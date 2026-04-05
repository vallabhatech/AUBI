"""
Orchestrator v3 - Supervisor Pattern with LLM-Driven Decision Making.

This orchestrator:
1. Uses an LLM to decide which tools/workers to spawn (not hardcoded)
2. Spawns multiple workers in parallel using Send API
3. Evaluates results and retries with different strategies if needed
4. Synthesizes a final answer from all gathered context

The key difference from v2: The orchestrator LLM DECIDES what to do,
rather than following hardcoded logic.
"""

from __future__ import annotations

import json
import logging
import operator
import re
import time
import uuid
from typing import Annotated, Any, Literal, Optional

from langchain_core.callbacks.manager import adispatch_custom_event
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, AnyMessage
from langchain_openai import ChatOpenAI
from langgraph.config import get_config
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.graph.state import CompiledStateGraph
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.types import Send
from pydantic import BaseModel, Field
from typing_extensions import TypedDict

from app.config import get_settings
from app.db.session import async_session_maker
from app.services import tenant_sql_context_service
from app.utils.http_client import get_http_client
from app.tools.graph_tools import query_graph, search_text, find_entity, get_graph_schema
from app.tools.cognee_tools import search_chunks, search_summaries, search_graph, search_rag
from app.tools.sql_tools import get_tenant_sql_tools, get_tenant_sql_tools_async
from app.tools.firecrawl_tools import (
    firecrawl_scrape,
    firecrawl_search,
    firecrawl_map,
    firecrawl_crawl,
    firecrawl_extract,
)

logger = logging.getLogger(__name__)


# =============================================================================
# STATE SCHEMAS
# =============================================================================

class ToolCall(TypedDict):
    """A tool call requested by the planner."""
    id: str
    tool_name: str
    tool_args: dict[str, Any]
    priority: Literal["high", "medium", "low"]
    rationale: str  # Why the planner chose this tool


class ToolResult(TypedDict):
    """Result from a tool execution."""
    call_id: str
    tool_name: str
    success: bool
    data: Any
    error: Optional[str]
    execution_time_ms: int


class OrchestratorV3State(TypedDict):
    """
    State for the v3 orchestrator with supervisor pattern.

    Key features:
    - Messages for conversation context
    - Planned tool calls (LLM-decided)
    - Tool results with operator.add for parallel writes
    - Evaluation and retry tracking
    """
    # Conversation
    messages: Annotated[list[AnyMessage], add_messages]
    query: str
    user_context: Optional[dict[str, Any]]
    tenant_id: Optional[str]
    canvas_id: Optional[str]
    chat_block_id: Optional[str]
    auto_artifacts: bool
    context_artifacts: list[dict[str, Any]]
    selected_tools: list[str]

    # Planning
    plan: Optional[str]  # LLM's reasoning about what to do
    planned_calls: list[ToolCall]

    # Execution - operator.add enables parallel worker writes
    tool_results: Annotated[list[ToolResult], operator.add]

    # Evaluation
    evaluation: Optional[dict[str, Any]]
    retry_count: int
    max_retries: int

    # Synthesis
    final_answer: Optional[str]
    confidence: float
    citations: list[dict[str, Any]]


async def _emit_ui_message(name: str, props: dict[str, Any]) -> None:
    await adispatch_custom_event(
        "ui",
        {
            "type": "ui",
            "id": f"ui_{uuid.uuid4().hex[:8]}",
            "name": name,
            "props": props,
        },
    )


def _use_contract_v2() -> bool:
    """Check whether contract v2 is enabled for this run."""
    try:
        config = get_config() or {}
        configurable = config.get("configurable", {})
        if isinstance(configurable, dict) and "deep_agent_contract_v2" in configurable:
            return bool(configurable.get("deep_agent_contract_v2"))
    except Exception:
        pass
    return bool(get_settings().deep_agent_contract_v2)


