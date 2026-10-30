"""Second duplicate check: the same map recorded by two people.

Two recordings of one map are never byte-identical, so after the parse this
looks for results with the same mode, the exact same score and the same
eliminations/deaths for every player read in both. Matches are only
suspects: the user confirms each one.
"""
from __future__ import annotations

from typing import Any, Iterable

MIN_SHARED_PLAYERS = 4


def _mode(result: dict[str, Any]) -> str | None:
    value = (result.get("mode") or {}).get("value")
    return {"Search and Destroy": "SND"}.get(value, value)


def _score(result: dict[str, Any]) -> tuple | None:
    score = result.get("modeScore") or {}
    overtime = score.get("overtime") or {}
    if overtime.get("active"):
        return ("OT", (overtime.get("teamA") or {}).get("raw"), (overtime.get("teamB") or {}).get("raw"))
    if score.get("teamA") is None or score.get("teamB") is None:
        return None
    return (int(score["teamA"]), int(score["teamB"]))


def _lines(result: dict[str, Any]) -> dict[int, tuple[int, int]]:
    lines = {}
    for player in result.get("players") or []:
        pid, kills, deaths = player.get("registryId"), player.get("eliminations"), player.get("deaths")
        if pid is not None and kills is not None and deaths is not None:
            lines[int(pid)] = (int(kills), int(deaths))
    return lines


def same_map(first: dict[str, Any], second: dict[str, Any]) -> bool:
    if _mode(first) != _mode(second):
        return False
    score = _score(first)
    if score is None or score != _score(second):
        return False
    a, b = _lines(first), _lines(second)
    shared = set(a) & set(b)
    if len(shared) < MIN_SHARED_PLAYERS:
        # Not enough readable players to compare; the score alone is too weak
        # for Hardpoint, but SnD/Overload scores collide often, so require stats.
        return False
    return all(a[pid] == b[pid] for pid in shared)


def history_as_result(report: dict[str, Any]) -> dict[str, Any]:
    """Turn a saved history map into the OCR-result shape compared above."""
    game = report.get("game") or {}
    result = game.get("result") or {}
    raw_mode = report.get("gameMode") or game.get("gameMode")
    mode = {"SND": "Search and Destroy"}.get(raw_mode, raw_mode)
    if result.get("type") == "overtime":
        overtime = result.get("overtime") or {}
        mode_score = {"overtime": {"active": True, "teamA": {"raw": overtime.get("teamA")},
                                   "teamB": {"raw": overtime.get("teamB")}}}
    else:
        mode_score = dict(result.get("score") or {})
    players = [{"registryId": p["playerId"], "eliminations": p["kills"], "deaths": p["deaths"]}
               for side in ("A", "B") for p in (game.get("teams") or {}).get(side) or []]
    return {"source": report.get("source"), "mode": {"value": mode}, "modeScore": mode_score, "players": players}


def find_suspects(results: list[dict[str, Any]], history: Iterable[dict[str, Any]] = ()) -> list[tuple[int, Any]]:
    """Return (index, other) pairs: other is an earlier index in results, or a history report."""
    suspects: list[tuple[int, Any]] = []
    saved = [(report, history_as_result(report)) for report in history]
    for index, result in enumerate(results):
        if result.get("droppedAsDuplicate"):
            continue
        for earlier in range(index):
            if not results[earlier].get("droppedAsDuplicate") and same_map(results[earlier], result):
                suspects.append((index, earlier))
                break
        else:
            for report, shape in saved:
                if same_map(shape, result):
                    suspects.append((index, report))
                    break
    return suspects
