"""Validate approved games and apply them to Elo (replaces CodStatsImporter.java).

Duplicate protection is by content: a game whose fingerprint is already in
the ledger is never counted twice, whatever its date or file name. Two
different games that share a file name on the same day (for example two
batches that both contain "1.mp4") are both imported; the second gets a
"#2" ledger key. That fixes the same-day export collision.
"""
from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from datetime import date as date_type
from pathlib import Path
from typing import Any, Iterable

from .calculator import calculate_map
from .history import HistoryStore, now_iso
from .rules import MODES, margin_t
from .stats import StatsStore

OVERTIME = re.compile(r"^(\d+):(\d{2})$")


class ImportError_(ValueError):
    pass


def _gson(value: Any) -> str:
    """JSON exactly as Gson's default toJson wrote it (compact, HTML-safe escapes)."""
    text = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    for raw, escaped in (("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026"), ("=", "\\u003d"), ("'", "\\u0027")):
        text = text.replace(raw, escaped)
    return text


def normalise_game(game: dict[str, Any]) -> dict[str, Any]:
    """The game in Java CodStatsGame field order, null fields omitted."""
    result = game.get("result") or {}
    out_result: dict[str, Any] = {"type": result.get("type")}
    for key in ("score", "overtime"):
        part = result.get(key)
        if part is not None:
            out_result[key] = {side: part[side] for side in ("teamA", "teamB") if part.get(side) is not None}
    out_result["winningTeam"] = int(result.get("winningTeam") or 0)
    out_result["scoreDifference"] = int(result.get("scoreDifference") or 0)
    teams = game.get("teams") or {}
    return {
        "source": game.get("source"), "gameMode": game.get("gameMode"), "result": out_result,
        "teams": {side: [{"playerId": int(p["playerId"]), "kills": int(p["kills"]), "deaths": int(p["deaths"])}
                         for p in teams.get(side) or []] for side in ("A", "B")},
    }


def fingerprint(game: dict[str, Any]) -> str:
    """SHA-256 of the normalised game. Identical to the Java engine's fingerprint."""
    return hashlib.sha256(_gson(normalise_game(game)).encode("utf-8")).hexdigest()


def _overtime_seconds(value: str | None) -> int | None:
    match = OVERTIME.match((value or "").strip())
    if not match or int(match.group(2)) >= 60:
        return None
    return int(match.group(1)) * 60 + int(match.group(2))


def validate_game(game: dict[str, Any], known_ids: Iterable[int] | None = None) -> list[str]:
    errors: list[str] = []
    known = set(int(i) for i in known_ids) if known_ids is not None else None
    if not str(game.get("source") or "").strip():
        errors.append("source is missing")
    mode = game.get("gameMode")
    if mode not in MODES:
        errors.append(f"unsupported game mode: {mode}")
    teams = game.get("teams") or {}
    ids: set[int] = set()
    for side in ("A", "B"):
        players = teams.get(side)
        if players is None:
            errors.append("team information is missing")
            continue
        if len(players) != 4:
            errors.append(f"Team {side} must contain exactly 4 players")
        for player in players:
            pid = int(player.get("playerId", -1))
            if known is not None and pid not in known:
                errors.append(f"Team {side} contains unknown player ID {pid}")
            if pid in ids:
                errors.append(f"duplicate player ID {pid}")
            ids.add(pid)
            if int(player.get("kills", -1)) < 0 or int(player.get("deaths", -1)) < 0:
                errors.append(f"invalid K/D for player ID {pid}")
    result = game.get("result")
    if not result:
        return errors + ["result is missing"]
    winner, difference = result.get("winningTeam"), result.get("scoreDifference", -1)
    if winner not in (1, 2):
        errors.append("winningTeam must be 1 or 2")
    if difference is None or difference < 0:
        errors.append("scoreDifference cannot be negative")
    if result.get("type") == "score":
        score = result.get("score") or {}
        a, b = score.get("teamA"), score.get("teamB")
        if a is None or b is None:
            # Manual Java entries could leave the score blank; trust winner + difference.
            if game.get("source") != "Manual entry":
                errors.append("score result is missing Team A/Team B score")
            return errors
        if a < 0 or b < 0:
            errors.append("scores cannot be negative")
        if a == b:
            errors.append("score cannot be tied")
        elif winner != (1 if a > b else 2):
            errors.append("winningTeam does not match score")
        if difference != abs(a - b):
            errors.append("scoreDifference does not match score")
    elif result.get("type") == "overtime":
        if mode != "Overload":
            errors.append("overtime result is only valid for Overload")
        overtime = result.get("overtime") or {}
        a_dnf = str(overtime.get("teamA", "")).strip().upper() == "DNF"
        b_dnf = str(overtime.get("teamB", "")).strip().upper() == "DNF"
        a, b = _overtime_seconds(overtime.get("teamA")), _overtime_seconds(overtime.get("teamB"))
        if not a_dnf and a is None:
            errors.append(f"invalid Team A overtime value: {overtime.get('teamA')}")
        if not b_dnf and b is None:
            errors.append(f"invalid Team B overtime value: {overtime.get('teamB')}")
        if a_dnf and b_dnf:
            errors.append("both teams cannot be DNF")
        expected = None
        if a_dnf and b is not None:
            expected = 2
        elif b_dnf and a is not None:
            expected = 1
        elif a is not None and b is not None:
            if a == b:
                errors.append("overtime times cannot be equal")
            else:
                expected = 1 if a < b else 2
        if expected is not None and winner != expected:
            errors.append("winningTeam does not match overtime result")
        if difference != 1:
            errors.append("Overload overtime scoreDifference must be 1")
    else:
        errors.append("result.type must be score or overtime")
    return errors


