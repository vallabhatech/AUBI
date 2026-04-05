"""
State schemas for LangGraph Orchestrator v2.

Defines state types for:
- Main orchestrator (v1 compatibility + new fields)
- Parallel researcher workflow (Send API)
- Evaluator-optimizer cycle
    - Live SQL workflow
- Worker subgraphs
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, Literal, Optional

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


# =============================================================================
# RESEARCH TASK & RESULT TYPES
# =============================================================================

class ResearchTask(TypedDict):
    """A single research task to be executed by a worker."""
    id: str
    type: Literal["entity", "text", "summary", "graph", "sql"]
    query: str
    focus: str
    priority: Literal["high", "medium", "low"]
    config: Optional[dict[str, Any]]


class ResearchResult(TypedDict):
    """Result from a single research task."""
    task_id: str
    task_type: str
    success: bool
    data: Any
    confidence: float
    sources: list[str]
    error: Optional[str]
    execution_time_ms: int


class EvaluationCriteria(TypedDict):
    """Criteria used to evaluate research quality."""
    has_sufficient_data: bool
    confidence_threshold_met: bool
    answers_query: bool
    has_citations: bool


class Evaluation(TypedDict):
    """Full evaluation result."""
    criteria: EvaluationCriteria
    passed: bool
    feedback: str
    suggested_refinements: list[str]


# =============================================================================
# ORCHESTRATOR STATE (v1 compatible + v2 extensions)
# =============================================================================

class OrchestratorState(TypedDict):
    """
    Main state schema for the orchestrator graph.

    Uses the MessagesState pattern with additional fields for
    session management, user context, and streaming events.

    V2 additions:
    - research_tasks/results for parallel execution
    - evaluation for quality gates
    - query classification for routing
    """

    # Core conversation messages - uses add_messages reducer for append behavior
    messages: Annotated[list[AnyMessage], add_messages]

    # Session/thread management
    session_id: str
    user_id: str
    tenant_id: str

    # User context for personalization
    user_context: Optional[dict[str, Any]]
    auth0_id: Optional[str]

    # Accumulated results
    citations: list[dict[str, Any]]

    # Custom streaming events buffer (for thinking, citations)
    pending_events: list[dict[str, Any]]

    # V2: Query analysis
    query_type: Optional[Literal["simple", "complex", "analytical", "action"]]
    query_entities: Optional[list[str]]

    # V2: Parallel research coordination
    research_tasks: list[ResearchTask]
    research_results: Annotated[list[ResearchResult], operator.add]

    # V2: Quality tracking
    confidence: float
    evaluation: Optional[Evaluation]
    retry_count: int

    # V2: Final output
    final_answer: Optional[str]


# =============================================================================
# PARALLEL RESEARCHER STATE
# =============================================================================

class ParallelResearchState(TypedDict):
    """
    State for parallel researcher workflow.

    Uses operator.add for research_results to enable parallel writes
    from multiple worker nodes spawned via Send API.
    """
    # Input
    query: str
    messages: Annotated[list[AnyMessage], add_messages]
    user_context: Optional[dict[str, Any]]

    # Planning
    research_tasks: list[ResearchTask]

    # Parallel execution - operator.add enables concurrent writes
    research_results: Annotated[list[ResearchResult], operator.add]

    # Synthesis
    synthesized_answer: Optional[str]
    confidence: float
    citations: list[dict[str, Any]]


class WorkerState(TypedDict):
    """
    State for individual research workers.

    Each worker receives a single task and writes results back
    to the parent graph via the shared research_results key.
    """
    task: ResearchTask
    research_results: Annotated[list[ResearchResult], operator.add]


# =============================================================================
# EVALUATOR-OPTIMIZER STATE
# =============================================================================

class EvaluatorOptimizerState(TypedDict):
    """
    State for evaluator-optimizer workflow.

    Supports cycles for retry when quality thresholds aren't met.
    """
    # Input
    query: str
    messages: Annotated[list[AnyMessage], add_messages]

    # Research
    research_tasks: list[ResearchTask]
    research_results: Annotated[list[ResearchResult], operator.add]

    # Synthesis
    final_answer: Optional[str]
    confidence: float

    # Evaluation
    evaluation: Optional[Evaluation]
    retry_count: int
    max_retries: int

    # Output
    approved_answer: Optional[str]


# =============================================================================
# MENTOR HUB WORKFLOW STATE
# =============================================================================

class MentorHubWorkflowState(TypedDict):
    """
    State for mentor-hub API workflow.

    Used when queries require live data from the application.
    """
    # Input
    query: str
    messages: Annotated[list[AnyMessage], add_messages]
    user_context: Optional[dict[str, Any]]

    # API data
    sessions: Optional[list[dict[str, Any]]]
    teams: Optional[list[dict[str, Any]]]
    mentors: Optional[list[dict[str, Any]]]
    tasks: Optional[list[dict[str, Any]]]
    feedback: Optional[list[dict[str, Any]]]

    # Synthesis
    final_answer: Optional[str]


# =============================================================================
# SUPERVISOR STATE
# =============================================================================

class SupervisorState(TypedDict):
    """
    State for the supervisor orchestrator.

    Routes queries to appropriate workflows and aggregates results.
    """
    # Input
    messages: Annotated[list[AnyMessage], add_messages]
    query: str
    user_context: Optional[dict[str, Any]]
    auth0_id: Optional[str]

    # Routing
    query_classification: Optional[Literal["simple", "complex", "analytical", "action"]]
    selected_workflow: Optional[str]

    # Workflow results
    workflow_result: Optional[dict[str, Any]]

    # Final output
    final_answer: Optional[str]
    confidence: float
    citations: list[dict[str, Any]]


# =============================================================================
# LEGACY SUBGRAPH STATES (v1 compatibility)
# =============================================================================


class ResearcherState(TypedDict):
    """
    State schema for researcher subgraphs.

    Used by entity_researcher, text_researcher, and summary_researcher.
    """

    messages: Annotated[list[AnyMessage], add_messages]
    query: str  # The specific research query
    findings: list[dict[str, Any]]  # Accumulated research findings


class DeepReasoningState(TypedDict):
    """
    State schema for deep reasoning agent.

    Handles complex queries requiring multi-step analysis.
    """

    messages: Annotated[list[AnyMessage], add_messages]
    query: str
    decomposed_questions: list[str]  # Sub-questions for analysis
    gathered_data: dict[str, Any]  # Data collected from tools
    analysis: Optional[str]  # Final analysis
    confidence: float  # Confidence score
    gaps: list[str]  # Identified information gaps


class MentorMatcherState(TypedDict):
    """
    State schema for mentor matching agent.

    Specialized for mentor-team recommendation queries.
    """

    messages: Annotated[list[AnyMessage], add_messages]
    team_name: str
    team_context: dict[str, Any]  # Team challenges, needs
    mentor_pool: list[dict[str, Any]]  # Available mentors
    past_interactions: list[str]  # Previous mentor-team sessions
    recommendations: list[dict[str, Any]]  # Ranked mentor recommendations
