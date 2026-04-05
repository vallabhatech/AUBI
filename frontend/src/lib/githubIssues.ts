import type { GitHubIssue } from "./types";

export const AUBI_ISSUES_REPO = "Neilyoo98/AUBI-demo";

export function issueUrlFor(issue: GitHubIssue) {
  return issue.html_url || issue.url;
}

export function issueRefFor(issue: GitHubIssue) {
  return `${issue.repo_name}#${issue.issue_number}`;
}

export function issueLabelFor(issue: GitHubIssue) {
  return `${issueRefFor(issue)} · ${issue.title}`;
}

export function issueMatchesInput(issue: GitHubIssue, input: string) {
  const trimmed = input.trim();
  if (!trimmed) return false;
  const normalized = trimmed.toLowerCase();
  return [
    issue.url,
    issue.html_url,
    issueUrlFor(issue),
    issueRefFor(issue),
  ].some((candidate) => candidate?.toLowerCase() === normalized);
}
