"""GitHub issue reader, code reader, and PR pusher for AUBI.

Three responsibilities:
1. read_issue()        — parse a GitHub issue URL → structured dict
2. list_repo_files()   — list repository file paths for issue grounding
3. read_repo_files()   — fetch file contents from a repo
4. create_fix_pr()     — create branch, commit fix, open PR
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any

from github import Github, GithubException
from github.InputGitAuthor import InputGitAuthor


def _get_github() -> Github:
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN not set")
    return Github(token)


def parse_issue_ref(issue_url_or_ref: str) -> tuple[str, int]:
    """Parse 'owner/repo#42' or full GitHub URL into (repo_name, issue_number)."""
    # Full URL: https://github.com/owner/repo/issues/42
    url_match = re.search(r"github\.com/([^/]+/[^/]+)/issues/(\d+)", issue_url_or_ref)
    if url_match:
        return url_match.group(1), int(url_match.group(2))

    # Short form: owner/repo#42
    short_match = re.match(r"([^#]+)#(\d+)", issue_url_or_ref)
    if short_match:
        return short_match.group(1), int(short_match.group(2))

    raise ValueError(f"Cannot parse issue ref: {issue_url_or_ref!r}")


def read_issue(issue_url_or_ref: str) -> dict[str, Any]:
    """Fetch a GitHub issue and return structured dict."""
    g = _get_github()
    repo_name, issue_number = parse_issue_ref(issue_url_or_ref)

    try:
        repo = g.get_repo(repo_name)
        issue = repo.get_issue(issue_number)
    except GithubException as e:
        raise ValueError(f"Could not fetch issue {issue_url_or_ref}: {e}") from e

    return {
        "repo_name": repo_name,
        "issue_number": issue_number,
        "title": issue.title,
        "body": issue.body or "",
        "author": issue.user.login if issue.user else "unknown",
        "url": issue.html_url,
        "state": issue.state,
        "labels": [label.name for label in issue.labels],
    }


def read_repo_files(repo_name: str, filepaths: list[str], ref: str = "main") -> dict[str, str]:
    """Fetch file contents for given paths from a repo.

    Returns {filepath: file_content_str}.
    Raises if any requested file cannot be fetched.
    """
    g = _get_github()
    try:
        repo = g.get_repo(repo_name)
    except GithubException as e:
        raise ValueError(f"Could not access repo {repo_name}: {e}") from e

    contents: dict[str, str] = {}
    for path in filepaths:
        try:
            file_obj = repo.get_contents(path, ref=ref)
        except GithubException as e:
            raise FileNotFoundError(f"Could not fetch {path!r} from {repo_name}@{ref}: {e}") from e
        if isinstance(file_obj, list) or not hasattr(file_obj, "decoded_content"):
            raise ValueError(f"{path!r} in {repo_name}@{ref} is not a file")
        contents[path] = file_obj.decoded_content.decode("utf-8", errors="replace")

    return contents


def list_repo_files(repo_name: str, ref: str | None = None, max_files: int = 500) -> list[str]:
    """Return repository file paths from the default branch or a requested ref."""
    g = _get_github()
    try:
        repo = g.get_repo(repo_name)
        branch_name = ref or repo.default_branch
        branch = repo.get_branch(branch_name)
        tree = repo.get_git_tree(branch.commit.sha, recursive=True).tree
    except GithubException as e:
        raise ValueError(f"Could not list files for repo {repo_name}: {e}") from e

    paths = sorted(
        item.path
        for item in tree
        if getattr(item, "type", "") == "blob" and getattr(item, "path", "")
    )
    return paths[:max_files]


def create_fix_pr(
    *,
    repo_name: str,
    issue_number: int,
    issue_title: str,
    file_path: str,
    new_file_content: str,
    pr_body: str,
    branch_name: str | None = None,
    base_branch: str = "main",
    author_name: str = "Aubi Bot",
    author_email: str = "aubi@cognoxent.ai",
) -> str:
    """Create a branch, commit the fix, and open a PR. Returns the PR URL."""
    g = _get_github()
    repo = g.get_repo(repo_name)

    suffix = datetime.now(tz=timezone.utc).strftime("%Y%m%d%H%M%S")
    branch = branch_name or f"aubi/fix-issue-{issue_number}-{suffix}"
    commit_msg = f"fix: resolve {issue_title[:60]} (closes #{issue_number})"
    pr_title = f"fix: {issue_title[:70]} (closes #{issue_number})"

    # 1. Get base branch SHA
    try:
        base = repo.get_branch(base_branch)
    except GithubException:
        base_branch = repo.default_branch
        base = repo.get_branch(base_branch)

    # 2. Create fix branch in the target repo. If the token cannot write to
    # the target repo, fall back to a fork-based PR, which is the normal path
    # for public repos owned by teammates.
    write_repo = repo
    pr_head = branch
    try:
        repo.create_git_ref(f"refs/heads/{branch}", base.commit.sha)
    except GithubException as e:
        raise RuntimeError(f"Failed to create branch {branch}: {e}") from e

    # 3. Commit the fixed file
    try:
        existing = write_repo.get_contents(file_path, ref=branch)
        write_repo.update_file(
            path=existing.path,
            message=commit_msg,
            content=new_file_content,
            sha=existing.sha,
            branch=branch,
            author=InputGitAuthor(author_name, author_email),
        )
    except GithubException as e:
        raise RuntimeError(f"Failed to commit fix to {file_path}: {e}") from e

    # 4. Open PR
    try:
        pr = repo.create_pull(
            title=pr_title,
            body=pr_body,
            head=pr_head,
            base=base_branch,
        )
        return pr.html_url
    except GithubException as e:
        raise RuntimeError(f"Failed to create PR: {e}") from e


def get_latest_open_issue(repo_name: str) -> dict[str, Any] | None:
    """Poll for the most recent open issue on a repo."""
    g = _get_github()
    repo = g.get_repo(repo_name)
    issues = list(repo.get_issues(state="open", sort="created", direction="desc"))
    if not issues:
        return None

    issue = next(
        (candidate for candidate in issues if getattr(candidate, "pull_request", None) is None),
        None,
    )
    if issue is None:
        return None
    return {
        "repo_name": repo_name,
        "issue_number": issue.number,
        "title": issue.title,
        "body": issue.body or "",
        "author": issue.user.login if issue.user else "unknown",
        "url": issue.html_url,
    }


def list_open_issues(repo_name: str, limit: int = 20) -> list[dict[str, Any]]:
    """Return recent open non-PR issues for a repo."""
    g = _get_github()
    repo = g.get_repo(repo_name)
    issues: list[dict[str, Any]] = []

    for issue in repo.get_issues(state="open", sort="created", direction="desc"):
        if getattr(issue, "pull_request", None) is not None:
            continue
        issues.append({
            "repo_name": repo_name,
            "issue_number": issue.number,
            "title": issue.title,
            "body": issue.body or "",
            "author": issue.user.login if issue.user else "unknown",
            "url": issue.html_url,
            "html_url": issue.html_url,
            "created_at": issue.created_at.isoformat() if issue.created_at else None,
            "updated_at": issue.updated_at.isoformat() if issue.updated_at else None,
            "labels": [label.name for label in issue.labels],
        })
        if len(issues) >= max(1, min(limit, 50)):
            break

    return issues