def _normalize_final_response_citations(citations: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not citations:
        return []
    normalized: list[dict[str, Any]] = []
    for citation in citations:
        if not isinstance(citation, dict):
            continue
        source_number = citation.get("source_number")
        source = citation.get("source") or (f"source:{source_number}" if source_number is not None else "source:unknown")
        normalized.append(
            {
                "source": source,
                "display_name": citation.get("display_name") or citation.get("tool_name") or "Source",
                "content": citation.get("content"),
                "group_key": citation.get("group_key"),
                "source_number": source_number,
                "metadata": citation.get("metadata"),
            }
        )
    return normalized


async def _emit_final_response_if_enabled(summary: str, citations: list[dict[str, Any]] | None = None) -> None:
    """Emit a contract v2 final_response event if enabled."""
    if not _use_contract_v2():
        return
    payload = {
        "summary": summary,
        "actions_taken": [],
        "artifacts": [],
        "citations": _normalize_final_response_citations(citations),
        "next_steps": [],
        "warnings": [],
        "raw_text": summary,
    }
    await adispatch_custom_event(
        "final_response",
        {
            "type": "final_response",
            "data": payload,
        },
    )


def _extract_text_from_content(content: Any) -> Optional[str]:
    if isinstance(content, str):
        stripped = content.strip()
        return stripped or None
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        combined = " ".join(part.strip() for part in parts if part.strip())
        return combined or None
    return None


def _extract_query_from_messages(messages: list[AnyMessage]) -> Optional[str]:
    for message in reversed(messages):
        if isinstance(message, HumanMessage):
            extracted = _extract_text_from_content(message.content)
            if extracted:
                return extracted
        if isinstance(message, dict):
            if message.get("type") in {"human", "user"}:
                extracted = _extract_text_from_content(message.get("content"))
                if extracted:
                    return extracted
    return None


async def normalize_input(state: OrchestratorV3State) -> dict[str, Any]:
    """Normalize incoming state for LangGraph API clients (e.g., agent-chat-ui)."""
    messages = state.get("messages") or []
    query = state.get("query")
    updates: dict[str, Any] = {}
    config = get_config() or {}
    configurable = config.get("configurable") if isinstance(config, dict) else {}

    latest_query = _extract_query_from_messages(messages) or ""
    if latest_query and latest_query != query:
        updates["query"] = latest_query
        query = latest_query

    if not messages and query:
        updates["messages"] = [HumanMessage(content=query)]

    if state.get("context_artifacts") is None:
        updates["context_artifacts"] = []
    if state.get("selected_tools") is None:
        updates["selected_tools"] = []
    if state.get("tool_results") is None:
        updates["tool_results"] = []
    if state.get("retry_count") is None:
        updates["retry_count"] = 0
    if state.get("max_retries") is None:
        updates["max_retries"] = 2
    if state.get("confidence") is None:
        updates["confidence"] = 0.0
    if state.get("citations") is None:
        updates["citations"] = []
    if state.get("evaluation") is None:
        updates["evaluation"] = None
    if state.get("final_answer") is None:
        updates["final_answer"] = None
    if state.get("tenant_id") is None and isinstance(configurable, dict):
        updates["tenant_id"] = configurable.get("tenant_id")

    return updates


class WorkerState(TypedDict):
    """State passed to individual tool workers."""
    tool_call: ToolCall
    tool_results: Annotated[list[ToolResult], operator.add]


# =============================================================================
# TOOL REGISTRY
# =============================================================================

# Build comprehensive tool descriptions for the planner LLM
BASE_TOOL_DESCRIPTIONS = """
## Available Tools

### Knowledge Graph Tools (via Cognee)
These search a knowledge graph built from program documents.

1. **find_entity(name)** - Find an entity by name and get its relationships
   - Best for: "Who is X?", "Tell me about X", finding specific people/teams/orgs
   - Returns: Entity info, type, incoming/outgoing relationships

2. **search_text(query, top_k=20)** - Semantic search over document chunks
   - Best for: Finding specific mentions, quotes, detailed context
   - Returns: Raw text passages matching the query

3. **query_graph(cypher_query)** - Run a Cypher query on the graph
   - Best for: Complex relationship queries, finding connections
   - Schema: Entity types include person, team, organization, event, session
   - Relationships: mentored_by, has_member, participates_in, held_on

4. **search_summaries(query)** - Search document summaries
   - Best for: High-level overviews, "summarize X"
   - Returns: Summary passages

5. **search_graph(query)** - Graph-enhanced search with synthesis
   - Best for: Complex questions requiring relationship understanding
   - Returns: Synthesized answer from graph traversal

6. **search_rag(query)** - Full RAG pipeline
   - Best for: Comprehensive answers, when other tools don't have enough
   - Returns: LLM-synthesized answer from retrieved context

### Tenant SQL Live Data Tools
These query the live application database for real-time information (read-only).

7. **sql_db_context(detail_level='summary')**
   - Best for: Cached tenant schema context and purpose

8. **sql_db_list_tables()**
   - Best for: Discovering what live tables exist

9. **sql_db_schema(table_names)**
   - Best for: Inspecting table structure and sample rows

10. **sql_db_query_checker(query)**
   - Best for: Validating SQL before execution

11. **sql_db_query(query)**
    - Best for: Running read-only SELECT queries for live data

### Web Research Tools (via Firecrawl)
These scrape or search the live web. Use when the question needs external sources.

12. **firecrawl_scrape(url, formats=['markdown'], only_main_content=True)**
    - Best for: Scraping a specific URL the user provides
    - Returns: Markdown + metadata for that page

13. **firecrawl_search(query, limit=5)**
    - Best for: Finding relevant public web pages for a query
    - Returns: Search results (title, url, description)

14. **firecrawl_map(url, limit?)**
    - Best for: Listing URLs on a site to explore or scrape
    - Returns: Discovered URLs

15. **firecrawl_crawl(url, limit?, max_discovery_depth?)**
    - Best for: Crawling a site to gather multiple pages
    - Returns: Crawl job info (may be async)

16. **firecrawl_extract(urls, prompt?, schema?)**
    - Best for: Structured extraction from one or more pages
    - Returns: Extracted structured data

### Memory Tools (if enabled)
17. **remember(content)** - Store information for later
18. **recall(query)** - Search stored memories

## Strategy Guidelines

- For entity queries ("Who is X?"): Start with find_entity, then search_text for more context
- For SQL schema orientation: Use sql_db_context before deeper SQL exploration
- For scheduling queries: Use sql_db_list_tables + sql_db_schema, then query live data via sql_db_query
- For team members/info: Use find_entity for names, then SQL tools to fetch live rows
- For complex analysis: Use multiple tools in parallel with different phrasings
- If a SQL tool fails: Re-check schema and run sql_db_query_checker before retrying
- If a tool returns 0 results: Try a different tool or different query phrasing
- For current/live data about teams/members: SQL tools are required, not just knowledge graph
"""


def _format_sql_context_block(sql_context: Optional[dict[str, Any]]) -> str:
    if not sql_context:
        return (
            "### Tenant SQL Context (Cached)\n"
            "- No cached tenant SQL context is available yet.\n"
            "- Call `sql_db_context` to fetch context after configuration."
        )
    formatted = tenant_sql_context_service.format_sql_context_for_prompt(
        sql_context,
        include_header=False,
    )
    return "### Tenant SQL Context (Cached)\n" + formatted


def build_tool_descriptions(sql_context: Optional[dict[str, Any]]) -> str:
    sql_block = _format_sql_context_block(sql_context)
    return f"{BASE_TOOL_DESCRIPTIONS}\n\n{sql_block}"


def get_all_tools(tenant_id: Optional[str], llm: Any) -> list:
    """Get all available tools for the orchestrator."""
    tools = [
        # Knowledge graph tools
        find_entity,
        search_text,
        query_graph,
        search_summaries,
        search_graph,
        search_rag,
        get_graph_schema,
        # Firecrawl tools
        firecrawl_scrape,
        firecrawl_search,
        firecrawl_map,
        firecrawl_crawl,
        firecrawl_extract,
    ]
    # Add Tenant SQL tools (prefer cached integration config if available)
    tools.extend(list(_get_sql_tool_map(tenant_id).values()) or get_tenant_sql_tools(tenant_id, llm))
    return tools


_SQL_TOOL_CACHE: dict[str, dict[str, Any]] = {}
_SQL_TOOL_LLM: Optional[Any] = None


def _get_sql_tool_llm() -> Any:
    global _SQL_TOOL_LLM
    if _SQL_TOOL_LLM is not None:
        return _SQL_TOOL_LLM
    settings = get_settings()
    _SQL_TOOL_LLM = ChatOpenAI(
        model=settings.default_research_model,
        api_key=settings.openai_api_key,
        temperature=0,
        http_async_client=get_http_client(),
    )
    return _SQL_TOOL_LLM


def _get_sql_tool_map(tenant_id: Optional[str]) -> dict[str, Any]:
    cache_key = tenant_id or "default"
    if cache_key not in _SQL_TOOL_CACHE:
        sql_tools = get_tenant_sql_tools(tenant_id, _get_sql_tool_llm())
        _SQL_TOOL_CACHE[cache_key] = {tool.name: tool for tool in sql_tools}
    return _SQL_TOOL_CACHE[cache_key]


async def _prime_sql_tool_cache(tenant_id: Optional[str]) -> None:
    cache_key = tenant_id or "default"
    if cache_key in _SQL_TOOL_CACHE:
        return
    sql_tools = await get_tenant_sql_tools_async(tenant_id, _get_sql_tool_llm())
    _SQL_TOOL_CACHE[cache_key] = {tool.name: tool for tool in sql_tools}


def get_tool_by_name(name: str, tenant_id: Optional[str] = None):
    """Get a tool function by its name."""
    tool_map = {
        "find_entity": find_entity,
        "search_text": search_text,
        "query_graph": query_graph,
        "search_summaries": search_summaries,
        "search_graph": search_graph,
        "search_rag": search_rag,
        "get_graph_schema": get_graph_schema,
        "search_chunks": search_chunks,
        "firecrawl_scrape": firecrawl_scrape,
        "firecrawl_search": firecrawl_search,
        "firecrawl_map": firecrawl_map,
        "firecrawl_crawl": firecrawl_crawl,
        "firecrawl_extract": firecrawl_extract,
    }
    # Add tenant SQL tools
    if name.startswith("sql_db_"):
        tool_map.update(_get_sql_tool_map(tenant_id))
    return tool_map.get(name)


# =============================================================================
# PLANNER NODE
# =============================================================================

PLANNER_SYSTEM_PROMPT = """You are an intelligent research planner for a mentorship platform.

Your job is to analyze the user's query and decide which tools to use to gather information.
You have access to knowledge graph tools (historical data) and live SQL tools (real-time data).

{tool_descriptions}

## Your Task

Given a query, output a JSON plan with:
1. Your reasoning about what information is needed
2. A list of tool calls to execute IN PARALLEL

IMPORTANT:
- For conversational queries (greetings like "hi", "hello", "thanks", or questions about your capabilities), return an EMPTY tool_calls array - no research is needed
- Choose 2-5 tools that complement each other
- Use different query phrasings for text searches to get broader coverage
- Prefer live SQL tools for questions about schedules, sessions, teams
- Prefer knowledge graph tools for historical context, relationships, program info
- If the query mentions a specific entity, always include find_entity
- Include your rationale for each tool choice

## Output Format (JSON only, no markdown)

{{
    "reasoning": "Brief analysis of what the query needs...",
    "tool_calls": [
        {{
            "tool_name": "find_entity",
            "tool_args": {{"name": "defenx"}},
            "priority": "high",
            "rationale": "Get entity info and relationships"
        }},
        {{
            "tool_name": "search_text",
            "tool_args": {{"query": "defenx team challenges", "top_k": 10}},
            "priority": "medium",
            "rationale": "Find mentions of challenges in documents"
        }}
    ]
}}
"""


class PlannerOutput(BaseModel):
    """Structured output for the planner."""
    reasoning: str = Field(description="Analysis of what information is needed")
    tool_calls: list[dict] = Field(description="List of tool calls to execute")


def _extract_first_url(text: str) -> Optional[str]:
    match = re.search(r"https?://\S+", text)
    if not match:
        return None
    url = match.group(0).rstrip(").,]")
    return url


def _ensure_selected_tools(
    planned_calls: list[ToolCall],
    selected_tools: list[str],
    query: str,
) -> list[ToolCall]:
    """Ensure user-selected tool groups are represented in planned calls."""
    if not selected_tools:
        return planned_calls

    normalized = {
        ("sql" if tool.strip().lower() == "mentor_hub" else tool.strip().lower())
        for tool in selected_tools
        if tool.strip()
    }
    updated_calls = list(planned_calls)

    if "firecrawl" in normalized:
        has_firecrawl = any(call["tool_name"].startswith("firecrawl_") for call in planned_calls)
        if not has_firecrawl:
            url = _extract_first_url(query)
            tool_name = "firecrawl_scrape" if url else "firecrawl_search"
            tool_args = {"url": url, "formats": ["markdown"], "only_main_content": True} if url else {
                "query": query,
                "limit": 5,
            }
            updated_calls.append(ToolCall(
                id=f"forced_firecrawl_{uuid.uuid4().hex[:6]}",
                tool_name=tool_name,
                tool_args=tool_args,
                priority="high",
                rationale="User selected Firecrawl for this request",
            ))

    return updated_calls


async def planner_node(state: OrchestratorV3State) -> dict[str, Any]:
    """
    LLM-driven planning node.

    Analyzes the query and decides which tools to use.
    This is the "brain" that determines the research strategy.
    """
    query = state["query"]
    user_context = state.get("user_context")
    context_artifacts = state.get("context_artifacts") or []
    selected_tools = state.get("selected_tools") or []
    retry_count = state.get("retry_count", 0)
    previous_results = state.get("tool_results", [])
    previous_evaluation = state.get("evaluation")

    settings = get_settings()
    llm = ChatOpenAI(
        model=settings.default_orchestrator_model,
        api_key=settings.openai_api_key,
        temperature=0.1,  # Low temperature for consistent planning
        http_async_client=get_http_client(),
    )

    # Build context for the planner
    context_parts = []

    if user_context:
        context_parts.append(f"Current user: {user_context.get('name', 'Unknown')}")
        if user_context.get("role"):
            context_parts.append(f"Role: {user_context['role']}")
        if user_context.get("teams"):
            context_parts.append(f"Teams: {', '.join(user_context['teams'])}")

    context_section = "\n".join(context_parts) if context_parts else "No user context"
    artifacts_section = _format_context_artifacts(context_artifacts)
    if artifacts_section:
        context_section = f"{context_section}\n\n{artifacts_section}"

    # If this is a retry, include feedback about what didn't work
    retry_section = ""
    if retry_count > 0 and previous_evaluation:
        retry_section = f"""
## Retry Context (Attempt {retry_count + 1})

Previous attempt feedback: {previous_evaluation.get('feedback', 'Unknown')}
Suggested refinements: {previous_evaluation.get('suggested_refinements', [])}

Previous tool results summary:
"""
        for result in previous_results[-5:]:  # Last 5 results
            status = "✓" if result.get("success") else "✗"
            data_preview = str(result.get("data", ""))[:100]
            retry_section += f"- {status} {result.get('tool_name')}: {data_preview}...\n"

        retry_section += "\nPlease try DIFFERENT tools or DIFFERENT query phrasings."

    sql_context_summary = None
    if state.get("tenant_id"):
        async with async_session_maker() as session:
            sql_context_summary = await tenant_sql_context_service.get_context_summary_for_prompt(
                session,
                state["tenant_id"],
            )
            await tenant_sql_context_service.refresh_context_if_stale(session, state["tenant_id"])

    # Build the prompt
    system_prompt = PLANNER_SYSTEM_PROMPT.format(
        tool_descriptions=build_tool_descriptions(sql_context_summary),
    )

    tool_selection_note = ""
    if selected_tools:
        tool_list = ", ".join(selected_tools)
        tool_selection_note = (
            f"## User-Selected Tools\n"
            f"The user explicitly selected: {tool_list}.\n"
            "Include at least one call to each selected tool when possible.\n\n"
        )

    user_prompt = f"""## User Context
{context_section}

{tool_selection_note}## Query
{query}

{retry_section}

Now output your plan as JSON (no markdown code blocks):"""

    try:
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])

        # Parse the JSON response
        content = response.content.strip()
        # Remove markdown code blocks if present
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        content = content.strip()

        plan_data = json.loads(content)

        # Emit thinking event so frontend can display the planner's reasoning
        reasoning = plan_data.get("reasoning", "")
        if reasoning:
            await adispatch_custom_event(
                "thinking",
                {
                    "type": "thinking",
                    "phase": "planner",
                    "content": reasoning,
                    "agent": "Planner",
                },
            )
            await _emit_ui_message(
                "thinking",
                {
                    "phase": "planner",
                    "content": reasoning,
                    "agent": "Planner",
                },
            )

        # Convert to ToolCall format
        planned_calls = []
        for i, call in enumerate(plan_data.get("tool_calls", [])):
            planned_calls.append(ToolCall(
                id=f"call_{i}_{uuid.uuid4().hex[:6]}",
                tool_name=call.get("tool_name"),
                tool_args=call.get("tool_args", {}),
                priority=call.get("priority", "medium"),
                rationale=call.get("rationale", ""),
            ))

        planned_calls = _ensure_selected_tools(planned_calls, selected_tools, query)

        if planned_calls:
            await _emit_ui_message(
                "plan",
                {
                    "reasoning": reasoning,
                    "tool_calls": planned_calls,
                },
            )

        logger.info(f"Planner created {len(planned_calls)} tool calls for query: {query[:50]}...")

        return {
            "plan": plan_data.get("reasoning", ""),
            "planned_calls": planned_calls,
        }

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse planner output: {e}")
        # Fallback: create basic plan
        return {
            "plan": "Fallback plan due to parsing error",
            "planned_calls": [
                ToolCall(
                    id=f"fallback_1",
                    tool_name="search_text",
                    tool_args={"query": query, "top_k": 15},
                    priority="high",
                    rationale="Fallback text search",
                ),
                ToolCall(
                    id=f"fallback_2",
                    tool_name="search_rag",
                    tool_args={"query": query},
                    priority="medium",
                    rationale="Fallback RAG search",
                ),
            ],
        }


