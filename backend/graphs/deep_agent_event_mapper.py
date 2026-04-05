"""
Deep Agent Event Mapper - Extended SSE event mapping for Deep Agents.

Extends the base LangGraphEventMapper to handle Deep Agent-specific events:
- write_todos: Planning/task decomposition -> thinking events
- task: Subagent delegation -> agent_activity events
- Filesystem operations: Context management (filtered for internal ops)
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
import uuid
from typing import Any, cast

from app.monitoring.deep_agent_runtime_metrics import increment_deep_agent_runtime_metric
from app.streaming.event_mapper import LangGraphEventMapper
from app.streaming.canvas_artifacts import (
    DOCUMENT_TOOLS,
    GRAPH_TOOLS,
    build_document_content,
    build_document_title,
    extract_graph_payload,
    select_table_candidate,
)
from app.streaming.sse_events import (
    AgentActivityData,
    ArtifactData,
    ClarificationData,
    ClarificationOptionData,
    ClarificationQuestionData,
    RichCitationData,
    SSEEvent,
    SSEEventType,
    ThinkingData,
    ToolApprovalRequestData,
    TocEntryData,
    TodoData,
    TodoItemData,
)
from app.tools.sanitize import sanitize_for_json

logger = logging.getLogger(__name__)


def _extract_interrupt_value(error: Any) -> dict[str, Any] | None:
    """Extract the payload value from a GraphInterrupt-like error."""
    interrupt_value = None
    if hasattr(error, "args") and error.args:
        interrupts = error.args[0] if error.args else ()
        if interrupts:
            first_interrupt = interrupts[0] if isinstance(interrupts, (list, tuple)) else interrupts
            if hasattr(first_interrupt, "value"):
                interrupt_value = first_interrupt.value
    if not interrupt_value and hasattr(error, "value"):
        interrupt_value = error.value
    if not interrupt_value and isinstance(error, dict) and "value" in error:
        interrupt_value = error["value"]
    return interrupt_value if isinstance(interrupt_value, dict) else None


def _build_interrupt_sse_event(
    interrupt_value: dict[str, Any],
    *,
    fallback_tool_name: str,
) -> SSEEvent | None:
    interrupt_type = interrupt_value.get("type")
    if interrupt_type == "clarification":
        clarification_id = interrupt_value.get("id", f"clarification_{uuid.uuid4().hex[:8]}")
        title = interrupt_value.get("title", "Clarification needed")
        description = interrupt_value.get("description")
        raw_questions = interrupt_value.get("questions", [])
        questions = []
        for q in raw_questions:
            options = []
            for opt in q.get("options", []):
                options.append(
                    ClarificationOptionData(
                        id=opt.get("id", ""),
                        label=opt.get("label", ""),
                        description=opt.get("description"),
                        value=opt.get("value"),
                    )
                )
            questions.append(
                ClarificationQuestionData(
                    id=q.get("id", ""),
                    prompt=q.get("prompt", ""),
                    options=options,
                    selectionType=q.get("selectionType", "single"),
                    allowOther=q.get("allowOther", True),
                    required=q.get("required", True),
                )
            )
        return SSEEvent(
            event=SSEEventType.CLARIFICATION,
            data=ClarificationData(
                id=clarification_id,
                title=title,
                description=description,
                questions=questions,
            ),
        )

    if interrupt_type == "tool_approval":
        approval_id = str(
            interrupt_value.get("id")
            or interrupt_value.get("approval_id")
            or f"tool_approval_{uuid.uuid4().hex[:8]}"
        )
        return SSEEvent(
            event=SSEEventType.TOOL_APPROVAL_REQUEST,
            data=ToolApprovalRequestData(
                id=approval_id,
                tool_name=str(interrupt_value.get("tool_name") or fallback_tool_name),
                tool_args_summary=str(interrupt_value.get("tool_args_summary") or "Approval required"),
                agent_name=cast(str | None, interrupt_value.get("agent_name")),
                invocation_id=cast(str | None, interrupt_value.get("invocation_id")),
            ),
        )

    return None


class DeepAgentEventMapper(LangGraphEventMapper):
    """
    Extended event mapper for Deep Agent streaming.

    Handles Deep Agent-specific tool calls:
    - write_todos: Emits thinking events with task breakdown
    - task: Emits agent_activity events for subagent delegation
    - Filesystem ops: Filters internal context files, shows user-relevant ones
    """

    # Deep Agent built-in tool names
    DEEP_AGENT_TOOLS = {
        "write_todos",
        "read_todos",
        "ls",
        "read_file",
        "write_file",
        "edit_file",
        "glob",
        "grep",
        "task",
        "subagent",  # deepagents library uses this name for task delegation
        "request_clarifications",  # Clarification tool - uses interrupt()
    }

    # Internal paths to filter (don't show to user)
    INTERNAL_PATHS = {
        "/context/",
        "/.cache/",
        "/.tmp/",
        "/conversation_history/",
    }

    def __init__(
        self,
        contract_v2_enabled: bool = False,
        event_max_chars: int | None = None,
        model_id: str | None = None,
        max_tokens: int | None = None,
        store: Any | None = None,
        sql_preview_table_resolver_enabled: bool = False,
        canvas_id: str | None = None,
        chat_block_id: str | None = None,
        auto_artifacts: bool | None = None,
        request_query: str | None = None,
        filter_conversation_history_from_sse: bool = True,
    ) -> None:
        super().__init__(
            contract_v2_enabled=contract_v2_enabled,
            event_max_chars=event_max_chars,
            model_id=model_id,
            max_tokens=max_tokens,
            store=store,
            sql_preview_table_resolver_enabled=sql_preview_table_resolver_enabled,
        )
        self._canvas_id = canvas_id
        self._chat_block_id = chat_block_id
        self._auto_artifacts = bool(auto_artifacts)
        self._request_query = request_query or ""
        self._internal_paths = set(self.INTERNAL_PATHS)
        if not filter_conversation_history_from_sse:
            self._internal_paths.discard("/conversation_history/")
        self._current_todos: list[dict] = []
        self._toc_entries: list[dict] = []
        # Track active subagents by run_id for parallel execution support
        # Key: task tool's run_id, Value: {name: str, invocation_id: str, run_id: str}
        self._active_subagents_by_run_id: dict[str, dict[str, str]] = {}
        # Also maintain a list for backward compatibility and stack-like operations
        # This is used for sequential nested subagent tracking
        self._active_subagents: list[dict[str, str]] = []
        # Map run_id -> invocation_id for parallel subagent tracking
        # When multiple subagents run in parallel, each has a unique run_id
        self._run_to_invocation: dict[str, str] = {}
        # Map run_id -> agent_name for parallel tracking
        self._run_to_agent: dict[str, str] = {}
        self._current_invocation_id: str | None = None  # Current invocation ID for event attribution (fallback)
        self._orchestrator_invocation_id: str | None = None  # Stable orchestrator invocation ID for grouping
        self._artifact_writes: dict[str, dict[str, str]] = {}
        self._artifact_write_queue: list[dict[str, str]] = []
        self._file_reads_by_run_id: dict[str, str] = {}
        self._event_sequence: int = 0  # Track event order for debugging
        self._last_tool_name: str | None = None
        self._seen_inline_source_numbers: set[int] = set()
        self._graph_interrupted: bool = False  # Set on GraphInterrupt (HITL); suppresses all subsequent events
        self._suppress_sql_code_block: bool = False

    @property
    def is_interrupted(self) -> bool:
        """Whether the graph hit a HITL interrupt (e.g. clarification). Useful for callers to skip post-stream cleanup."""
        return self._graph_interrupted

    def _ensure_orchestrator_invocation_id(self, event: dict[str, Any]) -> None:
        """Ensure a stable invocation_id is set for orchestrator events."""
        if self._active_subagents:
            return

        if self._orchestrator_invocation_id:
            self._current_invocation_id = self._orchestrator_invocation_id
            return

        run_id = event.get("run_id") or event.get("data", {}).get("run_id")
        thread_id = (event.get("metadata", {}).get("configurable") or {}).get("thread_id")

        if thread_id:
            self._orchestrator_invocation_id = f"orchestrator:{thread_id}"
        elif run_id:
            self._orchestrator_invocation_id = f"orchestrator:{run_id}"
        else:
            self._orchestrator_invocation_id = "orchestrator"

        self._current_invocation_id = self._orchestrator_invocation_id

    def _emit_toc_entry(
        self,
        entry_id: str,
        title: str,
        entry_type: str,
        agent: str | None = None,
        invocation_id: str | None = None,
        status: str = "active",
        parent_id: str | None = None,
        message_index: int | None = None,
        timestamp: float | None = None,
    ) -> SSEEvent:
        """Emit a toc_entry event for the thread outline rail."""
        toc_timestamp = timestamp if timestamp is not None else time.time()
        data = TocEntryData(
            id=entry_id,
            title=title,
            type=entry_type,
            agent=agent,
            invocation_id=invocation_id,
            status=status,
            parent_id=parent_id,
            message_index=message_index,
            timestamp=toc_timestamp,
        )
        self._toc_entries.append(data.model_dump())
        return SSEEvent(
            event=SSEEventType.TOC_ENTRY,
            data=data,
        )

    def _get_existing_toc_entry(self, entry_id: str) -> dict | None:
        """Return the most recent ToC entry with the given id, if any."""
        for entry in reversed(self._toc_entries):
            if entry.get("id") == entry_id:
                return entry
        return None

    def get_toc_entries(self) -> list[dict]:
        """Return accumulated ToC entries for checkpoint metadata."""
        return list(self._toc_entries)

    def _infer_agent_from_invocation_id(self, invocation_id: str | None) -> str | None:
        """Infer agent name from invocation_id when metadata is insufficient."""
        if not invocation_id:
            return None
        if invocation_id.startswith("orchestrator"):
            return "orchestrator"
        for subagent in reversed(self._active_subagents):
            if subagent.get("invocation_id") == invocation_id:
                return subagent.get("name")
        if "_" in invocation_id:
            return invocation_id.split("_", 1)[0]
        return invocation_id

    def _get_invocation_id_for_event(self, event: dict) -> str | None:
        """
        Look up the invocation_id for an event based on its context.

        For parallel subagent tracking, we need to map events to their specific
        invocation even when multiple subagents of the same type are running.

        Priority:
        1. Direct run_id match in _run_to_invocation
        2. Config metadata (injected when subagent is invoked)
        3. Parent invocation from metadata
        4. Parent run context from checkpoint_ns or parent_ids
        5. Match by agent name from active subagents stack (only for single active subagent of that type)
        6. Current invocation_id (fallback, only if single active subagent)

        Note on fallback heuristics (priorities 5-6):
        - These are NOT for deepagents state-merge bug fixes (deepagents #954 addressed that path).
        - They remain necessary to preserve stable SSE attribution when upstream LangGraph
          streaming metadata lacks tool_call/subagent correlation in parallel flows
          (LangGraph issue #6714; expected resolution in PR #6722).
        - Do not remove without staged trace validation against LangSmith canary traffic.

        IMPORTANT: When we resolve an invocation_id through priorities 2-6, we also
        store the run_id -> invocation_id mapping. This allows future events with the
        same run_id to be resolved via Priority 1, which is crucial for parallel
        subagent tracking where subagent internal events have new run_ids.

        Returns:
            The invocation_id for this event, or None if not in subagent context
        """
        run_id = event.get("run_id") or event.get("data", {}).get("run_id")
        metadata = event.get("metadata", {})

        # Priority 1: Direct run_id lookup (already in mapping, no need to store again)
        if run_id and run_id in self._run_to_invocation:
            return self._run_to_invocation[run_id]

        # Helper to store mapping and return result
        def _store_and_return(invocation_id: str) -> str:
            """Store run_id -> invocation_id mapping for future lookups."""
            if run_id and invocation_id:
                self._run_to_invocation[run_id] = invocation_id
                # Also map run_id -> agent to attribute subagent tool events correctly.
                inferred_agent = self._infer_agent_from_invocation_id(invocation_id)
                if inferred_agent:
                    self._run_to_agent.setdefault(run_id, inferred_agent)
                logger.debug(f"Stored run_id mapping: {run_id[:8]}... -> {invocation_id}")
            return invocation_id

        # Priority 2: Try to find parent run context from parent_ids (v2 events)
        # parent_ids live on the event root, not metadata
        parent_ids = event.get("parent_ids") or metadata.get("parent_ids", [])
        if parent_ids:
            # Prefer the closest parent (last in list) for nested subagents
            for parent_id in reversed(parent_ids):
                if parent_id in self._run_to_invocation:
                    return _store_and_return(self._run_to_invocation[parent_id])

        # Priority 3: Config metadata (injected by execute_subagent)
        # Useful when parent_ids are unavailable
        configurable = metadata.get("configurable", {})
        if configurable.get("invocation_id"):
            return _store_and_return(configurable["invocation_id"])

        # Priority 4: Parent invocation from metadata (set when delegating)
        if metadata.get("parent_invocation_id"):
            return _store_and_return(metadata["parent_invocation_id"])

        # Priority 5: Match by agent name from active subagents
        # For parallel safety, only use this if there's exactly ONE active subagent with this name
        # If multiple subagents of the same type are active, we can't safely attribute
        agent_name = self._get_agent_name(event)
        matching_subagents = [s for s in self._active_subagents if s.get("name") == agent_name]
        if len(matching_subagents) == 1:
            invocation_id = matching_subagents[0].get("invocation_id")
            if invocation_id:
                return _store_and_return(invocation_id)
        elif len(matching_subagents) > 1:
            # Multiple subagents of same type - try to use checkpoint_ns to disambiguate.
            # This is a conservative bridge for LangGraph #6714 (parallel streaming
            # namespace correlation gap). Remove only after PR #6722 is validated in canary.
            checkpoint_ns = metadata.get("checkpoint_ns", "")
            # If checkpoint_ns contains run_id info, try to match
            for subagent in matching_subagents:
                subagent_run_id = subagent.get("run_id", "")
                if subagent_run_id and subagent_run_id in checkpoint_ns:
                    invocation_id = subagent.get("invocation_id")
                    if invocation_id:
                        return _store_and_return(invocation_id)
            # Fallback: if self._current_invocation_id belongs to one of the matching subagents,
            # use it. This works because map_event() updates _current_invocation_id when events
            # are successfully resolved, so it tracks the most recent subagent context switch.
            if self._current_invocation_id:
                for subagent in matching_subagents:
                    if subagent.get("invocation_id") == self._current_invocation_id:
                        logger.debug(
                            f"Multiple active '{agent_name}' subagents - using _current_invocation_id "
                            f"({self._current_invocation_id}) as it matches an active subagent"
                        )
                        return _store_and_return(self._current_invocation_id)
            # Can't disambiguate - log warning and fall through
            increment_deep_agent_runtime_metric("attribution_ambiguous_total")
            logger.warning(
                f"Multiple active subagents with name '{agent_name}' - "
                f"cannot safely attribute event with run_id={run_id[:8] if run_id else 'none'}..."
            )

        # Priority 6: Fallback to current invocation_id.
        # Product-specific SSE continuity fallback to avoid user-visible orphaning when
        # upstream metadata is incomplete. We keep this guarded by active-subagent membership
        # to remain parallel-safe.
        # TODO(Wave4): Re-evaluate after LangGraph #6714 / PR #6722 lands and canary traces pass.
        if self._current_invocation_id:
            # Verify _current_invocation_id belongs to an active subagent
            for subagent in self._active_subagents:
                if subagent.get("invocation_id") == self._current_invocation_id:
                    return _store_and_return(self._current_invocation_id)

        # If multiple active subagents and no clear match, return None
        # This prevents misattribution in parallel scenarios
        if len(self._active_subagents) > 1:
            increment_deep_agent_runtime_metric("attribution_unresolved_total")
            logger.debug(
                f"No invocation_id resolved for event with run_id={run_id[:8] if run_id else 'none'}... "
                f"({len(self._active_subagents)} active subagents)"
            )
            return None

        return self._current_invocation_id

    def _log_sse_events(self, events: list[SSEEvent]) -> list[SSEEvent]:
        """Log SSE events being emitted for sequence debugging."""
        seq = self._event_sequence
        for sse in events:
            event_type = sse.event.value if hasattr(sse.event, 'value') else str(sse.event)
            if event_type == "text_chunk":
                data = sse.data
                chunk_preview = ""
                if hasattr(data, 'chunk'):
                    chunk_preview = data.chunk[:50].replace("\n", " ") if data.chunk else ""
                agent = getattr(data, 'agent', '?')
                logger.debug(f"[SSE-OUT:{seq:04d}] {event_type} agent={agent} chunk=\"{chunk_preview}...\"")
            elif event_type == "agent_activity":
                data = sse.data
                action = getattr(data, 'action', '?')
                agent = getattr(data, 'agent', '?')
                tool = getattr(data, 'tool_name', '')
                logger.debug(f"[SSE-OUT:{seq:04d}] {event_type} action={action} agent={agent} tool={tool}")
            else:
                logger.debug(f"[SSE-OUT:{seq:04d}] {event_type}")
        return events

    def _finalize_events(self, events: list[SSEEvent]) -> list[SSEEvent]:
        """Assign global sequence numbers and log SSE events."""
        self._assign_sequence_to_events(events)
        return self._log_sse_events(events)

    def _strip_sql_code_fences(self, text: str) -> str:
        """Strip ```sql fenced blocks from streamed text to avoid inline SQL echo."""
        if not text:
            return text
        output: list[str] = []
        i = 0
        while i < len(text):
            if self._suppress_sql_code_block:
                end = text.find("```", i)
                if end == -1:
                    return "".join(output)
                i = end + 3
                if i < len(text) and text[i] == "\r":
                    i += 1
                if i < len(text) and text[i] == "\n":
                    i += 1
                self._suppress_sql_code_block = False
                continue

            start = text.lower().find("```sql", i)
            if start == -1:
                output.append(text[i:])
                break
            output.append(text[i:start])
            i = start + len("```sql")
            if i < len(text) and text[i] == "\r":
                i += 1
            if i < len(text) and text[i] == "\n":
                i += 1
            self._suppress_sql_code_block = True
        return "".join(output)

    def map_event(self, event: dict[str, Any]) -> list[SSEEvent]:
        """
        Map event with Deep Agent-specific handling.

        Intercepts Deep Agent tool calls to provide better user feedback,
        then delegates to parent for standard events.
        """
        # After a GraphInterrupt (HITL pause), the astream_events() iterator may
        # continue draining buffered events (text chunks the LLM already generated).
        # These are stale — the graph is paused — so drop them silently.
        if self._graph_interrupted:
            return []

        sse_events: list[SSEEvent] = []
        kind = event.get("event")
        timestamp = time.time()
        increment_deep_agent_runtime_metric("events_mapped_total")

        # Ensure orchestrator events get a stable invocation_id
        if kind in ("on_chat_model_stream", "on_tool_start", "on_tool_end", "on_custom_event"):
            self._ensure_orchestrator_invocation_id(event)

        # Always update current agent from event metadata (stateless approach)
        # This ensures correct attribution even when we handle events directly
        self._current_agent = self._get_agent_name(event)

        # Override agent attribution based on invocation_id when available.
        # This fixes subagent tool calls being attributed to orchestrator when metadata is ambiguous.
        # ALSO update self._current_invocation_id so downstream handlers (filesystem tools,
        # parent class) emit the correct invocation_id for parallel same-type subagents.
        if kind in ("on_chat_model_stream", "on_tool_start", "on_tool_end", "on_custom_event"):
            invocation_id = self._get_invocation_id_for_event(event)
            if invocation_id:
                self._current_invocation_id = invocation_id
            inferred_agent = self._infer_agent_from_invocation_id(invocation_id)
            if inferred_agent and inferred_agent != self._current_agent:
                self._current_agent = inferred_agent

        # Log incoming LangGraph event for sequence debugging
        self._event_sequence += 1
        seq = self._event_sequence
        if kind in ("on_tool_start", "on_tool_end"):
            tool_name = event.get("name", "?")
            logger.debug(f"[SEQ:{seq:04d}] {kind} tool={tool_name} agent={self._current_agent}")
        elif kind == "on_chat_model_stream":
            chunk = event.get("data", {}).get("chunk")
            content_preview = ""
            if chunk and hasattr(chunk, "content"):
                raw = chunk.content
                if isinstance(raw, str):
                    content_preview = raw[:50].replace("\n", " ")
                elif isinstance(raw, list) and raw:
                    content_preview = str(raw[0])[:50]
            logger.debug(f"[SEQ:{seq:04d}] {kind} agent={self._current_agent} preview=\"{content_preview}...\"")
        else:
            logger.debug(f"[SEQ:{seq:04d}] {kind} agent={self._current_agent}")

        # =====================================================================
        # HANDLE TOOL STARTS
        # =====================================================================
        if kind == "on_tool_start":
            tool_name = event.get("name", "")
            if tool_name in self.INTERNAL_TOOL_NAMES:
                return self._finalize_events(sse_events)
            tool_input = event.get("data", {}).get("input", {})
            run_id = event.get("run_id") or event.get("data", {}).get("run_id")

            if tool_name in ("write_file", "edit_file"):
                path = tool_input.get("path") or tool_input.get("file_path", "")
                if path.startswith("/artifacts/"):
                    content = (
                        tool_input.get("content")
                        or tool_input.get("new_content")
                        or tool_input.get("new_string")
                        or ""
                    )
                    entry = {"path": path, "content": content}
                    if run_id:
                        self._artifact_writes[run_id] = entry
                    else:
                        self._artifact_write_queue.append(entry)

            # -----------------------------------------------------------------
            # write_todos: Emit thinking event with task breakdown
            # -----------------------------------------------------------------
            if tool_name == "write_todos":
                raw_todos = tool_input.get("todos", [])
                todos = self._normalize_todos(raw_todos)
                self._current_todos = todos
                invocation_id = self._get_invocation_id_for_event(event)

                # Format todos for display
                try:
                    todo_text = self._format_todos(todos)
                except Exception:
                    logger.warning(
                        "Failed to format write_todos payload; falling back to generic planning text.",
                        exc_info=True,
                    )
                    todo_text = "Planning tasks..."

                # Emit thinking event
                sse_events.append(
                    SSEEvent(
                        event=SSEEventType.THINKING,
                        data=ThinkingData(
                            phase="planning",
                            content=todo_text,
                            agent="Planner",
                            timestamp=timestamp,
                            invocation_id=invocation_id,
                        ),
                    )
                )

                # Also emit agent activity for trace
                # Use current agent context or fallback to "orchestrator" (not "Planner")
                # so it doesn't create a separate subagent section in the UI
                planning_activity = AgentActivityData(
                    agent=self._current_agent or "orchestrator",
                    action="planning",
                    tool_name="write_todos",
                    details=f"Created {len(todos)} tasks",
                    timestamp=timestamp,
                    invocation_id=invocation_id,
                    tool_call_id=run_id,
                )
                self.agent_trace.append(planning_activity)
                sse_events.append(
                    SSEEvent(
                        event=SSEEventType.AGENT_ACTIVITY,
                        data=planning_activity,
                    )
                )

                # Emit dedicated TODO event for UI progress panels
                # Convert raw todo dicts to TodoItemData objects
                todo_items = [
                    TodoItemData(
                        id=todo.get("id", f"todo-{i}"),
                        content=todo.get("content", ""),
                        status=todo.get("status", "pending"),
                        activeForm=todo.get("activeForm"),
                    )
                    for i, todo in enumerate(todos)
                ]

                # Get the invocation_id for proper grouping in progress panel
                # This fixes the issue where write_todos from subagents fell into "Planner" bucket
                invocation_id = self._get_invocation_id_for_event(event)

                # Determine the owning agent - use current agent context
                # For subagents, this will be the subagent name; for orchestrator, use "orchestrator"
                owning_agent = self._current_agent if self._active_subagents else "orchestrator"

                sse_events.append(
                    SSEEvent(
                        event=SSEEventType.TODO,
                        data=TodoData(
                            todos=todo_items,
                            timestamp=timestamp,
                            agent=owning_agent,
                            invocation_id=invocation_id,
                        ),
                    )
                )

                # Emit ToC entry for planning phase
                toc_event = self._emit_toc_entry(
                    entry_id=f"toc_plan_{invocation_id or 'main'}_{int(time.time()*1000)}",
                    title=f"Planning: {owning_agent}",
                    entry_type="planning",
                    agent=owning_agent,
                    invocation_id=invocation_id,
                    status="active",
                    parent_id=f"toc_{invocation_id}" if invocation_id and not invocation_id.startswith("orchestrator") else None,
                )
                sse_events.append(toc_event)

                return self._finalize_events(sse_events)

            # -----------------------------------------------------------------
            # task/subagent: Emit subagent delegation event and track subagent context
            # deepagents library uses "subagent" tool name, Claude Code uses "task"
            # -----------------------------------------------------------------
            if tool_name in ("task", "subagent"):
                # Try multiple fields to get the subagent name
                subagent_name = (
                    tool_input.get("agent") or
                    tool_input.get("name") or
                    tool_input.get("subagent_type") or
                    tool_input.get("agent_type") or
                    tool_input.get("type") or
                    tool_input.get("description", "")[:50].split()[0] if tool_input.get("description") else None
                )

                # If still no name, try to infer from task description
                task_description = tool_input.get("task") or tool_input.get("prompt", "")
                if not subagent_name or subagent_name == "subagent":
                    subagent_name = self._infer_subagent_name(task_description, tool_input)

                # Final fallback
                if not subagent_name:
                    subagent_name = "assistant"

                # NEW: Get AI-generated display_name if provided, otherwise generate one
                # Format: "Role – Concise task description"
                display_name = tool_input.get("display_name")
                if not display_name:
                    # Generate display_name from subagent_name and task description
                    role_name = self._get_readable_agent_name(subagent_name)
                    task_summary = self._summarize_task_description(task_description)
                    display_name = f"{role_name} – {task_summary}" if task_summary else role_name

                # Generate invocation ID for this delegation
                # Prefer deterministic IDs based on run_id for stable cross-layer attribution.
                # Fallback to UUID only if run_id is missing.
                safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", subagent_name)[:50] or "assistant"
                if run_id:
                    invocation_id = f"{safe_name}_{run_id}"
                else:
                    invocation_id = f"{safe_name}_{uuid.uuid4().hex[:8]}"

                # Emit delegation event BEFORE switching context
                # Truncate task description for display and sanitize to remove control chars
                display_task = task_description[:100]
                if len(task_description) > 100:
                    display_task += "..."
                safe_details = sanitize_for_json(f"Delegating: {display_task}")

                delegate_activity = AgentActivityData(
                    agent=self._current_agent,
                    action="delegate",
                    tool_name=subagent_name,
                    details=safe_details,
                    timestamp=timestamp,
                    invocation_id=invocation_id,
                    display_name=display_name,  # NEW: AI-generated or inferred name
                )
                self.agent_trace.append(delegate_activity)
                sse_events.append(
                    SSEEvent(
                        event=SSEEventType.AGENT_ACTIVITY,
                        data=delegate_activity,
                    )
                )

                # Emit ToC entry for this delegation
                toc_event = self._emit_toc_entry(
                    entry_id=f"toc_{invocation_id}",
                    title=display_name or subagent_name,
                    entry_type="delegation",
                    agent=subagent_name,
                    invocation_id=invocation_id,
                    status="active",
                )
                sse_events.append(toc_event)

                # Now switch to subagent context - all subsequent tool calls
                # will be attributed to this subagent until task completes
                subagent_info = {
                    "name": subagent_name,
                    "invocation_id": invocation_id,
                    "run_id": run_id or "",
                    "display_name": display_name,
                }
                self._active_subagents.append(subagent_info)
                # Also store by run_id for parallel subagent lookup (O(1) lookup on completion)
                if run_id:
                    self._active_subagents_by_run_id[run_id] = subagent_info
                self._current_agent = subagent_name
                self._current_invocation_id = invocation_id

                # Store run_id -> invocation_id mapping for parallel subagent tracking
                # This allows us to route events to the correct invocation when multiple
                # subagents of the same type run in parallel
                if run_id:
                    self._run_to_invocation[run_id] = invocation_id
                    self._run_to_agent[run_id] = subagent_name

                logger.info(
                    f"[SSE-OUT:{self._event_sequence:04d}] >>> DELEGATE to {subagent_name} "
                    f"(invocation_id={invocation_id}, run_id={run_id}, "
                    f"active_subagents={len(self._active_subagents)})"
                )
                increment_deep_agent_runtime_metric("subagent_delegations_total")
                return self._finalize_events(sse_events)

            # -----------------------------------------------------------------
            # Filesystem operations: Filter internal, show user-relevant
            # -----------------------------------------------------------------
            if tool_name in ("ls", "read_file", "write_file", "edit_file", "glob", "grep"):
                path = tool_input.get("path", "") or tool_input.get("pattern", "")

                # Filter internal paths
                for internal_path in self._internal_paths:
                    if path.startswith(internal_path):
                        logger.debug(f"Filtering internal filesystem op: {tool_name} {path}")
                        return self._finalize_events(sse_events)

                # Artifact writes to /artifacts/ are handled in on_tool_end
                # (content is already captured at lines 97-110 above)
                if path.startswith("/artifacts/") and tool_name in ("write_file", "edit_file"):
                    logger.debug(f"Artifact write started: {path}")
                    return self._finalize_events(sse_events)

                if tool_name == "read_file" and run_id and path:
                    self._file_reads_by_run_id[run_id] = path

                # Build action description based on tool and path
                if path.startswith("/memories/"):
                    action_desc = {
                        "read_file": "Reading memory",
                        "write_file": "Saving memory",
                        "ls": "Listing memories",
                        "edit_file": "Updating memory",
                    }.get(tool_name, tool_name)
                else:
                    # General file operations
                    action_desc = {
                        "read_file": "Reading file",
                        "write_file": "Writing file",
                        "edit_file": "Editing file",
                        "ls": "Listing directory",
                        "glob": "Searching files",
                        "grep": "Searching content",
                    }.get(tool_name, tool_name)

                # Emit activity event for all visible file operations
                # Use action="tool_call" so frontend shows as active until tool_complete arrives
                # Sanitize path in case it contains control characters
                safe_details = sanitize_for_json(f"{action_desc}: {path}" if path else action_desc)
                file_activity = AgentActivityData(
                    agent=self._current_agent,
                    action="tool_call",
                    tool_name=tool_name,
                    details=safe_details,
                    description=action_desc,
                    timestamp=timestamp,
                    invocation_id=self._current_invocation_id,
                    tool_call_id=run_id,
                )
                self.agent_trace.append(file_activity)
                sse_events.append(
                    SSEEvent(
                        event=SSEEventType.AGENT_ACTIVITY,
                        data=file_activity,
                    )
                )
                return self._finalize_events(sse_events)

            # -----------------------------------------------------------------
            # read_todos: Just log, don't emit
            # -----------------------------------------------------------------
            if tool_name == "read_todos":
                logger.debug("Agent reading todos")
                return self._finalize_events(sse_events)

            # -----------------------------------------------------------------
            # request_clarifications: Emit thinking event showing question prep
            # Note: The actual clarification payload is emitted via GraphInterrupt
            # handling in chat_stream.py, but we emit a thinking event here for
            # UI feedback while the tool is "running"
            # -----------------------------------------------------------------
            if tool_name == "request_clarifications":
                title = tool_input.get("title", "Asking for clarification")
                questions = tool_input.get("questions", [])
                num_questions = len(questions)
                invocation_id = self._get_invocation_id_for_event(event)

                # Emit thinking event to show the agent is preparing clarifications
                sse_events.append(
                    SSEEvent(
                        event=SSEEventType.THINKING,
                        data=ThinkingData(
                            phase="clarification",
                            content=f"Preparing {num_questions} clarifying question{'s' if num_questions != 1 else ''}: {title}",
                            agent=self._current_agent,
                            timestamp=timestamp,
                            invocation_id=invocation_id,
                        ),
                    )
                )

                # Emit agent activity for trace
                clarifying_activity = AgentActivityData(
                    agent=self._current_agent,
                    action="tool_call",
                    tool_name="request_clarifications",
                    details=f"Asking: {title}" if title else f"Asking {num_questions} clarifying questions",
                    timestamp=timestamp,
                    invocation_id=self._current_invocation_id,
                    tool_call_id=run_id,
                )
                self.agent_trace.append(clarifying_activity)
                sse_events.append(
                    SSEEvent(
                        event=SSEEventType.AGENT_ACTIVITY,
                        data=clarifying_activity,
                    )
                )

                logger.debug(
                    f"[SSE-OUT:{self._event_sequence:04d}] request_clarifications: {title} ({num_questions} questions)"
                )
                return self._finalize_events(sse_events)

        # =====================================================================
        # HANDLE TOOL / CHAIN ERRORS (including GraphInterrupt HITL pauses)
        # =====================================================================
        if kind in {"on_tool_error", "on_chain_error"}:
            tool_name = event.get("name", "")
            if kind == "on_tool_error" and tool_name in self.INTERNAL_TOOL_NAMES:
                return self._finalize_events(sse_events)
            error_data = event.get("data", {})

            # Debug: Log the full error structure
            logger.debug(f"[SEQ:{seq:04d}] on_tool_error data keys: {list(error_data.keys())}")
            logger.debug(f"[SEQ:{seq:04d}] on_tool_error data: {error_data}")

            # Check if this is a GraphInterrupt from request_clarifications
            # The error object contains the interrupt payload
            error = error_data.get("error")
            logger.debug(
                f"[SEQ:{seq:04d}] error type: {type(error)}, has value attr: {hasattr(error, 'value') if error else 'N/A'}"
            )
            if error:
                logger.debug(f"[SEQ:{seq:04d}] error repr: {repr(error)[:500]}")

            if error:
                interrupt_value = _extract_interrupt_value(error)
                if interrupt_value:
                    interrupt_event = _build_interrupt_sse_event(
                        interrupt_value,
                        fallback_tool_name=tool_name,
                    )
                    if interrupt_event is not None:
                        sse_events.append(interrupt_event)
                        self._graph_interrupted = True
                        return self._finalize_events(sse_events)

            # For other tool errors, emit a failed tool_complete so the UI shows the failure.
            error_message = str(error) if error else "Tool error"
            tool_call_id = (
                error_data.get("tool_call_id")
                or event.get("run_id")
                or event.get("data", {}).get("run_id")
            )
            invocation_id = self._get_invocation_id_for_event(event)

            failed_activity = AgentActivityData(
                agent=self._current_agent,
                action="tool_complete",
                tool_name=tool_name or "unknown_tool",
                details=sanitize_for_json(error_message)[:500],
                result_summary=sanitize_for_json(f"Error: {error_message}")[:500],
                timestamp=timestamp,
                invocation_id=invocation_id,
                tool_call_id=tool_call_id,
                success=False,
            )
            self.agent_trace.append(failed_activity)
            sse_events.append(
                SSEEvent(
                    event=SSEEventType.AGENT_ACTIVITY,
                    data=failed_activity,
                )
            )
            return self._finalize_events(sse_events)

        # =====================================================================
        # HANDLE TOOL ENDS
        # =====================================================================
        if kind == "on_tool_end":
            tool_name = event.get("name", "")
            self._last_tool_name = tool_name
            if tool_name in self.INTERNAL_TOOL_NAMES:
                return self._finalize_events(sse_events)
            run_id = event.get("run_id") or event.get("data", {}).get("run_id")

            if tool_name in ("write_file", "edit_file"):
                entry_data: dict[str, str] | None = None
                if run_id and run_id in self._artifact_writes:
                    entry_data = self._artifact_writes.pop(run_id)
                elif self._artifact_write_queue:
                    entry_data = self._artifact_write_queue.pop(0)
                else:
                    output = event.get("data", {}).get("output")
                    if isinstance(output, str) and "/artifacts/" in output:
                        start = output.find("/artifacts/")
                        end = output.find(" ", start)
                        path = output[start:] if end == -1 else output[start:end]
                        entry_data = {"path": path, "content": ""}

                if entry_data and entry_data.get("path", "").startswith("/artifacts/"):
                    path = entry_data["path"]
                    title = path.split("/")[-1] or "Artifact file"
                    content = entry_data.get("content", "")
                    is_saved = "/artifacts/saved/" in path
                    action = "create" if tool_name == "write_file" else "update"

                    # Sanitize content to remove control characters that break Redis JSON
                    safe_content = sanitize_for_json(content) if content else ""

                    # Emit artifact event
                    artifact = ArtifactData(
                        id=path,
                        artifact_type="file",
                        title=title,
                        summary=path,
                        payload={"path": path, "content": safe_content, "action": action, "saved": is_saved},
                        created_at=timestamp,
                    )
                    self._register_artifact(artifact)
                    sse_events.append(
                        SSEEvent(
                            event=SSEEventType.ARTIFACT,
                            data=artifact,
                        )
                    )

                    # Emit activity for trace
                    action_desc = "Created" if tool_name == "write_file" else "Updated"
                    if is_saved:
                        action_desc = f"Saved permanently: {title}"
                    else:
                        action_desc = f"{action_desc}: {title}"

                    artifact_activity = AgentActivityData(
                        agent=self._current_agent,
                        action="tool_complete",
                        tool_name=tool_name,
                        details=sanitize_for_json(action_desc),
                        result_summary=sanitize_for_json(action_desc),
                        timestamp=timestamp,
                        invocation_id=self._current_invocation_id,
                        tool_call_id=run_id,
                        success=True,
                    )
                    self.agent_trace.append(artifact_activity)
                    sse_events.append(
                        SSEEvent(
                            event=SSEEventType.AGENT_ACTIVITY,
                            data=artifact_activity,
                        )
                    )
                    return self._finalize_events(sse_events)

            # task/subagent completion: Subagent returned, restore previous context
            if tool_name in ("task", "subagent"):
                subagent_context: dict[str, str] | None = None
                subagent_name = None
                completed_invocation_id = None

                # First try to find by run_id (parallel-safe lookup)
                if run_id and run_id in self._active_subagents_by_run_id:
                    subagent_context = self._active_subagents_by_run_id.pop(run_id)
                    # Also remove from the list
                    if subagent_context in self._active_subagents:
                        self._active_subagents.remove(subagent_context)
                    if run_id in self._run_to_agent:
                        del self._run_to_agent[run_id]
                    if run_id in self._run_to_invocation:
                        del self._run_to_invocation[run_id]
                elif self._active_subagents:
                    # Fallback: pop from stack (sequential case)
                    subagent_context = self._active_subagents.pop()
                    # Also remove from dict if present
                    info_run_id = subagent_context.get("run_id")
                    if info_run_id and info_run_id in self._active_subagents_by_run_id:
                        del self._active_subagents_by_run_id[info_run_id]
                    if info_run_id and info_run_id in self._run_to_agent:
                        del self._run_to_agent[info_run_id]
                    if info_run_id and info_run_id in self._run_to_invocation:
                        del self._run_to_invocation[info_run_id]

                if subagent_context:
                    subagent_name = subagent_context["name"]
                    completed_invocation_id = subagent_context["invocation_id"]
                    increment_deep_agent_runtime_metric("subagent_completions_total")

                    completed_activity = AgentActivityData(
                        agent=subagent_name,
                        action="completed",
                        tool_name=subagent_name,  # Use agent name for frontend matching
                        details="Subagent completed task",
                        timestamp=timestamp,
                        invocation_id=completed_invocation_id,
                    )
                    self.agent_trace.append(completed_activity)
                    sse_events.append(
                        SSEEvent(
                            event=SSEEventType.AGENT_ACTIVITY,
                            data=completed_activity,
                        )
                    )

                    # Update ToC entry status to completed (preserve original title/type)
                    toc_entry_id = f"toc_{completed_invocation_id}"
                    existing_entry = self._get_existing_toc_entry(toc_entry_id)
                    toc_title = None
                    toc_type = None
                    toc_parent_id = None
                    toc_message_index = None
                    toc_timestamp = None
                    if existing_entry:
                        toc_title = existing_entry.get("title")
                        toc_type = existing_entry.get("type")
                        toc_parent_id = existing_entry.get("parent_id")
                        toc_message_index = existing_entry.get("message_index")
                        toc_timestamp = existing_entry.get("timestamp")

                    if not toc_title:
                        toc_title = subagent_context.get("display_name") or subagent_name
                    if not toc_type:
                        toc_type = "completion"

                    toc_event = self._emit_toc_entry(
                        entry_id=toc_entry_id,
                        title=toc_title,
                        entry_type=toc_type,
                        agent=subagent_name,
                        invocation_id=completed_invocation_id,
                        status="completed",
                        parent_id=toc_parent_id,
                        message_index=toc_message_index,
                        timestamp=toc_timestamp,
                    )
                    sse_events.append(toc_event)
                    # Mark todos as completed for this subagent
                    sse_events.extend(
                        self._emit_todo_status_update(
                            subagent_name, completed_invocation_id, "completed", timestamp
                        )
                    )

                # Restore context to parent agent (previous subagent or orchestrator)
                if self._active_subagents:
                    parent_info = self._active_subagents[-1]
                    self._current_agent = parent_info["name"]
                    self._current_invocation_id = parent_info["invocation_id"]
                else:
                    self._current_agent = "orchestrator"
                    self._current_invocation_id = self._orchestrator_invocation_id

                logger.info(
                    f"[SSE-OUT:{self._event_sequence:04d}] <<< COMPLETED subagent '{subagent_name}' "
                    f"(invocation_id={completed_invocation_id}, run_id={run_id}), "
                    f"restored to {self._current_agent} (remaining_active={len(self._active_subagents)})"
                )
                return self._finalize_events(sse_events)

            # write_todos completion: Could update progress display
            if tool_name == "write_todos":
                logger.debug("Todo list updated")
                return self._finalize_events(sse_events)

            # Filesystem tool completions: emit tool_complete to match the tool_start
            # (write_file/edit_file on non-artifact paths, ls, read_file, glob, grep)
            if tool_name in ("ls", "read_file", "write_file", "edit_file", "glob", "grep"):
                output = event.get("data", {}).get("output")
                result_summary = f"Completed: {tool_name}"
                if isinstance(output, str):
                    result_summary = output[:200] if len(output) > 200 else output
                fs_complete_activity = AgentActivityData(
                    agent=self._current_agent,
                    action="tool_complete",
                    tool_name=tool_name,
                    result_summary=sanitize_for_json(result_summary),
                    timestamp=timestamp,
                    invocation_id=self._current_invocation_id,
                    tool_call_id=run_id,
                    success=True,
                )
                self.agent_trace.append(fs_complete_activity)
                sse_events.append(
                    SSEEvent(
                        event=SSEEventType.AGENT_ACTIVITY,
                        data=fs_complete_activity,
                    )
                )

                if tool_name == "read_file":
                    path = self._file_reads_by_run_id.pop(run_id, None) if run_id else None
                    if path:
                        source = f"file:{path}"
                        if source not in self._seen_citation_sources:
                            self._seen_citation_sources.add(source)
                            excerpt = self._extract_read_file_excerpt(output).strip()
                            if len(excerpt) > 200:
                                excerpt = excerpt[:200] + "..."
                            display_name = path.split("/")[-1] or path
                            description = excerpt or path
                            citation = RichCitationData(
                                source=source,
                                entity_type="document",
                                display_name=display_name,
                                content=description,
                                confidence=0.9,
                                group_key="documents",
                                source_number=self._get_or_assign_source_number(source),
                                metadata={
                                    "path": path,
                                    "source_type": "file",
                                    "excerpt": excerpt or None,
                                    "title": display_name,
                                    "description": description,
                                },
                            )
                            self.citations.append(citation)
                            sse_events.append(
                                SSEEvent(
                                    event=SSEEventType.CITATION,
                                    data=citation,
                                )
                            )
                return self._finalize_events(sse_events)

            # Skip other Deep Agent internal tool completions (read_todos, etc.)
            if tool_name in self.DEEP_AGENT_TOOLS:
                return self._finalize_events(sse_events)

        # =====================================================================
        # HANDLE FINAL RESPONSE CUSTOM EVENTS (AUTO DOCUMENT ARTIFACT)
        # =====================================================================
        if kind == "on_custom_event":
            custom_data = event.get("data", {})
            if custom_data.get("type") == "final_response":
                payload = custom_data.get("data") or custom_data.get("response") or custom_data
                response = self._coerce_final_response_data(payload)
                final_text = response.raw_text or response.summary or ""
                artifact = self._build_document_artifact_from_response(final_text, timestamp)
                if artifact:
                    self._register_artifact(artifact)
                    sse_events.append(
                        SSEEvent(
                            event=SSEEventType.ARTIFACT,
                            data=artifact,
                        )
                    )

                parent_events = super().map_event(event)
                sse_events.extend(parent_events)
                return self._finalize_events(sse_events)

        # =====================================================================
        # DELEGATE TO PARENT FOR STANDARD EVENTS
        # =====================================================================
        parent_events = super().map_event(event)

        if kind == "on_chat_model_stream" and parent_events:
            filtered_events: list[SSEEvent] = []
            for sse_event in parent_events:
                if sse_event.event == SSEEventType.TEXT_CHUNK:
                    data = sse_event.data
                    chunk_text = getattr(data, "chunk", "") or ""
                    cleaned = self._strip_sql_code_fences(chunk_text)
                    if cleaned != chunk_text:
                        if self._should_accumulate_text(self._current_agent):
                            if self.accumulated_text.endswith(chunk_text):
                                self.accumulated_text = (
                                    self.accumulated_text[: -len(chunk_text)] + cleaned
                                )
                        if not cleaned:
                            continue
                        data.chunk = cleaned
                    filtered_events.append(sse_event)
                else:
                    filtered_events.append(sse_event)
            parent_events = filtered_events

        return self._finalize_events(parent_events)

    def _extract_citations(self, text: str) -> list[RichCitationData]:
        """Extract both [Source: ...] and inline [source:N] citations."""
        citations = super()._extract_citations(text)
        if not text:
            return citations

        pattern = r"\[source:\s*(\d+)\]"
        for match in re.finditer(pattern, text, re.IGNORECASE):
            try:
                source_number = int(match.group(1))
            except (TypeError, ValueError):
                continue

            if source_number in self._seen_inline_source_numbers:
                continue

            existing = next(
                (c for c in self.citations if c.source_number == source_number),
                None,
            )
            if existing:
                if existing.source in self._seen_citation_sources:
                    self._seen_inline_source_numbers.add(source_number)
                    continue
                self._seen_inline_source_numbers.add(source_number)
                self._seen_citation_sources.add(existing.source)
                citations.append(existing)
                continue

            # Create a placeholder citation when no matching source exists yet.
            start = max(0, match.start() - 100)
            end = min(len(text), match.end() + 100)
            context = text[start:end].strip()
            source_key = f"inline:source:{source_number}"
            self._seen_inline_source_numbers.add(source_number)
            self._seen_citation_sources.add(source_key)

            placeholder = RichCitationData(
                source=source_key,
                entity_type="document",
                display_name=f"Source {source_number}",
                content=context,
                confidence=1.0,
                group_key="documents",
                source_number=source_number,
            )
            self.citations.append(placeholder)
            citations.append(placeholder)

        return citations

    def _extract_citations_from_tool_result(
        self, tool_name: str, result: Any
    ) -> list[RichCitationData]:
        result = self._normalize_tool_result(result)
        citations = super()._extract_citations_from_tool_result(tool_name, result)

        if tool_name in self.DEEP_AGENT_TOOLS or tool_name in self.INTERNAL_TOOL_NAMES:
            return citations
        if tool_name in ("find_entity", "search_text", "search_chunks", "search_summaries", "query_graph"):
            return citations
        if not _is_citation_tool(tool_name):
            return citations

        payload = result
        if isinstance(payload, dict) and "ok" in payload and "data" in payload:
            payload = payload.get("data")
        if tool_name.startswith("sql_db_") and isinstance(payload, list):
            payload = {"rows": payload}
        if not isinstance(payload, dict):
            return citations

        source_key = _derive_source_key(tool_name, payload)
        if not source_key or source_key in self._seen_citation_sources:
            return citations

        self._seen_citation_sources.add(source_key)
        citation = RichCitationData(
            source=source_key,
            entity_type=_get_entity_type_from_tool(tool_name),
            display_name=_get_display_name_from_data(tool_name, payload),
            content=_get_content_summary_from_data(tool_name, payload),
            confidence=1.0,
            group_key=_get_group_key_from_tool(tool_name),
            source_number=self._get_or_assign_source_number(source_key),
            metadata=_extract_metadata_from_data(tool_name, payload),
        )
        self.citations.append(citation)
        citations.append(citation)
        return citations

    def _extract_artifacts_from_tool_result(self, result: Any) -> list[ArtifactData]:
        artifacts = super()._extract_artifacts_from_tool_result(result)

        if not self._auto_artifacts or not self._canvas_id:
            return artifacts

        tool_name = self._last_tool_name or ""
        if not tool_name:
            return artifacts
        if tool_name in self.DEEP_AGENT_TOOLS or tool_name in self.INTERNAL_TOOL_NAMES:
            return artifacts
        if tool_name.startswith("sql_db_"):
            # Avoid duplicating SQL preview artifacts.
            return artifacts

        payload = self._normalize_tool_result(result)
        if isinstance(payload, dict) and "ok" in payload and "data" in payload:
            payload = payload.get("data")
        if tool_name.startswith("sql_db_") and isinstance(payload, list):
            payload = {"rows": payload}
        if not isinstance(payload, dict):
            return artifacts

        source_number = None
        if _is_citation_tool(tool_name):
            source_key = _derive_source_key(tool_name, payload)
            if source_key:
                source_number = self._get_or_assign_source_number(source_key)

        origin = {
            "tool_name": tool_name,
            "source_number": source_number,
            "query": payload.get("query") if isinstance(payload, dict) else None,
            "canvas_id": self._canvas_id,
            "chat_block_id": self._chat_block_id,
            "entity_type": _get_entity_type_from_tool(tool_name),
        }

        if tool_name in DOCUMENT_TOOLS:
            content = build_document_content(tool_name, payload)
            if content:
                title = build_document_title(tool_name, payload)
                summary = content.replace("\n", " ").strip()[:160]
                artifacts.append(
                    ArtifactData(
                        id=f"artifact_doc_{tool_name}_{uuid.uuid4().hex[:8]}",
                        artifact_type="document",
                        title=title,
                        summary=summary,
                        payload={"content": content, "format": "markdown"},
                        origin=origin,
                        created_at=time.time(),
                    )
                )
            return artifacts

        if tool_name in GRAPH_TOOLS:
            graph_payload = extract_graph_payload(payload, source_number)
            if graph_payload.get("nodes") or graph_payload.get("edges"):
                title = build_document_title(tool_name, payload)
                artifacts.append(
                    ArtifactData(
                        id=f"artifact_graph_{tool_name}_{uuid.uuid4().hex[:8]}",
                        artifact_type="graph",
                        title=title,
                        payload=graph_payload,
                        origin=origin,
                        created_at=time.time(),
                    )
                )
            return artifacts

        candidate = select_table_candidate(tool_name, payload)
        if not candidate:
            return artifacts

        key, title, rows = candidate
        columns = list(rows[0].keys()) if rows else []
        payload_data = {
            "rows": rows,
            "columns": columns,
            "key": key,
        }
        artifacts.append(
            ArtifactData(
                id=f"artifact_table_{tool_name}_{uuid.uuid4().hex[:8]}",
                artifact_type="data_table",
                title=title,
                payload=payload_data,
                origin=origin,
                created_at=time.time(),
            )
        )
        return artifacts

    def _should_prompt_document(self) -> bool:
        if not self._canvas_id:
            return False
        query = (self._request_query or "").strip()
        if not query:
            return False
        return bool(
            re.search(r"^\s*(note|doc|document)\b", query, re.IGNORECASE)
            or re.search(
                r"\b(create|write|draft|make)\s+(a\s+)?(note|doc|document|summary)\b",
                query,
                re.IGNORECASE,
            )
        )

    def _extract_document_title_and_body(self, content: str) -> tuple[str | None, str]:
        match = re.match(r"^\s*#\s+(.+?)\s*\r?\n", content)
        if not match:
            return None, content
        title = match.group(1).strip()
        body = content[match.end():].lstrip()
        return title or None, body

    def _get_document_title(self) -> str:
        query = (self._request_query or "").strip()
        if not query:
            return "Canvas Document"
        words = query.split()
        return " ".join(words[:8]).rstrip(",:;")[:72]

    def _build_document_artifact_from_response(
        self, content: str, timestamp: float
    ) -> ArtifactData | None:
        if not self._auto_artifacts or not self._should_prompt_document():
            return None
        if not content or not content.strip():
            return None

        extracted_title, body = self._extract_document_title_and_body(content)
        title = extracted_title or self._get_document_title()
        summary = body.replace("\n", " ").strip()[:160]
        origin = {
            "type": "assistant_response",
            "canvas_id": self._canvas_id,
            "chat_block_id": self._chat_block_id,
        }
        payload = {
            "content": body,
            "format": "markdown",
        }
        return ArtifactData(
            id=f"artifact_document_{uuid.uuid4().hex[:8]}",
            artifact_type="document",
            title=title,
            summary=summary,
            payload=payload,
            origin=origin,
            created_at=timestamp,
        )

    def _format_todos(self, todos: list[dict]) -> str:
        """Format todos for display in thinking event."""
        if not todos:
            return "No tasks planned"

        lines = ["Planning tasks:"]
        for todo in todos:
            if not isinstance(todo, dict):
                todo = {"content": str(todo)}
            raw_status = todo.get("status", "pending")
            status = raw_status.lower() if isinstance(raw_status, str) else "pending"
            raw_content = todo.get("content", "")
            content = raw_content if isinstance(raw_content, str) else str(raw_content)
            raw_active_form = todo.get("activeForm", "")
            active_form = raw_active_form if isinstance(raw_active_form, str) else ""

            # Status emoji
            emoji = {
                "pending": "[ ]",
                "in_progress": "[>]",
                "completed": "[x]",
            }.get(status, "[ ]")

            # Use activeForm if available for more readable display
            display_text = active_form or content
            lines.append(f"{emoji} {display_text}")

        return "\n".join(lines)

    def _normalize_todos(self, todos: Any) -> list[dict[str, Any]]:
        """Normalize todo payloads to a list of dicts for safe rendering."""
        if not isinstance(todos, list):
            return []
        normalized: list[dict[str, Any]] = []
        for item in todos:
            if isinstance(item, dict):
                normalized.append(item)
                continue
            if item is None:
                continue
            if isinstance(item, str):
                normalized.append({"content": item.strip(), "status": "pending"})
                continue
            normalized.append({"content": str(item), "status": "pending"})
        return normalized

    def _extract_read_file_excerpt(self, output: Any) -> str:
        """Extract a short text excerpt from read_file output for citations."""
        if isinstance(output, str):
            return output
        if isinstance(output, dict):
            candidate = output.get("content") or output.get("text") or output.get("data")
            if isinstance(candidate, str):
                return candidate
            if isinstance(candidate, list):
                texts: list[str] = []
                for block in candidate:
                    if isinstance(block, dict):
                        if isinstance(block.get("text"), str):
                            texts.append(block["text"])
                        elif block.get("type") == "text" and isinstance(block.get("value"), str):
                            texts.append(block["value"])
                return "\n".join(texts)
        if hasattr(output, "content"):
            content = getattr(output, "content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                texts: list[str] = []
                for block in content:
                    if isinstance(block, dict) and isinstance(block.get("text"), str):
                        texts.append(block["text"])
                return "\n".join(texts)
        return ""

    def _get_agent_name(self, event: dict) -> str:
        """
        Determine agent name from event metadata (stateless approach).

        Maps LangGraph node names to UI agent names. This is robust because
        it doesn't rely on tracking start/end states.

        Uses checkpoint_ns (namespace) to detect if we're inside a subagent's
        context, which is important for correctly attributing "tools" nodes.
        """
        metadata = event.get("metadata", {})
        node_name_raw = metadata.get("langgraph_node", "")
        agent_name_raw = metadata.get("lc_agent_name", "")
        checkpoint_ns_raw = metadata.get("checkpoint_ns", "")
        node_name = node_name_raw if isinstance(node_name_raw, str) else ""
        agent_name = agent_name_raw if isinstance(agent_name_raw, str) else ""
        checkpoint_ns = checkpoint_ns_raw if isinstance(checkpoint_ns_raw, str) else ""
        run_id = event.get("run_id") or event.get("data", {}).get("run_id")
        parent_ids = event.get("parent_ids") or metadata.get("parent_ids", [])

        # Use the most specific name available
        name = agent_name or node_name

        # If we can resolve the agent from a known parent run_id, prefer that.
        # This fixes subagent tool calls being attributed to orchestrator.
        if run_id and run_id in self._run_to_agent:
            return self._run_to_agent[run_id]
        if parent_ids:
            for parent_id in reversed(parent_ids):
                if parent_id in self._run_to_agent:
                    return self._run_to_agent[parent_id]

        # Map Deep Agent node names to UI agent names
        # Nodes that are subagents (will be nested in UI)
        subagent_nodes = {
            "integration_expert": "integration_expert",
            "research_expert": "research_expert",
            "web_researcher": "web_researcher",
            "research-agent": "research_agent",
            "web-researcher": "web_researcher",
            "mentor-matcher": "mentor_matcher",
            "general-purpose": "assistant",
        }

        # Check if we're inside a subagent's namespace
        # checkpoint_ns format is typically "parent_node:child_node" or contains subagent name
        # Keep this namespace heuristic for now: LangGraph #6714 can omit reliable
        # tool-call correlation on parallel streaming events, so checkpoint namespaces
        # are still needed for user-visible SSE attribution stability.
        subagent_from_ns = None
        if checkpoint_ns:
            for subagent_key in subagent_nodes:
                if subagent_key in checkpoint_ns:
                    subagent_from_ns = subagent_nodes[subagent_key]
                    break

        # If we're in a subagent namespace and the node is "tools" or "model",
        # attribute to the subagent, not orchestrator
        # IMPORTANT: Only if we actually have active subagents - after subagent completion,
        # the checkpoint_ns might still reference the subagent path, but we should attribute to orchestrator
        if subagent_from_ns and name in ("tools", "model", "agent") and self._active_subagents:
            return subagent_from_ns

        # Internal middleware nodes should never appear as separate agents
        if self._is_internal_middleware_node(name):
            if subagent_from_ns and self._active_subagents:
                return subagent_from_ns
            return "orchestrator"

        # Direct subagent node match
        if name in subagent_nodes:
            return subagent_nodes[name]

        # Nodes that are the main orchestrator (shown at top level)
        # Only use these if NOT inside a subagent namespace
        orchestrator_nodes = {
            "orchestrator": "orchestrator",
            "mentor-hub-agent": "orchestrator",  # Legacy name
            "model": "orchestrator",
            "agent": "orchestrator",
            "tools": "orchestrator",
            "__start__": "orchestrator",
            "__end__": "orchestrator",
            "": "orchestrator",
        }

        if name in orchestrator_nodes and not subagent_from_ns:
            return orchestrator_nodes[name]

        # If unknown node, check if it looks like a subagent name
        # (anything that's not explicitly orchestrator is treated as subagent)
        if name and name not in ("orchestrator", "supervisor", "synthesizer"):
            return name  # Return as-is, frontend will treat as subagent

        return "orchestrator"

    def _map_agent_name(self, node_name: str) -> str:
        """Map internal node names to user-friendly names."""
        # First check Deep Agent specific names
        deep_agent_names = {
            "orchestrator": "orchestrator",
            "mentor-hub-agent": "orchestrator",  # Legacy name
            "model": "orchestrator",  # deepagents library internal model node
            "research-agent": "Research Agent",
            "web-researcher": "Web Researcher",
            "mentor-matcher": "Mentor Matcher",
            "general-purpose": "Assistant",
        }

        if node_name in deep_agent_names:
            return deep_agent_names[node_name]

        # Fall back to parent mapping
        return cast(str, super()._map_agent_name(node_name))

    def _infer_subagent_name(self, task_description: str, tool_input: dict) -> str:
        """
        Infer subagent name from task description or tool input context.

        Uses keyword matching to determine the type of agent being delegated to.
        Returns a meaningful name or None if cannot be inferred.
        """
        if not task_description:
            return "assistant"

        task_lower = task_description.lower()

        # Check for specific domain keywords
        keyword_to_agent = {
            # Integration/API agents
            ("wrike", "integration", "api", "webhook", "sync"): "integration_expert",
            # Research agents
            ("research", "search", "find", "look up", "investigate"): "research_expert",
            # Web/browsing agents
            ("web", "browse", "scrape", "url", "website"): "web_researcher",
            # Mentor matching
            ("mentor", "match", "pairing", "assign"): "mentor_matcher",
            # Data analysis
            ("analyze", "analysis", "data", "report", "statistics"): "data_analyst",
            # Code/development
            ("code", "program", "develop", "implement", "fix bug"): "developer",
            # Writing/content
            ("write", "draft", "compose", "document", "email"): "writer",
        }

        for keywords, agent_name in keyword_to_agent.items():
            if any(kw in task_lower for kw in keywords):
                return agent_name

        # Check if there's a subagent_type hint in tool_input metadata
        if isinstance(tool_input.get("metadata"), dict):
            agent_hint = tool_input["metadata"].get("agent_type") or tool_input["metadata"].get("subagent")
            if isinstance(agent_hint, str) and agent_hint:
                return agent_hint

        # Default to assistant for general tasks
        return "assistant"

    def _get_readable_agent_name(self, agent_name: str) -> str:
        """
        Convert internal agent name to a human-readable display name.

        Examples:
        - "web_researcher" -> "Web Researcher"
        - "integration_expert" -> "Integration Expert"
        - "research-agent" -> "Research Agent"
        """
        readable_names = {
            "web_researcher": "Web Researcher",
            "research_expert": "Research Expert",
            "integration_expert": "Integration Expert",
            "mentor_matcher": "Mentor Matcher",
            "data_analyst": "Data Analyst",
            "developer": "Developer",
            "writer": "Writer",
            "assistant": "Assistant",
            "research-agent": "Research Agent",
            "web-researcher": "Web Researcher",
            "mentor-matcher": "Mentor Matcher",
            "integration-agent": "Integration Agent",
            "general-purpose": "General Purpose",
        }

        if agent_name in readable_names:
            return readable_names[agent_name]

        # Convert snake_case or kebab-case to Title Case
        # Replace underscores and hyphens with spaces, then title case
        return agent_name.replace("_", " ").replace("-", " ").title()

    def _should_accumulate_text(self, agent: str) -> bool:
        """
        Only orchestrator-level agents should contribute to the final response.

        Subagent text should render inside subagent cards but not be duplicated
        in the orchestrator's final_response payload.

        Uses dynamic detection: if no subagents are active, ALL text accumulates
        (it's the orchestrator). If subagents ARE active, only non-subagent text
        accumulates.
        """
        if not self._active_subagents:
            return True
        active_names = {s["name"] for s in self._active_subagents}
        return agent not in active_names

    def _emit_todo_status_update(
        self, agent: str, invocation_id: str | None, new_status: str, timestamp: float
    ) -> list[SSEEvent]:
        """Emit updated todo events for todos belonging to a specific agent."""
        if not self._current_todos:
            return []
        updated = [
            TodoItemData(
                id=todo.get("id", f"todo-{i}"),
                content=todo.get("content", ""),
                status=new_status,
                activeForm=todo.get("activeForm"),
            )
            for i, todo in enumerate(self._current_todos)
        ]
        return [SSEEvent(
            event=SSEEventType.TODO,
            data=TodoData(
                todos=updated,
                timestamp=timestamp,
                agent=agent,
                invocation_id=invocation_id,
            ),
        )]

    def create_completion_todo_events(self) -> list[SSEEvent]:
        """Mark all remaining pending/in_progress todos as completed.

        Called at stream end to ensure no todos are left in a stale state.
        """
        if not self._current_todos:
            return []
        timestamp = time.time()
        agent = "orchestrator"
        invocation_id = self._orchestrator_invocation_id
        return self._emit_todo_status_update(agent, invocation_id, "completed", timestamp)

    def _summarize_task_description(self, task_description: str, max_length: int = 50) -> str:
        """
        Create a concise summary of a task description for display.

        Extracts the key action/topic from the task description.
        Returns an empty string if the description is empty or unhelpful.
        """
        if not task_description:
            return ""

        # Clean up the description
        desc = task_description.strip()

        # Remove common prefixes that don't add value
        prefixes_to_remove = [
            "please ",
            "can you ",
            "i need you to ",
            "i want you to ",
            "your task is to ",
            "you should ",
        ]
        desc_lower = desc.lower()
        for prefix in prefixes_to_remove:
            if desc_lower.startswith(prefix):
                desc = desc[len(prefix):]
                break

        # Take the first sentence or clause
        for sep in [". ", ".\n", " - ", ": ", "\n"]:
            if sep in desc:
                desc = desc.split(sep)[0]
                break

        # Truncate to max length, breaking at word boundary
        if len(desc) > max_length:
            desc = desc[:max_length]
            # Find last space to avoid cutting words
            last_space = desc.rfind(" ")
            if last_space > max_length // 2:
                desc = desc[:last_space]

        # Capitalize first letter
        if desc:
            desc = desc[0].upper() + desc[1:]

        return desc.strip()


_CITATION_TOOL_WHITELIST = {
    "sql_db_query",
    "sql_db_schema",
    "sql_db_list_tables",
    "sql_db_query_checker",
    "sql_db_context",
    "search_graph",
    "search_rag",
    "firecrawl_scrape",
    "firecrawl_search",
    "firecrawl_map",
    "firecrawl_extract",
    "firecrawl_crawl",
}


def _is_citation_tool(tool_name: str) -> bool:
    return tool_name.startswith("sql_db_") or tool_name in _CITATION_TOOL_WHITELIST


def _stable_digest(data: Any) -> str:
    try:
        payload = json.dumps(data, ensure_ascii=True, sort_keys=True, default=str)
    except Exception:
        payload = str(data)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


def _extract_primary_url(tool_name: str, data: Any) -> str | None:
    if not isinstance(data, dict):
        return None
    if tool_name == "firecrawl_search":
        results = data.get("results", [])
        if isinstance(results, list) and results:
            first = results[0]
            if isinstance(first, dict):
                url = first.get("url")
                if isinstance(url, str) and url.strip():
                    return url.strip()
    if tool_name == "firecrawl_map":
        url = data.get("url")
        if isinstance(url, str) and url.strip():
            return url.strip()
        urls = data.get("urls")
        if isinstance(urls, list) and urls:
            first_url = urls[0]
            if isinstance(first_url, str) and first_url.strip():
                return first_url.strip()
    if tool_name in ("firecrawl_scrape", "firecrawl_extract", "firecrawl_crawl"):
        url = data.get("url")
        if isinstance(url, str) and url.strip():
            return url.strip()
        urls = data.get("urls")
        if isinstance(urls, list) and urls:
            first_url = urls[0]
            if isinstance(first_url, str) and first_url.strip():
                return first_url.strip()
    return None


def _derive_source_key(tool_name: str, data: Any) -> str:
    url = _extract_primary_url(tool_name, data)
    if url:
        return url
    return f"{tool_name}:{_stable_digest(data)}"


def _get_entity_type_from_tool(tool_name: str) -> str:
    mapping = {
        "sql_db_query": "live_data",
        "sql_db_schema": "schema",
        "sql_db_list_tables": "schema",
        "sql_db_query_checker": "validation",
        "sql_db_context": "schema",
        "find_entity": "entity",
        "search_text": "document",
        "search_chunks": "document",
        "search_summaries": "document",
        "search_rag": "document",
        "search_graph": "document",
        "query_graph": "entity",
        "firecrawl_scrape": "document",
        "firecrawl_search": "document",
        "firecrawl_map": "document",
        "firecrawl_extract": "document",
        "firecrawl_crawl": "document",
    }
    return mapping.get(tool_name, "document")


def _get_group_key_from_tool(tool_name: str) -> str:
    mapping = {
        "sql_db_query": "live_data",
        "sql_db_schema": "schema",
        "sql_db_list_tables": "schema",
        "sql_db_query_checker": "validation",
        "sql_db_context": "schema",
        "find_entity": "entities",
        "search_text": "documents",
        "search_chunks": "documents",
        "search_summaries": "documents",
        "search_rag": "documents",
        "search_graph": "documents",
        "query_graph": "entities",
        "firecrawl_scrape": "documents",
        "firecrawl_search": "documents",
        "firecrawl_map": "documents",
        "firecrawl_extract": "documents",
        "firecrawl_crawl": "documents",
    }
    return mapping.get(tool_name, "documents")


def _get_display_name_from_data(tool_name: str, data: Any) -> str:
    if not isinstance(data, dict):
        return tool_name.replace("_", " ").title()

    if tool_name.startswith("sql_db_"):
        if tool_name == "sql_db_query":
            return "SQL Query Result"
        if tool_name == "sql_db_schema":
            return "SQL Schema"
        if tool_name == "sql_db_list_tables":
            return "SQL Tables"
        if tool_name == "sql_db_query_checker":
            return "SQL Query Check"
        if tool_name == "sql_db_context":
            return "SQL Context"
        return "SQL Tool"
    if tool_name == "find_entity":
        return data.get("name", "Entity")
    if tool_name in ("search_text", "search_chunks", "search_summaries", "search_graph", "search_rag"):
        results = data.get("results", [])
        count = len(results) if isinstance(results, list) else 0
        return f"Documents ({count})" if count > 1 else "Document"
    if tool_name == "firecrawl_scrape":
        metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
        title = metadata.get("title") or metadata.get("og:title")
        if isinstance(title, str) and title.strip():
            return title.strip()
        url = data.get("url")
        return url if isinstance(url, str) and url.strip() else "Scraped Page"
    if tool_name == "firecrawl_search":
        count = data.get("count")
        if not isinstance(count, int):
            count = len(data.get("results", [])) if isinstance(data.get("results"), list) else 0
        return f"Web Results ({count})" if count else "Web Results"
    if tool_name == "firecrawl_map":
        url = data.get("url")
        if isinstance(url, str) and url.strip():
            return f"Site Map: {url}"
        return "Site Map"
    if tool_name == "firecrawl_extract":
        return "Extracted Data"
    if tool_name == "firecrawl_crawl":
        return "Crawl Job"

    return tool_name.replace("_", " ").title()


def _get_content_summary_from_data(tool_name: str, data: Any) -> str:
    if not isinstance(data, dict):
        if tool_name == "sql_db_query" and isinstance(data, list):
            return f"Returned {len(data)} rows"
        return str(data)[:100]

    if tool_name.startswith("sql_db_"):
        if tool_name == "sql_db_query":
            rows = data.get("rows")
            if isinstance(rows, list):
                return f"Returned {len(rows)} rows"
            return "SQL query result"
        if tool_name == "sql_db_schema":
            return "Schema details"
        if tool_name == "sql_db_list_tables":
            return "List of tables"
        if tool_name == "sql_db_query_checker":
            return "Query validation"
        if tool_name == "sql_db_context":
            return "Tenant SQL context"
        return "SQL tool result"
    if tool_name == "find_entity":
        return data.get("description", "Entity from knowledge graph")[:150]
    if tool_name in ("search_text", "search_chunks", "search_summaries", "search_graph", "search_rag"):
        results = data.get("results", [])
        if results and isinstance(results, list) and isinstance(results[0], dict):
            return _extract_result_text(results[0])[:150]
        return "Document search results"
    if tool_name == "firecrawl_scrape":
        summary = data.get("summary")
        if isinstance(summary, str) and summary.strip():
            return summary[:150]
        markdown = data.get("markdown")
        if isinstance(markdown, str) and markdown.strip():
            return markdown[:150]
        return "Scraped web content"
    if tool_name == "firecrawl_search":
        results = data.get("results", [])
        if results and isinstance(results, list) and isinstance(results[0], dict):
            first = results[0]
            title = first.get("title") or first.get("url") or "Result"
            description = first.get("description") or ""
            summary = f"{title} - {description}".strip(" -")
            return summary[:150]
        return "Web search results"
    if tool_name == "firecrawl_map":
        urls = data.get("urls") if isinstance(data.get("urls"), list) else []
        return f"{len(urls)} URLs discovered" if urls else "Site map results"
    if tool_name == "firecrawl_extract":
        results = data.get("results")
        if isinstance(results, list) and results:
            return json.dumps(results[0], ensure_ascii=True, default=str)[:150]
        if isinstance(results, dict):
            return json.dumps(results, ensure_ascii=True, default=str)[:150]
        return "Extracted data"
    if tool_name == "firecrawl_crawl":
        job = data.get("job") if isinstance(data.get("job"), dict) else {}
        job_id = job.get("id") or job.get("jobId")
        return f"Crawl job {job_id}" if job_id else "Crawl job info"

    return str(data)[:100]


def _extract_metadata_from_data(tool_name: str, data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {}

    metadata: dict[str, Any] = {"tool_name": tool_name}

    if tool_name.startswith("sql_db_"):
        metadata["sqlTool"] = tool_name
    elif tool_name == "find_entity":
        if data.get("type"):
            metadata["entityType"] = data["type"]
        if data.get("outgoing_relationships"):
            metadata["relationshipCount"] = len(data["outgoing_relationships"])
    elif tool_name in ("search_text", "search_chunks", "search_summaries"):
        results = data.get("results", [])
        if results:
            metadata["resultCount"] = len(results)
            if isinstance(results[0], dict) and results[0].get("text"):
                metadata["excerpt"] = results[0]["text"][:200]
    elif tool_name in ("firecrawl_search", "firecrawl_map"):
        count = data.get("count")
        if isinstance(count, int):
            metadata["resultCount"] = count
        url = data.get("url")
        if isinstance(url, str) and url.strip():
            metadata["url"] = url
    elif tool_name in ("firecrawl_scrape", "firecrawl_extract", "firecrawl_crawl"):
        url = data.get("url")
        if isinstance(url, str) and url.strip():
            metadata["url"] = url
        if tool_name == "firecrawl_scrape":
            metadata["title"] = (
                data.get("metadata", {}).get("title")
                if isinstance(data.get("metadata"), dict)
                else None
            )
        if tool_name == "firecrawl_extract":
            results = data.get("results")
            if isinstance(results, list):
                metadata["resultCount"] = len(results)

    return {k: v for k, v in metadata.items() if v is not None}


def _extract_result_text(item: Any) -> str:
    if isinstance(item, dict):
        for key in ("answer", "content", "text", "summary", "completion", "result"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return json.dumps(item, ensure_ascii=True, default=str)
    if isinstance(item, str):
        return item.strip()
    return str(item).strip()
