"""Helpers for scoped memory paths, namespaces, and permissions."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

MemoryScope = Literal["user", "folder", "org"]
FolderVisibility = Literal["personal", "org"]

_MEMORY_ROOT = "/memories/"
_MEMORY_USER_PREFIX = "/memories/user/"
_MEMORY_FOLDER_PREFIX = "/memories/folders/"
_MEMORY_ORG_PREFIX = "/memories/org/"


class MemoryPathError(ValueError):
    """Raised when a memory path cannot be parsed or resolved."""


class MemoryPermissionError(PermissionError):
    """Raised when a caller is not allowed to access a memory path."""


@dataclass(frozen=True)
class ResolvedMemoryPath:
    """Resolved scoped memory target information."""

    canonical_path: str
    scope: MemoryScope
    namespace: tuple[str, ...]
    key: str
    folder_id: str | None = None
    folder_visibility: FolderVisibility | None = None


def _normalize_slashes(path: str) -> str:
    if not path:
        return _MEMORY_ROOT
    if not path.startswith("/"):
        path = f"/{path}"
    normalized = re.sub(r"/{2,}", "/", path)
    if normalized == "/memories":
        return _MEMORY_ROOT
    return normalized


def is_memory_path(path: str) -> bool:
    """Return True when the path targets `/memories/*`."""
    return _normalize_slashes(path).startswith(_MEMORY_ROOT)


def normalize_memory_path(path: str) -> str:
    """Normalize memory paths and map legacy `/memories/*` into `/memories/user/*`."""
    normalized = _normalize_slashes(path)
    if not normalized.startswith(_MEMORY_ROOT):
        raise MemoryPathError(f"Path is not under /memories/: {path}")

    if normalized in {_MEMORY_ROOT, "/memories/user", "/memories/user/"}:
        return _MEMORY_USER_PREFIX

    if normalized.startswith(_MEMORY_USER_PREFIX):
        return normalized

    if normalized.startswith(_MEMORY_FOLDER_PREFIX):
        return normalized

    if normalized.startswith(_MEMORY_ORG_PREFIX):
        return normalized

    # Backwards compatibility: `/memories/foo.md` -> `/memories/user/foo.md`
    suffix = normalized[len(_MEMORY_ROOT):]
    return f"{_MEMORY_USER_PREFIX}{suffix}"


def is_memory_suggestion_path(path: str) -> bool:
    """Return True when a memory path points at sidecar suggestions."""
    try:
        canonical = normalize_memory_path(path)
    except MemoryPathError:
        return False
    return "/_suggestions/" in canonical


def get_user_memories_namespace(tenant_id: str, user_id: str) -> tuple[str, ...]:
    """Namespace for user-scoped canonical memories."""
    return (tenant_id, "users", user_id, "memories", "user")


def get_org_memories_namespace(tenant_id: str) -> tuple[str, ...]:
    """Namespace for org-scoped canonical memories."""
    return (tenant_id, "org", "memories", "org")


def get_folder_memories_namespace(
    tenant_id: str,
    user_id: str,
    folder_id: str,
    visibility: FolderVisibility,
) -> tuple[str, ...]:
    """Namespace for folder-scoped canonical memories."""
    if visibility == "personal":
        return (tenant_id, "users", user_id, "memories", "folders", folder_id)
    return (tenant_id, "org", "memories", "folders", folder_id)


def get_folder_metadata_namespace(
    tenant_id: str,
    visibility: FolderVisibility,
    user_id: str | None = None,
) -> tuple[str, ...]:
    """Namespace where folder metadata objects are stored."""
    if visibility == "personal":
        if not user_id:
            raise MemoryPathError("user_id is required for personal folder namespace")
        return (tenant_id, "folders", "personal", user_id)
    return (tenant_id, "folders", "org")


async def _resolve_folder_visibility(
    *,
    store: Any,
    tenant_id: str,
    user_id: str,
    folder_id: str,
) -> FolderVisibility:
    """Resolve folder visibility and enforce basic access checks."""
    personal_ns = get_folder_metadata_namespace(tenant_id, "personal", user_id)
    personal_folder = await store.aget(personal_ns, folder_id)
    if personal_folder and isinstance(personal_folder.value, dict):
        owner_user_id = personal_folder.value.get("owner_user_id")
        if owner_user_id and owner_user_id != user_id:
            raise MemoryPermissionError("Access denied to personal folder memories")
        return "personal"

    org_ns = get_folder_metadata_namespace(tenant_id, "org")
    org_folder = await store.aget(org_ns, folder_id)
    if org_folder and isinstance(org_folder.value, dict):
        folder_tenant = org_folder.value.get("tenant_id")
        if folder_tenant and folder_tenant != tenant_id:
            raise MemoryPermissionError("Access denied to org folder memories")
        return "org"

    raise MemoryPathError(f"Folder not found for memory scope: {folder_id}")


async def resolve_memory_path(
    *,
    store: Any,
    path: str,
    tenant_id: str,
    user_id: str,
) -> ResolvedMemoryPath:
    """Resolve a memory path into namespace/key with tenant/folder permission checks."""
    canonical = normalize_memory_path(path)

    if canonical.startswith(_MEMORY_USER_PREFIX):
        key = canonical[len(_MEMORY_USER_PREFIX):].strip("/")
        if not key:
            raise MemoryPathError("Memory path must include a filename under /memories/user/")
        return ResolvedMemoryPath(
            canonical_path=canonical,
            scope="user",
            namespace=get_user_memories_namespace(tenant_id, user_id),
            key=key,
        )

    if canonical.startswith(_MEMORY_ORG_PREFIX):
        key = canonical[len(_MEMORY_ORG_PREFIX):].strip("/")
        if not key:
            raise MemoryPathError("Memory path must include a filename under /memories/org/")
        return ResolvedMemoryPath(
            canonical_path=canonical,
            scope="org",
            namespace=get_org_memories_namespace(tenant_id),
            key=key,
        )

    if canonical.startswith(_MEMORY_FOLDER_PREFIX):
        remainder = canonical[len(_MEMORY_FOLDER_PREFIX):].strip("/")
        if not remainder:
            raise MemoryPathError("Memory path must include folder id and filename under /memories/folders/")

        folder_id, _, key = remainder.partition("/")
        if not folder_id or not key:
            raise MemoryPathError("Folder memory path must be /memories/folders/{folder_id}/{filename}")

        visibility = await _resolve_folder_visibility(
            store=store,
            tenant_id=tenant_id,
            user_id=user_id,
            folder_id=folder_id,
        )
        return ResolvedMemoryPath(
            canonical_path=canonical,
            scope="folder",
            namespace=get_folder_memories_namespace(tenant_id, user_id, folder_id, visibility),
            key=key,
            folder_id=folder_id,
            folder_visibility=visibility,
        )

    raise MemoryPathError(f"Unsupported memory path: {path}")


def build_memory_path(scope: MemoryScope, key: str, folder_id: str | None = None) -> str:
    """Build a canonical memory path for a scope + key."""
    normalized_key = key.strip("/")
    if not normalized_key:
        raise MemoryPathError("Memory key must not be empty")

    if scope == "user":
        return f"{_MEMORY_USER_PREFIX}{normalized_key}"
    if scope == "org":
        return f"{_MEMORY_ORG_PREFIX}{normalized_key}"
    if scope == "folder":
        if not folder_id:
            raise MemoryPathError("folder_id is required for folder memory paths")
        return f"{_MEMORY_FOLDER_PREFIX}{folder_id}/{normalized_key}"

    raise MemoryPathError(f"Unsupported memory scope: {scope}")


def split_scope_root(canonical_path: str) -> tuple[str, str]:
    """Split canonical path into scope root and remainder key."""
    normalized = normalize_memory_path(canonical_path)
    if normalized.startswith(_MEMORY_USER_PREFIX):
        return _MEMORY_USER_PREFIX.rstrip("/"), normalized[len(_MEMORY_USER_PREFIX):]
    if normalized.startswith(_MEMORY_ORG_PREFIX):
        return _MEMORY_ORG_PREFIX.rstrip("/"), normalized[len(_MEMORY_ORG_PREFIX):]
    if normalized.startswith(_MEMORY_FOLDER_PREFIX):
        remainder = normalized[len(_MEMORY_FOLDER_PREFIX):].strip("/")
        folder_id, _, key = remainder.partition("/")
        if not folder_id or not key:
            raise MemoryPathError(f"Invalid folder memory path: {canonical_path}")
        return f"/memories/folders/{folder_id}", key
    raise MemoryPathError(f"Invalid canonical memory path: {canonical_path}")