# =============================================================================
# WORKER SPAWNER (CONDITIONAL EDGE)
# =============================================================================

def route_after_planner(state: OrchestratorV3State) -> list[Send] | Literal["synthesizer"]:
    """
    Route after planner: either spawn workers or go directly to synthesizer.

    For queries that don't need research (greetings, simple questions),
    the planner may produce no tool calls. In that case, go straight to
    synthesizer for a conversational response.
    """
    planned_calls = state.get("planned_calls", [])

    if not planned_calls:
        # No research needed - go directly to synthesizer for conversational response
        logger.info("No tool calls planned - routing directly to synthesizer")
        return "synthesizer"

    # Spawn workers for research
    logger.info(f"Spawning {len(planned_calls)} parallel workers")
    return [
        Send("tool_worker", {"tool_call": call})
        for call in planned_calls
    ]


# =============================================================================
# TOOL WORKER NODE
# =============================================================================

async def tool_worker(state: WorkerState) -> dict[str, Any]:
    """
    Execute a single tool call.

    This node is spawned multiple times in parallel via Send API.
    Each instance executes one tool and writes results to shared state.
    """
    tool_call = state["tool_call"]
    start_time = time.time()

    tool_name = tool_call["tool_name"]
    tool_args = tool_call["tool_args"]
    call_id = tool_call["id"]
    config = get_config() or {}
    configurable = config.get("configurable") if isinstance(config, dict) else {}
    tenant_id = configurable.get("tenant_id") if isinstance(configurable, dict) else None

    logger.info(f"Worker executing {tool_name} with args: {tool_args}")

    await _emit_ui_message(
        "tool_call",
        {
            "tool_name": tool_name,
            "tool_args": tool_args,
        },
    )

    try:
        # Get the tool function
        tool_fn = get_tool_by_name(tool_name, tenant_id=tenant_id)

        if not tool_fn:
            raise ValueError(f"Unknown tool: {tool_name}")

        # Execute the tool
        result_data = await tool_fn.ainvoke(tool_args)

        execution_time = int((time.time() - start_time) * 1000)

        # Check for empty results
        is_empty = False
        if isinstance(result_data, dict):
            if result_data.get("count", -1) == 0:
                is_empty = True
            elif result_data.get("results") == []:
                is_empty = True
            elif "error" in result_data:
                is_empty = True

        result = ToolResult(
            call_id=call_id,
            tool_name=tool_name,
            success=not is_empty,
            data=result_data,
            error=result_data.get("error") if isinstance(result_data, dict) else None,
            execution_time_ms=execution_time,
        )

        logger.info(f"Worker completed {tool_name} in {execution_time}ms (success={not is_empty})")

        await _emit_ui_message(
            "tool_result",
            {
                "tool_name": tool_name,
                "success": not is_empty,
                "summary": _summarize_tool_result(tool_name, result_data),
            },
        )

        return {"tool_results": [result]}

    except Exception as e:
        execution_time = int((time.time() - start_time) * 1000)
        logger.error(f"Worker failed {tool_name}: {e}")

        result = ToolResult(
            call_id=call_id,
            tool_name=tool_name,
            success=False,
            data=None,
            error=str(e),
            execution_time_ms=execution_time,
        )

        await _emit_ui_message(
            "tool_result",
            {
                "tool_name": tool_name,
                "success": False,
                "summary": str(e),
            },
        )

        return {"tool_results": [result]}


# =============================================================================
# EVALUATOR NODE
# =============================================================================

EVALUATOR_SYSTEM_PROMPT = """You are evaluating research results for a mentorship platform query.

Determine if the gathered information is sufficient to answer the user's question.

## Evaluation Criteria

1. **Live Data Required**: For questions about teams, members, sessions, or tasks, the SQL tools MUST succeed
2. **Query Coverage**: Do the results contain information relevant to the question?
3. **Critical Failures**: If a SQL tool failed but find_entity succeeded, retry with improved schema/filters

## Important Patterns

- If a SQL query failed but `find_entity` succeeded and returned a team name:
  - Set passed=false
  - In suggested_refinements, include: "Retry SQL query using exact name from find_entity"

- If asking about team members and only have knowledge graph data (not live SQL data):
  - Set passed=false, suggest using SQL tools for current member list

## Output Format (JSON only)

{
    "passed": true/false,
    "confidence": 0.0-1.0,
    "feedback": "Brief explanation of the evaluation",
    "suggested_refinements": ["refinement 1", "refinement 2"] or [],
    "has_live_data": true/false,
    "has_knowledge_data": true/false
}
"""


async def evaluator_node(state: OrchestratorV3State) -> dict[str, Any]:
    """
    Evaluate the quality of gathered results.

    Decides whether to:
    - Proceed to synthesis (if sufficient)
    - Retry with different strategy (if insufficient and retries left)
    - Finalize with best effort (if max retries reached)
    """
    query = state["query"]
    tool_results = state.get("tool_results", [])
    retry_count = state.get("retry_count", 0)
    max_retries = state.get("max_retries", 2)

    settings = get_settings()
    llm = ChatOpenAI(
        model=settings.default_research_model,
        api_key=settings.openai_api_key,
        temperature=0,
        http_async_client=get_http_client(),
    )

    # Summarize results for evaluation
    successful = [r for r in tool_results if r.get("success")]
    failed = [r for r in tool_results if not r.get("success")]

    results_summary = f"""
## Query
{query}

## Tool Results Summary
- Total tools called: {len(tool_results)}
- Successful: {len(successful)}
- Failed: {len(failed)}
- Retry attempt: {retry_count + 1} of {max_retries + 1}

### Successful Results:
"""

    for r in successful:
        data_preview = str(r.get("data", ""))[:300]
        results_summary += f"\n**{r['tool_name']}**: {data_preview}...\n"

    if failed:
        results_summary += "\n### Failed Results:\n"
        for r in failed:
            results_summary += f"- {r['tool_name']}: {r.get('error', 'Unknown error')}\n"

    try:
        response = await llm.ainvoke([
            SystemMessage(content=EVALUATOR_SYSTEM_PROMPT),
            HumanMessage(content=results_summary),
        ])

        content = response.content.strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        content = content.strip()

        evaluation = json.loads(content)

        # Emit thinking event so frontend can display the evaluator's reasoning
        feedback = evaluation.get("feedback", "")
        if feedback:
            passed_status = "✓ Passed" if evaluation.get("passed") else "✗ Needs more info"
            await adispatch_custom_event(
                "thinking",
                {
                    "type": "thinking",
                    "phase": "evaluator",
                    "content": f"{passed_status}: {feedback}",
                    "agent": "Evaluator",
                },
            )

        logger.info(f"Evaluation: passed={evaluation.get('passed')}, confidence={evaluation.get('confidence')}")

        return {"evaluation": evaluation}

    except json.JSONDecodeError:
        # Fallback evaluation based on stricter heuristics
        has_live_data = any(r["tool_name"].startswith("sql_db_") for r in successful)
        has_knowledge_data = any(not r["tool_name"].startswith("sql_db_") for r in successful)
        has_sql_failure = any(r["tool_name"].startswith("sql_db_") for r in failed)

        # For team/member queries, we need live data - fail if SQL tools failed
        if has_sql_failure and not has_live_data:
            passed = False
            feedback = "SQL tool failed - retry with exact name from find_entity"
        elif len(successful) >= 2:
            passed = True
            feedback = "Sufficient results gathered"
        else:
            passed = False
            feedback = "Insufficient results"

        evaluation = {
            "passed": passed,
            "confidence": len(successful) / max(len(tool_results), 1) if passed else 0.3,
            "feedback": feedback,
            "suggested_refinements": [] if passed else ["Retry failed SQL tools with exact names"],
            "has_live_data": has_live_data,
            "has_knowledge_data": has_knowledge_data,
        }

        # Emit thinking event for fallback evaluation
        passed_status = "✓ Passed" if passed else "✗ Needs more info"
        await adispatch_custom_event(
            "thinking",
            {
                "type": "thinking",
                "phase": "evaluator",
                "content": f"{passed_status}: {feedback}",
                "agent": "Evaluator",
            },
        )

        return {"evaluation": evaluation}


