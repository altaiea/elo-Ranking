"""Presentation-only terminal helpers modelled on the original Codstats CLI."""
from __future__ import annotations

import os
import sys
from typing import Any


_COLOUR_ENABLED = sys.stdout.isatty() and not os.environ.get("NO_COLOR")


def _ansi(code: str, value: object, close: str = "39") -> str:
    text = str(value)
    return f"\033[{code}m{text}\033[{close}m" if _COLOUR_ENABLED else text


def success(value: object) -> str:
    return _ansi("32", value)


def warning(value: object) -> str:
    return _ansi("33", value)


def danger(value: object) -> str:
    return _ansi("31", value)


def accent(value: object) -> str:
    return _ansi("36", value)


def heading(value: object) -> str:
    return _ansi("1;36", value, "22;39")


def muted(value: object) -> str:
    return _ansi("2", value, "22")


def section_divider(width: int = 88) -> str:
    return _ansi("94", "─" * width)


def major_divider(width: int = 88) -> str:
    return _ansi("94", "═" * width)


def _team_label(result: dict[str, Any], key: str) -> str:
    return result.get("teams", {}).get(key, {}).get("name") or ("Team A" if key == "teamA" else "Team B")


def print_game(result: dict[str, Any], *, title: str | None = None) -> None:
    """Render one parsed game without changing or normalising its data."""
    if title:
        print(f"\n{heading(title)}")
        print(section_divider())

    mode = result.get("mode", {}).get("value") or "UNRESOLVED"
    score = result.get("modeScore")
    print(f"Mode:   {accent(mode)}")
    if score:
        a_name = score.get("teamAName") or _team_label(result, "teamA")
        b_name = score.get("teamBName") or _team_label(result, "teamB")
        a_score = score.get("teamA")
        b_score = score.get("teamB")
        print(f"Result: {accent(f'{a_name} {a_score} - {b_score} {b_name}')}")
        overtime = score.get("overtime")
        if overtime:
            print(f"OT:     {overtime['teamA']['raw']} - {overtime['teamB']['raw']}  Winner: {overtime['winner']}")
    else:
        print(f"Result: {warning('UNRESOLVED')}")

    players = result.get("players", [])
    print()
    print(f"{'Team':<8} {'Player ID':<34} {'E':>4} {'D':>4} {'Confidence':>12}")
    print(section_divider(68))
    for player in players:
        team = _team_label(result, player.get("team")) if player.get("team") in {"teamA", "teamB"} else "?"
        confidence = player.get("confidence", {})
        lowest = min(
            float(confidence.get("id", 0)),
            float(confidence.get("eliminations", 0)),
            float(confidence.get("deaths", 0)),
        )
        confidence_text = success(f"{lowest:.0%}") if lowest >= .85 else warning(f"{lowest:.0%}")
        print(
            f"{team:<8} {str(player.get('id') or player.get('name') or 'UNRESOLVED'):<34} "
            f"{str(player.get('eliminations', '?')):>4} {str(player.get('deaths', '?')):>4} {confidence_text:>12}"
        )

    count = len(players)
    complete = bool(result.get("complete"))
    status = success("✓ READY") if complete else warning("⚠ NEEDS REVIEW")
    print(section_divider(68))
    print(f"{status}  |  {count}/8 player records  |  {result.get('framesScanned', 0)} OCR frames")


def print_batch_summary(results: list[dict[str, Any]], *, title: str = "Parse complete") -> None:
    print(f"\n{heading(title)}")
    print(major_divider())
    for index, result in enumerate(results, start=1):
        mode = result.get("mode", {}).get("value") or "?"
        score = result.get("modeScore") or {}
        score_text = f"{score.get('teamA', '?')}-{score.get('teamB', '?')}"
        state = success("✓ ready") if result.get("complete") else warning("⚠ review")
        print(f"{index:>2}. {str(result.get('source') or '?'):<28} {mode:<22} {score_text:<9} {state}")
