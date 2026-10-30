"""Interactive correction of parsed video results before Elo export."""
from __future__ import annotations

from typing import Any, Callable

from .elo_exporter import EloExportError, convert_game


InputFunction = Callable[[str], str]
OutputFunction = Callable[[str], None]


def _ask_int(
    prompt: str,
    input_function: InputFunction,
    output: OutputFunction,
    default: int | None = None,
) -> int:
    while True:
        suffix = f" [{default}]" if default is not None else ""
        raw = input_function(f"{prompt}{suffix}: ").strip()
        if not raw and default is not None:
            return default
        try:
            value = int(raw)
            if value >= 0:
                return value
        except ValueError:
            pass
        output("Enter a whole number of zero or greater.")


def _parse_manual_overtime(raw: str) -> tuple[str, float | None]:
    value = raw.strip().upper()
    if value in {"-", "DNF"}:
        return "DNF", None
    pieces = value.split(":")
    if len(pieces) != 2:
        raise ValueError("Use M:SS or DNF")
    minutes, seconds = int(pieces[0]), int(pieces[1])
    if minutes < 0 or not 0 <= seconds < 60:
        raise ValueError("Use M:SS or DNF")
    return f"{minutes}:{seconds:02d}", float(minutes * 60 + seconds)


def set_standard_score(result: dict[str, Any], team_a: int, team_b: int) -> None:
    if team_a == team_b:
        raise ValueError("A completed map cannot have a tied ordinary score")
    existing = result.get("modeScore") or {}
    result["modeScore"] = {
        "teamAName": existing.get("teamAName") or "GUILD",
        "teamA": team_a,
        "teamBName": existing.get("teamBName") or "JSOC",
        "teamB": team_b,
        "difference": team_a - team_b,
        "confidence": 1.0,
        "overtime": None,
        "manuallyValidated": True,
    }


def set_overtime_result(result: dict[str, Any], team_a_raw: str, team_b_raw: str) -> None:
    team_a_text, team_a_seconds = _parse_manual_overtime(team_a_raw)
    team_b_text, team_b_seconds = _parse_manual_overtime(team_b_raw)
    if team_a_seconds is None and team_b_seconds is None:
        raise ValueError("Both teams cannot be DNF")
    if team_a_seconds is not None and team_b_seconds is not None:
        if team_a_seconds == team_b_seconds:
            raise ValueError("Overtime times cannot be equal")
        winner = "teamA" if team_a_seconds < team_b_seconds else "teamB"
    else:
        winner = "teamA" if team_a_seconds is not None else "teamB"
    existing = result.get("modeScore") or {}
    difference = 1 if winner == "teamA" else -1
    result["modeScore"] = {
        "teamAName": existing.get("teamAName") or "GUILD",
        "teamA": existing.get("teamA"),
        "teamBName": existing.get("teamBName") or "JSOC",
        "teamB": existing.get("teamB"),
        "difference": difference,
        "confidence": 1.0,
        "overtime": {
            "active": True,
            "teamA": {"raw": team_a_text, "seconds": team_a_seconds,
                      "status": "time" if team_a_seconds is not None else "dnf"},
            "teamB": {"raw": team_b_text, "seconds": team_b_seconds,
                      "status": "time" if team_b_seconds is not None else "dnf"},
            "winner": winner,
            "difference": difference,
        },
        "manuallyValidated": True,
    }


def _rebuild_rosters(result: dict[str, Any]) -> None:
    if not isinstance(result.get("teams"), dict):
        result["teams"] = {}
    teams = result["teams"]
    for key, default_name in (("teamA", "GUILD"), ("teamB", "JSOC")):
        if not isinstance(teams.get(key), dict):
            teams[key] = {"name": default_name, "nameConfidence": 1.0}
        team = teams[key]
        members = [player for player in result.get("players", []) if player.get("team") == key]
        members.sort(key=lambda player: player.get("registryId") or 9999)
        team["players"] = [
            {
                "row": row,
                "name": member.get("name"),
                "registryId": member.get("registryId"),
                "resolved": member.get("registryId") is not None,
                "ocrConfidence": member.get("confidence", {}).get("id", 1.0),
                "registrySimilarity": 1.0,
                "manuallyValidated": bool(member.get("manuallyValidated")),
            }
            for row, member in enumerate(members[:4], start=1)
        ]
        while len(team["players"]) < 4:
            team["players"].append({
                "row": len(team["players"]) + 1,
                "name": None,
                "registryId": None,
                "resolved": False,
            })


