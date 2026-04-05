"""GitHub data ingestion for AUBI constitution building.

Pulls commits, PRs, file ownership, and review patterns for a developer.
Returns structured data ready for Claude to build a Context Constitution.
"""

from __future__ import annotations

import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from dotenv import load_dotenv
from github import Github, GithubException

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


def _configured_target_repos() -> list[str]:
    raw = os.getenv("TARGET_REPOS") or os.getenv("TARGET_REPO") or os.getenv("GITHUB_REPO") or ""
    return [item.strip() for item in raw.split(",") if item.strip()]


def ingest_developer(
    github_username: str,
    *,
    token: str | None = None,
    days: int = 90,
    target_repos: list[str] | None = None,
) -> dict[str, Any]:
    """Pull GitHub data for a developer and return structured dict.

    Args:
        github_username: GitHub handle (e.g. "alicechen")
        token: GitHub PAT. Falls back to GITHUB_TOKEN env var.
        days: How many days of history to pull.
        target_repos: Full repo names to inspect first, such as "owner/repo".

    Returns:
        Structured dict with commits, prs, files_touched, languages, review_comments.
    """
    g = Github(token or os.getenv("GITHUB_TOKEN"))
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=days)

    try:
        user = g.get_user(github_username)
    except GithubException as e:
        raise ValueError(f"GitHub user '{github_username}' not found: {e}") from e

    commits_data: list[dict] = []
    prs_data: list[dict] = []
    files_touched: Counter = Counter()
    languages: set[str] = set()
    review_comments_sample: list[str] = []

    # Target repos are the demo/source-of-truth repos. Inspect them first even
    # when the coworker does not own the repository.
    target_repo_names = target_repos if target_repos is not None else _configured_target_repos()
    repos_by_name: dict[str, Any] = {}
    for repo_name in target_repo_names:
        try:
            repo = g.get_repo(repo_name)
            repos_by_name[repo.full_name.lower()] = repo
        except GithubException:
            continue

    # If no target repo is configured, fall back to repos owned by the user.
    if not repos_by_name:
        try:
            for repo in list(user.get_repos(type="all", sort="pushed"))[:20]:
                repos_by_name.setdefault(repo.full_name.lower(), repo)
        except GithubException:
            pass

    repos = list(repos_by_name.values())

    for repo in repos:
        # Languages
        try:
            for lang in repo.get_languages():
                languages.add(lang)
        except GithubException:
            pass

        # Commits by this user
        try:
            for commit in repo.get_commits(author=github_username, since=cutoff):
                files = [f.filename for f in commit.files] if commit.files else []
                commits_data.append({
                    "message": commit.commit.message.split("\n")[0][:120],
                    "files": files[:10],
                    "repo": repo.name,
                    "date": commit.commit.author.date.isoformat() if commit.commit.author.date else None,
                })
                for f in files:
                    # Track directory-level ownership
                    parts = f.split("/")
                    if len(parts) > 1:
                        files_touched[parts[0] + "/"] += 1
                    files_touched[f] += 1
                if len(commits_data) >= 200:
                    break
        except GithubException:
            pass

        # PRs authored
        try:
            for pr in repo.get_pulls(state="all", sort="updated", direction="desc"):
                if pr.updated_at < cutoff:
                    break
                if pr.user.login.lower() != github_username.lower():
                    continue
                prs_data.append({
                    "title": pr.title,
                    "body": (pr.body or "")[:300],
                    "files": [f.filename for f in pr.get_files()][:10],
                    "repo": repo.name,
                })
                if len(prs_data) >= 30:
                    break
        except GithubException:
            pass

        # Review comments (expertise signals)
        try:
            for pr in repo.get_pulls(state="all"):
                if pr.updated_at < cutoff:
                    break
                for review in pr.get_reviews():
                    if review.user and review.user.login.lower() == github_username.lower():
                        body = (review.body or "").strip()
                        if len(body) > 20:
                            review_comments_sample.append(body[:200])
                if len(review_comments_sample) >= 10:
                    break
        except GithubException:
            pass

    # Top 20 most-touched files/dirs
    top_files = [path for path, _ in files_touched.most_common(20)]

    return {
        "username": github_username,
        "name": user.name or github_username,
        "bio": user.bio or "",
        "company": user.company or "",
        "commits": commits_data[:100],
        "prs": prs_data[:20],
        "top_files": top_files,
        "languages": sorted(languages),
        "review_comments_sample": review_comments_sample[:10],
        "commit_count": len(commits_data),
        "pr_count": len(prs_data),
        "repos_considered": [repo.full_name for repo in repos],
        "target_repos": target_repo_names,
    }


def build_ownership_map(github_data_list: list[dict[str, Any]]) -> dict[str, str]:
    """Build a {filepath_prefix → owner_username} map from multiple devs' data.

    Simple heuristic: whoever has most commits to a path owns it.
    """
    path_scores: dict[str, Counter] = {}

    for dev_data in github_data_list:
        username = dev_data["username"]
        for commit in dev_data.get("commits", []):
            for f in commit.get("files", []):
                parts = f.split("/")
                # Track both directory and file level
                keys = [parts[0] + "/"] if len(parts) > 1 else [f]
                for key in keys:
                    if key not in path_scores:
                        path_scores[key] = Counter()
                    path_scores[key][username] += 1

    ownership: dict[str, str] = {}
    for path, scores in path_scores.items():
        if scores:
            owner, count = scores.most_common(1)[0]
            if count >= 2:  # only assign if at least 2 commits
                ownership[path] = owner

    return ownership
