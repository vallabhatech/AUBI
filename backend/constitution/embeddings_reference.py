"""Embedding model management.

Uses sentence-transformers for local embedding generation.
The default model (all-MiniLM-L6-v2) produces 384-dim vectors.
"""

from __future__ import annotations

import logging
from functools import lru_cache

import numpy as np

from app.config import get_settings

logger = logging.getLogger(__name__)


@lru_cache
def get_embedding_model():
    """Load and cache the embedding model."""
    from sentence_transformers import SentenceTransformer

    settings = get_settings()
    logger.info("Loading embedding model: %s", settings.embedding_model)
    return SentenceTransformer(settings.embedding_model)


def embed_text(text: str) -> list[float]:
    """Generate embedding for a single text."""
    model = get_embedding_model()
    embedding = model.encode(text, normalize_embeddings=True)
    return embedding.tolist()


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a batch of texts."""
    model = get_embedding_model()
    embeddings = model.encode(texts, normalize_embeddings=True, batch_size=32)
    return [e.tolist() for e in embeddings]
