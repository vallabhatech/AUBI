"""AUBI Backend — FastAPI app.

Endpoints:
  POST /agents                  create agent from GitHub
  GET  /agents                  list all agents
  GET  /agents/{id}             get agent + constitution
  POST /agents/{id}/query       query agent's context for an incident
  POST /constitution/{id}       add fact to constitution
  PATCH /constitution/{id}      update/add fact
  GET  /constitution/team       query/list shared team memory
  POST /constitution/team       write shared team memory
  GET  /ownership               file → owner lookup
  POST /incidents/run           blocking incident run
  GET  /incidents/stream        SSE stream of incident graph
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langgraph.types import Command
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from graphs.incident_graph import aubi_graph
from constitution.store import ConstitutionStore

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PROFILE_SUMMARY_CATEGORY = "profile_metadata"
PROFILE_SUMMARY_PREDICATE = "github_data_summary"

app = FastAPI(title="AUBI Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_store: ConstitutionStore | None = None

def get_store() -> ConstitutionStore:
    global _store
    if _store is None:
        _store = ConstitutionStore()
    return _store

# ---------------------------------------------------------------------------
# In-memory agent registry for agents created during this backend process.
# ---------------------------------------------------------------------------

_agents: dict[str, dict[str, Any]] = {}  # id → agent record
# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateAgentRequest(BaseModel):
    github_username: str
    name: str | None = None
    role: str | None = None


class QueryAgentRequest(BaseModel):
    incident_text: str


class IncidentRequest(BaseModel):
    incident_text: str


class ConstitutionFactRequest(BaseModel):
    fact: dict[str, Any]


class TeamMemoryWriteRequest(BaseModel):
    fact: dict[str, Any] | None = None
    episode: dict[str, Any] | None = None
    team_id: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tenant_id() -> str:
    tenant_id = os.getenv("AUBI_TENANT_ID")
    if not tenant_id:
        raise RuntimeError("AUBI_TENANT_ID is not set")
    return tenant_id


def _team_id(override: str | None = None) -> str:
    if override and override.strip():
        return override.strip()
    team_id = os.getenv("AUBI_TEAM_ID")
    if not team_id:
        raise RuntimeError("AUBI_TEAM_ID is not set")
    return team_id


def _openai_model() -> str:
    model = os.getenv("OPENAI_MODEL")
    if not model:
        raise RuntimeError("OPENAI_MODEL is not set")
    return model


def _get_constitution_from_store(user_id: str) -> dict[str, Any]:
    """Fetch constitution facts from Qdrant grouped by category."""
    return get_store().get_by_user(user_id, _tenant_id())


def _flatten_constitution(grouped: dict[str, Any]) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    for value in grouped.values():
        if isinstance(value, list):
            facts.extend(fact for fact in value if isinstance(fact, dict))
    return facts


def _group_facts_by_category(facts: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for fact in facts:
        grouped.setdefault(str(fact.get("category", "general")), []).append(fact)
    return grouped


def _is_profile_summary_fact(fact: dict[str, Any]) -> bool:
    return (
        fact.get("category") == PROFILE_SUMMARY_CATEGORY and
        fact.get("predicate") == PROFILE_SUMMARY_PREDICATE
    )


def _public_constitution_facts(facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [fact for fact in facts if not _is_profile_summary_fact(fact)]


def _public_constitution(grouped: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return _group_facts_by_category(_public_constitution_facts(_flatten_constitution(grouped)))


def _github_summary_defaults() -> dict[str, Any]:
    return {
        "commit_count": 0,
        "pr_count": 0,
        "top_files": [],
        "languages": [],
        "repos_considered": [],
        "target_repos": [],
    }


def _github_summary_from_data(github_data: dict[str, Any]) -> dict[str, Any]:
    return {
        "commit_count": int(github_data.get("commit_count") or 0),
        "pr_count": int(github_data.get("pr_count") or 0),
        "top_files": _string_list(github_data.get("top_files"))[:5],
        "languages": _string_list(github_data.get("languages"))[:5],
        "repos_considered": _string_list(github_data.get("repos_considered")),
        "target_repos": _string_list(github_data.get("target_repos")),
    }


def _profile_summary_fact(github_username: str, summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "subject": github_username,
        "predicate": PROFILE_SUMMARY_PREDICATE,
        "object": json.dumps(summary, sort_keys=True),
        "confidence": 1.0,
        "category": PROFILE_SUMMARY_CATEGORY,
    }


def _github_summary_from_facts(facts: list[dict[str, Any]]) -> dict[str, Any]:
    for fact in facts:
        if not _is_profile_summary_fact(fact):
            continue
        raw = fact.get("object")
        try:
            parsed = json.loads(raw) if isinstance(raw, str) else raw
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            return _merge_github_summaries(_github_summary_defaults(), parsed)
    return _github_summary_defaults()


def _merge_github_summaries(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    return {
        "commit_count": max(int(left.get("commit_count") or 0), int(right.get("commit_count") or 0)),
        "pr_count": max(int(left.get("pr_count") or 0), int(right.get("pr_count") or 0)),
        "top_files": list(dict.fromkeys(_string_list(left.get("top_files")) + _string_list(right.get("top_files")))),
        "languages": list(dict.fromkeys(_string_list(left.get("languages")) + _string_list(right.get("languages")))),
        "repos_considered": list(dict.fromkeys(_string_list(left.get("repos_considered")) + _string_list(right.get("repos_considered")))),
        "target_repos": list(dict.fromkeys(_string_list(left.get("target_repos")) + _string_list(right.get("target_repos")))),
    }


def _identity_key(value: Any) -> str:
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum())


def _agent_record_identity(record: dict[str, Any]) -> str:
    facts = record.get("constitution_facts") if isinstance(record.get("constitution_facts"), list) else []
    subject = next((fact.get("subject") for fact in facts if isinstance(fact, dict) and fact.get("subject")), "")
    return (
        _identity_key(record.get("github_username")) or
        _identity_key(record.get("name")) or
        _identity_key(subject) or
        _identity_key(record.get("id"))
    )


def _fact_key(fact: dict[str, Any]) -> str:
    return "|".join(str(fact.get(key, "")).lower() for key in ("category", "subject", "predicate", "object"))


def _dedupe_fact_records(facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for fact in facts:
        if isinstance(fact, dict):
            deduped[_fact_key(fact)] = fact
    return list(deduped.values())


def _string_list(value: Any) -> list[str]:
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def _agent_record_score(record: dict[str, Any]) -> int:
    summary = record.get("github_data_summary") if isinstance(record.get("github_data_summary"), dict) else {}
    facts = record.get("constitution_facts") if isinstance(record.get("constitution_facts"), list) else []
    return (
        len(facts) * 10 +
        len(_string_list(summary.get("top_files"))) * 3 +
        len(_string_list(summary.get("languages"))) * 2 +
        int(summary.get("commit_count") or 0) +
        int(summary.get("pr_count") or 0)
    )


def _merge_agent_records(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    primary, secondary = (right, left) if _agent_record_score(right) > _agent_record_score(left) else (left, right)
    primary_summary = primary.get("github_data_summary") if isinstance(primary.get("github_data_summary"), dict) else {}
    secondary_summary = secondary.get("github_data_summary") if isinstance(secondary.get("github_data_summary"), dict) else {}
    facts = _dedupe_fact_records(
        list(secondary.get("constitution_facts") or []) +
        list(primary.get("constitution_facts") or [])
    )
    merged = {
        **primary,
        "github_username": primary.get("github_username") or secondary.get("github_username"),
        "name": primary.get("name") or secondary.get("name"),
        "role": primary.get("role") or secondary.get("role"),
        "github_data_summary": _merge_github_summaries(primary_summary, secondary_summary),
        "constitution_facts": facts,
        "constitution": _group_facts_by_category(facts),
    }
    return merged


def _dedupe_agent_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_identity: dict[str, dict[str, Any]] = {}
    for record in records:
        key = _agent_record_identity(record) or _identity_key(record.get("id"))
        if key in by_identity:
            by_identity[key] = _merge_agent_records(by_identity[key], record)
        else:
            by_identity[key] = record
    return list(by_identity.values())


def _public_memory_record(record: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "scope",
        "scope_id",
        "team_id",
        "tenant_id",
        "subject",
        "predicate",
        "object",
        "confidence",
        "category",
        "participants",
        "owner_ids",
        "related_agent_ids",
        "issue_number",
        "issue_title",
        "repo_name",
        "affected_files",
        "fixed_file_path",
        "pr_url",
        "tests_passed",
        "written_at",
        "source_agent_id",
        "_score",
        "_collection",
    }
    return {key: value for key, value in record.items() if key in allowed}


def _agent_record_from_facts(agent_id: str, facts: list[dict[str, Any]]) -> dict[str, Any]:
    summary = _github_summary_from_facts(facts)
    public_facts = _public_constitution_facts(facts)
    username = str(next((fact.get("subject") for fact in public_facts if fact.get("subject")), agent_id))
    expertise = next((fact.get("object") for fact in public_facts if fact.get("category") == "expertise"), "")
    return {
        "id": agent_id,
        "github_username": username,
        "name": username,
        "role": str(expertise or "Software Engineer"),
        "github_data_summary": summary,
        "constitution_facts": public_facts,
        "constitution": _group_facts_by_category(public_facts),
    }


def _register_agent_record(
    *,
    agent_id: str,
    github_username: str,
    name: str,
    role: str,
    facts: list[dict[str, Any]],
    github_data_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    record = {
        "id": agent_id,
        "github_username": github_username,
        "name": name,
        "role": role,
        "github_data_summary": github_data_summary or {},
        "constitution_facts": facts,
    }
    _agents[agent_id] = record
    return record


def _extract_interrupt_payload(result: dict[str, Any]) -> dict[str, Any] | None:
    interrupts = result.get("__interrupt__")
    if not interrupts:
        return None
    first = interrupts[0] if isinstance(interrupts, (list, tuple)) else interrupts
    value = getattr(first, "value", None)
    return value if isinstance(value, dict) else None


def _extract_interrupt_payload_from_chunk(chunk: dict[str, Any]) -> dict[str, Any] | None:
    interrupts = chunk.get("__interrupt__")
    if not interrupts:
        return None
    first = interrupts[0] if isinstance(interrupts, (list, tuple)) else interrupts
    value = getattr(first, "value", None)
    return value if isinstance(value, dict) else None


_gpt55 = None


def get_gpt55():
    global _gpt55
    if _gpt55 is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        from langchain_openai import ChatOpenAI
        kwargs: dict[str, Any] = {
            "model": _openai_model(),
            "api_key": api_key,
            "streaming": False,
            "use_responses_api": True,
        }
        base_url = os.getenv("OPENAI_BASE_URL")
        if base_url:
            kwargs["base_url"] = base_url
        _gpt55 = ChatOpenAI(**kwargs)
    return _gpt55


# ---------------------------------------------------------------------------
# Agent endpoints
# ---------------------------------------------------------------------------

@app.post("/agents")
async def create_agent(req: CreateAgentRequest):
    """Create an AUBI agent from a GitHub username. Builds constitution from GitHub."""
    from ingestion.github_ingest import ingest_developer
    from constitution.builder import build_constitution_from_github

    agent_id = str(uuid4())[:8]

    # 1. Pull GitHub data
    try:
        github_data = ingest_developer(req.github_username)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # 2. Build constitution facts via Gemini structured output
    facts = await build_constitution_from_github(github_data)
    github_summary = _github_summary_from_data(github_data)
    facts_to_store = facts + [_profile_summary_fact(req.github_username, github_summary)]

    # 3. Store facts in Qdrant. This is a required part of agent creation.
    stored_count = get_store().upsert_facts(agent_id, _tenant_id(), facts_to_store)
    if stored_count != len(facts_to_store):
        raise HTTPException(
            status_code=500,
            detail=f"Stored {stored_count} of {len(facts_to_store)} constitution facts",
        )

    # 4. Register agent in-memory
    agent_record = _register_agent_record(
        agent_id=agent_id,
        github_username=req.github_username,
        name=req.name or github_data.get("name", req.github_username),
        role=req.role or "Software Engineer",
        facts=facts,
        github_data_summary=github_summary,
    )

    return {**agent_record, "facts_stored": len(facts)}


@app.get("/agents")
async def list_agents():
    records = {agent_id: agent.copy() for agent_id, agent in _agents.items()}
    for agent_id, facts in get_store().list_user_facts(_tenant_id()).items():
        if agent_id not in records:
            records[agent_id] = _agent_record_from_facts(agent_id, facts)
        else:
            public_facts = _public_constitution_facts(facts)
            records[agent_id]["constitution_facts"] = public_facts
            records[agent_id]["constitution"] = _group_facts_by_category(public_facts)
            summary = records[agent_id].get("github_data_summary") if isinstance(records[agent_id].get("github_data_summary"), dict) else {}
            records[agent_id]["github_data_summary"] = _merge_github_summaries(summary, _github_summary_from_facts(facts))
    return _dedupe_agent_records(list(records.values()))


@app.get("/agents/{agent_id}")
async def get_agent(agent_id: str):
    live_constitution = _get_constitution_from_store(agent_id)
    if not live_constitution:
        raise HTTPException(status_code=404, detail=f"No constitution facts found for agent {agent_id}")
    if agent_id in _agents:
        agent = _agents[agent_id].copy()
    else:
        agent = _agent_record_from_facts(agent_id, _flatten_constitution(live_constitution))
    all_facts = _flatten_constitution(live_constitution)
    public_facts = _public_constitution_facts(all_facts)
    agent["constitution"] = _group_facts_by_category(public_facts)
    agent["constitution_facts"] = public_facts
    summary = agent.get("github_data_summary") if isinstance(agent.get("github_data_summary"), dict) else {}
    agent["github_data_summary"] = _merge_github_summaries(summary, _github_summary_from_facts(all_facts))
    return agent


@app.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str):
    """Delete an AUBI coworker profile and its persisted memory."""
    live_constitution = _get_constitution_from_store(agent_id)
    if not live_constitution and agent_id not in _agents:
        raise HTTPException(status_code=404, detail=f"No coworker found for agent {agent_id}")

    get_store().delete_user(agent_id, _tenant_id())
    _agents.pop(agent_id, None)
    return {"deleted": True, "agent_id": agent_id}


@app.post("/agents/{agent_id}/query")
async def query_agent(agent_id: str, req: QueryAgentRequest):
    """Ask an agent what context it has relevant to an incident."""
    facts = _public_constitution_facts(_flatten_constitution(_get_constitution_from_store(agent_id)))
    if not facts:
        raise HTTPException(status_code=404, detail=f"No constitution facts found for agent {agent_id}")
    agent = _agents.get(agent_id) or _agent_record_from_facts(agent_id, facts)
    constitution = json.dumps(facts[:20], indent=2)

    from langchain_core.messages import HumanMessage, SystemMessage
    response = await get_gpt55().ainvoke([
        SystemMessage(content=(
            f"You are {agent['name']}'s AI representative.\n"
            f"Their constitution:\n{constitution}\n\n"
            "Answer briefly: Is this incident in their domain? "
            "What context do they have? What would they say when paged?"
        )),
        HumanMessage(content=f"Incident: {req.incident_text}"),
    ])
    context = response.content

    return {"agent_id": agent_id, "agent_name": agent["name"], "context": context}


# ---------------------------------------------------------------------------
# Constitution endpoints
# ---------------------------------------------------------------------------

@app.get("/constitution/team")
async def get_team_constitution(
    query: str | None = None,
    team_id: str | None = None,
    top_k: int = 10,
    limit: int = 100,
):
    """Return shared team memory. If query is provided, run semantic search."""
    resolved_team_id = _team_id(team_id)
    try:
        if query:
            hits = get_store().search_team_memory(
                _tenant_id(),
                query,
                team_id=resolved_team_id,
                top_k=max(1, min(top_k, 25)),
            )
            return {
                "scope": "team",
                "team_id": resolved_team_id,
                "query": query,
                "hits": [_public_memory_record(hit) for hit in hits],
            }
        memory = get_store().list_team_memory(
            _tenant_id(),
            team_id=resolved_team_id,
            limit=max(1, min(limit, 500)),
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Shared memory lookup failed: {e}") from e

    return {
        "scope": "team",
        "team_id": resolved_team_id,
        "memory": {
            collection: [_public_memory_record(item) for item in items]
            for collection, items in memory.items()
        },
    }


@app.post("/constitution/team")
async def write_team_constitution(req: TeamMemoryWriteRequest):
    """Write a shared team fact or episode."""
    resolved_team_id = _team_id(req.team_id)
    if bool(req.fact) == bool(req.episode):
        raise HTTPException(status_code=400, detail="Provide exactly one of fact or episode")

    try:
        if req.fact:
            count = get_store().upsert_team_facts(
                _tenant_id(),
                [req.fact],
                team_id=resolved_team_id,
                source_agent_id=str(req.fact.get("source_agent_id") or "") or None,
            )
            if count != 1:
                raise HTTPException(status_code=500, detail="Team fact was not stored")
            return {
                "status": "ok",
                "memory_write": {
                    "scope": "team",
                    "team_id": resolved_team_id,
                    "collection": "semantic_facts",
                    "fact": _public_memory_record(req.fact),
                },
            }

        point_id = get_store().add_team_episode(
            _tenant_id(),
            req.episode or {},
            team_id=resolved_team_id,
        )
        return {
            "status": "ok",
            "memory_write": {
                "scope": "team",
                "team_id": resolved_team_id,
                "collection": "episodes",
                "point_id": point_id,
                "episode": _public_memory_record(req.episode or {}),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Shared memory write failed: {e}") from e


@app.get("/constitution/{agent_id}")
async def get_constitution(agent_id: str):
    """Return an agent's constitution facts grouped by category."""
    live_constitution = _get_constitution_from_store(agent_id)
    if live_constitution:
        return _public_constitution(live_constitution)
    raise HTTPException(status_code=404, detail=f"No constitution facts found for agent {agent_id}")


