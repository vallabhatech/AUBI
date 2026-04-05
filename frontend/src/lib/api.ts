import type { Agent, ApprovalResult, GitHubIssuesResult, GitHubPollResult, IncidentResult, StreamLike } from "./types";
import { normalizeAgent, normalizeAgents } from "./agents";
import { AUBI_ISSUES_REPO } from "./githubIssues";

const BASE = "/api";

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : `Request failed with ${response.status}`;
    throw new Error(detail);
  }
  return data as T;
}

export const api = {
  async getAgents(): Promise<Agent[]> {
    return normalizeAgents(await fetchJson<Agent[]>(`${BASE}/agents`));
  },

  async getAgent(id: string): Promise<Agent> {
    return normalizeAgent(await fetchJson<Agent>(`${BASE}/agents/${id}`));
  },

  async createAgent(body: { github_username: string; name?: string; role?: string }): Promise<Agent> {
    return normalizeAgent(await fetchJson<Agent>(`${BASE}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  },

  async deleteAgent(id: string): Promise<void> {
    await fetchJson(`${BASE}/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async pollGitHub(): Promise<GitHubPollResult> {
    return fetchJson<GitHubPollResult>(`${BASE}/github/poll`);
  },

  async listGitHubIssues(repoName = AUBI_ISSUES_REPO): Promise<GitHubIssuesResult> {
    return fetchJson<GitHubIssuesResult>(`${BASE}/github/issues?repo=${encodeURIComponent(repoName)}`);
  },

  async runIncident(issueUrl: string): Promise<IncidentResult> {
    return fetchJson<IncidentResult>(`${BASE}/incidents/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issue_url: issueUrl }),
    });
  },

  streamIncident(issueUrl: string): StreamLike {
    return new EventSource(`${BASE}/incidents/stream?issue_url=${encodeURIComponent(issueUrl)}`);
  },

  async approveIncident(threadId: string, approved = true): Promise<ApprovalResult> {
    return fetchJson<ApprovalResult>(
      `${BASE}/incidents/approve?thread_id=${encodeURIComponent(threadId)}&approved=${approved}`,
      { method: "POST" }
    );
  },
};
