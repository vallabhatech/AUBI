"""SSE Event models for streaming orchestrator responses."""

from __future__ import annotations

import json
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, field_validator

from app.models.structured_response import FinalResponse


class SSEEventType(str, Enum):
    """Types of SSE events emitted by the streaming endpoint."""

    AGENT_ACTIVITY = "agent_activity"
    TEXT_CHUNK = "text_chunk"
    CITATION = "citation"
    TOOL_RESULT = "tool_result"
    THINKING = "thinking"  # For planning/reasoning steps
    TODO = "todo"  # For todo/task list updates
    ARTIFACT = "artifact"
    THREAD_TITLE = "thread_title"  # AI-generated thread title
    CLARIFICATION = "clarification"  # Clarifying question from agent
    CLARIFICATION_RESPONSE = "clarification_response"  # User's answer to clarification (for persistence)
    TOOL_APPROVAL_REQUEST = "tool_approval_request"  # Approval card for destructive tool call
    TOOL_APPROVAL_RESPONSE = "tool_approval_response"  # User response to tool approval request
    FINAL_RESPONSE = "final_response"  # Structured final response (contract v2)
    CONTEXT_USAGE = "context_usage"  # Token usage + context window snapshot
    COMPLETE = "complete"
    ERROR = "error"
    HEARTBEAT = "heartbeat"
    TOC_ENTRY = "toc_entry"


class AgentActivityData(BaseModel):
    """Data for agent_activity events."""

    agent: str
    action: str  # "tool_call", "tool_response", "delegate", "thinking", "completed"
    tool_name: Optional[str] = None
    tool_args: Optional[dict[str, Any]] = None
    details: Optional[str] = None
    timestamp: Optional[float] = None
    invocation_id: Optional[str] = None  # Unique ID for parallel subagent tracking
    tool_call_id: Optional[str] = None  # Correlates tool calls/results (LangGraph run_id)
    llm_tool_call_id: Optional[str] = None  # Original model tool_call id (e.g., toolu_*)

    # NEW: Enhanced fields for inline tool UX
    display_name: Optional[str] = None  # AI-generated name: "Web Researcher – Social Media Audit"
    description: Optional[str] = None  # AI-generated description for active tool indicator
    sequence_number: Optional[int] = None  # For timeline ordering
    result_summary: Optional[str] = None  # Human-readable result for completed tools
    result_details: Optional[Any] = None  # Full result for expanded view
    success: Optional[bool] = None  # Tool success status


class TextChunkData(BaseModel):
    """Data for text_chunk events."""

    chunk: str
    agent: str
    is_partial: bool = True
    invocation_id: Optional[str] = None  # Unique ID for parallel subagent tracking
    sequence_number: Optional[int] = None  # Global ordering sequence


class CitationData(BaseModel):
    """Data for citation events."""

    source: str
    content: str
    confidence: float = 1.0


class RichCitationData(BaseModel):
    """Enhanced citation with entity information for user-friendly display.

    This model provides structured citation data that enables:
    - Entity-specific display names (e.g., task title, session date + mentor)
    - Grouping by entity type (tasks, sessions, documents)
    - Rich metadata for tooltips (status, due date, excerpt)
    - Inline citation markers via source_number ([1], [2], etc.)
    """

    source: str  # Unique ID: "task:rec123", "session:rec456", "doc:chunk789"
    entity_type: str  # "task" | "session" | "team" | "mentor" | "document" | "entity"
    display_name: str  # Human-readable name: "Complete project proposal"
    content: str  # Tooltip content / description
    confidence: float = 1.0
    group_key: str  # For frontend grouping: "tasks", "sessions", "documents"
    source_number: Optional[int] = None  # For inline [N] markers
    metadata: Optional[dict[str, Any]] = None  # Additional context: status, due_date, etc.
    sequence_number: Optional[int] = None  # Global ordering sequence


class ToolResultData(BaseModel):
    """Data for tool_result events."""

    agent: str
    tool_name: str
    result_summary: Optional[str] = None
    result_details: Optional[Any] = None  # Full result payload for expanded view in frontend
    success: bool = True
    invocation_id: Optional[str] = None  # Unique ID for parallel subagent tracking
    tool_call_id: Optional[str] = None  # Correlates tool calls/results (LangGraph run_id)
    llm_tool_call_id: Optional[str] = None  # Original model tool_call id (e.g., toolu_*)
    sequence_number: Optional[int] = None  # Global ordering sequence


class ThinkingData(BaseModel):
    """Data for thinking/reasoning events."""

    id: Optional[str] = None  # Stable key for frontend deduplication/React keying
    phase: str  # "planning", "reasoning", "action", "final_answer"
    content: str
    agent: str
    timestamp: Optional[float] = None
    invocation_id: Optional[str] = None  # Unique ID for parallel subagent tracking
    sequence_number: Optional[int] = None  # Global ordering sequence


class TodoItemData(BaseModel):
    """Data for a single todo item."""

    id: str
    content: str
    status: str  # "pending", "in_progress", "completed"
    activeForm: Optional[str] = None  # Present continuous form for display


class TodoData(BaseModel):
    """Data for todo events - contains the full list of todos."""

    todos: list[TodoItemData]
    timestamp: Optional[float] = None

    # NEW: Fields for grouping todos by owning agent in progress panel
    agent: Optional[str] = None  # Display name of owning agent
    invocation_id: Optional[str] = None  # For grouping in progress panel


