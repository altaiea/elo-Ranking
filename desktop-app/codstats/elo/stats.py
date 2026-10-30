"""stats.json: player records plus the import ledger, saved atomically.

The JSON layout is the one the Java engine wrote (and the website reads as
current_stats.json), minus the series fields.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from .rules import MODE_PREFIX, STARTING_ELO

# Field order matches the Java PlayerStats class so diffs stay readable.
PLAYER_FIELDS: tuple[str, ...] = (
    "elo", "lifetimeKills", "lifetimeDeaths", "mapKills", "mapDeaths",
    "hpKills", "hpDeaths", "sndKills", "sndDeaths", "overloadKills", "overloadDeaths",
    "hpWins", "hpLosses", "sndWins", "sndLosses", "overloadWins", "overloadLosses",
    "hpMarginTotal", "hpMarginCount", "sndMarginTotal", "sndMarginCount",
    "overloadMarginTotal", "overloadMarginCount",
    "hpDamage", "hpDamageShare", "sndDamage", "sndDamageShare", "overloadDamage", "overloadDamageShare",
    "hpLifetimeDamage", "hpLifetimeTeamDamage", "sndLifetimeDamage", "sndLifetimeTeamDamage",
    "overloadLifetimeDamage", "overloadLifetimeTeamDamage",
)
FLOAT_FIELDS = {"elo", "hpMarginTotal", "sndMarginTotal", "overloadMarginTotal", "hpDamage", "sndDamage",
                "overloadDamage", "hpLifetimeDamage", "hpLifetimeTeamDamage", "sndLifetimeDamage",
                "sndLifetimeTeamDamage", "overloadLifetimeDamage", "overloadLifetimeTeamDamage"}
NULLABLE_FIELDS = {"hpDamageShare", "sndDamageShare", "overloadDamageShare"}
REMOVED_FIELDS = ("seriesWins", "seriesLosses")


def new_player() -> dict[str, Any]:
    record: dict[str, Any] = {}
    for field in PLAYER_FIELDS:
        record[field] = None if field in NULLABLE_FIELDS else (0.0 if field in FLOAT_FIELDS else 0)
    record["elo"] = STARTING_ELO
    return record


def clean_player(raw: dict[str, Any]) -> dict[str, Any]:
    """Known fields in Java order; series fields dropped; unknown fields kept at the end."""
    record = new_player()
    for key, value in raw.items():
        if key in REMOVED_FIELDS:
            continue
        record[key] = value
    return record


def write_json_atomic(path: Path, payload: Any, *, indent: int | None = 2) -> None:
    """Write to a temp file in the same folder, flush to disk, then rename over the target."""
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(payload, stream, indent=indent, ensure_ascii=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


class StatsStore:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.players: dict[int, dict[str, Any]] = {}
        self.imported_games: dict[str, str] = {}
        self.load()

    def load(self) -> None:
        if not self.path.exists():
            self.players, self.imported_games = {}, {}
            return
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        self.players = {int(key): clean_player(value or {}) for key, value in (payload.get("players") or {}).items()}
        self.imported_games = dict(payload.get("importedGames") or {})

    def player(self, player_id: int) -> dict[str, Any]:
        return self.players.setdefault(int(player_id), new_player())

    def snapshot(self) -> dict[str, dict[str, Any]]:
        """Players keyed by string id, the shape used for openingStats/closingStats."""
        return {str(pid): dict(record) for pid, record in sorted(self.players.items())}

    def document(self) -> dict[str, Any]:
        return {"players": self.snapshot(), "importedGames": dict(self.imported_games),
                "importTrackingVersion": 1}

    def save(self) -> None:
        if self.path.exists():
            shutil.copy2(self.path, self.path.with_name(self.path.name + ".bak"))
        write_json_atomic(self.path, self.document())

    # -- map bookkeeping (MatchEngine steps 1-3 and the damage fields) --------
    def record_map(self, mode: str, team_a: list[int], team_b: list[int], kills: dict[int, int],
                   deaths: dict[int, int], winning_team: int, margin: float) -> None:
        prefix = MODE_PREFIX[mode]
        for pid in team_a + team_b:
            record = self.player(pid)
            record["lifetimeKills"] += kills[pid]
            record["lifetimeDeaths"] += deaths[pid]
            record[prefix + "Kills"] += kills[pid]
            record[prefix + "Deaths"] += deaths[pid]
            won = (pid in team_a) == (winning_team == 1)
            record[prefix + ("Wins" if won else "Losses")] += 1
            record[prefix + "MarginTotal"] += margin if won else -margin
            record[prefix + "MarginCount"] += 1

    def record_damage(self, mode: str, player_id: int, damage: float, share: float, team_damage: float) -> None:
        prefix = MODE_PREFIX[mode]
        record = self.player(player_id)
        record[prefix + "Damage"] = damage
        record[prefix + "DamageShare"] = share
        record[prefix + "LifetimeDamage"] += damage
        record[prefix + "LifetimeTeamDamage"] += team_damage
