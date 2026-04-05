"""Qdrant client management and collection initialization.

Three collections per agent scope:
- semantic_facts: Subject/predicate/object triples with confidence and temporal validity
- episodes: Conversation history, tool usage, outcomes, lessons
- procedures: Learned task workflows with steps and success tracking
"""

from __future__ import annotations

import logging
from functools import lru_cache

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    VectorParams,
)

from app.config import get_settings

logger = logging.getLogger(__name__)

COLLECTION_NAMES = ["semantic_facts", "episodes", "procedures"]


@lru_cache
def get_qdrant_client() -> QdrantClient:
    """Get a singleton Qdrant client instance."""
    settings = get_settings()
    return QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
    )


def ensure_collections() -> None:
    """Ensure all required Qdrant collections exist."""
    settings = get_settings()
    client = get_qdrant_client()

    existing = {c.name for c in client.get_collections().collections}

    for name in COLLECTION_NAMES:
        if name not in existing:
            logger.info("Creating Qdrant collection: %s", name)
            client.create_collection(
                collection_name=name,
                vectors_config=VectorParams(
                    size=settings.embedding_dim,
                    distance=Distance.COSINE,
                ),
            )
            logger.info("Created collection: %s", name)
        else:
            logger.info("Collection already exists: %s", name)


def scope_filter(tenant_id: str, scope: str, scope_id: str) -> Filter:
    """Build a Qdrant filter for a specific scope."""
    return Filter(
        must=[
            FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
            FieldCondition(key="scope", match=MatchValue(value=scope)),
            FieldCondition(key="scope_id", match=MatchValue(value=scope_id)),
        ]
    )