class ArtifactData(BaseModel):
    """Data for artifact events."""

    id: str
    artifact_type: str  # "data_table" | "document" | "chat_block" | "todo_list" | "graph" | "chart"
    title: str
    summary: Optional[str] = None
    payload: Any
    origin: Optional[dict[str, Any]] = None
    created_at: Optional[float] = None
    sequence_number: Optional[int] = None  # Global ordering sequence


class FinalResponseData(FinalResponse):
    """Data for structured final_response events."""
    sequence_number: Optional[int] = None  # Global ordering sequence


class ContextUsageData(BaseModel):
    """Data for context usage events (token usage + window)."""

    model_id: Optional[str] = None
    # Backward-compatible window snapshot for context occupancy UI.
    usage: dict[str, Any]
    used_tokens: Optional[int] = None
    # Explicit window fields (single-call/peak call within current run).
    window_usage: Optional[dict[str, Any]] = None
    window_used_tokens: Optional[int] = None
    max_tokens: Optional[int] = None
    # Aggregate spend across all model calls within the current run/turn.
    total_usage: Optional[dict[str, Any]] = None
    total_used_tokens: Optional[int] = None
    timestamp: Optional[float] = None


class TocEntryData(BaseModel):
    """Data for toc_entry events -- navigation markers for the thread outline."""

    id: str  # Unique entry ID (invocation_id or generated uuid)
    title: str  # Display title: "Market Research", "Draft V1"
    type: str  # "delegation" | "planning" | "completion" | "user_turn" | "heading"
    agent: Optional[str] = None  # Agent name if from a subagent
    invocation_id: Optional[str] = None  # Links to existing agent tracking
    message_index: Optional[int] = None  # Index in messages array for scroll-to
    heading_index: Optional[int] = None  # Index among headings for scroll-to (heading type)
    status: str = "active"  # "active" | "completed" | "pending"
    parent_id: Optional[str] = None  # For nesting under a delegation
    files_touched: Optional[list[str]] = None  # File paths touched in this phase
    level: Optional[int] = None  # Heading level (1-6) when used for outline
    anchor_id: Optional[str] = None  # DOM anchor id for scroll-to
    timestamp: float = 0.0  # Required by frontend; default to epoch if unavailable


class ThreadTitleData(BaseModel):
    """Data for thread_title events - AI-generated conversation title."""

    title: str
    thread_id: Optional[str] = None


class ClarificationOptionData(BaseModel):
    """Single option in a clarification question."""

    id: str
    label: str
    description: Optional[str] = None
    value: Optional[str] = None


class ClarificationQuestionData(BaseModel):
    """A single clarification question."""

    id: str
    prompt: str
    type: str = "select"  # "select" | "text" — frontend uses this to pick input component
    selectionType: str = "single"  # "single" | "multi"
    allowOther: bool = True
    required: bool = True
    placeholder: Optional[str] = None  # Hint text for free-text questions
    options: list[ClarificationOptionData] = []


class ClarificationData(BaseModel):
    """Data for clarification events - agent asking clarifying questions.

    This is emitted when the agent uses the request_clarifications tool,
    which triggers a LangGraph interrupt() to pause execution and wait
    for user input. The frontend renders this as an interactive UI.
    """

    type: str = "clarification"
    id: str  # Unique request ID (e.g., "clarification_3fda99ab")
    title: Optional[str] = None
    description: Optional[str] = None
    questions: list[ClarificationQuestionData]
    total_questions: int = 1
    current_question: int = 1

    @field_validator("questions")
    @classmethod
    def questions_must_not_be_empty(
        cls, v: list[ClarificationQuestionData]
    ) -> list[ClarificationQuestionData]:
        if not v:
            raise ValueError("clarification must have at least one question")
        return v


class ToolApprovalRequestData(BaseModel):
    """Data for a tool approval interrupt event."""

    type: str = "tool_approval"
    id: str
    tool_name: str
    tool_args_summary: str
    agent_name: Optional[str] = None
    invocation_id: Optional[str] = None


class ToolApprovalResponseData(BaseModel):
    """User response to a tool approval request."""

    interrupt_id: str
    approved: bool
    reason: Optional[str] = None


class CompleteData(BaseModel):
    """Data for complete events."""

    status: str
    thread_id: Optional[str] = None
    full_message: str
    citations: list[RichCitationData] = []  # Using RichCitationData for enhanced display
    agent_trace: list[AgentActivityData] = []
    handoff_summary: Optional[str] = None
    handoff_recent_messages: Optional[list[dict[str, Any]]] = None


class ErrorData(BaseModel):
    """Data for error events."""

    message: str
    code: Optional[str] = None
    recoverable: bool = False


class SSEEvent(BaseModel):
    """Generic SSE event wrapper."""

    event: SSEEventType
    data: Any

    def to_sse_string(self) -> str:
        """Format as SSE string for streaming response."""
        if hasattr(self.data, "model_dump"):
            data_dict = self.data.model_dump()
        elif isinstance(self.data, dict):
            data_dict = self.data
        else:
            data_dict = {"value": self.data}

        data_str = json.dumps(data_dict)
        return f"event: {self.event.value}\ndata: {data_str}\n\n"
