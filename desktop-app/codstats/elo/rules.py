"""Elo tuning knobs and side-effect-free helpers.

These are the rules agreed on 2026-10-30 (decisions/elo-and-architecture.md):
K/D and kill share weigh 50/50, the SnD team K/D uses the same 4.0 cap as the
player, winners can never lose Elo on a map, and the map total is shared back
to the winners so every map sums to zero.
"""
from __future__ import annotations

RULES_VERSION = 2          # 1 = the Java engine, 2 = this engine
K_FACTOR = 20.0
KD_WEIGHT = 0.36           # was 0.5
DAMAGE_WEIGHT = 2.5        # was 1.5 ("damage" = kills * 100)
WINNER_GUARD = 0.8         # a winner's penalty may cancel at most 80% of their win points
STARTING_ELO = 900.0
MODES = ("Hardpoint", "SND", "Overload")
MODE_PREFIX = {"Hardpoint": "hp", "SND": "snd", "Overload": "overload"}


def margin_t(score_difference: int, mode: str) -> float:
    cap = {"SND": 6.0, "Overload": 8.0}.get(mode, 200.0)
    return min(1.0, score_difference / cap)


def kd(kills: int, deaths: int, mode: str) -> float:
    value = float(kills) if deaths == 0 else kills / deaths
    return 4.0 if mode == "SND" and value > 4.0 else value


def damage_share(player_damage: float, team_damage: float) -> float:
    return 0.0 if team_damage == 0 else player_damage / team_damage


def expected_score(elo: float, opponent: float) -> float:
    return 1.0 / (1.0 + 10 ** ((opponent - elo) / 400.0))
