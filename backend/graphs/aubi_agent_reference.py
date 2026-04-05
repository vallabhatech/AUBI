"""Aubi agent graph — Deep Agents with full middleware stack.

The graph is compiled once at startup. Per-request context (tenant, user,
memory) flows through LangGraph's RunnableConfig.configurable dict and is
read by the prompt builder at invocation time.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from copilotkit import CopilotKitMiddleware
from deepagents.backends.local_shell import LocalShellBackend
from deepagents.graph import BASE_AGENT_PROMPT
from deepagents.middleware.filesystem import FilesystemMiddleware
from deepagents.middleware.patch_tool_calls import PatchToolCallsMiddleware
from deepagents.middleware.subagents import (
    GENERAL_PURPOSE_SUBAGENT,
    SubAgent,
    SubAgentMiddleware,
)
from deepagents.middleware.summarization import create_summarization_middleware
from langchain.agents import create_agent
from langchain.agents.middleware import TodoListMiddleware
from langchain.agents.middleware.types import AgentMiddleware
from langchain_core.tools import BaseTool
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph.state import CompiledStateGraph

from app.graphs.prompt_builder import build_aubi_system_prompt
from app.graphs.subagents import get_all_subagent_specs
from app.tools.integrations import get_integration_tools
from app.tools.web_search import get_web_search_tools

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gpt-5.4"


def _build_model(model_name: str | None = None) -> Any:
    """Create a chat model with provider-appropriate configuration."""
    name = model_name or DEFAULT_MODEL

    if "gpt-5" in name.lower():
        return ChatOpenAI(
            model=name,
            base_url="https://us.api.openai.com/v1",
            streaming=True,
            stream_usage=True,
            use_responses_api=True,
            reasoning={"effort": "high", "summary": "auto"},
        )

    if "claude" in name.lower():
        from langchain.chat_models import init_chat_model

        return init_chat_model(f"anthropic:{name}", thinking={"type": "adaptive"})

    from langchain.chat_models import init_chat_model

    return init_chat_model(name)


def create_aubi_agent(
    *,
    model: str | None = None,
    tools: list[BaseTool] | None = None,
    checkpointer: Any | None = None,
) -> CompiledStateGraph:
    """Build and compile the Aubi agent graph.

    The graph is compiled once. Per-request identity and memory context
    are passed via RunnableConfig at invocation time — the prompt builder
    reads them from config["configurable"].
    """
    resolved_model = _build_model(model)

    # LocalShellBackend — real disk I/O + shell execution
    # Extends FilesystemBackend with an `execute` tool for running commands.
    # In production, each user's Aubi runs in an isolated container — the container
    # provides sandboxing. For dev, runs on the local machine (use with care).
    # virtual_mode=True: agent paths like /report.md resolve to .state/workspace/report.md
    workspace_dir = os.path.join(
        os.getenv("DEEPAGENTS_STATE_DIR", ".state"), "workspace"
    )
    os.makedirs(workspace_dir, exist_ok=True)
    backend = LocalShellBackend(root_dir=workspace_dir, virtual_mode=True)

    # Collect all tools: custom + web search + integrations
    all_tools = list(tools or []) + get_web_search_tools() + get_integration_tools()

    # System prompt
    system_prompt = build_aubi_system_prompt()
    full_prompt = system_prompt + "\n\n" + BASE_AGENT_PROMPT

    # General-purpose subagent — same middleware + tools, used for delegation
    gp_middleware: list[AgentMiddleware] = [
        TodoListMiddleware(),
        FilesystemMiddleware(backend=backend),
        create_summarization_middleware(resolved_model, backend),
        PatchToolCallsMiddleware(),
    ]

    general_purpose_spec: SubAgent = {
        **GENERAL_PURPOSE_SUBAGENT,
        "model": resolved_model,
        "tools": all_tools,
        "middleware": gp_middleware,
    }

    # Specialized subagents for delegation
    specialized_subagents = get_all_subagent_specs(resolved_model, all_tools)

    # Main agent middleware stack
    middleware: list[AgentMiddleware] = [
        CopilotKitMiddleware(),
        TodoListMiddleware(),
        FilesystemMiddleware(backend=backend),
        SubAgentMiddleware(
            backend=backend,
            subagents=[general_purpose_spec, *specialized_subagents],
        ),
        create_summarization_middleware(resolved_model, backend),
        PatchToolCallsMiddleware(),
    ]

    # Use provided checkpointer or fall back to MemorySaver
    if checkpointer is None:
        checkpointer = MemorySaver()
        logger.info("Using MemorySaver (ephemeral) — pass checkpointer for persistence")
    else:
        logger.info("Using provided checkpointer for persistent thread storage")

    return create_agent(
        resolved_model,
        system_prompt=full_prompt,
        tools=all_tools,
        middleware=middleware,
        checkpointer=checkpointer,
    )