def should_retry_or_synthesize(state: OrchestratorV3State) -> Literal["retry", "synthesize"]:
    """Decide whether to retry research or proceed to synthesis."""
    evaluation = state.get("evaluation") or {}  # Handle None case
    retry_count = state.get("retry_count", 0)
    max_retries = state.get("max_retries", 2)

    if evaluation.get("passed", False):
        logger.info("Evaluation passed, proceeding to synthesis")
        return "synthesize"

    if retry_count >= max_retries:
        logger.info(f"Max retries ({max_retries}) reached, proceeding to synthesis with best effort")
        return "synthesize"

    logger.info(f"Evaluation failed, retrying (attempt {retry_count + 1}/{max_retries})")
    return "retry"


async def increment_retry(state: OrchestratorV3State) -> dict[str, Any]:
    """Increment retry count before going back to planner."""
    return {"retry_count": state.get("retry_count", 0) + 1}


# =============================================================================
# SYNTHESIZER NODE
# =============================================================================

CONVERSATIONAL_SYSTEM_PROMPT = """You are a helpful AI assistant for a mentorship platform called Mentor Hub.

You help students, mentors, and staff with questions about mentorship sessions, tasks, teams, and program information.

For this query, no research or data retrieval was needed. Respond conversationally and helpfully.

If the user is greeting you, greet them back warmly.
If they're asking what you can do, explain your capabilities:
- Answer questions about teams, members, and mentors
- Look up session schedules and summaries
- Check task status and assignments
- Search program documents and knowledge base
- Help with mentor matching

Keep responses concise and friendly.
Do not mention internal UI elements or internal tooling.
"""


SYNTHESIZER_TABLE_INSTRUCTIONS = """## Data Tables (IMPORTANT)

When presenting lists of database records (tasks, sessions, teams, members, mentors), you may output
them as Markdown pipe tables (preferred for chat display) or as a JSON array wrapped in a ```json
code block (optional, for programmatic use).

Example for tasks:
```json
[
  {{"name": "Complete MVP", "status": "In Progress", "due": "2025-01-20", "priority": "High"}},
  {{"name": "User testing", "status": "Not Started", "due": "2025-01-25", "priority": "Medium"}}
]
```

Example for team members:
```json
[
  {{"fullName": "John Smith", "email": "john@example.com", "type": "Participant"}},
  {{"fullName": "Jane Doe", "email": "jane@example.com", "type": "Mentor"}}
]
```

Example for sessions:
```json
[
  {{"scheduledStart": "2025-01-20T14:00:00", "sessionType": "Weekly Check-in", "status": "Scheduled"}},
  {{"scheduledStart": "2025-01-13T14:00:00", "sessionType": "Deep Dive", "status": "Completed"}}
]
```

**Rules for data tables:**
- Prefer Markdown pipe tables for ANY list of 2+ records from database queries
- JSON code blocks are allowed when the user explicitly asks for JSON or data export
- Include relevant fields: name/title, status, dates, assignees, etc.
- You can add text explanations before/after the table
"""


SYNTHESIZER_SYSTEM_PROMPT_BASE = """You are synthesizing research results into a helpful answer for a mentorship platform.

## Guidelines

1. **Be comprehensive**: Use all relevant information from the results
2. **Be accurate**: Only state what the data supports
3. **Use inline citations**: Add [N] markers when referencing specific data
4. **Be helpful**: Format the answer clearly with sections if needed
5. **Acknowledge gaps**: If information is incomplete, say so
6. **Avoid internal UI references**: Do not mention internal UI elements or internal tooling

## Citation Format

IMPORTANT: When citing specific facts, use [N] markers where N is the source number:
- When mentioning a specific person, add [N] after their name
- When citing session or task data, add [N] after the fact
- When referencing team information, add [N] after the detail
- Multiple facts from the same source can share the same marker

Example: "DefenX has 3 active members [1] including John Smith [1] who is working on the MVP task [2]."

{table_instructions}
{document_instructions}

## Text Formatting

- **Bold** for key information
- Bullet points for lists of non-database items
- Headers (##) for sections if the answer is long

{context_section}
"""

DOCUMENT_INSTRUCTIONS = """## Document Output

When the response should be a note or document, start with a single H1 title line:

`# Title`

Then write the document content on the following lines. Keep the title short and descriptive. Do not mention internal UI elements or internal tooling.
"""


def _should_prompt_document(state: OrchestratorV3State) -> bool:
    if not state.get("canvas_id"):
        return False
    query = state.get("query") or ""
    return bool(
        re.search(r"^\s*(note|doc|document)\b", query, re.IGNORECASE)
        or re.search(
            r"\b(create|write|draft|make)\s+(a\s+)?(note|doc|document|summary)\b",
            query,
            re.IGNORECASE,
        )
    )


def _build_document_instructions(state: OrchestratorV3State) -> str:
    return DOCUMENT_INSTRUCTIONS if _should_prompt_document(state) else ""


async def _handle_conversational_query(
    query: str,
    user_context: Optional[dict[str, Any]],
    context_artifacts: Optional[list[dict[str, Any]]] = None,
    document_instructions: str = "",
) -> dict[str, Any]:
    """Handle simple conversational queries without research."""
    settings = get_settings()
    llm = ChatOpenAI(
        model=settings.default_orchestrator_model,
        api_key=settings.openai_api_key,
        temperature=0.7,  # Slightly higher for conversational tone
        http_async_client=get_http_client(),
    )

    # Build context
    context_parts = []
    if user_context:
        if user_context.get("name"):
            context_parts.append(f"User's name: {user_context['name']}")
        if user_context.get("role"):
            context_parts.append(f"User's role: {user_context['role']}")
        if user_context.get("teams"):
            context_parts.append(f"User's teams: {', '.join(user_context['teams'])}")

    artifacts_section = _format_context_artifacts(context_artifacts or [])
    if artifacts_section:
        context_parts.append(artifacts_section)

    user_prompt = query
    if context_parts:
        context_text = "\n".join(context_parts)
        user_prompt = f"User context:\n{context_text}\n\nUser says: {query}"

    system_prompt = CONVERSATIONAL_SYSTEM_PROMPT
    if document_instructions:
        system_prompt = f"{system_prompt}\n\n{document_instructions}"

    response = await llm.ainvoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ])

    await _emit_final_response_if_enabled(response.content, citations=[])

    return {
        "final_answer": response.content,
        "confidence": 1.0,
        "citations": [],
        "messages": [AIMessage(content=response.content)],
    }


