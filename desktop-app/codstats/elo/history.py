"""Per-day map history (history/YYYY-MM-DD.json), index.json and summary.json.

Same format the Java MapHistoryStorage wrote and the website reads. The
summary is the light copy the site uses for its leaderboard arrows, Teams,
Duo network and Monthly tabs (no calculation traces).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .stats import write_json_atomic

DAY_FILE = re.compile(r"^\d{4}-\d{2}-\d{2}\.json$")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_day(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def day_files(directory: Path) -> list[Path]:
    if not directory.exists():
        return []
    return sorted(path for path in directory.iterdir() if path.is_file() and DAY_FILE.match(path.name))


def build_index(directory: Path) -> dict[str, Any]:
    days = []
    for path in sorted(day_files(directory), reverse=True):
        try:
            day = read_day(path)
        except (OSError, ValueError):
            continue
        item = {"date": day.get("date") or path.stem, "file": path.name, "mapCount": len(day.get("maps") or [])}
        if day.get("updatedAt"):
            item["updatedAt"] = day["updatedAt"]
        days.append(item)
    return {"days": days, "updatedAt": now_iso()}


def build_summary(directory: Path) -> dict[str, Any]:
    days = []
    for path in day_files(directory):
        try:
            day = read_day(path)
        except (OSError, ValueError):
            continue
        maps = []
        for item in day.get("maps") or []:
            game = item.get("game") or {}
            maps.append({
                "mapId": item.get("mapId"), "date": item.get("date") or day.get("date"),
                "gameMode": item.get("gameMode") or game.get("gameMode"),
                "game": {"result": game.get("result"), "teams": game.get("teams")},
                "elo": [{key: row.get(key) for key in ("playerId", "before", "change", "after")}
                        for row in item.get("elo") or []],
            })
        opening = {key: (value or {}).get("elo") for key, value in (day.get("openingStats") or {}).items()}
        days.append({"date": day.get("date") or path.stem, "mapCount": len(maps), "openingElo": opening, "maps": maps})
    return {"version": 1, "days": days}


def write_index_and_summary(directory: Path) -> None:
    write_json_atomic(directory / "index.json", build_index(directory))
    write_json_atomic(directory / "summary.json", build_summary(directory), indent=None)


class HistoryStore:
    def __init__(self, directory: Path) -> None:
        self.directory = Path(directory)

    def known_map_ids(self) -> set[str]:
        ids = set()
        for path in day_files(self.directory):
            try:
                ids.update(str(item.get("mapId")) for item in read_day(path).get("maps") or [])
            except (OSError, ValueError):
                continue
        return ids

    def add_maps(self, date: str, opening: dict, reports: list[dict], closing: dict) -> None:
        """Append map reports to one day file (written once, atomically)."""
        path = self.directory / f"{date}.json"
        day = read_day(path) if path.exists() else {}
        day.setdefault("date", date)
        day.setdefault("openingStats", opening)
        maps = list(day.get("maps") or [])
        existing = {item.get("mapId") for item in maps}
        maps.extend(report for report in reports if report["mapId"] not in existing)
        day["maps"] = maps
        day["closingStats"] = closing
        day["updatedAt"] = now_iso()
        write_json_atomic(path, day)
        write_index_and_summary(self.directory)
