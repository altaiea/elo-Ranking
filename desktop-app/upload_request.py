"""Request an upload of the latest stats to the league owner's GitHub repository.

What it does
------------
Builds the same website files the "Export to GitHub Folder" button writes
(current_stats.json, daily_stats/<today>.json, previous_stats.json,
history/<day>.json, history/index.json) and sends them to GitHub as a NEW BRANCH
plus a PULL REQUEST. It never writes to the base branch (main), so nothing goes
live until the owner reviews and merges (or pulls the branch in GitHub Desktop
and commits).

Safety
------
* Only the whitelisted file names above can be uploaded.
* The branch is always named stats-upload/<name>-<UTC time>.
* The token is only ever sent to api.github.com (plain HTTP is accepted only for
  127.0.0.1 so the logic can be tested against a local fake server).
* No Elo maths happens here; the local data is only read, never changed.

Standard library only, so it can be tested without Qt.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable

DATE_FILE = re.compile(r"^\d{4}-\d{2}-\d{2}\.json$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
BRANCH_RE = re.compile(r"^[A-Za-z0-9._/-]{1,100}$")
ALLOWED_PATH = re.compile(
    r"^(current_stats\.json|previous_stats\.json|daily_stats/\d{4}-\d{2}-\d{2}\.json"
    r"|history/\d{4}-\d{2}-\d{2}\.json|history/index\.json)$"
)
BRANCH_PREFIX = "stats-upload/"
DEFAULT_API = "https://api.github.com"


class UploadError(RuntimeError):
    pass


@dataclass
class Package:
    files: dict[str, bytes]
    players: int
    days: int
    maps: int
    today: str
    stats_sha256: str
    notes: list[str] = field(default_factory=list)

    def describe(self) -> str:
        lines = [f"Ready to request an upload ({self.today}):",
                 f"  {self.players} players, {self.maps} map report(s) across {self.days} history day(s)",
                 "  Files:"]
        for path in sorted(self.files):
            lines.append(f"    {path}  ({len(self.files[path]):,} bytes)")
        lines.extend(f"  Note: {note}" for note in self.notes)
        lines.append("Nothing has been sent yet.")
        return "\n".join(lines)


# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------
def load_config(app_root: Path, data_root: Path) -> dict[str, Any]:
    """Merge upload-config.json files and the environment.

    Order (later wins): <app folder>/upload-config.json, <data folder>/upload-config.json,
    then CODSTATS_UPLOAD_TOKEN for the token.
    """
    config: dict[str, Any] = {"repo": "", "branch": "main", "token": ""}
    for path in (Path(app_root) / "upload-config.json", Path(data_root) / "upload-config.json"):
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(value, dict):
            for key in ("repo", "branch", "token"):
                if isinstance(value.get(key), str) and value[key].strip():
                    config[key] = value[key].strip()
    env_token = os.environ.get("CODSTATS_UPLOAD_TOKEN", "").strip()
    if env_token:
        config["token"] = env_token
    return config


def connection_problem(config: dict[str, Any]) -> str:
    """Empty string when the connection details look usable."""
    if not REPO_RE.fullmatch(str(config.get("repo", ""))):
        return "No upload repository is set. Put \"repo\": \"owner/name\" in upload-config.json."
    if not BRANCH_RE.fullmatch(str(config.get("branch", ""))):
        return "The base branch name in upload-config.json is not valid."
    if not str(config.get("token", "")).strip():
        return "No upload token is set. The league owner needs to add one to upload-config.json."
    return ""


# ----------------------------------------------------------------------------
# Building the package from local data (read-only)
# ----------------------------------------------------------------------------
def _read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise UploadError(f"Cannot read {path.name}: {exc}") from exc
    if not isinstance(value, dict):
        raise UploadError(f"Expected a JSON object in {path.name}")
    return value


def _dump(payload: Any) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def build_package(data_root: Path, today: date | None = None) -> Package:
    today = today or date.today()
    elo = Path(data_root) / "elo"
    stats = _read_object(elo / "stats.json")
    if not isinstance(stats.get("players"), dict) or not stats["players"]:
        raise UploadError("The local Elo stats have no player records, so there is nothing to upload.")

    days: list[tuple[str, dict[str, Any]]] = []
    history = elo / "history"
    if history.is_dir():
        for path in sorted(history.iterdir()):
            if not path.is_file() or not DATE_FILE.fullmatch(path.name):
                continue
            day = _read_object(path)
            try:
                date.fromisoformat(path.stem)
            except ValueError as exc:
                raise UploadError(f"Invalid history filename: {path.name}") from exc
            if day.get("date") != path.stem or not isinstance(day.get("maps"), list):
                raise UploadError(f"Invalid history date or maps in {path.name}")
            if any(not isinstance(m, dict) or not isinstance(m.get("elo"), list) for m in day["maps"]):
                raise UploadError(f"Invalid Elo map report in {path.name}")
            days.append((path.name, day))

    stats_bytes = _dump(stats)
    files: dict[str, bytes] = {
        "current_stats.json": stats_bytes,
        f"daily_stats/{today.isoformat()}.json": stats_bytes,
    }
    for name, day in days:
        files[f"history/{name}"] = _dump(day)
    index = {"days": [{"date": name[:-5], "file": name, "mapCount": len(day["maps"])}
                      for name, day in sorted(days, reverse=True)]}
    files["history/index.json"] = _dump(index)
    for path in files:
        if not ALLOWED_PATH.fullmatch(path):          # defensive: never upload anything else
            raise UploadError(f"Refusing to upload unexpected file: {path}")
    return Package(
        files=files,
        players=len(stats["players"]),
        days=len(days),
        maps=sum(len(day["maps"]) for _, day in days),
        today=today.isoformat(),
        stats_sha256=hashlib.sha256(stats_bytes).hexdigest(),
    )


# ----------------------------------------------------------------------------
# GitHub API
# ----------------------------------------------------------------------------
def _api_base() -> str:
    base = os.environ.get("CODSTATS_GITHUB_API", DEFAULT_API).rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    local = parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost")
    if not (parsed.scheme == "https" and parsed.hostname == "api.github.com") and not local:
        raise UploadError("The token can only be sent to api.github.com.")
    return base


class _GitHub:
    def __init__(self, repo: str, token: str, timeout: float = 30.0) -> None:
        self.repo, self.token, self.timeout, self.base = repo, token, timeout, _api_base()

    def call(self, method: str, path: str, payload: Any | None = None, *, raw: bool = False,
             optional: bool = False) -> Any:
        url = f"{self.base}/repos/{self.repo}{path}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github.raw+json" if raw else "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "CODStats-Desktop/3.0",
        }
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = response.read()
        except urllib.error.HTTPError as error:
            if optional and error.code == 404:
                return None
            raise UploadError(self._explain(error)) from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise UploadError(f"Could not reach GitHub: {self._scrub(str(error))}") from None
        if raw:
            return body
        return json.loads(body.decode("utf-8")) if body.strip() else None

    def _scrub(self, text: str) -> str:
        return text.replace(self.token, "***") if self.token else text

    def _explain(self, error: urllib.error.HTTPError) -> str:
        try:
            detail = json.loads(error.read().decode("utf-8", "replace")).get("message", "")
        except Exception:
            detail = ""
        hint = {
            401: "GitHub rejected the upload token (expired or wrong).",
            403: "The token is not allowed to do this (it needs Contents and Pull requests write access to this repository).",
            404: "GitHub could not find the repository, or the token has no access to it.",
            422: "GitHub refused the request.",
        }.get(error.code, f"GitHub returned an error ({error.code}).")
        return self._scrub(f"{hint} {detail}".strip())


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (slug or "client")[:30].strip("-") or "client"


def _clean(text: str, limit: int) -> str:
    return re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", text or "").strip()[:limit]


def _latest_earlier_snapshot(github: _GitHub, base: str, today: str) -> bytes | None:
    listing = github.call("GET", f"/contents/daily_stats?ref={urllib.parse.quote(base)}", optional=True)
    if not isinstance(listing, list):
        return None
    dates = sorted(item["name"][:-5] for item in listing
                   if isinstance(item, dict) and DATE_FILE.fullmatch(str(item.get("name", "")))
                   and item["name"][:-5] < today)
    if not dates:
        return None
    return github.call("GET", f"/contents/daily_stats/{dates[-1]}.json?ref={urllib.parse.quote(base)}", raw=True)


def send_package(config: dict[str, Any], package: Package, requester: str, note: str = "",
                 progress: Callable[[str], None] = lambda _message: None,
                 now: datetime | None = None) -> dict[str, Any]:
    """Create branch + pull request. Returns {"status", "pullRequestUrl", "branch", ...}."""
    problem = connection_problem(config)
    if problem:
        raise UploadError(problem)
    requester, note = _clean(requester, 60), _clean(note, 500)
    if not requester:
        raise UploadError("Enter your name so the owner knows who sent this.")
    github = _GitHub(config["repo"], config["token"])
    base = config["branch"]
    files = dict(package.files)

    progress("Checking the repository…")
    head = github.call("GET", f"/git/ref/heads/{urllib.parse.quote(base, safe='/')}")
    base_sha = head["object"]["sha"]
    base_tree = github.call("GET", f"/git/commits/{base_sha}")["tree"]["sha"]

    try:
        previous = _latest_earlier_snapshot(github, base, package.today)
    except UploadError:
        previous = None
    if previous is not None:
        files["previous_stats.json"] = previous
    else:
        package.notes.append("previous_stats.json was not changed (no earlier daily snapshot found).")

    progress(f"Uploading {len(files)} files…")
    entries = []
    for path in sorted(files):
        if not ALLOWED_PATH.fullmatch(path):
            raise UploadError(f"Refusing to upload unexpected file: {path}")
        blob = github.call("POST", "/git/blobs", {
            "content": base64.b64encode(files[path]).decode("ascii"), "encoding": "base64"})
        entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    tree = github.call("POST", "/git/trees", {"base_tree": base_tree, "tree": entries})
    if tree["sha"] == base_tree:
        return {"status": "unchanged", "message": "GitHub already has exactly these stats. Nothing to upload."}

    when = (now or datetime.now(timezone.utc)).strftime("%Y%m%d-%H%M%S")
    branch = f"{BRANCH_PREFIX}{_slug(requester)}-{when}"
    title = f"Stats upload from {requester} ({package.today})"
    commit = github.call("POST", "/git/commits", {
        "message": f"{title}\n\n{package.players} players, {package.maps} map report(s), {package.days} history day(s).",
        "tree": tree["sha"], "parents": [base_sha]})
    if not branch.startswith(BRANCH_PREFIX):
        raise UploadError("Internal safety check failed: unexpected branch name.")
    github.call("POST", "/git/refs", {"ref": f"refs/heads/{branch}", "sha": commit["sha"]})

    progress("Opening the pull request…")
    body = "\n".join([
        f"Requested by **{requester}** on {package.today}.",
        "",
        f"- {package.players} players, {package.maps} map report(s), {package.days} history day(s)",
        f"- current_stats.json SHA-256: `{package.stats_sha256}`",
        *( [f"- Note: {note}"] if note else [] ),
        "",
        "Sent from the CODStats desktop app. Review the changes, then merge, or pull this branch in GitHub Desktop and commit.",
    ])
    try:
        pull = github.call("POST", "/pulls", {"title": title, "head": branch, "base": base, "body": body})
    except UploadError as error:
        return {"status": "branch-only", "branch": branch,
                "message": f"The files were uploaded to the branch {branch}, but the pull request could not be opened: {error}"}
    return {"status": "ok", "branch": branch, "pullRequestUrl": pull.get("html_url", ""),
            "message": f"Upload requested. The owner can review it here:\n{pull.get('html_url', '')}"}
