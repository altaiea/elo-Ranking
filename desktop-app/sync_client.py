from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


class SyncError(RuntimeError):
    pass


def _request_json(url: str, *, method: str = "GET", payload: Any | None = None, token: str = "", timeout: float = 15.0) -> Any:
    data = None
    headers = {"Accept": "application/json", "User-Agent": "CODStats-Desktop/3.0"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as error:
        try:
            detail = error.read().decode("utf-8", errors="replace")
        except Exception:
            detail = ""
        raise SyncError(f"HTTP {error.code}: {detail or error.reason}") from error
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        raise SyncError(str(error)) from error


def join_url(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + "/" + path.lstrip("/")


def fetch_current_stats(base_url: str) -> dict:
    data = _request_json(join_url(base_url, "/api/v1/stats/current"))
    if not isinstance(data, dict) or not isinstance(data.get("players"), dict):
        raise SyncError("The server did not return a valid stats document.")
    return data


def fetch_latest_days(base_url: str, limit: int = 30) -> dict:
    data = _request_json(join_url(base_url, f"/api/v1/history/days?limit={int(limit)}"))
    return data if isinstance(data, dict) else {"days": []}


def publish_snapshot(base_url: str, stats: dict, token: str) -> dict:
    data = _request_json(join_url(base_url, "/api/v1/publish/snapshot"), method="POST", payload=stats, token=token)
    return data if isinstance(data, dict) else {}


def publish_day(base_url: str, day: dict, token: str) -> dict:
    data = _request_json(join_url(base_url, "/api/v1/publish/day"), method="POST", payload=day, token=token)
    return data if isinstance(data, dict) else {}


def local_only_imports(local: dict, remote: dict) -> list[str]:
    local_games = local.get("importedGames") or {}
    remote_games = remote.get("importedGames") or {}
    return sorted(key for key, fingerprint in local_games.items() if remote_games.get(key) != fingerprint)


def safely_replace_stats(local_path: Path, remote: dict) -> Path | None:
    local_path.parent.mkdir(parents=True, exist_ok=True)
    backup = None
    if local_path.exists():
        backup = local_path.with_name("stats.before-sync.json")
        backup.write_bytes(local_path.read_bytes())
    temp = local_path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(remote, indent=2) + "\n", encoding="utf-8")
    temp.replace(local_path)
    return backup


def fetch_optional_json(url: str) -> dict | None:
    """Fetch a JSON document, returning None only when the remote file does not exist."""
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "CODStats-Desktop/3.0"}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15.0) as response:
            raw = response.read().decode("utf-8")
            if not raw.strip():
                return None
            data = json.loads(raw)
            return data if isinstance(data, dict) else None
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        try:
            detail = error.read().decode("utf-8", errors="replace")
        except Exception:
            detail = ""
        raise SyncError(f"HTTP {error.code}: {detail or error.reason}") from error
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        raise SyncError(str(error)) from error


def fetch_github_dataset(base_url: str) -> tuple[dict | None, dict | None, dict | None, dict[str, dict]]:
    """Read the website's current, previous and map-history JSON directly from GitHub/Pages.

    base_url may be either a raw GitHub folder URL or the deployed GitHub Pages/site root.
    Missing files are treated as an empty starting point, as requested by the desktop workflow.
    """
    root = base_url.rstrip("/")
    current = fetch_optional_json(join_url(root, "current_stats.json"))
    previous = fetch_optional_json(join_url(root, "previous_stats.json"))
    history_index = fetch_optional_json(join_url(root, "history/index.json"))
    days: dict[str, dict] = {}
    if isinstance(history_index, dict):
        for item in history_index.get("days") or []:
            if isinstance(item, str):
                date_text, file_name = item, f"{item}.json"
            elif isinstance(item, dict):
                date_text = str(item.get("date") or "")
                file_name = str(item.get("file") or (f"{date_text}.json" if date_text else ""))
            else:
                continue
            if not date_text or not file_name:
                continue
            payload = fetch_optional_json(join_url(root, f"history/{file_name}"))
            if isinstance(payload, dict):
                days[file_name] = payload
    return current, previous, history_index, days


def replace_with_github_dataset(*, stats_path: Path, previous_path: Path, history_root: Path,
                                current: dict | None, previous: dict | None,
                                history_index: dict | None, days: dict[str, dict]) -> dict:
    """Replace local league state from the approved GitHub copy, without local backups."""
    stats_path.parent.mkdir(parents=True, exist_ok=True)
    history_root.mkdir(parents=True, exist_ok=True)

    if current is None:
        stats_path.unlink(missing_ok=True)
    else:
        temp = stats_path.with_suffix(".json.tmp")
        temp.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
        temp.replace(stats_path)

    if previous is None:
        previous_path.unlink(missing_ok=True)
    else:
        temp = previous_path.with_suffix(".json.tmp")
        temp.write_text(json.dumps(previous, indent=2) + "\n", encoding="utf-8")
        temp.replace(previous_path)

    for existing in history_root.glob("*.json"):
        existing.unlink(missing_ok=True)
    if isinstance(history_index, dict):
        (history_root / "index.json").write_text(json.dumps(history_index, indent=2) + "\n", encoding="utf-8")
    for file_name, payload in days.items():
        (history_root / Path(file_name).name).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    return {
        "current": current is not None,
        "previous": previous is not None,
        "historyDays": len(days),
    }
