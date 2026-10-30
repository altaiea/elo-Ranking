"""Writes history/summary.json, a small copy of the map history for the website.

The day files in history/ hold every map with its full Elo calculation trace,
which is most of their size. The leaderboard arrows, Teams chemistry, the Duo
network and Monthly rankings only need who played, who won and each player's
Elo before and after, so this file keeps just that (about 30 times smaller).

The site checks summary.json against history/index.json (same dates and map
counts). If it is missing or out of date the site reads the day files instead,
so this file only ever makes the site faster, never wrong.

    python tools/build_history_summary.py            # uses ./history
    python tools/build_history_summary.py path/to/history
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

DATE_FILE = re.compile(r"^\d{4}-\d{2}-\d{2}\.json$")
SUMMARY_VERSION = 1


def _opening_elo(opening: Any) -> dict[str, float]:
    if not isinstance(opening, dict):
        return {}
    out: dict[str, float] = {}
    for player_id, stats in opening.items():
        elo = stats.get("elo") if isinstance(stats, dict) else None
        if isinstance(elo, (int, float)):
            out[str(player_id)] = elo
    return out


def _map_summary(item: dict[str, Any]) -> dict[str, Any]:
    game = item.get("game") if isinstance(item.get("game"), dict) else {}
    return {
        "mapId": item.get("mapId"),
        "date": item.get("date"),
        "gameMode": item.get("gameMode") or game.get("gameMode"),
        "game": {"result": game.get("result"), "teams": game.get("teams")},
        "elo": [
            {key: row.get(key) for key in ("playerId", "before", "change", "after")}
            for row in item.get("elo") or [] if isinstance(row, dict)
        ],
    }


def build_summary(history_dir: Path) -> dict[str, Any]:
    days = []
    for path in sorted(history_dir.iterdir()):
        if not DATE_FILE.fullmatch(path.name):
            continue
        day = json.loads(path.read_text(encoding="utf-8"))
        maps = [m for m in day.get("maps") or [] if isinstance(m, dict)]
        days.append({
            "date": day.get("date") or path.stem,
            "mapCount": len(maps),
            "openingElo": _opening_elo(day.get("openingStats")),
            "maps": [_map_summary(m) for m in maps],
        })
    return {"version": SUMMARY_VERSION, "days": days}


def write_summary(history_dir: Path) -> Path:
    target = history_dir / "summary.json"
    data = build_summary(history_dir)
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    tmp.replace(target)          # never leave a half-written file behind
    return target


if __name__ == "__main__":
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "history"
    written = write_summary(folder)
    print(f"Wrote {written} ({written.stat().st_size // 1024} KB)")