async def synthesizer_node(state: OrchestratorV3State) -> dict[str, Any]:
    """
    Synthesize all gathered information into a final answer.

    Two-pass approach:
    1. Stream the answer with [N] inline citations
    2. Build rich citation data from tool results for frontend display

    For conversational queries (no tool results), generates a friendly response.

    This is the final step that produces the user-facing response.
    """
    query = state["query"]
    tool_results = state.get("tool_results", [])
    user_context = state.get("user_context")
    context_artifacts = state.get("context_artifacts") or []
    evaluation = state.get("evaluation") or {}  # Handle None case

    # Handle conversational queries with no research needed
    successful_results = [r for r in tool_results if r.get("success")]
    if not successful_results:
        document_instructions = _build_document_instructions(state)
        result = await _handle_conversational_query(
            query, user_context, context_artifacts, document_instructions
        )
        await _emit_handoff_event_if_needed(state, result.get("final_answer", ""))
        return result

    settings = get_settings()
    llm = ChatOpenAI(
        model=settings.default_orchestrator_model,
        api_key=settings.openai_api_key,
        streaming=True,
        http_async_client=get_http_client(),
    )

    # Build context
    context_parts = []
    if user_context:
        if user_context.get("name"):
            context_parts.append(f"User: {user_context['name']}")
        if user_context.get("role"):
            context_parts.append(f"Role: {user_context['role']}")

    context_section = "\n".join(context_parts) if context_parts else ""
    artifacts_section = _format_context_artifacts(context_artifacts)
    if artifacts_section:
        context_section = f"{context_section}\n\n{artifacts_section}" if context_section else artifacts_section

    # Build source index for citation mapping
    source_index: list[dict[str, Any]] = []
    results_text = "## Research Results\n\n"

    for i, r in enumerate(successful_results, start=1):
        tool_name = r["tool_name"]
        data = r.get("data", {})

        # Add to source index for citation mapping
        source_entry = {
            "source_number": i,
            "tool_name": tool_name,
            "data": data,
        }
        source_index.append(source_entry)

        results_text += f"### Source {i}: {tool_name}\n"

        # Format based on tool type
        if isinstance(data, dict):
            if tool_name == "firecrawl_search":
                results = data.get("results", [])
                results_text += f"Found {len(results)} web results:\n"
                for item in results[:5]:
                    if not isinstance(item, dict):
                        results_text += f"- {str(item)[:200]}...\n"
                        continue
                    title = item.get("title") or item.get("url") or "Result"
                    url = item.get("url")
                    description = item.get("description") or ""
                    line = f"- {title}"
                    if url:
                        line += f" ({url})"
                    if description:
                        line += f": {description[:200]}"
                    results_text += f"{line}\n"
            elif tool_name == "firecrawl_scrape":
                results_text += f"Scraped URL: {data.get('url', 'Unknown')}\n"
                metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
                title = metadata.get("title") or metadata.get("og:title")
                if title:
                    results_text += f"Title: {title}\n"
                summary = data.get("summary")
                markdown = data.get("markdown")
                if summary:
                    results_text += f"Summary: {summary[:400]}\n"
                elif markdown:
                    results_text += f"Content: {markdown[:500]}...\n"
                links = data.get("links")
                if isinstance(links, list):
                    results_text += f"Links: {len(links)}\n"
            elif tool_name == "firecrawl_map":
                urls = data.get("urls") if isinstance(data.get("urls"), list) else []
                results_text += f"Found {len(urls)} URLs:\n"
                for url in urls[:10]:
                    results_text += f"- {url}\n"
            elif tool_name == "firecrawl_extract":
                results = data.get("results")
                if isinstance(results, list):
                    results_text += f"Extracted {len(results)} items:\n"
                    for item in results[:5]:
                        results_text += f"- {json.dumps(item, ensure_ascii=True)[:200]}...\n"
                elif isinstance(results, dict):
                    results_text += "Extracted data:\n"
                    results_text += f"{json.dumps(results, ensure_ascii=True)[:500]}...\n"
                else:
                    results_text += f"{str(results)[:500]}...\n"
            elif tool_name == "firecrawl_crawl":
                job = data.get("job") or data
                results_text += f"Crawl job: {json.dumps(job, ensure_ascii=True)[:500]}...\n"
            elif "sessions" in data:
                results_text += f"Found {data.get('count', 0)} sessions:\n"
                for s in data.get("sessions", [])[:5]:
                    results_text += f"- {s.get('scheduled_start', 'No date')}: {s.get('type', 'Session')} with {s.get('mentor', 'Unknown')}\n"
                    if s.get("summary"):
                        results_text += f"  Summary: {s['summary'][:200]}...\n"
            elif "active_members" in data:
                # Team data from live SQL or other tools
                results_text += f"Team: {data.get('name', 'Unknown')}\n"
                if data.get("description"):
                    results_text += f"Description: {data['description'][:300]}\n"
                results_text += f"Status: {data.get('status', 'Unknown')}\n"
                # Format active members
                active = data.get("active_members", [])
                if active:
                    results_text += f"\nActive Members ({len(active)}):\n"
                    for m in active:
                        name = m.get("name", "Unknown")
                        member_type = m.get("type", "")
                        email = m.get("email", "")
                        results_text += f"- {name}"
                        if member_type:
                            results_text += f" ({member_type})"
                        if email:
                            results_text += f" - {email}"
                        results_text += "\n"
                # Format other members if any
                other = data.get("other_members", [])
                if other:
                    results_text += f"\nOther Members ({len(other)}):\n"
                    for m in other[:5]:  # Limit to 5
                        results_text += f"- {m.get('name', 'Unknown')} ({m.get('status', 'Unknown')})\n"
            elif "mentors" in data:
                # Mentor search results
                results_text += f"Found {data.get('count', 0)} mentors:\n"
                for m in data.get("mentors", [])[:5]:
                    results_text += f"- {m.get('name', 'Unknown')}"
                    if m.get("bio"):
                        results_text += f": {m['bio'][:100]}..."
                    results_text += "\n"
            elif "tasks" in data:
                # Tasks data
                results_text += f"Found {data.get('count', 0)} tasks:\n"
                for t in data.get("tasks", [])[:5]:
                    results_text += f"- {t.get('title', 'Untitled')} [{t.get('status', 'Unknown')}]"
                    if t.get("assignee"):
                        results_text += f" - Assigned to: {t['assignee']}"
                    results_text += "\n"
            elif "results" in data:
                results_text += f"Found {data.get('count', 0)} results:\n"
                for item in data.get("results", [])[:5]:
                    if isinstance(item, dict):
                        text = item.get("text", item.get("name", str(item)))[:200]
                        results_text += f"- {text}...\n"
                    else:
                        results_text += f"- {str(item)[:200]}...\n"
            elif "found" in data:  # Entity result
                if data.get("found"):
                    results_text += f"Entity: {data.get('name', 'Unknown')}\n"
                    if data.get("description"):
                        results_text += f"Description: {data['description'][:200]}\n"
                    if data.get("outgoing_relationships"):
                        results_text += f"Relationships: {len(data['outgoing_relationships'])} connections\n"
                        # Show some relationship details
                        for rel in data.get("outgoing_relationships", [])[:5]:
                            if isinstance(rel, dict):
                                results_text += f"  - {rel.get('rel', 'related')}: {rel.get('target', 'unknown')}\n"
            else:
                results_text += f"{str(data)[:500]}...\n"
        else:
            results_text += f"{str(data)[:500]}...\n"

        results_text += "\n"

    # Add note about confidence
    confidence = evaluation.get("confidence", 0.5)
    if confidence < 0.5:
        results_text += "\n*Note: Limited information was found for this query.*\n"

    if state.get("canvas_id") and state.get("auto_artifacts"):
        await _emit_canvas_artifacts(source_index, state)

    # Synthesize with inline citation instructions
    user_prompt = f"""## User Question
{query}

{results_text}

Now provide a comprehensive, well-formatted answer to the user's question.
Use [N] markers to cite specific facts (where N is the source number from above).
For example: "The team has 5 members [1] and their next session is Jan 15 [2]."
"""

    table_instructions = "" if state.get("canvas_id") else SYNTHESIZER_TABLE_INSTRUCTIONS
    document_instructions = _build_document_instructions(state)
    system_prompt = SYNTHESIZER_SYSTEM_PROMPT_BASE.format(
        context_section=context_section,
        table_instructions=table_instructions,
        document_instructions=document_instructions,
    )

    response = await llm.ainvoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ])

    # Build rich citations from source index and emit as custom events
    # The event_mapper will pick these up and include them in the complete event
    citations = []
    for source in source_index:
        source_num = source["source_number"]
        tool_name = source["tool_name"]
        data = source["data"]

        citation = {
            "source_number": source_num,
            "source": f"source:{source_num}",
            "tool_name": tool_name,
            "entity_type": _get_entity_type_from_tool(tool_name),
            "display_name": _get_display_name_from_data(tool_name, data),
            "content": _get_content_summary_from_data(tool_name, data),
            "group_key": _get_group_key_from_tool(tool_name),
            "data": data,  # Include full data for frontend to extract details
        }
        citations.append(citation)

        # Emit citation as custom event for SSE streaming
        # The event_mapper handles these and adds them to the complete event
        await adispatch_custom_event(
            "citation",
            {
                "type": "citation",
                "source": citation["source"],
                "source_number": source_num,
                "entity_type": citation["entity_type"],
                "display_name": citation["display_name"],
                "content": citation["content"],
                "group_key": citation["group_key"],
                "confidence": 1.0,
                "metadata": _extract_metadata_from_data(tool_name, data),
            },
        )
        logger.debug(f"Emitted citation event for source {source_num}: {citation['display_name']}")

    await _emit_document_artifact_if_needed(state, response.content)

    await _emit_handoff_event_if_needed(state, response.content)

    await _emit_final_response_if_enabled(response.content, citations=citations)

    return {
        "final_answer": response.content,
        "confidence": confidence,
        "citations": citations,
        "source_index": source_index,  # For debugging/reference
        "messages": [AIMessage(content=response.content)],
    }


def _get_entity_type_from_tool(tool_name: str) -> str:
    """Map tool name to entity type for citation display."""
    mapping = {
        "sql_db_query": "live_data",
        "sql_db_schema": "schema",
        "sql_db_list_tables": "schema",
        "sql_db_query_checker": "validation",
        "sql_db_context": "schema",
        "find_entity": "entity",
        "search_text": "document",
        "search_chunks": "document",
        "search_summaries": "document",
        "search_rag": "document",
        "search_graph": "document",
        "query_graph": "entity",
        "firecrawl_scrape": "document",
        "firecrawl_search": "document",
        "firecrawl_map": "document",
        "firecrawl_extract": "document",
        "firecrawl_crawl": "document",
    }
    return mapping.get(tool_name, "document")


def _get_group_key_from_tool(tool_name: str) -> str:
    """Map tool name to group key for citation grouping."""
    mapping = {
        "sql_db_query": "live_data",
        "sql_db_schema": "schema",
        "sql_db_list_tables": "schema",
        "sql_db_query_checker": "validation",
        "sql_db_context": "schema",
        "find_entity": "entities",
        "search_text": "documents",
        "search_chunks": "documents",
        "search_summaries": "documents",
        "search_rag": "documents",
        "search_graph": "documents",
        "query_graph": "entities",
        "firecrawl_scrape": "documents",
        "firecrawl_search": "documents",
        "firecrawl_map": "documents",
        "firecrawl_extract": "documents",
        "firecrawl_crawl": "documents",
    }
    return mapping.get(tool_name, "documents")


def _get_display_name_from_data(tool_name: str, data: dict) -> str:
    """Extract a human-readable display name from tool result data."""
    if not isinstance(data, dict):
        return tool_name

    if tool_name.startswith("sql_db_"):
        if tool_name == "sql_db_query":
            return "SQL Query Result"
        if tool_name == "sql_db_schema":
            return "SQL Schema"
        if tool_name == "sql_db_list_tables":
            return "SQL Tables"
        if tool_name == "sql_db_query_checker":
            return "SQL Query Check"
        if tool_name == "sql_db_context":
            return "SQL Context"
        return "SQL Tool"
    elif tool_name == "find_entity":
        return data.get("name", "Entity")
    elif tool_name in ("search_text", "search_chunks", "search_summaries", "search_graph", "search_rag", "search_natural_language"):
        results = data.get("results", [])
        count = len(results)
        if count == 1 and isinstance(results[0], dict):
            title = results[0].get("title") or results[0].get("name") or results[0].get("document_name")
            if isinstance(title, str) and title.strip():
                return title.strip()
        return f"Documents ({count})" if count > 1 else "Document"
    elif tool_name == "firecrawl_scrape":
        metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
        title = metadata.get("title") or metadata.get("og:title")
        if isinstance(title, str) and title.strip():
            return title.strip()
        url = data.get("url")
        return url if isinstance(url, str) and url.strip() else "Scraped Page"
    elif tool_name == "firecrawl_search":
        count = data.get("count")
        if not isinstance(count, int):
            count = len(data.get("results", [])) if isinstance(data.get("results"), list) else 0
        return f"Web Results ({count})" if count else "Web Results"
    elif tool_name == "firecrawl_map":
        url = data.get("url")
        if isinstance(url, str) and url.strip():
            return f"Site Map: {url}"
        return "Site Map"
    elif tool_name == "firecrawl_extract":
        return "Extracted Data"
    elif tool_name == "firecrawl_crawl":
        return "Crawl Job"
    elif tool_name.startswith("outline_"):
        results = data.get("results") or data.get("documents") or data.get("data") or []
        if isinstance(results, list) and results:
            first = results[0] if isinstance(results[0], dict) else {}
            title = first.get("title") or first.get("name")
            if isinstance(title, str) and title.strip():
                return title.strip()
        return "Outline Document"
    else:
        return tool_name.replace("_", " ").title()