@app.patch("/constitution/{agent_id}")
async def patch_constitution(agent_id: str, req: ConstitutionFactRequest):
    """Add a fact to an agent's constitution (called by memory_updater)."""
    stored_count = get_store().upsert_facts(agent_id, _tenant_id(), [req.fact])
    if stored_count != 1:
        raise HTTPException(status_code=500, detail="Constitution fact was not stored")
    if agent_id in _agents:
        _agents[agent_id].setdefault("constitution_facts", []).append(req.fact)
    return {"status": "ok", "agent_id": agent_id}


# ---------------------------------------------------------------------------
# Ownership endpoint
# ---------------------------------------------------------------------------

@app.get("/ownership")
async def get_ownership(filepath: str):
    """Return which agent owns a filepath prefix."""
    try:
        owner_agent_id, confidence, evidence = get_store().search_ownership(filepath, _tenant_id())
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Qdrant ownership lookup failed: {e}") from e

    return {
        "owner_agent_id": owner_agent_id,
        "confidence": confidence,
        "evidence_facts": evidence,
    }


# ---------------------------------------------------------------------------
# Incident endpoints
# ---------------------------------------------------------------------------

class IssueRequest(BaseModel):
    issue_url: str | None = None
    incident_text: str | None = None
    repo_name: str | None = None
    issue_number: int | None = None
    thread_id: str | None = None
    auto_approve: bool = False


