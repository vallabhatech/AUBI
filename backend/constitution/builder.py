"""Context Constitution builder.

Takes structured GitHub data -> a configured JSON-capable model -> list of
ConstitutionFacts -> stored as Qdrant semantic_facts points.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

logger = logging.getLogger(__name__)

ALLOWED_CATEGORIES = {
    "code_ownership",
    "expertise",
    "collaboration",
    "current_focus",
    "known_issues",
}

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        kwargs: dict[str, Any] = {"api_key": api_key}
        base_url = os.getenv("OPENAI_BASE_URL")
        if base_url:
            kwargs["base_url"] = base_url
        _client = AsyncOpenAI(**kwargs)
    return _client


def _constitution_model() -> str:
    model = os.getenv("OPENAI_CONSTITUTION_MODEL") or os.getenv("OPENAI_MODEL")
    if not model:
        raise RuntimeError("OPENAI_CONSTITUTION_MODEL or OPENAI_MODEL is not set")
    return model

CONSTITUTION_SYSTEM = """\
You are a developer profiling system. Analyze GitHub activity data and extract structured facts about a developer.

Return a JSON object with a "facts" array. Each fact MUST have these fields:
{
  "subject": "<github_username>",
  "predicate": "<verb describing relationship>",
  "object": "<the value>",
  "confidence": 0.0-1.0,
  "category": "<one of: code_ownership | expertise | collaboration | current_focus | known_issues>"
}

Guidelines:
- code_ownership: which directories/files they own (use predicate "owns")
- expertise: technical skills inferred from repos/languages (predicate "expertise_in")
- collaboration: how they prefer to work, review style, communication (predicate "prefers")
- current_focus: what they are actively working on right now (predicate "currently_working_on")
- known_issues: known problems in their code areas (predicate "is_aware_of_issue")

Be specific and concrete. Infer from patterns, not keywords.
Return ONLY valid JSON. No markdown. No explanation.

Example output:
{
  "facts": [
    {"subject": "<github_username>", "predicate": "owns", "object": "auth/ directory (78% of commits there)", "confidence": 0.95, "category": "code_ownership"},
    {"subject": "<github_username>", "predicate": "expertise_in", "object": "Go, PostgreSQL, distributed systems", "confidence": 0.9, "category": "expertise"},
    {"subject": "<github_username>", "predicate": "prefers", "object": "async communication - review comments show detailed, standalone explanations", "confidence": 0.8, "category": "collaboration"},
    {"subject": "<github_username>", "predicate": "currently_working_on", "object": "payment retry logic based on recent PR titles", "confidence": 0.85, "category": "current_focus"}
  ]
}
"""

CONSTITUTION_USER = """\
Developer: {username} ({name})
Bio: {bio}
Company: {company}
Languages: {languages}

Top files/directories touched (last 90 days):
{top_files}

Recent commit messages (sample):
{commit_messages}

Recent PR titles:
{pr_titles}

Review comments written (sample):
{review_comments}

Extract 8-15 concrete facts about this developer.
"""


def _confidence(value: Any, default: float = 0.75) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return default


def _normalize_facts(raw_facts: Any, username: str) -> list[dict[str, Any]]:
    if not isinstance(raw_facts, list):
        return []

    facts: list[dict[str, Any]] = []
    for raw in raw_facts:
        if not isinstance(raw, dict):
            continue
        obj = str(raw.get("object", "")).strip()
        if not obj:
            continue
        category = str(raw.get("category", "expertise")).strip()
        if category not in ALLOWED_CATEGORIES:
            category = "expertise"
        facts.append({
            "subject": str(raw.get("subject") or username),
            "predicate": str(raw.get("predicate") or "knows"),
            "object": obj,
            "confidence": _confidence(raw.get("confidence")),
            "category": category,
        })
    return facts


async def build_constitution_from_github(
    github_data: dict[str, Any],
) -> list[dict[str, Any]]:
    """Call OpenAI to extract constitution facts from GitHub data.

    Returns list of fact dicts ready to store in Qdrant.
    """
    username = github_data["username"]

    commit_messages = "\n".join(
        f"- {c['message']} ({c.get('repo', '?')})"
        for c in github_data.get("commits", [])[:30]
    )
    pr_titles = "\n".join(
        f"- {p['title']} ({p.get('repo', '?')})"
        for p in github_data.get("prs", [])[:15]
    )
    review_comments = "\n".join(
        f"- {r[:150]}" for r in github_data.get("review_comments_sample", [])
    )

    prompt = CONSTITUTION_USER.format(
        username=username,
        name=github_data.get("name", username),
        bio=github_data.get("bio", ""),
        company=github_data.get("company", ""),
        languages=", ".join(github_data.get("languages", [])),
        top_files="\n".join(f"  {f}" for f in github_data.get("top_files", [])[:20]),
        commit_messages=commit_messages or "(no commits found)",
        pr_titles=pr_titles or "(no PRs found)",
        review_comments=review_comments or "(no review comments found)",
    )

    model = _constitution_model()
    response = await _get_client().chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": CONSTITUTION_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    raw = response.choices[0].message.content or ""
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"{model} did not return valid JSON: {raw[:500]}") from e

    raw_facts = parsed.get("facts") if isinstance(parsed, dict) else parsed
    facts = _normalize_facts(raw_facts, username)
    if not facts:
        raise ValueError(f"{model} returned no usable constitution facts for {username}")

    return facts


def facts_to_qdrant_points(
    facts: list[dict[str, Any]],
    *,
    user_id: str,
    tenant_id: str,
    embed_fn,
) -> list[Any]:
    """Convert fact dicts into Qdrant PointStruct objects."""
    from qdrant_client.models import PointStruct

    points = []
    for fact in facts:
        text = f"{fact.get('subject', '')} {fact.get('predicate', '')} {fact.get('object', '')}"
        vector = embed_fn(text)
        point_key = json.dumps({
            "tenant_id": tenant_id,
            "user_id": user_id,
            "subject": fact.get("subject", ""),
            "predicate": fact.get("predicate", ""),
            "object": fact.get("object", ""),
            "category": fact.get("category", "general"),
        }, sort_keys=True, separators=(",", ":"), default=str)
        points.append(PointStruct(
            id=str(uuid5(NAMESPACE_URL, point_key)),
            vector=vector,
            payload={
                "user_id": user_id,
                "tenant_id": tenant_id,
                "scope": "user",
                "scope_id": user_id,
                "subject": fact.get("subject", ""),
                "predicate": fact.get("predicate", ""),
                "object": fact.get("object", ""),
                "confidence": fact.get("confidence", 0.7),
                "category": fact.get("category", "general"),
            },
        ))
    return points
