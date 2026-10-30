"""Where the app and its data live, and the one-time copy of the old data.

The app keeps its own data folder (Documents\\CODStats-v4 by default). On the
first start it COPIES what it needs from the old app's Documents\\CODStats.
The old folder is only ever read, never changed, so the old app keeps working.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

from .elo.history import write_index_and_summary
from .elo.stats import StatsStore, write_json_atomic

ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
OCR_ROOT = ROOT / "engines" / "ocr"
SEED_ROOT = ROOT / "seed-data"            # bundled copy of the latest published data

DOCUMENTS = Path.home() / "Documents"
DATA_ROOT = Path(os.environ.get("CODSTATS_DATA_DIR", str(DOCUMENTS / "CODStats-v4"))).expanduser().resolve()
OLD_DATA_ROOT = Path(os.environ.get("CODSTATS_OLD_DATA_DIR", str(DOCUMENTS / "CODStats"))).expanduser()
ELO_DATA_ROOT = DATA_ROOT / "elo"
HISTORY_ROOT = ELO_DATA_ROOT / "history"
STATS_PATH = ELO_DATA_ROOT / "stats.json"
STAGING = DATA_ROOT / "staging"
APPROVED = DATA_ROOT / "approved"
DEBUG_ROOT = DATA_ROOT / "debug"
REGISTRY_PATH = DATA_ROOT / "player_registry.json"
SETTINGS_PATH = DATA_ROOT / "settings.json"
DRIVE_LEDGER = DATA_ROOT / "drive-ledger.json"


def _site_root() -> Path:
    """The website shown in the Leaderboard tab: the repo this app sits in, else a bundled copy."""
    for candidate in (ROOT.parent, ROOT / "site"):
        if (candidate / "index.html").is_file() and (candidate / "script.js").is_file():
            return candidate
    return ROOT / "site"


SITE_ROOT = _site_root()

# Files copied from the old data folder on the first start (relative paths).
_OLD_FILES = ("player_registry.json", "elo/stats.json", "elo/previous_stats.json",
              "github-desktop-folder.json", "github-desktop-export-state.json", "github-sync.json")
_OLD_FOLDERS = ("elo/history", "registry-backups")


def _copy_tree(source: Path, target: Path) -> int:
    count = 0
    for path in source.rglob("*"):
        if path.is_file():
            destination = target / path.relative_to(source)
            if not destination.exists():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, destination)
                count += 1
    return count


def _strip_series(stats_path: Path) -> None:
    if stats_path.exists():
        store = StatsStore(stats_path)          # loading drops seriesWins/seriesLosses
        write_json_atomic(stats_path, store.document())


def ensure_data() -> str:
    """Create the data folder; on the first start copy the old data. Returns a short note for the log."""
    first_start = not STATS_PATH.exists()
    for folder in (DATA_ROOT, ELO_DATA_ROOT, HISTORY_ROOT, STAGING, APPROVED, DEBUG_ROOT):
        folder.mkdir(parents=True, exist_ok=True)
    note = ""
    if first_start:
        if (OLD_DATA_ROOT / "elo" / "stats.json").is_file():
            copied = sum(1 for name in _OLD_FILES if _copy_file(OLD_DATA_ROOT / name, DATA_ROOT / name))
            copied += sum(_copy_tree(OLD_DATA_ROOT / name, DATA_ROOT / name)
                          for name in _OLD_FOLDERS if (OLD_DATA_ROOT / name).is_dir())
            note = f"First start: copied {copied} file(s) from {OLD_DATA_ROOT} (that folder was not changed)."
        elif (SEED_ROOT / "current_stats.json").is_file():
            _copy_file(SEED_ROOT / "current_stats.json", STATS_PATH)
            _copy_file(SEED_ROOT / "previous_stats.json", ELO_DATA_ROOT / "previous_stats.json")
            if (SEED_ROOT / "history").is_dir():
                _copy_tree(SEED_ROOT / "history", HISTORY_ROOT)
            note = "First start: loaded the bundled copy of the published stats."
        _strip_series(STATS_PATH)
        if any(HISTORY_ROOT.glob("????-??-??.json")):
            write_index_and_summary(HISTORY_ROOT)
    if not REGISTRY_PATH.exists():
        _copy_file(SEED_ROOT / "player_registry.json", REGISTRY_PATH) or _copy_file(OCR_ROOT / "player_registry.json", REGISTRY_PATH)
    if not STATS_PATH.exists():
        write_json_atomic(STATS_PATH, {"players": {}, "importedGames": {}, "importTrackingVersion": 1})
    return note


def _copy_file(source: Path, target: Path) -> bool:
    if source.is_file() and not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        return True
    return False


def load_settings() -> dict:
    try:
        return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_settings(settings: dict) -> None:
    write_json_atomic(SETTINGS_PATH, settings)