def _get_content_summary_from_data(tool_name: str, data: dict) -> str:
    """Extract a content summary from tool result data for tooltip."""
    if not isinstance(data, dict):
        return str(data)[:100]

    if tool_name.startswith("sql_db_"):
        if tool_name == "sql_db_query":
            return f"Returned {len(data)} rows" if isinstance(data, list) else "SQL query result"
        if tool_name == "sql_db_schema":
            return "Schema details"
        if tool_name == "sql_db_list_tables":
            return "List of tables"
        if tool_name == "sql_db_query_checker":
            return "Query validation"
        if tool_name == "sql_db_context":
            return "Tenant SQL context"
        return "SQL tool result"
    elif tool_name == "find_entity":
        return data.get("description", "Entity from knowledge graph")[:150]
    elif tool_name == "query_graph":
        results = data.get("results", [])
        if results and isinstance(results[0], dict):
            text = results[0].get("text") or results[0].get("description") or ""
            if isinstance(text, str) and text.strip():
                return text[:150]
        return "Graph query results"
    elif tool_name in ("search_text", "search_chunks", "search_summaries", "search_graph", "search_rag", "search_natural_language"):
        results = data.get("results", [])
        if results and isinstance(results[0], dict):
            return _extract_result_text(results[0])[:150]
        return "Document search results"
    elif tool_name == "firecrawl_scrape":
        summary = data.get("summary")
        if isinstance(summary, str) and summary.strip():
            return summary[:150]
        markdown = data.get("markdown")
        if isinstance(markdown, str) and markdown.strip():
            return markdown[:150]
        return "Scraped web content"
    elif tool_name == "firecrawl_search":
        results = data.get("results", [])
        if results and isinstance(results[0], dict):
            first = results[0]
            title = first.get("title") or first.get("url") or "Result"
            description = first.get("description") or ""
            summary = f"{title} - {description}".strip(" -")
            return summary[:150]
        return "Web search results"
    elif tool_name == "firecrawl_map":
        urls = data.get("urls") if isinstance(data.get("urls"), list) else []
        return f"{len(urls)} URLs discovered" if urls else "Site map results"
    elif tool_name == "firecrawl_extract":
        results = data.get("results")
        if isinstance(results, list) and results:
            return json.dumps(results[0], ensure_ascii=True)[:150]
        if isinstance(results, dict):
            return json.dumps(results, ensure_ascii=True)[:150]
        return "Extracted data"
    elif tool_name == "firecrawl_crawl":
        job = data.get("job") if isinstance(data.get("job"), dict) else {}
        job_id = job.get("id") or job.get("jobId")
        return f"Crawl job {job_id}" if job_id else "Crawl job info"
    elif tool_name.startswith("outline_"):
        results = data.get("results") or data.get("documents") or data.get("data") or []
        if isinstance(results, list) and results:
            first = results[0] if isinstance(results[0], dict) else {}
            summary = first.get("snippet") or first.get("summary") or first.get("text") or first.get("content")
            if isinstance(summary, str) and summary.strip():
                return summary[:150]
        text = data.get("text")
        if isinstance(text, str) and text.strip():
            return text[:150]
        return "Outline document"
    else:
        return str(data)[:100]


def _extract_metadata_from_data(tool_name: str, data: dict) -> dict[str, Any]:
    """Extract metadata from tool result data for citation tooltip."""
    if not isinstance(data, dict):
        return {}

    metadata: dict[str, Any] = {}

    if tool_name.startswith("sql_db_"):
        metadata["sqlTool"] = tool_name
    elif tool_name == "find_entity":
        if data.get("type"):
            metadata["entityType"] = data["type"]
        if data.get("outgoing_relationships"):
            metadata["relationshipCount"] = len(data["outgoing_relationships"])
        title = data.get("name")
        if isinstance(title, str) and title.strip():
            metadata["title"] = title.strip()
        description = data.get("description")
        if isinstance(description, str) and description.strip():
            metadata["description"] = description[:200]
    elif tool_name == "query_graph":
        results = data.get("results", [])
        if results and isinstance(results[0], dict):
            title = results[0].get("name") or results[0].get("id")
            if isinstance(title, str) and title.strip():
                metadata["title"] = title.strip()
            description = results[0].get("text") or results[0].get("description")
            if isinstance(description, str) and description.strip():
                metadata["description"] = description[:200]
    elif tool_name in ("search_text", "search_chunks", "search_summaries", "search_graph", "search_rag", "search_natural_language"):
        results = data.get("results", [])
        if results:
            metadata["resultCount"] = len(results)
            if isinstance(results[0], dict) and results[0].get("text"):
                metadata["excerpt"] = results[0]["text"][:200]
            if isinstance(results[0], dict):
                title = results[0].get("title") or results[0].get("name") or results[0].get("document_name")
                if isinstance(title, str) and title.strip():
                    metadata["title"] = title.strip()
                description = (
                    results[0].get("description")
                    or results[0].get("summary")
                    or results[0].get("snippet")
                    or results[0].get("text")
                )
                if isinstance(description, str) and description.strip():
                    metadata["description"] = description[:200]
                url = results[0].get("url") or results[0].get("source_url") or results[0].get("link")
                if isinstance(url, str) and url.strip():
                    metadata["url"] = url
    elif tool_name in ("firecrawl_search", "firecrawl_map"):
        count = data.get("count")
        if isinstance(count, int):
            metadata["resultCount"] = count
        url = data.get("url")
        if isinstance(url, str) and url.strip():
            metadata["url"] = url
    elif tool_name in ("firecrawl_scrape", "firecrawl_extract", "firecrawl_crawl"):
        url = data.get("url")
        if isinstance(url, str) and url.strip():
            metadata["url"] = url
        if tool_name == "firecrawl_scrape":
            metadata["title"] = (
                data.get("metadata", {}).get("title")
                if isinstance(data.get("metadata"), dict)
                else None
            )
            description = data.get("summary") or data.get("markdown")
            if isinstance(description, str) and description.strip():
                metadata["description"] = description[:200]
        if tool_name == "firecrawl_extract":
            results = data.get("results")
            if isinstance(results, list):
                metadata["resultCount"] = len(results)
    elif tool_name.startswith("outline_"):
        results = data.get("results") or data.get("documents") or data.get("data") or []
        if isinstance(results, list) and results:
            first = results[0] if isinstance(results[0], dict) else {}
            title = first.get("title") or first.get("name")
            if isinstance(title, str) and title.strip():
                metadata["title"] = title.strip()
            description = (
                first.get("snippet")
                or first.get("summary")
                or first.get("text")
                or first.get("content")
            )
            if isinstance(description, str) and description.strip():
                metadata["description"] = description[:200]
            url = first.get("url") or first.get("link")
            if isinstance(url, str) and url.strip():
                metadata["url"] = url

    return {k: v for k, v in metadata.items() if v is not None}


# =============================================================================
# CANVAS HELPERS
# =============================================================================

TABLE_KEYS_BY_TOOL: dict[str, tuple[str, str]] = {}

TABLE_KEY_PRIORITY = [
    "tasks",
    "sessions",
    "mentors",
    "active_members",
    "members",
    "contacts",
    "results",
]

DOCUMENT_TOOL_TITLES: dict[str, str] = {
    "search_text": "Document Sources",
    "search_chunks": "Document Chunks",
    "search_summaries": "Document Summaries",
    "search_rag": "RAG Answer",
    "search_graph": "Graph Answer",
    "firecrawl_search": "Web Search Results",
    "firecrawl_scrape": "Web Page Content",
    "firecrawl_map": "Site Map",
    "firecrawl_extract": "Extracted Web Data",
}

DOCUMENT_TOOLS = set(DOCUMENT_TOOL_TITLES.keys())
GRAPH_TOOLS = {"query_graph"}


def _format_context_artifacts(context_artifacts: list[dict[str, Any]]) -> str:
    if not context_artifacts:
        return ""

    lines = ["## Linked Context Items"]
    for i, artifact in enumerate(context_artifacts, start=1):
        artifact_type = (
            artifact.get("artifact_type")
            or artifact.get("artifactType")
            or artifact.get("type")
            or "item"
        )
        title = artifact.get("title") or artifact.get("name") or f"Item {i}"
        lines.append(f"{i}. {title} (kind: {artifact_type})")

        summary = artifact.get("handoff_summary") or artifact.get("summary")
        if summary:
            lines.append(f"Summary: {summary}")

        recent_messages = artifact.get("handoff_recent_messages") or artifact.get("recent_messages")
        if isinstance(recent_messages, list) and recent_messages:
            lines.append("Recent messages:")
            for message in recent_messages[:20]:
                role = message.get("role", "unknown")
                content = message.get("content", "")
                lines.append(f"- {role}: {content}")

        payload = artifact.get("payload")
        if payload is None:
            payload = artifact.get("data")
        if payload is not None:
            payload_json = json.dumps(payload, ensure_ascii=True, default=str)
            lines.append(f"Payload: {payload_json}")

    return "\n".join(lines)


