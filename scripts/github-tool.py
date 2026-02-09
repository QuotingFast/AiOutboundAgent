#!/usr/bin/env python3
"""
GitHub API tool server for Claude Desktop (MCP).

Setup:
  1. pip install mcp httpx
  2. Create a GitHub Personal Access Token (fine-grained recommended)
     with repo read/write permissions.
  3. Export it:  export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
  4. Add to claude_desktop_config.json:
     {
       "mcpServers": {
         "github": {
           "command": "python3",
           "args": ["/absolute/path/to/github-tool.py"],
           "env": { "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx" }
         }
       }
     }
  5. Restart Claude Desktop.
"""

import os
import json
import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("github")

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
BASE = "https://api.github.com"
HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


def _request(method: str, path: str, body: dict | None = None) -> dict:
    """Make an authenticated GitHub API request."""
    url = f"{BASE}{path}" if path.startswith("/") else path
    with httpx.Client(headers=HEADERS, timeout=30) as client:
        resp = client.request(method, url, json=body)
        try:
            data = resp.json()
        except Exception:
            data = {"status": resp.status_code, "body": resp.text}
        if resp.status_code >= 400:
            msg = data.get("message", resp.text) if isinstance(data, dict) else resp.text
            return {"error": True, "status": resp.status_code, "message": msg, "details": data}
        return data


# ── Repository Info ──────────────────────────────────────────────

@mcp.tool()
def get_repo(owner: str, repo: str) -> str:
    """Get repository information including default branch, visibility, and description."""
    return json.dumps(_request("GET", f"/repos/{owner}/{repo}"), indent=2)


@mcp.tool()
def list_branches(owner: str, repo: str, per_page: int = 30) -> str:
    """List branches in a repository."""
    return json.dumps(_request("GET", f"/repos/{owner}/{repo}/branches?per_page={per_page}"), indent=2)


# ── File Operations ──────────────────────────────────────────────

@mcp.tool()
def get_file(owner: str, repo: str, path: str, ref: str = "") -> str:
    """
    Get a file's content and metadata from a repo.
    Returns the content (decoded), sha, and size.
    Pass `ref` for a specific branch/tag/commit (defaults to repo default branch).
    """
    url = f"/repos/{owner}/{repo}/contents/{path}"
    if ref:
        url += f"?ref={ref}"
    data = _request("GET", url)
    if isinstance(data, dict) and data.get("encoding") == "base64" and "content" in data:
        import base64
        decoded = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        return json.dumps({"path": data["path"], "sha": data["sha"], "size": data["size"], "content": decoded}, indent=2)
    return json.dumps(data, indent=2)


@mcp.tool()
def create_or_update_file(
    owner: str,
    repo: str,
    path: str,
    content: str,
    message: str,
    branch: str,
    sha: str = "",
) -> str:
    """
    Create or update a single file in a repo.
    For updates, provide the current blob `sha` (get it from get_file).
    For new files, omit `sha`.
    Content should be the raw file text (will be base64-encoded automatically).
    """
    import base64
    body: dict = {
        "message": message,
        "content": base64.b64encode(content.encode()).decode(),
        "branch": branch,
    }
    if sha:
        body["sha"] = sha
    return json.dumps(_request("PUT", f"/repos/{owner}/{repo}/contents/{path}", body), indent=2)


# ── Branch Operations ────────────────────────────────────────────

@mcp.tool()
def create_branch(owner: str, repo: str, new_branch: str, from_branch: str = "main") -> str:
    """
    Create a new branch from an existing branch.
    Gets the latest SHA of `from_branch` and creates `new_branch` pointing to it.
    """
    ref_data = _request("GET", f"/repos/{owner}/{repo}/git/ref/heads/{from_branch}")
    if isinstance(ref_data, dict) and ref_data.get("error"):
        return json.dumps(ref_data, indent=2)
    sha = ref_data["object"]["sha"]
    result = _request("POST", f"/repos/{owner}/{repo}/git/refs", {
        "ref": f"refs/heads/{new_branch}",
        "sha": sha,
    })
    return json.dumps(result, indent=2)


# ── Pull Request Operations ─────────────────────────────────────

@mcp.tool()
def create_pull_request(
    owner: str,
    repo: str,
    title: str,
    head: str,
    base: str = "main",
    body: str = "",
) -> str:
    """
    Create a pull request.
    `head` is the branch with your changes, `base` is the target (usually main).
    """
    return json.dumps(_request("POST", f"/repos/{owner}/{repo}/pulls", {
        "title": title,
        "head": head,
        "base": base,
        "body": body,
    }), indent=2)


