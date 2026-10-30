"""Checks for the Python Elo engine against the published history."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1]
REPO = APP.parent
sys.path.insert(0, str(APP))

from codstats.elo.calculator import calculate_map  # noqa: E402
from codstats.elo.importer import EloImporter, fingerprint, validate_game  # noqa: E402

HISTORY = sorted((REPO / "history").glob("2026-*.json"))
pytestmark = pytest.mark.skipif(not HISTORY, reason="needs the site's history folder")


def _maps(since: str = "2026-09-20"):
    return [m for path in HISTORY if path.stem >= since for m in json.loads(path.read_text())["maps"]]


def _split(game):
    team_a = [p["playerId"] for p in game["teams"]["A"]]
    team_b = [p["playerId"] for p in game["teams"]["B"]]
    rows = game["teams"]["A"] + game["teams"]["B"]
    return team_a, team_b, {p["playerId"]: p["kills"] for p in rows}, {p["playerId"]: p["deaths"] for p in rows}


def test_fingerprint_matches_java():
    imported = [m for m in _maps("2000") if m.get("source") != "Manual entry"]
    assert imported and all(fingerprint(m["game"]) == m["fingerprint"] for m in imported)


def test_replay_zero_sum_and_winners_never_lose():
    """The agreed rules, replayed over the maps from 2026-09-20 (decisions/elo-and-architecture.md)."""
    start = [p for p in HISTORY if p.stem >= "2026-09-20"][0]
    elo = {int(k): v["elo"] for k, v in json.loads(start.read_text())["openingStats"].items()}
    winners_lost = losers_gained = 0
    for report in _maps():
        game = report["game"]; result = game["result"]
        team_a, team_b, kills, deaths = _split(game)
        for pid in team_a + team_b:
            elo.setdefault(pid, 900.0)
        out = calculate_map(elo, team_a, team_b, kills, deaths, report["gameMode"],
                            result["scoreDifference"], result["winningTeam"])
        winners = team_a if result["winningTeam"] == 1 else team_b
        assert abs(sum(row["change"] for row in out.values())) < 1e-9
        for pid, row in out.items():
            winners_lost += pid in winners and row["change"] < 0
            losers_gained += pid not in winners and row["change"] > 0
            elo[pid] += row["change"]
    assert winners_lost == 0
    assert losers_gained == 4      # the four SnD carries found in the analysis


def test_validation_catches_bad_games():
    game = json.loads(json.dumps(_maps()[0]["game"]))
    assert validate_game(game, range(1, 17)) == []
    game["result"]["winningTeam"] = 3 - game["result"]["winningTeam"]
    assert "winningTeam does not match score" in validate_game(game, range(1, 17))


def test_import_is_idempotent_and_same_name_games_both_count(tmp_path):
    elo_root = tmp_path / "elo"; elo_root.mkdir()
    shutil.copy(REPO / "current_stats.json", elo_root / "stats.json")
    base = json.loads(json.dumps(_maps()[-1]["game"]))
    base["source"] = "1.mp4"
    other = json.loads(json.dumps(base)); other["teams"]["A"][0]["kills"] += 3
    importer = EloImporter(elo_root)
    assert importer.import_games("2026-10-30", [base], range(1, 17))["imported"] == 1
    assert importer.import_games("2026-10-30", [base], range(1, 17))["imported"] == 0       # already counted
    assert importer.import_games("2026-10-30", [other], range(1, 17))["imported"] == 1      # same name, new game
    keys = [k for k in importer.stats.imported_games if k.startswith("2026-10-30")]
    assert keys == ["2026-10-30|1.mp4", "2026-10-30|1.mp4#2"]
    stats = json.loads((elo_root / "stats.json").read_text())
    assert "seriesWins" not in json.dumps(stats["players"])
    day = json.loads((elo_root / "history" / "2026-10-30.json").read_text())
    assert len(day["maps"]) == 2
    assert [s["name"] for s in day["maps"][0]["elo"][0]["calculationTrace"]["steps"]][-3:] == \
        ["Leak share", "Final change", "Updated Elo"]
    summary = json.loads((elo_root / "history" / "summary.json").read_text())
    assert summary["version"] == 1 and summary["days"][0]["mapCount"] == 2