def _normalize_rows(rows: Any) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def _select_table_candidate(tool_name: str, data: dict) -> Optional[tuple[str, str, list[dict[str, Any]]]]:
    if not isinstance(data, dict):
        return None

    if tool_name in TABLE_KEYS_BY_TOOL:
        key, title = TABLE_KEYS_BY_TOOL[tool_name]
        rows = _normalize_rows(data.get(key))
        if rows:
            return key, title, rows

    for key in TABLE_KEY_PRIORITY:
        rows = _normalize_rows(data.get(key))
        if rows:
            title = key.replace("_", " ").title()
            return key, title, rows

    for key, value in data.items():
        rows = _normalize_rows(value)
        if rows:
            title = key.replace("_", " ").title()
            return key, title, rows

    return None


def _truncate_title(title: str, max_len: int = 72) -> str:
    cleaned = re.sub(r"\s+", " ", title or "").strip()
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[:max_len].rstrip(",:; ") + "..."


def _extract_result_title(item: Any, index: int) -> str:
    if isinstance(item, dict):
        for key in ("document_name", "_document_name", "title", "name", "id"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return f"Source {index}"


def _extract_result_text(item: Any) -> str:
    if isinstance(item, dict):
        for key in ("answer", "content", "text", "summary", "completion", "result"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return json.dumps(item, ensure_ascii=True, default=str)
    if isinstance(item, str):
        return item.strip()
    return str(item).strip()


def _build_document_title(tool_name: str, data: dict) -> str:
    base = DOCUMENT_TOOL_TITLES.get(tool_name, "Document")
    query = data.get("query") if isinstance(data, dict) else None
    if isinstance(query, str) and query.strip():
        return _truncate_title(f"{base}: {query.strip()}")
    url = data.get("url") if isinstance(data, dict) else None
    if isinstance(url, str) and url.strip():
        return _truncate_title(f"{base}: {url.strip()}")
    return base


def _build_document_content(tool_name: str, data: dict) -> str:
    if not isinstance(data, dict):
        return ""

    query = data.get("query") if isinstance(data.get("query"), str) else ""
    results = data.get("results") if isinstance(data.get("results"), list) else []

    if tool_name == "firecrawl_scrape":
        markdown = data.get("markdown") if isinstance(data.get("markdown"), str) else ""
        summary = data.get("summary") if isinstance(data.get("summary"), str) else ""
        url = data.get("url") if isinstance(data.get("url"), str) else ""
        lines: list[str] = []
        if url:
            lines.append(f"## URL\n{url}\n")
        if summary:
            lines.append("## Summary")
            lines.append(summary)
            lines.append("")
        if markdown:
            lines.append("## Content")
            lines.append(markdown)
        return "\n".join(lines).strip()

    if tool_name == "firecrawl_map":
        urls = data.get("urls") if isinstance(data.get("urls"), list) else []
        if not urls:
            return ""
        lines = ["## URLs"]
        lines.extend([str(url) for url in urls])
        return "\n".join(lines).strip()

    if tool_name == "firecrawl_search":
        if not results:
            return ""
        lines: list[str] = []
        if query:
            lines.append("## Query")
            lines.append(query)
            lines.append("")
        lines.append("## Results")
        for index, item in enumerate(results, start=1):
            if not isinstance(item, dict):
                lines.append(f"### Result {index}")
                lines.append(str(item))
                lines.append("")
                continue
            title = item.get("title") or item.get("url") or f"Result {index}"
            description = item.get("description") or ""
            lines.append(f"### {title}")
            if item.get("url"):
                lines.append(str(item["url"]))
            if description:
                lines.append(description)
            lines.append("")
        return "\n".join(lines).strip()

    if tool_name == "firecrawl_extract":
        extracted = data.get("results")
        if extracted is None:
            return ""
        content = json.dumps(extracted, ensure_ascii=True, indent=2)
        lines: list[str] = []
        if query:
            lines.append("## Query")
            lines.append(query)
            lines.append("")
        lines.append("## Extracted Data")
        lines.append(content)
        return "\n".join(lines).strip()

    if tool_name in ("search_rag", "search_graph"):
        answer = data.get("answer") if isinstance(data.get("answer"), str) else ""
        if not answer and results:
            answer = "\n\n".join(
                [text for text in (_extract_result_text(item) for item in results) if text]
            )
        if not answer:
            return ""
        if query:
            return f"## Query\n{query}\n\n{answer}"
        return answer

    if not results:
        return ""

    lines: list[str] = []
    if query:
        lines.append("## Query")
        lines.append(query)
        lines.append("")

    lines.append("## Sources")
    for index, item in enumerate(results, start=1):
        title = _extract_result_title(item, index)
        text = _extract_result_text(item)
        lines.append(f"### {title}")
        lines.append(text)
        lines.append("")

    return "\n".join(lines).strip()


def _extract_graph_payload(data: dict, source_number: Optional[int]) -> dict[str, Any]:
    results = data.get("results", []) if isinstance(data, dict) else []
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []

    def add_node(value: Any) -> Optional[str]:
        if isinstance(value, dict):
            node_id = value.get("id") or value.get("name") or value.get("title") or value.get("label")
            if not node_id:
                return None
            node_id_str = str(node_id)
            if node_id_str not in nodes:
                nodes[node_id_str] = {
                    "id": node_id_str,
                    "title": value.get("name") or value.get("title") or value.get("label") or node_id_str,
                    "type": value.get("type") or value.get("entity_type"),
                    "description": value.get("description") or value.get("text"),
                    "sourceNumber": source_number,
                }
            return node_id_str
        if isinstance(value, str) and value.strip():
            node_id_str = value.strip()
            if node_id_str not in nodes:
                nodes[node_id_str] = {
                    "id": node_id_str,
                    "title": node_id_str,
                    "sourceNumber": source_number,
                }
            return node_id_str
        return None

    edge_key_pairs = [
        ("source", "target"),
        ("from", "to"),
        ("start", "end"),
        ("subject", "object"),
    ]
    relation_keys = ("rel", "relation", "type", "predicate", "label")

    for row in results:
        if not isinstance(row, dict):
            add_node(row)
            continue

        edge_created = False
        for source_key, target_key in edge_key_pairs:
            if source_key in row and target_key in row:
                source_id = add_node(row.get(source_key))
                target_id = add_node(row.get(target_key))
                if source_id and target_id:
                    relation = next((row.get(key) for key in relation_keys if row.get(key)), None)
                    edges.append(
                        {
                            "id": f"{source_id}->{target_id}:{relation or 'rel'}",
                            "source": source_id,
                            "target": target_id,
                            "label": relation,
                        }
                    )
                edge_created = True
                break

        if edge_created:
            continue

        for value in row.values():
            add_node(value)

    return {
        "nodes": list(nodes.values()),
        "edges": edges,
    }


async def _emit_table_artifacts(source_index: list[dict[str, Any]], state: OrchestratorV3State) -> None:
    for source in source_index:
        tool_name = source.get("tool_name", "")
        if tool_name in DOCUMENT_TOOLS or tool_name in GRAPH_TOOLS:
            continue
        data = source.get("data", {})
        source_number = source.get("source_number")

        candidate = _select_table_candidate(tool_name, data)
        if not candidate:
            continue

        key, title, rows = candidate
        columns = list(rows[0].keys()) if rows else []
        payload = {
            "rows": rows,
            "columns": columns,
            "key": key,
        }
        origin = {
            "tool_name": tool_name,
            "source_number": source_number,
            "query": data.get("query") if isinstance(data, dict) else None,
            "entity_type": _get_entity_type_from_tool(tool_name),
            "canvas_id": state.get("canvas_id"),
            "chat_block_id": state.get("chat_block_id"),
        }

        await adispatch_custom_event(
            "artifact",
            {
                "type": "artifact",
                "id": f"artifact_{tool_name}_{uuid.uuid4().hex[:8]}",
                "artifact_type": "data_table",
                "title": title,
                "payload": payload,
                "origin": origin,
                "created_at": time.time(),
            },
        )


async def _emit_document_artifacts_from_sources(
    source_index: list[dict[str, Any]], state: OrchestratorV3State
) -> None:
    for source in source_index:
        tool_name = source.get("tool_name", "")
        if tool_name not in DOCUMENT_TOOLS:
            continue

        data = source.get("data", {})
        source_number = source.get("source_number")
        content = _build_document_content(tool_name, data)
        if not content:
            continue

        title = _build_document_title(tool_name, data)
        summary = content.replace("\n", " ").strip()[:160]
        origin = {
            "tool_name": tool_name,
            "source_number": source_number,
            "query": data.get("query") if isinstance(data, dict) else None,
            "entity_type": _get_entity_type_from_tool(tool_name),
            "canvas_id": state.get("canvas_id"),
            "chat_block_id": state.get("chat_block_id"),
        }
        payload = {
            "content": content,
            "format": "markdown",
        }

        await adispatch_custom_event(
            "artifact",
            {
                "type": "artifact",
                "id": f"artifact_doc_{tool_name}_{uuid.uuid4().hex[:8]}",
                "artifact_type": "document",
                "title": title,
                "summary": summary,
                "payload": payload,
                "origin": origin,
                "created_at": time.time(),
            },
        )


async def _emit_graph_artifacts(source_index: list[dict[str, Any]], state: OrchestratorV3State) -> None:
    for source in source_index:
        tool_name = source.get("tool_name", "")
        if tool_name not in GRAPH_TOOLS:
            continue

        data = source.get("data", {})
        source_number = source.get("source_number")
        payload = _extract_graph_payload(data, source_number)
        if not payload.get("nodes") and not payload.get("edges"):
            continue

        title = _build_document_title(tool_name, data)
        origin = {
            "tool_name": tool_name,
            "source_number": source_number,
            "entity_type": _get_entity_type_from_tool(tool_name),
            "canvas_id": state.get("canvas_id"),
            "chat_block_id": state.get("chat_block_id"),
        }

        await adispatch_custom_event(
            "artifact",
            {
                "type": "artifact",
                "id": f"artifact_graph_{uuid.uuid4().hex[:8]}",
                "artifact_type": "graph",
                "title": title,
                "payload": payload,
                "origin": origin,
                "created_at": time.time(),
            },
        )


async def _emit_canvas_artifacts(source_index: list[dict[str, Any]], state: OrchestratorV3State) -> None:
    await _emit_table_artifacts(source_index, state)
    await _emit_document_artifacts_from_sources(source_index, state)
    await _emit_graph_artifacts(source_index, state)


def _should_emit_document_artifact(state: OrchestratorV3State, content: str) -> bool:
    if not content or not content.strip():
        return False
    return _should_prompt_document(state)


def _extract_document_title_and_body(content: str) -> tuple[Optional[str], str]:
    match = re.match(r"^\s*#\s+(.+?)\s*\r?\n", content)
    if not match:
        return None, content
    title = match.group(1).strip()
    body = content[match.end():].lstrip()
    return title or None, body


def _get_document_title(state: OrchestratorV3State) -> str:
    query = (state.get("query") or "").strip()
    if not query:
        return "Canvas Document"
    words = query.split()
    return " ".join(words[:8]).rstrip(",:;")[:72]


async def _emit_document_artifact_if_needed(
    state: OrchestratorV3State, content: str
) -> None:
    if not _should_emit_document_artifact(state, content):
        return

    extracted_title, body = _extract_document_title_and_body(content)
    title = extracted_title or _get_document_title(state)
    summary = body.replace("\n", " ").strip()[:160]
    origin = {
        "type": "assistant_response",
        "canvas_id": state.get("canvas_id"),
        "chat_block_id": state.get("chat_block_id"),
    }
    payload = {
        "content": body,
        "format": "markdown",
    }

    await adispatch_custom_event(
        "artifact",
        {
            "type": "artifact",
            "id": f"artifact_document_{uuid.uuid4().hex[:8]}",
            "artifact_type": "document",
            "title": title,
            "summary": summary,
            "payload": payload,
            "origin": origin,
            "created_at": time.time(),
        },
    )


def _normalize_message_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("text"):
                parts.append(item["text"])
            else:
                parts.append(str(item))
        return " ".join(parts)
    return json.dumps(content, ensure_ascii=True, default=str)


def _message_role(message: AnyMessage) -> str:
    role = getattr(message, "type", None) or getattr(message, "role", None) or "assistant"
    if role == "human":
        return "user"
    if role == "ai":
        return "assistant"
    return role


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _build_recent_messages(messages: list[AnyMessage], budget_tokens: int) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    total = 0

    for message in reversed(messages):
        role = _message_role(message)
        if role not in ("user", "assistant"):
            continue
        content = _normalize_message_content(message.content)
        token_count = _estimate_tokens(content) + 4
        if selected and total + token_count > budget_tokens:
            break
        selected.append({"role": role, "content": content})
        total += token_count

    return list(reversed(selected))


async def _generate_handoff_summary(
    model_name: str,
    api_key: Optional[str],
    recent_messages: list[dict[str, Any]],
    max_tokens: int,
) -> Optional[str]:
    if not api_key or not recent_messages:
        return None

    llm = ChatOpenAI(
        model=model_name,
        api_key=api_key,
        temperature=0.2,
        max_tokens=max_tokens,
        http_async_client=get_http_client(),
    )

    message_lines = []
    for message in recent_messages:
        message_lines.append(f"{message['role']}: {message['content']}")

    user_prompt = (
        "Summarize this chat for handoff. Keep it concise and factual. "
        "Include key entities, decisions, and open questions.\n\n"
        + "\n".join(message_lines)
    )

    response = await llm.ainvoke(
        [
            SystemMessage(content="You create handoff summaries for chat blocks."),
            HumanMessage(content=user_prompt),
        ],
        config={
            "tags": ["handoff_summary"],
            "metadata": {"purpose": "handoff_summary"},
        },
    )
    return response.content.strip()


async def _emit_handoff_event_if_needed(state: OrchestratorV3State, final_message: str) -> None:
    if not state.get("canvas_id"):
        return

    settings = get_settings()
    budgets = settings.get_handoff_budgets(settings.default_orchestrator_model)
    messages = list(state.get("messages", [])) + [AIMessage(content=final_message)]

    recent_messages = _build_recent_messages(messages, budgets["messages_budget"])
    summary = await _generate_handoff_summary(
        settings.default_orchestrator_model,
        settings.openai_api_key,
        recent_messages,
        budgets["summary_budget"],
    )

    await adispatch_custom_event(
        "handoff",
        {
            "type": "handoff",
            "summary": summary,
            "recent_messages": recent_messages,
        },
    )


# =============================================================================
# GRAPH BUILDER
# =============================================================================

def create_orchestrator_v3(
    checkpointer: Optional[BaseCheckpointSaver] = None,
    user_context: Optional[dict[str, Any]] = None,  # Reserved for memory tool config
    auth0_id: Optional[str] = None,  # Reserved for memory isolation
) -> CompiledStateGraph:
    # Note: user_context and auth0_id are passed for API compatibility
    # They will be used when memory tools are added to v3
    _ = (user_context, auth0_id)  # Silence unused parameter warnings
    """
    Create the v3 Orchestrator with supervisor pattern.

    Flow:
    1. Planner (LLM) decides which tools to use
    2. Workers execute tools in parallel (via Send API)
    3. Evaluator checks if results are sufficient
    4. If insufficient and retries left → back to Planner
    5. If sufficient or max retries → Synthesizer
    6. Synthesizer creates final answer

    Args:
        checkpointer: Session persistence
        user_context: User details for personalization
        auth0_id: User ID for memory isolation

    Returns:
        Compiled orchestrator graph
    """
    builder = StateGraph(OrchestratorV3State)

    # Add nodes
    builder.add_node("normalize_input", normalize_input)
    builder.add_node("planner", planner_node)
    builder.add_node("tool_worker", tool_worker)
    builder.add_node("evaluator", evaluator_node)
    builder.add_node("increment_retry", increment_retry)
    builder.add_node("synthesizer", synthesizer_node)

    # Entry: Normalize input, then plan
    builder.add_edge(START, "normalize_input")
    builder.add_edge("normalize_input", "planner")

    # Planner → Spawn parallel workers OR go to synthesizer for conversational queries
    builder.add_conditional_edges(
        "planner",
        route_after_planner,
        ["tool_worker", "synthesizer"],
    )

    # All workers converge to evaluator
    builder.add_edge("tool_worker", "evaluator")

    # Evaluator → Retry or Synthesize
    builder.add_conditional_edges(
        "evaluator",
        should_retry_or_synthesize,
        {
            "retry": "increment_retry",
            "synthesize": "synthesizer",
        },
    )

    # Retry loop back to planner
    builder.add_edge("increment_retry", "planner")

    # Synthesizer → End
    builder.add_edge("synthesizer", END)

    # Compile
    graph = builder.compile(checkpointer=checkpointer)

    logger.info("Created orchestrator_v3 with supervisor pattern")

    return graph


# =============================================================================
# SINGLETON MANAGEMENT
# =============================================================================

_orchestrator_v3_cache: dict[str, CompiledStateGraph] = {}


async def get_orchestrator_v3(
    checkpointer: Optional[BaseCheckpointSaver] = None,
    user_context: Optional[dict[str, Any]] = None,
    auth0_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
    force_new: bool = False,
) -> CompiledStateGraph:
    """
    Get or create an orchestrator v3 instance.

    Args:
        checkpointer: Session persistence
        user_context: User details
        auth0_id: User ID
        force_new: Force new instance

    Returns:
        Compiled orchestrator v3
    """
    cache_key = f"{tenant_id or 'default'}::{auth0_id or 'anonymous'}"

    if not force_new and cache_key in _orchestrator_v3_cache:
        logger.debug(f"Returning cached orchestrator v3 for: {cache_key[:32]}...")
        return _orchestrator_v3_cache[cache_key]

    await _prime_sql_tool_cache(tenant_id)

    orchestrator = create_orchestrator_v3(
        checkpointer=checkpointer,
        user_context=user_context,
        auth0_id=auth0_id,
    )

    _orchestrator_v3_cache[cache_key] = orchestrator
    logger.info(f"Created orchestrator v3 for: {cache_key[:32]}...")

    return orchestrator


def clear_orchestrator_v3_cache():
    """Clear the orchestrator v3 cache."""
    global _orchestrator_v3_cache
    _orchestrator_v3_cache = {}
    logger.info("Cleared orchestrator v3 cache")


# =============================================================================
# CONVENIENCE FUNCTION
# =============================================================================

async def run_orchestrator_v3(
    query: str,
    user_context: Optional[dict[str, Any]] = None,
    checkpointer: Optional[BaseCheckpointSaver] = None,
    config: Optional[dict] = None,
) -> dict[str, Any]:
    """
    Run the v3 orchestrator on a query.

    Convenience function for standalone usage.

    Args:
        query: User query
        user_context: Optional user context
        checkpointer: Optional checkpointer
        config: Optional LangGraph config

    Returns:
        Result with answer, confidence, and citations
    """
    graph = await get_orchestrator_v3(
        checkpointer=checkpointer,
        user_context=user_context,
    )

    initial_state = OrchestratorV3State(
        messages=[HumanMessage(content=query)],
        query=query,
        user_context=user_context,
        canvas_id=None,
        chat_block_id=None,
        auto_artifacts=False,
        context_artifacts=[],
        plan=None,
        planned_calls=[],
        tool_results=[],
        evaluation=None,
        retry_count=0,
        max_retries=2,
        final_answer=None,
        confidence=0.0,
        citations=[],
    )

    result = await graph.ainvoke(initial_state, config=config or {})

    return {
        "answer": result.get("final_answer"),
        "confidence": result.get("confidence", 0.0),
        "citations": result.get("citations", []),
        "retries_used": result.get("retry_count", 0),
    }