GRAPH_NODES = {
    "issue_reader", "ownership_router", "query_single_agent",
    "coworker_mesh_exchange", "code_reader", "fix_generator",
    "test_runner", "approval_gate", "pr_pusher",
}


def _target_repo() -> str:
    return os.getenv("TARGET_REPO") or os.getenv("GITHUB_REPO", "")


def _state_input_from_issue_request(req: IssueRequest) -> dict[str, Any]:
    state_input: dict[str, Any] = {}
    if req.issue_url:
        state_input["issue_url"] = req.issue_url
        return state_input

    if not req.incident_text:
        raise HTTPException(status_code=400, detail="Provide issue_url or incident_text")

    if not req.repo_name or req.issue_number is None:
        raise HTTPException(
            status_code=400,
            detail="incident_text runs require repo_name and issue_number; use issue_url for the normal GitHub issue flow",
        )
    state_input["incident_text"] = req.incident_text
    state_input["repo_name"] = req.repo_name
    state_input["issue_number"] = req.issue_number
    return state_input


@app.post("/incidents/run")
async def run_incident(req: IssueRequest):
    """Blocking run. Stops at approval unless auto_approve=true."""
    state_input = _state_input_from_issue_request(req)

    thread_id = req.thread_id or uuid4().hex
    config = {"configurable": {"thread_id": thread_id}}
    result = await aubi_graph.ainvoke(state_input, config=config)

    interrupt_payload = _extract_interrupt_payload(result)
    if interrupt_payload and req.auto_approve:
        result = await aubi_graph.ainvoke(
            Command(resume={"approved": True}),
            config=config,
        )
        interrupt_payload = None

    if interrupt_payload:
        return {
            "thread_id": thread_id,
            "awaiting_approval": True,
            "approval": interrupt_payload,
            "patch_diff": result.get("patch_diff"),
            "fix_explanation": result.get("fix_explanation"),
            "test_output": result.get("test_output"),
            "tests_passed": result.get("tests_passed"),
            "owners": result.get("owner_ids"),
            "agent_messages": result.get("agent_messages", []),
            "routing_evidence": result.get("routing_evidence", []),
            "coworker_exchanges": result.get("coworker_exchanges", []),
            "shared_memory_hits": result.get("shared_memory_hits", []),
            "memory_writes": result.get("memory_writes", []),
            "stream_log": result.get("stream_log", []),
        }

    return {
        "thread_id":         thread_id,
        "pr_url":           result.get("pr_url"),
        "patch_diff":       result.get("patch_diff"),
        "fix_explanation":  result.get("fix_explanation"),
        "test_output":      result.get("test_output"),
        "tests_passed":     result.get("tests_passed"),
        "slack_message":    result.get("slack_message"),
        "postmortem":       result.get("postmortem"),
        "owners":           result.get("owner_ids"),
        "agent_messages":   result.get("agent_messages", []),
        "routing_evidence": result.get("routing_evidence", []),
        "coworker_exchanges": result.get("coworker_exchanges", []),
        "shared_memory_hits": result.get("shared_memory_hits", []),
        "learned_facts":    result.get("learned_facts", []),
        "memory_writes":    result.get("memory_writes", []),
        "stream_log":       result.get("stream_log", []),
    }


