"""One map's Elo changes, with a step-by-step trace for the History tab.

The first steps (names, formulas and order) match the Java EloCalculator, so
the website's calculation viewer keeps working. Two steps are new:
"Winner guard scale" and "Leak share".
"""
from __future__ import annotations

from statistics import mean
from typing import Any

from .rules import (DAMAGE_WEIGHT, K_FACTOR, KD_WEIGHT, RULES_VERSION, WINNER_GUARD,
                    damage_share, expected_score, kd, margin_t)


def _step(steps: list, name: str, formula: str, result: float, **inputs: float) -> None:
    steps.append({"name": name, "formula": formula,
                  "inputs": {key: float(value) for key, value in inputs.items()},
                  "result": float(result)})


def _team(ids: list[int], elo: dict[int, float], kills: dict[int, int], deaths: dict[int, int],
          enemy_average: float, won: bool, margin: float, mode: str) -> dict[int, dict[str, Any]]:
    """Base Elo and the K/D + damage carry for one team, before the guard and leak."""
    team_kd = mean(kd(kills[i], deaths[i], mode) for i in ids) if ids else 1.0
    team_damage = sum(kills[i] * 100.0 for i in ids)
    average_share = 1.0 / len(ids) if ids else 0.0
    rows = {}
    for pid in ids:
        steps: list = []
        start = elo[pid]
        _step(steps, "Starting Elo", "Existing player Elo", start, elo=start)
        _step(steps, "Opponent average Elo", "Average of opponent Elo ratings before this map",
              enemy_average, opponentAverage=enemy_average)
        _step(steps, "Team average KD", "Average of team map KD values (SnD capped at 4.0)",
              team_kd, teamAverageKD=team_kd)
        _step(steps, "Team damage", "Sum of team player map kills * 100", team_damage, teamDamage=team_damage)
        _step(steps, "Average damage share", "teamSize == 0 ? 0 : 1 / teamSize", average_share, teamSize=len(ids))
        _step(steps, "Margin multiplier", "marginT(scoreDifference, mode)", margin, marginT=margin)
        expected = expected_score(start, enemy_average)
        actual = 1.0 if won else 0.0
        base = K_FACTOR * (actual - expected)
        after_margin = base * margin
        pool = abs(after_margin)
        _step(steps, "Expected score", "1 / (1 + 10 ^ ((opponentAverage - startingElo) / 400))",
              expected, startingElo=start, opponentAverage=enemy_average)
        _step(steps, "Actual result", "win ? 1 : 0", actual, actual=actual)
        _step(steps, "Base Elo", "K_FACTOR * (actual - expected)", base, K_FACTOR=K_FACTOR, actual=actual, expected=expected)
        _step(steps, "Base after margin", "base * marginT", after_margin, base=base, marginT=margin)
        _step(steps, "Adjustment pool", "abs(baseAfterMargin)", pool, baseAfterMargin=after_margin)
        player_damage = kills[pid] * 100.0
        share = damage_share(player_damage, team_damage)
        _step(steps, "Player damage", "mapKills * 100", player_damage, mapKills=kills[pid])
        _step(steps, "Damage share", "teamDamage == 0 ? 0 : playerDamage / teamDamage", share,
              playerDamage=player_damage, teamDamage=team_damage)
        player_kd = kd(kills[pid], deaths[pid], mode)
        kd_carry = player_kd - team_kd
        _step(steps, "Player KD", "kd(mapKills, mapDeaths, mode)", player_kd, mapKills=kills[pid], mapDeaths=deaths[pid])
        _step(steps, "KD carry", "playerKD - teamAverageKD", kd_carry, playerKD=player_kd, teamAverageKD=team_kd)
        damage_carry = share - average_share
        _step(steps, "Damage carry", "damageShare - averageShare", damage_carry, damageShare=share, averageShare=average_share)
        rows[pid] = {"steps": steps, "start": start, "base": after_margin, "pool": pool,
                     "kd": pool * kd_carry * KD_WEIGHT, "damage": pool * damage_carry * DAMAGE_WEIGHT,
                     "kdCarry": kd_carry, "damageCarry": damage_carry, "won": won,
                     "damageValue": player_damage, "damageShare": share, "teamDamage": team_damage}
    return rows


