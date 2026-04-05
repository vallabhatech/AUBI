"""Qdrant-backed constitution store.

Collections:
  semantic_facts  — SPO triples (subject/predicate/object) from GitHub profiling
  episodes        — resolved incidents written back after each PR push

Usage:
  from constitution.store import ConstitutionStore
  store = ConstitutionStore()
  store.upsert_facts(user_id, tenant_id, facts)
  results = store.search(user_id, tenant_id, query_text, top_k=5)
  grouped = store.get_by_user(user_id, tenant_id)
"""

from __future__ import annotations

import logging
import os
import json
from functools import lru_cache
from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

logger = logging.getLogger(__name__)

COLLECTION_FACTS    = "semantic_facts"
COLLECTION_EPISODES = "episodes"
EMBEDDING_DIM       = 384   # all-MiniLM-L6-v2
FILTER_INDEX_FIELDS = ("user_id", "tenant_id", "scope", "scope_id", "category", "predicate")


# ---------------------------------------------------------------------------
# Embeddings (local, free — no API credits)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _get_model():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer("all-MiniLM-L6-v2")


def embed(text: str) -> list[float]:
    return _get_model().encode(text, normalize_embeddings=True).tolist()


# ---------------------------------------------------------------------------
# Qdrant client
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _get_client():
    from qdrant_client import QdrantClient
    url = os.getenv("QDRANT_URL")
    if not url:
        raise RuntimeError("QDRANT_URL is not set")
    api_key = os.getenv("QDRANT_API_KEY")
    return QdrantClient(url=url, api_key=api_key)


def _ensure_collection(name: str) -> None:
    from qdrant_client.models import Distance, VectorParams
    client = _get_client()
    existing = {c.name for c in client.get_collections().collections}
    if name not in existing:
        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
        )
        logger.info("Created Qdrant collection: %s", name)
    _ensure_payload_indexes(name)


def _ensure_payload_indexes(name: str) -> None:
    """Create payload indexes required by filtered search/scroll/delete."""
    from qdrant_client.models import PayloadSchemaType

    client = _get_client()
    existing = set((getattr(client.get_collection(name), "payload_schema", None) or {}).keys())
    for field_name in FILTER_INDEX_FIELDS:
        if field_name in existing:
            continue
        try:
            client.create_payload_index(
                collection_name=name,
                field_name=field_name,
                field_schema=PayloadSchemaType.KEYWORD,
                wait=True,
            )
        except Exception as e:
            message = str(e).lower()
            if "already exists" not in message and "already has" not in message:
                raise


def _vector_search(
    *,
    collection_name: str,
    query_vector: list[float],
    query_filter,
    limit: int,
):
    """Compatibility wrapper for older `.search()` and newer `.query_points()` clients."""
    client = _get_client()
    if hasattr(client, "search"):
        return client.search(
            collection_name=collection_name,
            query_vector=query_vector,
            query_filter=query_filter,
            limit=limit,
        )
    response = client.query_points(
        collection_name=collection_name,
        query=query_vector,
        query_filter=query_filter,
        limit=limit,
        with_payload=True,
        with_vectors=False,
    )
    return response.points


