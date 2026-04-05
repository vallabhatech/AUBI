"""Specialized subagent definitions for Aubi.

Each subagent has a focused role, curated tools, and a system prompt
that tells it exactly what it's good at. The main Aubi agent delegates
to these via the `task` tool when work benefits from specialization.
"""

from __future__ import annotations

from typing import Any

from deepagents.middleware.subagents import SubAgent

from app.tools.web_search import get_web_search_tools


def get_research_subagent_spec(model: Any, tools: list | None = None) -> SubAgent:
    """Research Agent — deep web research with source synthesis."""
    return {
        "name": "research-agent",
        "description": (
            "Use for in-depth research requiring multiple searches and synthesis. "
            "Good for: competitive landscape analysis, industry trends, company "
            "research, technology evaluation, market sizing. Provides cited, "
            "structured research reports."
        ),
        "system_prompt": (
            "You are a research specialist. Your job is to:\n\n"
            "1. Break the research question into specific, searchable queries\n"
            "2. Search multiple sources and cross-reference findings\n"
            "3. Synthesize a comprehensive but concise answer\n"
            "4. Cite every claim with source URLs\n\n"
            "## Output Format\n"
            "- Executive summary (2-3 sentences)\n"
            "- Key findings (bullet points with citations)\n"
            "- Sources section listing all referenced URLs\n\n"
            "Keep responses under 800 words. Be factual, not speculative."
        ),
        "model": model,
        "tools": list(tools or []) + get_web_search_tools(),
    }


def get_document_subagent_spec(model: Any, tools: list | None = None) -> SubAgent:
    """Document Agent — drafts structured documents and reports."""
    return {
        "name": "document-agent",
        "description": (
            "Use for creating structured documents: reports, plans, memos, "
            "proposals, summaries, analyses. Produces well-formatted markdown "
            "with clear headings, sections, and professional tone."
        ),
        "system_prompt": (
            "You are a document specialist. Your job is to:\n\n"
            "1. Understand the document type and audience\n"
            "2. Create a clear structure with headings\n"
            "3. Write concise, professional content\n"
            "4. Save the document to a file when complete\n\n"
            "## Guidelines\n"
            "- Use markdown formatting\n"
            "- Include a title (H1) at the top\n"
            "- Use H2/H3 for sections\n"
            "- Keep paragraphs short (3-4 sentences)\n"
            "- Use bullet points for lists\n"
            "- Include a summary section at the top for long documents\n"
            "- Save files with descriptive names (e.g., competitive-analysis.md)"
        ),
        "model": model,
        "tools": list(tools or []),
    }


def get_data_analyst_subagent_spec(model: Any, tools: list | None = None) -> SubAgent:
    """Data Analyst — analyzes data, creates tables, extracts insights."""
    return {
        "name": "data-analyst",
        "description": (
            "Use for data analysis: interpreting datasets, creating summary "
            "tables, extracting trends, statistical analysis, and data-driven "
            "recommendations."
        ),
        "system_prompt": (
            "You are a data analyst specialist. Your job is to:\n\n"
            "1. Understand the data and the question being asked\n"
            "2. Analyze the data systematically\n"
            "3. Present findings in clear tables and bullet points\n"
            "4. Highlight key insights and anomalies\n"
            "5. Make data-driven recommendations\n\n"
            "## Guidelines\n"
            "- Use markdown tables for structured data\n"
            "- Include summary statistics where relevant\n"
            "- Visualize trends in text when charts aren't available\n"
            "- Be precise with numbers — don't round unnecessarily\n"
            "- Distinguish correlation from causation"
        ),
        "model": model,
        "tools": list(tools or []),
    }


def get_all_subagent_specs(model: Any, tools: list | None = None) -> list[SubAgent]:
    """Return all specialized subagent specs."""
    return [
        get_research_subagent_spec(model, tools),
        get_document_subagent_spec(model, tools),
        get_data_analyst_subagent_spec(model, tools),
    ]
