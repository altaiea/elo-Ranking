"""Prepare approved CODStats JSON for a local GitHub Desktop website checkout.

No Elo arithmetic is performed here. Monthly rankings are derived by the site's
existing History/Monthly Rankings JavaScript from the dated map reports.
"""
from __future__ import annotations

import json
import os
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from .elo.history import build_summary

DATE_FILE = re.compile(r"^\d{4}-\d{2}-\d{2}\.json$")

class ExportError(RuntimeError):
    pass


def looks_like_site_repo(folder: Path) -> bool:
    return (folder / "index.html").is_file() and (folder / "script.js").is_file() and (folder / ".git").exists()


def suggest_repos(app_root: Path) -> list[Path]:
    """Likely local clones of the site, best first: the repo this app runs from, then GitHub Desktop's default."""
    documents = Path.home() / "Documents" / "GitHub"
    candidates = [app_root.parent]
    if documents.is_dir():
        candidates += sorted(path for path in documents.iterdir() if "elo" in path.name.lower())
    return [path.resolve() for path in candidates if looks_like_site_repo(path)]


def github_desktop_url(repo: Path) -> str:
    """Opens the repo in GitHub Desktop (its registered x-github-client:// link)."""
    return "x-github-client://openLocalRepo/" + str(repo).replace(os.sep, "/")


def read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ExportError(f"Cannot read {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ExportError(f"Expected a JSON object in {path}")
    return value


def prepare_export(*, data_root: Path, repo: Path, today: date | None = None) -> dict[str, Any]:
    """Validate inputs and return a manifest; does not write to the repository."""
    today = today or date.today()
    stats_path = data_root / "elo" / "stats.json"
    history_dir = data_root / "elo" / "history"
    stats = read_object(stats_path)
    if not isinstance(stats.get("players"), dict) or not stats["players"]:
        raise ExportError("The current local Elo stats have no player records. Nothing was exported.")
    if not (repo / "index.html").is_file() or not (repo / "script.js").is_file():
        raise ExportError("Choose your local GitHub Desktop website repository (the folder with index.html and script.js).")
    if not (repo / ".git").exists():
        raise ExportError("This folder is not a Git checkout. Choose the local folder opened in GitHub Desktop.")

    days: list[tuple[Path, dict[str, Any]]] = []
    if history_dir.exists():
        for path in sorted(history_dir.iterdir()):
            if not path.is_file() or not DATE_FILE.fullmatch(path.name):
                continue
            day = read_object(path)
            try:
                date.fromisoformat(path.stem)
            except ValueError as exc:
                raise ExportError(f"Invalid history filename: {path.name}") from exc
            if day.get("date") != path.stem or not isinstance(day.get("maps"), list):
                raise ExportError(f"Invalid history date or maps in {path.name}")
            if any(not isinstance(item, dict) or not isinstance(item.get("elo"), list) for item in day["maps"]):
                raise ExportError(f"Invalid Elo map report in {path.name}")
            days.append((path, day))

    # Each publication creates one dated snapshot of approved statistics.
    # Choose the latest *earlier* publication for the daily comparison; never
    # use today's snapshot, even if the user exports more than once today.
    daily_dir = repo / "daily_stats"
    earlier: list[tuple[date, Path]] = []
    if daily_dir.exists():
        for path in daily_dir.iterdir():
            if not path.is_file() or not DATE_FILE.fullmatch(path.name):
                continue
            try:
                snapshot_date = date.fromisoformat(path.stem)
            except ValueError as exc:
                raise ExportError(f"Invalid daily snapshot filename: {path.name}") from exc
            if snapshot_date < today:
                earlier.append((snapshot_date, path))
    previous_stats = None
    previous_source = "none"
    if earlier:
        last_date, last_path = max(earlier, key=lambda item: item[0])
        previous_stats = read_object(last_path)
        previous_source = f"daily_stats/{last_date.isoformat()}.json"
    else:
        # Compatibility with installations that predate daily_stats/.
        journal_path = data_root / "github-desktop-export-state.json"
        journal = read_object(journal_path) if journal_path.exists() else {}
        yesterday = (today - timedelta(days=1)).isoformat()
        previous_path = data_root / "elo" / "previous_stats.json"
        if journal.get("date") == yesterday and isinstance(journal.get("stats"), dict):
            previous_stats = journal["stats"]
            previous_source = "yesterday_export"
        elif previous_path.exists():
            previous_stats = read_object(previous_path)
            previous_source = "existing_previous"
        elif (repo / "previous_stats.json").exists():
            previous_stats = read_object(repo / "previous_stats.json")
            previous_source = "existing_previous"
    return {"stats": stats, "days": days, "previous": previous_stats,
            "previous_source": previous_source,
            "journal_path": data_root / "github-desktop-export-state.json",
            "today": today.isoformat(), "repo": repo}


def write_export(manifest: dict[str, Any]) -> dict[str, Any]:
    """Copy validated JSON into the checkout without changing local Elo data."""
    repo: Path = manifest["repo"]
    history_dir = repo / "history"
    history_dir.mkdir(parents=True, exist_ok=True)
    def write_json(path: Path, payload: dict[str, Any]) -> None:
        temp = path.with_name(path.name + ".codstats-tmp")
        temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp.replace(path)
    # A valid stats snapshot is required; do not reset the approved copy to empty.
    daily_dir = repo / "daily_stats"
    daily_dir.mkdir(parents=True, exist_ok=True)
    # One snapshot per publication date. A second export that day updates it.
    write_json(daily_dir / f"{manifest['today']}.json", manifest["stats"])
    write_json(repo / "current_stats.json", manifest["stats"])
    if manifest["previous"] is not None:
        write_json(repo / "previous_stats.json", manifest["previous"])

    # GitHub sync explicitly resets local history to the approved GitHub set.
    # Drop obsolete *dated* map files so tests removed by a sync cannot linger
    # on the live site. Other repository files are left alone.
    expected = {path.name for path, _ in manifest["days"]}
    for stale in history_dir.glob("????-??-??.json"):
        if DATE_FILE.fullmatch(stale.name) and stale.name not in expected:
            stale.unlink()
    for path, day in manifest["days"]:
        write_json(history_dir / path.name, day)
    index = {"days": [{"date": path.stem, "file": path.name, "mapCount": len(day["maps"])}
                       for path, day in sorted(manifest["days"], reverse=True)]}
    write_json(history_dir / "index.json", index)
    # Light copy for the site's leaderboard arrows, Teams, Duo and Monthly tabs.
    summary = build_summary(history_dir)
    temp = history_dir / "summary.json.codstats-tmp"
    temp.write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temp.replace(history_dir / "summary.json")

    # Record the export date and original precise ratings for *next day's*
    # previous_stats.json. Repeated exports today leave yesterday unchanged.
    write_json(manifest["journal_path"],
               {"date": manifest["today"], "stats": manifest["stats"]})
    return {"history_days": len(manifest["days"]),
            "maps": sum(len(day["maps"]) for _, day in manifest["days"]),
            "daily_snapshot": manifest["today"],
            "previous_source": manifest["previous_source"]}