@app.get("/incidents/stream")
async def stream_incident(
    issue_url: str | None = None,
    incident_text: str | None = None,
    repo_name: str | None = None,
    issue_number: int | None = None,
    thread_id: str | None = None,
):
    """SSE stream of the full AUBI graph execution."""

    state_input = _state_input_from_issue_request(IssueRequest(
        issue_url=issue_url,
        incident_text=incident_text,
        repo_name=repo_name,
        issue_number=issue_number,
    ))
    run_thread_id = thread_id or uuid4().hex
    config = {"configurable": {"thread_id": run_thread_id}}

    async def event_generator():
        interrupted = False
        try:
            yield f"data: {json.dumps({'event': 'thread', 'data': {'thread_id': run_thread_id}})}\n\n"
            async for event in aubi_graph.astream_events(state_input, config=config, version="v2"):
                kind = event.get("event", "")
                name = event.get("name", "")
                data = event.get("data", {})

                if kind == "on_chain_start" and name in GRAPH_NODES:
                    yield f"data: {json.dumps({'event': 'node_start', 'node': name, 'data': None})}\n\n"

                elif kind == "on_chain_stream" and name == "LangGraph":
                    payload = _extract_interrupt_payload_from_chunk(data.get("chunk", {}))
                    if payload:
                        payload = {**payload, "thread_id": run_thread_id}
                        yield f"data: {json.dumps({'event': 'awaiting_approval', 'data': payload}, default=str)}\n\n"
                        interrupted = True
                        break

                elif kind == "on_chain_end" and name in GRAPH_NODES:
                    output = data.get("output", {})

                    # Agent comm feed messages
                    for msg in (output.get("agent_messages") or []):
                        yield f"data: {json.dumps({'event': 'agent_message', 'data': msg})}\n\n"

                    # Routing evidence for the selected coworker panel.
                    for ev in (output.get("routing_evidence") or []):
                        yield f"data: {json.dumps({'event': 'routing_evidence', 'data': ev})}\n\n"

                    for exchange in (output.get("coworker_exchanges") or []):
                        yield f"data: {json.dumps({'event': 'coworker_exchange', 'data': exchange}, default=str)}\n\n"

                    for hit in (output.get("shared_memory_hits") or []):
                        yield f"data: {json.dumps({'event': 'shared_memory_hit', 'data': hit}, default=str)}\n\n"

                    # "AUBI learned" strip — fires after pr_pusher
                    for lf in (output.get("learned_facts") or []):
                        yield f"data: {json.dumps({'event': 'aubi_learned', 'data': lf})}\n\n"

                    for write in (output.get("memory_writes") or []):
                        yield f"data: {json.dumps({'event': 'memory_write', 'data': write}, default=str)}\n\n"

                    yield f"data: {json.dumps({'event': 'node_done', 'node': name, 'data': output}, default=str)}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'event': 'error', 'node': 'graph', 'data': str(e)})}\n\n"

        yield f"data: {json.dumps({'event': 'complete', 'data': {'interrupted': interrupted, 'thread_id': run_thread_id}})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/incidents/approve")