def _edit_player(
    result: dict[str, Any],
    registry: list[dict[str, Any]],
    input_function: InputFunction,
    output: OutputFunction,
) -> None:
    players = result.setdefault("players", [])
    output("\nPlayer records:")
    for index, player in enumerate(players, start=1):
        output(
            f"  {index}. {player.get('id') or player.get('name') or 'UNRESOLVED'} | "
            f"{player.get('team') or 'no team'} | "
            f"{player.get('eliminations')}/{player.get('deaths')}"
        )
    raw_index = input_function("Entry number to edit, or A to add a missing player: ").strip()
    if raw_index.lower() == "a":
        player: dict[str, Any] = {}
        players.append(player)
    else:
        try:
            index = int(raw_index) - 1
            player = players[index]
        except (ValueError, IndexError):
            output("That player entry does not exist.")
            return

    registry_by_id = {int(item["id"]): item for item in registry}
    current_registry_id = player.get("registryId")
    while True:
        registry_id = _ask_int("Registry player ID", input_function, output, current_registry_id)
        if registry_id in registry_by_id:
            break
        output("That ID is not present in player_registry.json.")
    registry_player = registry_by_id[registry_id]
    default_team = "B" if player.get("team") == "teamB" else "A"
    while True:
        team = input_function(f"Team A or B [{default_team}]: ").strip().upper() or default_team
        if team in {"A", "B"}:
            break
        output("Enter A or B.")
    eliminations = _ask_int(
        "Eliminations", input_function, output, player.get("eliminations")
    )
    deaths = _ask_int("Deaths", input_function, output, player.get("deaths"))
    default_full_id = player.get("id") or registry_player["codName"]
    full_id = input_function(f"Full displayed ID [{default_full_id}]: ").strip() or default_full_id
    player.update({
        "team": "teamA" if team == "A" else "teamB",
        "name": registry_player["codName"],
        "id": full_id,
        "registryId": registry_id,
        "eliminations": eliminations,
        "deaths": deaths,
        "confidence": {"id": 1.0, "eliminations": 1.0, "deaths": 1.0},
        "supportingFrames": player.get("supportingFrames", 0),
        "manuallyValidated": True,
    })
    # A registry player may occur only once.
    result["players"] = [
        item for item in players
        if item is player or item.get("registryId") != registry_id
    ]
    result["players"].sort(
        key=lambda item: (item.get("team") or "teamZ", item.get("registryId") or 9999)
    )
    _rebuild_rosters(result)


def review_video_result(
    result: dict[str, Any],
    registry: list[dict[str, Any]],
    show_result: Callable[[dict[str, Any]], None],
    input_function: InputFunction = input,
    output: OutputFunction = print,
) -> dict[str, Any]:
    """Let the operator correct every Elo-relevant value for one video."""
    accepted = input_function("Are all parsed values correct? [Y/n]: ").strip().lower()
    if accepted in {"", "y", "yes"}:
        return result

    while True:
        output("\nCorrect: 1) mode  2) score/result  3) player/stat  4) show  5) finish")
        choice = input_function("Choose an option: ").strip()
        if choice == "1":
            modes = {"1": "Hardpoint", "2": "Search and Destroy", "3": "Overload"}
            selected = input_function("1) Hardpoint  2) Search and Destroy  3) Overload: ").strip()
            if selected in modes:
                result["mode"] = {"value": modes[selected], "confidence": 1.0,
                                  "manuallyValidated": True}
            else:
                output("Invalid mode selection.")
        elif choice == "2":
            mode = (result.get("mode") or {}).get("value")
            kind = "score"
            if mode == "Overload":
                kind = input_function("Standard score or overtime? [score/overtime]: ").strip().lower()
            try:
                if kind in {"overtime", "ot"}:
                    team_a = input_function("Team A overtime (M:SS or DNF): ")
                    team_b = input_function("Team B overtime (M:SS or DNF): ")
                    set_overtime_result(result, team_a, team_b)
                else:
                    current = result.get("modeScore") or {}
                    team_a = _ask_int("Team A score", input_function, output, current.get("teamA"))
                    team_b = _ask_int("Team B score", input_function, output, current.get("teamB"))
                    set_standard_score(result, team_a, team_b)
            except ValueError as error:
                output(str(error))
        elif choice == "3":
            _edit_player(result, registry, input_function, output)
        elif choice == "4":
            show_result(result)
        elif choice == "5":
            break
        else:
            output("Choose 1, 2, 3, 4 or 5.")

    try:
        convert_game(result)
        result["complete"] = True
        output("Validation complete: this video is ready for EloSystem.")
    except EloExportError as error:
        result["complete"] = False
        output(f"Validation incomplete: {error}")
    show_result(result)
    return result