class EloImporter:
    """Applies games to stats.json and history/ in the Elo data folder."""

    def __init__(self, elo_root: Path) -> None:
        self.elo_root = Path(elo_root)
        self.stats = StatsStore(self.elo_root / "stats.json")
        self.history = HistoryStore(self.elo_root / "history")

    def status(self, game: dict[str, Any]) -> str:
        """"new" or "imported" (same content already counted)."""
        return "imported" if fingerprint(game) in set(self.stats.imported_games.values()) else "new"

    def _ledger_key(self, match_date: str, source: str) -> str:
        key, number = f"{match_date}|{source}", 1
        while key in self.stats.imported_games:
            number += 1
            key = f"{match_date}|{source}#{number}"
        return key

    def import_games(self, match_date: str, games: list[dict[str, Any]],
                     known_ids: Iterable[int] | None = None) -> dict[str, Any]:
        """Import every new game in order. Validates all of them before changing anything."""
        date_type.fromisoformat(match_date)
        known = list(known_ids) if known_ids is not None else None
        problems = []
        for index, game in enumerate(games, start=1):
            problems += [f"Game {index} ({game.get('source')}): {error}" for error in validate_game(game, known)]
        if problems:
            raise ImportError_("\n".join(problems))

        self.stats.load()
        opening = self.stats.snapshot()
        seen = set(self.stats.imported_games.values())
        reports, skipped = [], []
        for game in games:
            print_id = fingerprint(game)
            if print_id in seen:
                skipped.append(game.get("source"))
                continue
            seen.add(print_id)
            before = self.stats.snapshot()
            traces = self._apply(game)
            after = self.stats.snapshot()
            self.stats.imported_games[self._ledger_key(match_date, str(game["source"]))] = print_id
            reports.append({
                "mapId": "map-" + print_id, "date": match_date, "source": game["source"],
                "fingerprint": print_id, "importedAt": now_iso(), "gameMode": game["gameMode"],
                "game": normalise_game(game),
                "elo": [{"playerId": pid, "before": before[str(pid)]["elo"],
                         "change": after[str(pid)]["elo"] - before[str(pid)]["elo"],
                         "after": after[str(pid)]["elo"], "calculationTrace": traces[pid]}
                        for side in ("A", "B") for pid in (p["playerId"] for p in game["teams"][side])],
            })
        if reports:
            # History first, then stats.json: both are atomic, and the ledger in
            # stats.json is only written once its maps are safely in history.
            self.history.add_maps(match_date, opening, reports, self.stats.snapshot())
            self.stats.save()
        return {"imported": len(reports), "skipped": skipped, "reports": reports}

    def _apply(self, game: dict[str, Any]) -> dict[int, dict]:
        mode = game["gameMode"]
        result = game["result"]
        team_a = [int(p["playerId"]) for p in game["teams"]["A"]]
        team_b = [int(p["playerId"]) for p in game["teams"]["B"]]
        kills = {int(p["playerId"]): int(p["kills"]) for side in ("A", "B") for p in game["teams"][side]}
        deaths = {int(p["playerId"]): int(p["deaths"]) for side in ("A", "B") for p in game["teams"][side]}
        for pid in team_a + team_b:
            self.stats.player(pid)
        self.stats.record_map(mode, team_a, team_b, kills, deaths, result["winningTeam"],
                              margin_t(result["scoreDifference"], mode))
        elo = {pid: float(self.stats.player(pid)["elo"]) for pid in team_a + team_b}
        outcome = calculate_map(elo, team_a, team_b, kills, deaths, mode,
                                result["scoreDifference"], result["winningTeam"])
        traces = {}
        for pid, row in outcome.items():
            record = self.stats.player(pid)
            record["elo"] = elo[pid] + row["change"]
            self.stats.record_damage(mode, pid, row["damage"], row["damageShare"], row["teamDamage"])
            traces[pid] = deepcopy(row["trace"])
        return traces
