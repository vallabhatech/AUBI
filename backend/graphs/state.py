"""State schemas for AUBI graphs."""

from __future__ import annotations

import operator
from typing import Annotated, Any, Optional
from typing_extensions import TypedDict


class AgentMessage(TypedDict):
    sender: str       # "orchestrator" | "<agent_name>_aubi"
    recipient: str
    message: str
    timestamp: float


class AUBIIssueState(TypedDict):
    """State flowing through the full issue → PR graph."""

    # Input — one of these is set
    issue_url: Optional[str]       # GitHub issue URL or "owner/repo#N"
    incident_text: Optional[str]   # raw incident report text

    # Issue reader output
    repo_name: Optional[str]
    issue_number: Optional[int]
    issue_title: Optional[str]
    issue_body: Optional[str]
    issue_author: Optional[str]

    # Analyzer output
    affected_files: list[str]
    affected_service: Optional[str]
    error_type: Optional[str]
    urgency: Optional[str]

    # Ownership router output
    owner_ids: list[str]

    # Agent consultor output — merged across parallel agent queries
    agent_messages: Annotated[list[AgentMessage], operator.add]
    agent_contexts: Annotated[list[dict[str, Any]], operator.add]

    # Routing evidence showing why a coworker was chosen.
    routing_evidence: Annotated[list[dict[str, Any]], operator.add]

    # Coworker mesh output — owner agents exchange context with related agents
    coworker_exchanges: Annotated[list[dict[str, Any]], operator.add]
    shared_memory_hits: Annotated[list[dict[str, Any]], operator.add]

    # Code reader output
    file_contents: dict[str, str]   # {filepath: raw_code}

    # Fix generator output
    patch_diff: Optional[str]
    fixed_file_path: Optional[str]
    fixed_file_content: Optional[str]
    fix_explanation: Optional[str]

    # Verification output
    tests_passed: Optional[bool]
    test_output: Optional[str]

    # Human approval output
    approval_status: Optional[bool]

    # PR pusher output
    pr_url: Optional[str]
    branch_name: Optional[str]

    # Memory update — what AUBI learned after this incident (shown in "AUBI learned" strip)
    learned_facts: Annotated[list[dict[str, Any]], operator.add]
    memory_writes: Annotated[list[dict[str, Any]], operator.add]

    # Slack-style response (incident mode)
    slack_message: Optional[str]
    postmortem: Optional[str]

    # Stream log — frontend readable progress
    stream_log: Annotated[list[str], operator.add]
