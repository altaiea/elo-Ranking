"""Convert detailed OCR results into the EloSystem v2.1 import contract."""
from __future__ import annotations

from datetime import date as date_type
from typing import Any, Iterable


MODE_NAMES = {
    "Hardpoint": "Hardpoint",
    "Search and Destroy": "SND",
    "SND": "SND",
    "Overload": "Overload",
}


class EloExportError(ValueError):
    """Raised when an OCR result cannot safely satisfy the Elo contract."""


def _overtime_value(team: dict[str, Any]) -> str:
    seconds = team.get("seconds")
    if seconds is None:
        return "DNF"
    whole_seconds = int(round(float(seconds)))
    minutes, remainder = divmod(whole_seconds, 60)
    return f"{minutes}:{remainder:02d}"


def _elo_players(result: dict[str, Any], team_key: str) -> list[dict[str, int]]:
    players = []
    for player in result.get("players", []):
        if player.get("team") != team_key:
            continue
        registry_id = player.get("registryId")
        kills = player.get("eliminations")
        deaths = player.get("deaths")
        if registry_id is None or kills is None or deaths is None:
            continue
        players.append({
            "playerId": int(registry_id),
            "kills": int(kills),
            "deaths": int(deaths),
        })
    players.sort(key=lambda player: player["playerId"])
    if len(players) != 4:
        label = "A" if team_key == "teamA" else "B"
        raise EloExportError(f"Team {label} does not contain four complete players")
    return players


def convert_game(result: dict[str, Any]) -> dict[str, Any]:
    """Convert one complete video result to one EloSystem game object."""
    source = str(result.get("source") or "").strip()
    if not source:
        raise EloExportError("Source filename is missing")
    mode_value = (result.get("mode") or {}).get("value")
    game_mode = MODE_NAMES.get(mode_value)
    if game_mode is None:
        raise EloExportError(f"Unsupported or unresolved game mode: {mode_value}")

    team_a = _elo_players(result, "teamA")
    team_b = _elo_players(result, "teamB")
    player_ids = [player["playerId"] for player in team_a + team_b]
    if len(set(player_ids)) != 8:
        raise EloExportError("The game does not contain eight unique registry IDs")

    mode_score = result.get("modeScore") or {}
    overtime = mode_score.get("overtime")
    if overtime and overtime.get("active"):
        if game_mode != "Overload":
            raise EloExportError("Overtime is only valid for Overload")
        winner_key = overtime.get("winner")
        if winner_key not in {"teamA", "teamB"}:
            raise EloExportError("Overload overtime winner is unresolved")
        elo_result = {
            "type": "overtime",
            "overtime": {
                "teamA": _overtime_value(overtime.get("teamA") or {}),
                "teamB": _overtime_value(overtime.get("teamB") or {}),
            },
            "winningTeam": 1 if winner_key == "teamA" else 2,
            "scoreDifference": 1,
        }
    else:
        score_a, score_b = mode_score.get("teamA"), mode_score.get("teamB")
        if score_a is None or score_b is None:
            raise EloExportError("Team score is unresolved")
        score_a, score_b = int(score_a), int(score_b)
        if score_a == score_b:
            raise EloExportError("A tied score cannot be imported")
        elo_result = {
            "type": "score",
            "score": {"teamA": score_a, "teamB": score_b},
            "winningTeam": 1 if score_a > score_b else 2,
            "scoreDifference": abs(score_a - score_b),
        }

    return {
        "source": source,
        "gameMode": game_mode,
        "result": elo_result,
        "teams": {"A": team_a, "B": team_b},
    }


def build_elo_document(
    results: Iterable[dict[str, Any]], match_date: str
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Build one schema-v1 document and report results that were unsafe to export."""
    try:
        date_type.fromisoformat(match_date)
    except ValueError as error:
        raise EloExportError("Date must use YYYY-MM-DD format") from error

    games: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    sources: set[str] = set()
    for result in results:
        source = str(result.get("source") or "UNRESOLVED")
        try:
            game = convert_game(result)
            source_key = game["source"].lower()
            if source_key in sources:
                raise EloExportError("Duplicate source filename")
            sources.add(source_key)
            games.append(game)
        except EloExportError as error:
            skipped.append({"source": source, "reason": str(error)})
    return {"schemaVersion": 1, "date": match_date, "games": games}, skipped