def calculate_map(elo: dict[int, float], team_a: list[int], team_b: list[int],
                  kills: dict[int, int], deaths: dict[int, int], mode: str,
                  score_difference: int, winning_team: int) -> dict[int, dict[str, Any]]:
    """Return {playerId: {"change", "trace", "damage", "damageShare", "teamDamage"}}.

    Nothing is changed: the caller applies the changes.
    """
    margin = margin_t(score_difference, mode)
    average_a = mean(elo[i] for i in team_a) if team_a else 1000.0
    average_b = mean(elo[i] for i in team_b) if team_b else 1000.0
    rows = _team(team_a, elo, kills, deaths, average_b, winning_team == 1, margin, mode)
    rows.update(_team(team_b, elo, kills, deaths, average_a, winning_team == 2, margin, mode))
    winners = team_a if winning_team == 1 else team_b

    # One-way guard: one scale for the whole winning team, chosen so no winner's
    # K/D + damage penalty cancels more than 80% of their own win points.
    scale = 1.0
    for pid in winners:
        row = rows[pid]
        penalty = -(row["kd"] + row["damage"])
        if penalty > 0 and row["base"] > 0 and penalty > WINNER_GUARD * row["base"]:
            scale = min(scale, WINNER_GUARD * row["base"] / penalty)
    for pid in winners:
        rows[pid]["kd"] *= scale
        rows[pid]["damage"] *= scale
    for row in rows.values():
        row["change"] = row["base"] + row["kd"] + row["damage"]

    # Leak fix: whatever the map created or destroyed is shared among the
    # winners in proportion to their change, so the map sums to exactly zero.
    leak = sum(row["change"] for row in rows.values())
    winner_total = sum(rows[pid]["change"] for pid in winners)
    shares = {pid: (-leak * rows[pid]["change"] / winner_total
                    if pid in winners and winner_total > 0 else 0.0) for pid in rows}

    output = {}
    for pid, row in rows.items():
        steps = row["steps"]
        is_winner = pid in winners
        _step(steps, "KD adjustment", "pool * kdCarry * KD_WEIGHT * guardScale", row["kd"],
              pool=row["pool"], kdCarry=row["kdCarry"], KD_WEIGHT=KD_WEIGHT, guardScale=scale if is_winner else 1.0)
        _step(steps, "Damage adjustment", "pool * damageCarry * DAMAGE_WEIGHT * guardScale", row["damage"],
              pool=row["pool"], damageCarry=row["damageCarry"], DAMAGE_WEIGHT=DAMAGE_WEIGHT,
              guardScale=scale if is_winner else 1.0)
        _step(steps, "Winner guard scale", "winners only: largest scale (<= 1) keeping every penalty under 80% of win points",
              scale if is_winner else 1.0, WINNER_GUARD=WINNER_GUARD)
        share = shares[pid]
        _step(steps, "Leak share", "winners only: -mapTotal * playerChange / winnersChange", share,
              mapTotal=leak, winnersChange=winner_total)
        change = row["change"] + share
        _step(steps, "Final change", "baseAfterMargin + kdAdjustment + damageAdjustment + leakShare", change,
              baseAfterMargin=row["base"], kdAdjustment=row["kd"], damageAdjustment=row["damage"], leakShare=share)
        _step(steps, "Updated Elo", "startingElo + finalChange", row["start"] + change,
              startingElo=row["start"], finalChange=change)
        trace = {"playerId": pid, "mode": mode, "teamWon": row["won"], "teamSize": len(team_a if pid in team_a else team_b),
                 "scoreDifferenceMargin": margin, "rulesVersion": RULES_VERSION,
                 "before": row["start"], "change": change, "after": row["start"] + change, "steps": steps}
        output[pid] = {"change": change, "trace": trace, "damage": row["damageValue"],
                       "damageShare": row["damageShare"], "teamDamage": row["teamDamage"]}
    return output
