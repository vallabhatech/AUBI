"""Memory context builder.

Assembles memory context for an agent at session start.
Priority order: semantic_facts -> episodes -> procedures.
Respects token budget (default 50,000 tokens).

For user Aubis, King Aubi's semantic_facts are injected first
as a read-only secondary source.
"""

from __future__ import annotations

import logging
from typing import Any

from qdrant_client.models import FieldCondition, Filter, MatchValue

from app.collections.embeddings import embed_text
from app.collections.qdrant_client import get_qdrant_client, scope_filter
from app.config import get_settings

logger = logging.getLogger(__name__)

# Approximate token estimation: ~1 token per 4 characters
CHARS_PER_TOKEN = 4


def estimate_tokens(text: str) -> int:
    return len(text) // CHARS_PER_TOKEN


def build_memory_context(
    *,
    tenant_id: str,
    user_id: str,
    query: str | None = None,
    include_king_facts: bool = True,
) -> str:
    """Build the full memory context string for an agent session.

    Returns a formatted string ready for injection into the system prompt.
    """
    settings = get_settings()
    client = get_qdrant_client()
    budget = settings.memory_context_total_tokens
    sections: list[str] = []
    used_tokens = 0

    # Step 1: King Aubi's semantic facts (organizational knowledge)
    if include_king_facts:
        king_facts = _search_collection(
            client=client,
            collection="semantic_facts",
            query=query or "",
            filter_=scope_filter(tenant_id, "tenant", tenant_id),
            limit=settings.semantic_search_limit,
        )
        if king_facts:
            facts_text = _format_facts(king_facts, "Organizational Knowledge")
            facts_tokens = estimate_tokens(facts_text)
            if used_tokens + facts_tokens <= budget:
                sections.append(facts_text)
                used_tokens += facts_tokens

    # Step 2: User's own semantic facts
    user_facts = _search_collection(
        client=client,
        collection="semantic_facts",
        query=query or "",
        filter_=scope_filter(tenant_id, "user", user_id),
        limit=settings.semantic_search_limit,
    )
    if user_facts:
        facts_text = _format_facts(user_facts, "Personal Knowledge")
        facts_tokens = estimate_tokens(facts_text)
        if used_tokens + facts_tokens <= budget:
            sections.append(facts_text)
            used_tokens += facts_tokens

    # Step 3: Episodes (if budget allows)
    remaining = budget - used_tokens
    if remaining > settings.memory_episode_threshold_tokens:
        episodes = _search_collection(
            client=client,
            collection="episodes",
            query=query or "",
            filter_=scope_filter(tenant_id, "user", user_id),
            limit=settings.episode_search_limit,
        )
        if episodes:
            episodes_text = _format_episodes(episodes)
            episodes_tokens = estimate_tokens(episodes_text)
            if used_tokens + episodes_tokens <= budget:
                sections.append(episodes_text)
                used_tokens += episodes_tokens

    # Step 4: Procedures (if budget allows)
    remaining = budget - used_tokens
    if remaining > settings.memory_procedure_threshold_tokens:
        procedures = _search_collection(
            client=client,
            collection="procedures",
            query=query or "",
            filter_=scope_filter(tenant_id, "user", user_id),
            limit=settings.procedure_search_limit,
        )
        if procedures:
            proc_text = _format_procedures(procedures)
            proc_tokens = estimate_tokens(proc_text)
            if used_tokens + proc_tokens <= budget:
                sections.append(proc_text)
                used_tokens += proc_tokens

    if not sections:
        return ""

    return "\n\n---\n\n".join(sections)


def _search_collection(
    *,
    client,
    collection: str,
    query: str,
    filter_: Filter,
    limit: int,
) -> list[dict[str, Any]]:
    """Search a Qdrant collection with hybrid scoring."""
    try:
        if query:
            vector = embed_text(query)
            results = client.search(
                collection_name=collection,
                query_vector=vector,
                query_filter=filter_,
                limit=limit,
            )
        else:
            results = client.scroll(
                collection_name=collection,
                scroll_filter=filter_,
                limit=limit,
            )[0]
        return [
            {**r.payload, "score": getattr(r, "score", 0.0)}
            for r in results
        ]
    except Exception as exc:
        logger.warning("Search failed for %s: %s", collection, exc)
        return []


def _format_facts(facts: list[dict], title: str) -> str:
    lines = [f"### {title}"]
    for f in facts:
        subject = f.get("subject", "")
        predicate = f.get("predicate", "")
        obj = f.get("object", "")
        confidence = f.get("confidence", 0.0)
        lines.append(f"- {subject} {predicate} {obj} (confidence: {confidence:.2f})")
    return "\n".join(lines)


def _format_episodes(episodes: list[dict]) -> str:
    lines = ["### Recent Experience"]
    for e in episodes:
        summary = e.get("summary", "")
        lessons = e.get("lessons", [])
        lines.append(f"- {summary}")
        for lesson in lessons:
            lines.append(f"  - Lesson: {lesson}")
    return "\n".join(lines)


def _format_procedures(procedures: list[dict]) -> str:
    lines = ["### Known Procedures"]
    for p in procedures:
        name = p.get("name", "")
        description = p.get("description", "")
        lines.append(f"- **{name}**: {description}")
    return "\n".join(lines)