async def approve_incident(thread_id: str, approved: bool = True):
    """Resume a paused graph after human approval/rejection."""
    snapshot = aubi_graph.get_state({"configurable": {"thread_id": thread_id}})
    if not snapshot.values:
        raise HTTPException(status_code=404, detail=f"No incident thread found for {thread_id}")
    if not snapshot.interrupts:
        raise HTTPException(status_code=409, detail=f"Incident thread {thread_id} is not awaiting approval")

    try:
        result = await aubi_graph.ainvoke(
            Command(resume={"approved": approved}),
            config={"configurable": {"thread_id": thread_id}},
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not resume incident {thread_id}: {e}") from e
    return {
        "thread_id": thread_id,
        "approved": approved,
        "pr_url": result.get("pr_url"),
        "branch_name": result.get("branch_name"),
        "patch_diff": result.get("patch_diff"),
        "fix_explanation": result.get("fix_explanation"),
        "test_output": result.get("test_output"),
        "tests_passed": result.get("tests_passed"),
        "coworker_exchanges": result.get("coworker_exchanges", []),
        "shared_memory_hits": result.get("shared_memory_hits", []),
        "learned_facts": result.get("learned_facts", []),
        "memory_writes": result.get("memory_writes", []),
        "stream_log": result.get("stream_log", []),
    }


@app.get("/github/poll")
async def poll_github():
    """Return the latest open issue on the configured target repo."""
    repo_name = _target_repo()
    if not repo_name:
        raise HTTPException(status_code=400, detail="Set TARGET_REPO or GITHUB_REPO to poll GitHub issues")
    try:
        from ingestion.github_issue import get_latest_open_issue
        return {"issue": get_latest_open_issue(repo_name)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitHub issue poll failed: {e}") from e


@app.get("/github/issues")
async def list_github_issues(repo_name: str | None = None, limit: int = 20):
    """Return recent open issues for the configured or requested target repo."""
    target = repo_name or _target_repo()
    if not target:
        raise HTTPException(status_code=400, detail="Set TARGET_REPO or GITHUB_REPO to list GitHub issues")
    try:
        from ingestion.github_issue import list_open_issues
        return {"repo_name": target, "issues": list_open_issues(target, limit)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitHub issue list failed: {e}") from e


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/ready")
async def ready():
    """Report whether the real demo dependencies are configured and reachable."""
    checks: dict[str, Any] = {
        "openai_api_key": bool(os.getenv("OPENAI_API_KEY")),
        "github_token": bool(os.getenv("GITHUB_TOKEN")),
        "target_repo": bool(_target_repo()),
        "openai_model": bool(os.getenv("OPENAI_MODEL")),
        "tenant_id": bool(os.getenv("AUBI_TENANT_ID")),
        "team_id": bool(os.getenv("AUBI_TEAM_ID")),
        "go_toolchain": bool(shutil.which("go")),
    }
    try:
        get_store()
        checks["qdrant"] = True
    except Exception as e:
        checks["qdrant"] = False
        checks["qdrant_error"] = str(e)

    required = [
        "openai_api_key",
        "github_token",
        "target_repo",
        "openai_model",
        "tenant_id",
        "team_id",
        "go_toolchain",
        "qdrant",
    ]
    return {
        "ready": all(bool(checks.get(name)) for name in required),
        "checks": checks,
    }