@mcp.tool()
def merge_pull_request(
    owner: str,
    repo: str,
    pull_number: int,
    merge_method: str = "merge",
    commit_title: str = "",
    commit_message: str = "",
) -> str:
    """
    Merge a pull request.
    `merge_method` can be: "merge", "squash", or "rebase".
    """
    payload: dict = {"merge_method": merge_method}
    if commit_title:
        payload["commit_title"] = commit_title
    if commit_message:
        payload["commit_message"] = commit_message
    return json.dumps(_request("PUT", f"/repos/{owner}/{repo}/pulls/{pull_number}/merge", payload), indent=2)


@mcp.tool()
def list_pull_requests(owner: str, repo: str, state: str = "open", per_page: int = 10) -> str:
    """List pull requests. State can be: open, closed, all."""
    return json.dumps(
        _request("GET", f"/repos/{owner}/{repo}/pulls?state={state}&per_page={per_page}"),
        indent=2,
    )


@mcp.tool()
def get_pull_request(owner: str, repo: str, pull_number: int) -> str:
    """Get details of a specific pull request, including mergeable status."""
    return json.dumps(_request("GET", f"/repos/{owner}/{repo}/pulls/{pull_number}"), indent=2)


# ── Commit Operations ────────────────────────────────────────────

@mcp.tool()
def list_commits(owner: str, repo: str, branch: str = "main", per_page: int = 10) -> str:
    """List recent commits on a branch."""
    return json.dumps(
        _request("GET", f"/repos/{owner}/{repo}/commits?sha={branch}&per_page={per_page}"),
        indent=2,
    )


@mcp.tool()
def compare_branches(owner: str, repo: str, base: str, head: str) -> str:
    """
    Compare two branches. Returns ahead/behind counts and list of commits.
    Useful to preview what a PR would contain.
    """
    data = _request("GET", f"/repos/{owner}/{repo}/compare/{base}...{head}")
    if isinstance(data, dict) and not data.get("error"):
        return json.dumps({
            "status": data.get("status"),
            "ahead_by": data.get("ahead_by"),
            "behind_by": data.get("behind_by"),
            "total_commits": data.get("total_commits"),
            "commits": [
                {"sha": c["sha"][:7], "message": c["commit"]["message"].split("\n")[0]}
                for c in data.get("commits", [])
            ],
            "files": [
                {"filename": f["filename"], "status": f["status"], "additions": f["additions"], "deletions": f["deletions"]}
                for f in data.get("files", [])
            ],
        }, indent=2)
    return json.dumps(data, indent=2)


# ── Issues ───────────────────────────────────────────────────────

@mcp.tool()
def create_issue(owner: str, repo: str, title: str, body: str = "", labels: list[str] | None = None) -> str:
    """Create an issue on the repository."""
    payload: dict = {"title": title}
    if body:
        payload["body"] = body
    if labels:
        payload["labels"] = labels
    return json.dumps(_request("POST", f"/repos/{owner}/{repo}/issues", payload), indent=2)


@mcp.tool()
def list_issues(owner: str, repo: str, state: str = "open", per_page: int = 10) -> str:
    """List issues. State can be: open, closed, all."""
    return json.dumps(
        _request("GET", f"/repos/{owner}/{repo}/issues?state={state}&per_page={per_page}"),
        indent=2,
    )


# ── Actions / Deployments ───────────────────────────────────────

@mcp.tool()
def list_workflow_runs(owner: str, repo: str, branch: str = "", per_page: int = 5) -> str:
    """List recent GitHub Actions workflow runs. Optionally filter by branch."""
    url = f"/repos/{owner}/{repo}/actions/runs?per_page={per_page}"
    if branch:
        url += f"&branch={branch}"
    data = _request("GET", url)
    if isinstance(data, dict) and not data.get("error") and "workflow_runs" in data:
        return json.dumps([
            {
                "id": r["id"],
                "name": r["name"],
                "status": r["status"],
                "conclusion": r["conclusion"],
                "branch": r["head_branch"],
                "commit": r["head_sha"][:7],
                "created": r["created_at"],
                "url": r["html_url"],
            }
            for r in data["workflow_runs"]
        ], indent=2)
    return json.dumps(data, indent=2)


# ── Generic Escape Hatch ────────────────────────────────────────

@mcp.tool()
def github_api(method: str, path: str, body: str = "") -> str:
    """
    Make any GitHub API call not covered by other tools.
    `method`: GET, POST, PUT, PATCH, DELETE
    `path`: e.g. /repos/owner/repo/releases
    `body`: JSON string for request body (optional)
    """
    parsed_body = json.loads(body) if body else None
    return json.dumps(_request(method.upper(), path, parsed_body), indent=2)


if __name__ == "__main__":
    mcp.run()
