"""Post-session memory extraction.

Runs after each session to extract implicit signals from the transcript:
- Explicit facts (statements, corrections, declarations)
- Implicit signals (preferences, patterns, recurring topics)
- Outcomes (what worked, what failed, lessons learned)

Extracted content is written to the appropriate Qdrant collection.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import uuid4

from qdrant_client.models import PointStruct

from app.collections.embeddings import embed_text
from app.collections.qdrant_client import get_qdrant_client
from app.config import get_settings

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """\
You are a memory extraction system. Analyze the following conversation transcript \
and extract structured knowledge.

Extract the following categories:

1. **Facts** — Explicit statements, corrections, and declarations made by the user.
   Format: {"subject": "...", "predicate": "...", "object": "...", "confidence": 0.0-1.0, "category": "..."}

2. **Lessons** — What worked, what failed, and what should be remembered.
   Format: {"summary": "...", "importance": 0.0-1.0}

3. **Preferences** — User preferences, patterns, and behavioral tendencies.
   Format: {"subject": "user", "predicate": "prefers", "object": "...", "confidence": 0.0-1.0, "category": "preference"}

Return valid JSON with keys: "facts", "lessons", "preferences"

Transcript:
{transcript}
"""


async def extract_and_store(
    *,
    tenant_id: str,
    user_id: str,
    thread_id: str,
    transcript: str,
) -> dict[str, int]:
    """Extract knowledge from a session transcript and store it.

    Returns counts of extracted items per category.
    """
    settings = get_settings()
    client = get_qdrant_client()

    # Use LLM to extract structured knowledge
    extracted = await _extract_with_llm(transcript, settings.extraction_model)
    if not extracted:
        return {"facts": 0, "lessons": 0, "preferences": 0}

    counts = {"facts": 0, "lessons": 0, "preferences": 0}

    # Store facts
    facts = extracted.get("facts", []) + extracted.get("preferences", [])
    if facts:
        points = []
        for fact in facts:
            text = f"{fact.get('subject', '')} {fact.get('predicate', '')} {fact.get('object', '')}"
            vector = embed_text(text)
            points.append(
                PointStruct(
                    id=str(uuid4()),
                    vector=vector,
                    payload={
                        "tenant_id": tenant_id,
                        "scope": "user",
                        "scope_id": user_id,
                        "subject": fact.get("subject", ""),
                        "predicate": fact.get("predicate", ""),
                        "object": fact.get("object", ""),
                        "confidence": fact.get("confidence", 0.5),
                        "category": fact.get("category", "general"),
                        "source_thread_id": thread_id,
                    },
                )
            )
        client.upsert(collection_name="semantic_facts", points=points)
        counts["facts"] = len(facts)

    # Store episode
    lessons = extracted.get("lessons", [])
    if lessons:
        episode_summary = "; ".join(l.get("summary", "") for l in lessons)
        vector = embed_text(episode_summary)
        importance = max(l.get("importance", 0.5) for l in lessons)
        client.upsert(
            collection_name="episodes",
            points=[
                PointStruct(
                    id=str(uuid4()),
                    vector=vector,
                    payload={
                        "tenant_id": tenant_id,
                        "scope": "user",
                        "scope_id": user_id,
                        "thread_id": thread_id,
                        "summary": episode_summary,
                        "lessons": [l.get("summary", "") for l in lessons],
                        "importance": importance,
                        "access_count": 0,
                    },
                )
            ],
        )
        counts["lessons"] = len(lessons)

    return counts


async def _extract_with_llm(transcript: str, model: str) -> dict[str, Any] | None:
    """Use an LLM to extract structured knowledge from a transcript."""
    try:
        from langchain.chat_models import init_chat_model
        from langchain_core.messages import HumanMessage

        llm = init_chat_model(model)
        prompt = EXTRACTION_PROMPT.format(transcript=transcript[:50000])
        response = await llm.ainvoke([HumanMessage(content=prompt)])

        # Parse JSON from response
        content = response.content
        if isinstance(content, str):
            # Try to find JSON in the response
            start = content.find("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
        return None
    except Exception as exc:
        logger.exception("LLM extraction failed: %s", exc)
        return None