def jsonish(value: Any) -> str:
    """Stable JSON string for deterministic Qdrant point IDs."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _team_scope_id(tenant_id: str, team_id: str) -> str:
    return f"{tenant_id}:team:{team_id}"


def _hit_payload(hit: Any, *, collection: str | None = None) -> dict[str, Any]:
    payload = dict(getattr(hit, "payload", None) or {})
    payload["_score"] = float(getattr(hit, "score", 0.0) or 0.0)
    if collection:
        payload["_collection"] = collection
    return payload


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class ConstitutionStore:
    def __init__(self) -> None:
        _ensure_collection(COLLECTION_FACTS)
        _ensure_collection(COLLECTION_EPISODES)

    # ---- Write ----------------------------------------------------------------

    def upsert_facts(
        self,
        user_id: str,
        tenant_id: str,
        facts: list[dict[str, Any]],
    ) -> int:
        """Store SPO triples into semantic_facts. Returns count stored."""
        from qdrant_client.models import PointStruct

        client = _get_client()
        points: list[PointStruct] = []
        for fact in facts:
            text   = f"{fact.get('subject','')} {fact.get('predicate','')} {fact.get('object','')}"
            vector = embed(text)
            point_key = jsonish({
                "tenant_id": tenant_id,
                "user_id": user_id,
                "subject": fact.get("subject", ""),
                "predicate": fact.get("predicate", ""),
                "object": fact.get("object", ""),
                "category": fact.get("category", "general"),
            })
            points.append(PointStruct(
                id=str(uuid5(NAMESPACE_URL, point_key)),
                vector=vector,
                payload={
                    "user_id":    user_id,
                    "scope":      "user",
                    "scope_id":   user_id,
                    "tenant_id":  tenant_id,
                    "subject":    fact.get("subject", ""),
                    "predicate":  fact.get("predicate", ""),
                    "object":     fact.get("object", ""),
                    "confidence": fact.get("confidence", 0.7),
                    "category":   fact.get("category", "general"),
                },
            ))

        if points:
            client.upsert(collection_name=COLLECTION_FACTS, points=points)
        logger.info("Stored %d facts for user %s", len(points), user_id)
        return len(points)

    def add_episode(
        self,
        user_id: str,
        tenant_id: str,
        episode: dict[str, Any],
    ) -> None:
        """Record a resolved incident/episode."""
        from qdrant_client.models import PointStruct

        text   = f"{episode.get('predicate','')} {episode.get('object','')}"
        vector = embed(text)
        payload = {
            "user_id":    user_id,
            "scope":      "user",
            "scope_id":   user_id,
            "tenant_id":  tenant_id,
            "subject":    episode.get("subject", user_id),
            "predicate":  episode.get("predicate", "resolved"),
            "object":     episode.get("object", ""),
            "confidence": episode.get("confidence", 0.9),
            "category":   "episodes",
        }
        for key in (
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
        ):
            if key in episode:
                payload[key] = episode[key]
        _get_client().upsert(
            collection_name=COLLECTION_EPISODES,
            points=[PointStruct(
                id=str(uuid4()),
                vector=vector,
                payload=payload,
            )],
        )

    def upsert_team_facts(
        self,
        tenant_id: str,
        facts: list[dict[str, Any]],
        *,
        team_id: str,
        source_agent_id: str | None = None,
    ) -> int:
        """Store shared team facts into semantic_facts under scope=team."""
        from qdrant_client.models import PointStruct

        scope_id = _team_scope_id(tenant_id, team_id)
        points: list[PointStruct] = []
        for fact in facts:
            text = f"{fact.get('subject','')} {fact.get('predicate','')} {fact.get('object','')}"
            point_key = jsonish({
                "tenant_id": tenant_id,
                "scope": "team",
                "scope_id": scope_id,
                "subject": fact.get("subject", "team"),
                "predicate": fact.get("predicate", ""),
                "object": fact.get("object", ""),
                "category": fact.get("category", "team_memory"),
            })
            payload = {
                "user_id": "",
                "scope": "team",
                "scope_id": scope_id,
                "team_id": team_id,
                "tenant_id": tenant_id,
                "subject": fact.get("subject", "team"),
                "predicate": fact.get("predicate", ""),
                "object": fact.get("object", ""),
                "confidence": fact.get("confidence", 0.8),
                "category": fact.get("category", "team_memory"),
            }
            if source_agent_id:
                payload["source_agent_id"] = source_agent_id
            for key in ("participants", "issue_number", "repo_name", "pr_url", "written_at"):
                if key in fact:
                    payload[key] = fact[key]
            points.append(PointStruct(
                id=str(uuid5(NAMESPACE_URL, point_key)),
                vector=embed(text),
                payload=payload,
            ))

        if points:
            _get_client().upsert(collection_name=COLLECTION_FACTS, points=points)
        logger.info("Stored %d shared team facts for %s", len(points), scope_id)
        return len(points)

    def add_team_episode(
        self,
        tenant_id: str,
        episode: dict[str, Any],
        *,
        team_id: str,
    ) -> str:
        """Record a team-scoped incident episode in shared memory."""
        from qdrant_client.models import PointStruct

        scope_id = _team_scope_id(tenant_id, team_id)
        text = f"{episode.get('predicate','')} {episode.get('object','')}"
        point_id = str(uuid4())
        payload = {
            "user_id": "",
            "scope": "team",
            "scope_id": scope_id,
            "team_id": team_id,
            "tenant_id": tenant_id,
            "subject": episode.get("subject", "team"),
            "predicate": episode.get("predicate", "learned"),
            "object": episode.get("object", ""),
            "confidence": episode.get("confidence", 0.9),
            "category": "episodes",
        }
        for key in (
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
        ):
            if key in episode:
                payload[key] = episode[key]
        _get_client().upsert(
            collection_name=COLLECTION_EPISODES,
            points=[PointStruct(id=point_id, vector=embed(text), payload=payload)],
        )
        return point_id

    # ---- Read -----------------------------------------------------------------

    def search(
        self,
        user_id: str,
        tenant_id: str,
        query: str,
        top_k: int = 8,
        collection: str = COLLECTION_FACTS,
    ) -> list[dict[str, Any]]:
        """Semantic search over a user's facts. Returns payload dicts."""
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        vector = embed(query)
        results = _vector_search(
            collection_name=collection,
            query_vector=vector,
            query_filter=Filter(must=[
                FieldCondition(key="user_id",   match=MatchValue(value=user_id)),
                FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
                FieldCondition(key="scope", match=MatchValue(value="user")),
            ]),
            limit=top_k,
        )
        return [
            _hit_payload(hit, collection=collection)
            for hit in results
        ]

    def search_across_agent_facts(
        self,
        tenant_id: str,
        query: str,
        *,
        top_k: int = 24,
        categories: set[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Semantic search over all personal agent facts in a tenant."""
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        results = _vector_search(
            collection_name=COLLECTION_FACTS,
            query_vector=embed(query),
            query_filter=Filter(must=[
                FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
                FieldCondition(key="scope", match=MatchValue(value="user")),
            ]),
            limit=top_k,
        )
        hits = [_hit_payload(hit, collection=COLLECTION_FACTS) for hit in results]
        if categories:
            hits = [hit for hit in hits if str(hit.get("category", "")) in categories]
        return hits

    def search_team_memory(
        self,
        tenant_id: str,
        query: str,
        *,
        team_id: str,
        top_k: int = 8,
        collections: tuple[str, ...] = (COLLECTION_FACTS, COLLECTION_EPISODES),
    ) -> list[dict[str, Any]]:
        """Semantic search over shared team memory across facts and episodes."""
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        scope_id = _team_scope_id(tenant_id, team_id)
        query_vector = embed(query)
        hits: list[dict[str, Any]] = []
        for collection in collections:
            results = _vector_search(
                collection_name=collection,
                query_vector=query_vector,
                query_filter=Filter(must=[
                    FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
                    FieldCondition(key="scope", match=MatchValue(value="team")),
                    FieldCondition(key="scope_id", match=MatchValue(value=scope_id)),
                ]),
                limit=top_k,
            )
            hits.extend(_hit_payload(hit, collection=collection) for hit in results)
        hits.sort(key=lambda item: float(item.get("_score", 0.0)), reverse=True)
        return hits[:top_k]

    def list_team_memory(
        self,
        tenant_id: str,
        *,
        team_id: str,
        limit: int = 100,
        collection: str | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        """Fetch shared team memory grouped by Qdrant collection."""
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        scope_id = _team_scope_id(tenant_id, team_id)
        collections = (collection,) if collection else (COLLECTION_FACTS, COLLECTION_EPISODES)
        grouped: dict[str, list[dict[str, Any]]] = {}
        for col in collections:
            results, _offset = _get_client().scroll(
                collection_name=col,
                scroll_filter=Filter(must=[
                    FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
                    FieldCondition(key="scope", match=MatchValue(value="team")),
                    FieldCondition(key="scope_id", match=MatchValue(value=scope_id)),
                ]),
                limit=limit,
                with_payload=True,
                with_vectors=False,
            )
            grouped[col] = [dict(point.payload or {}) for point in results]
        return grouped

    def get_by_user(
        self,
        user_id: str,
        tenant_id: str,
        limit: int = 100,
    ) -> dict[str, list[dict[str, Any]]]:
        """Fetch all facts and learned episodes for a user grouped by category."""
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        user_filter = Filter(must=[
            FieldCondition(key="user_id", match=MatchValue(value=user_id)),
            FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
            FieldCondition(key="scope", match=MatchValue(value="user")),
        ])
        results, _offset = _get_client().scroll(
            collection_name=COLLECTION_FACTS,
            scroll_filter=user_filter,
            limit=limit,
            with_payload=True,
            with_vectors=False,
        )

        grouped: dict[str, list] = {}
        for point in results:
            payload = dict(point.payload or {})
            cat = payload.get("category", "general")
            grouped.setdefault(cat, []).append(payload)

        episodes, _episode_offset = _get_client().scroll(
            collection_name=COLLECTION_EPISODES,
            scroll_filter=user_filter,
            limit=limit,
            with_payload=True,
            with_vectors=False,
        )
        for point in episodes:
            payload = dict(point.payload or {})
            payload.setdefault("_collection", COLLECTION_EPISODES)
            cat = payload.get("category", "episodes")
            grouped.setdefault(cat, []).append(payload)
        return grouped

    def list_user_facts(
        self,
        tenant_id: str,
        limit: int = 1000,
    ) -> dict[str, list[dict[str, Any]]]:
        """Fetch facts and learned episodes for all users in a tenant grouped by user_id."""
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        grouped: dict[str, list[dict[str, Any]]] = {}
        for collection in (COLLECTION_FACTS, COLLECTION_EPISODES):
            offset = None
            while True:
                results, offset = _get_client().scroll(
                    collection_name=collection,
                    scroll_filter=Filter(must=[
                        FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
                        FieldCondition(key="scope", match=MatchValue(value="user")),
                    ]),
                    limit=limit,
                    offset=offset,
                    with_payload=True,
                    with_vectors=False,
                )
                for point in results:
                    payload = dict(point.payload or {})
                    user_id = str(payload.get("user_id") or "")
                    if user_id:
                        if collection == COLLECTION_EPISODES:
                            payload.setdefault("_collection", COLLECTION_EPISODES)
                        grouped.setdefault(user_id, []).append(payload)
                if offset is None:
                    break
        return grouped

    def search_ownership(
        self,
        filepath: str,
        tenant_id: str,
        top_k: int = 8,
    ) -> tuple[str | None, float, list[dict[str, Any]]]:
        """Find the most likely owner for a filepath from code_ownership facts.

        Returns (owner_agent_id, confidence, evidence_facts).
        The score is boosted for deterministic directory-prefix matches because
        filepath ownership is more precise than pure semantic similarity.
        """
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        path = filepath.strip()
        if not path:
            return None, 0.0, []

        path_lower = path.lower()
        first_segment = path_lower.split("/", 1)[0] + "/" if "/" in path_lower else path_lower
        query = f"code owner for {path}"

        filt = Filter(must=[
            FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
            FieldCondition(key="scope", match=MatchValue(value="user")),
            FieldCondition(key="category", match=MatchValue(value="code_ownership")),
            FieldCondition(key="predicate", match=MatchValue(value="owns")),
        ])

        hits = _vector_search(
            collection_name=COLLECTION_FACTS,
            query_vector=embed(query),
            query_filter=filt,
            limit=top_k,
        )

        best_owner: str | None = None
        best_score = 0.0
        evidence: list[dict[str, Any]] = []

        for hit in hits:
            payload = dict(hit.payload or {})
            owner = payload.get("scope_id") or payload.get("user_id")
            if not owner:
                continue

            obj = str(payload.get("object", "")).lower()
            confidence = float(payload.get("confidence", 0.7) or 0.7)
            score = float(hit.score or 0.0) * confidence

            # Prefix evidence should dominate pure semantic similarity for
            # ownership facts.
            if first_segment and first_segment in obj:
                score = max(score, confidence, 0.9)
            elif path_lower in obj:
                score = max(score, confidence, 0.85)

            payload["_score"] = score
            evidence.append(payload)

            if score > best_score:
                best_owner = str(owner)
                best_score = score

        evidence.sort(key=lambda item: float(item.get("_score", 0.0)), reverse=True)
        return best_owner, round(best_score, 3), evidence[:4]

    def delete_user(self, user_id: str, tenant_id: str) -> None:
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        filt = Filter(must=[
            FieldCondition(key="user_id",   match=MatchValue(value=user_id)),
            FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
        ])
        for col in (COLLECTION_FACTS, COLLECTION_EPISODES):
            _get_client().delete(collection_name=col, points_selector=filt)
