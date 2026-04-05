"""Pydantic models for WebSocket notification events."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class ThreadStatusEvent(BaseModel):
    """Thread state changed (running, thinking, idle, waiting, error)."""
    type: Literal["thread_status"] = "thread_status"
    thread_id: str
    status: Literal["running", "thinking", "idle", "waiting", "error"]
    summary: Optional[str] = None


class ThreadCompleteEvent(BaseModel):
    """Agent run completed on a thread."""
    type: Literal["thread_complete"] = "thread_complete"
    thread_id: str
    title: str
    summary: str
    notify: bool = False


class ThreadErrorEvent(BaseModel):
    """Agent run errored on a thread."""
    type: Literal["thread_error"] = "thread_error"
    thread_id: str
    title: str
    error: str


class InterruptEvent(BaseModel):
    """Agent needs user input (HITL)."""
    type: Literal["interrupt"] = "interrupt"
    thread_id: str
    title: str
    question: str
    options: Optional[list[str]] = None


# Union type for all events
WSEvent = ThreadStatusEvent | ThreadCompleteEvent | ThreadErrorEvent | InterruptEvent
