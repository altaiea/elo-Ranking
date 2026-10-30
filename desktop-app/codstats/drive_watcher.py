"""Watch a Google Drive for desktop folder for new match videos.

Google Drive for desktop shows Drive as an ordinary folder (usually
G:\\My Drive). People upload to Drive, Drive syncs the file down, and this
watcher hands it to the parser once it has stopped growing. No Google sign-in
or API key is involved; the Drive app does the syncing.

The ledger (drive-ledger.json in the data folder) remembers every video that
was queued, by path and by content hash, so a restart or a re-upload of the
same file never parses it twice.
"""
from __future__ import annotations

import json
import os
import string
import time
from pathlib import Path
from typing import Any

from .duplicate_files import file_hash
from .elo.stats import write_json_atomic

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
# Files Drive (or a browser) is still writing.
PARTIAL_SUFFIXES = {".tmp", ".part", ".crdownload", ".download", ".gdownload"}


def suggest_drive_folders() -> list[Path]:
    """Likely Google Drive for desktop locations on this PC, best first."""
    candidates: list[Path] = []
    if os.name == "nt":
        for letter in "G" + "".join(c for c in string.ascii_uppercase if c != "G"):
            for name in ("My Drive", "Mon Drive", "Shared drives"):
                candidates.append(Path(f"{letter}:\\") / name)
    home = Path.home()
    candidates += [home / "Google Drive" / "My Drive", home / "My Drive", home / "Google Drive"]
    seen, found = set(), []
    for path in candidates:
        try:
            if path.is_dir() and str(path) not in seen:
                seen.add(str(path)); found.append(path)
        except OSError:
            continue
    return found


class DriveWatcher:
    def __init__(self, folder: Path, ledger_path: Path, settle_seconds: float = 15.0) -> None:
        self.folder = Path(folder)
        self.ledger_path = Path(ledger_path)
        self.settle_seconds = settle_seconds
        self._pending: dict[str, tuple[int, float, float]] = {}   # path -> (size, mtime, first seen unchanged)
        self.ledger = self._load()

    # -- ledger ---------------------------------------------------------------
    def _load(self) -> dict[str, Any]:
        try:
            payload = json.loads(self.ledger_path.read_text(encoding="utf-8"))
            if isinstance(payload.get("files"), dict):
                payload.setdefault("hashes", {})
                return payload
        except (OSError, ValueError):
            pass
        return {"files": {}, "hashes": {}}

    def _save(self) -> None:
        write_json_atomic(self.ledger_path, self.ledger)

    def _key(self, path: Path) -> str:
        return os.path.normcase(str(path.resolve()))

    def known(self, path: Path) -> bool:
        return self._key(path) in self.ledger["files"]

    def mark(self, path: Path, status: str, digest: str | None = None, **extra: Any) -> None:
        entry = self.ledger["files"].setdefault(self._key(path), {})
        entry.update({"name": path.name, "status": status, "at": time.strftime("%Y-%m-%d %H:%M:%S"), **extra})
        if digest:
            entry["hash"] = digest
            self.ledger["hashes"].setdefault(digest, self._key(path))
        self._save()

    # -- scanning -------------------------------------------------------------
    def videos(self) -> list[Path]:
        found = []
        try:
            for root, _dirs, files in os.walk(self.folder):
                for name in files:
                    path = Path(root) / name
                    if name.startswith((".", "~")) or path.suffix.lower() in PARTIAL_SUFFIXES:
                        continue
                    if path.suffix.lower() in VIDEO_EXTENSIONS:
                        found.append(path)
        except OSError:
            return []
        return sorted(found, key=lambda p: (p.stat().st_mtime if p.exists() else 0, p.name))

    def mark_existing_as_seen(self) -> int:
        count = 0
        for path in self.videos():
            if not self.known(path):
                self.mark(path, "skipped (already in folder)")
                count += 1
        return count

    def poll(self) -> list[tuple[Path, str | None]]:
        """Return newly settled videos as (path, duplicate_of). Call every few seconds.

        duplicate_of is the name of an earlier video with identical bytes, or None.
        """
        ready = []
        now = time.monotonic()
        for path in self.videos():
            key = self._key(path)
            if key in self.ledger["files"]:
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            previous = self._pending.get(key)
            if stat.st_size == 0 or previous is None or previous[:2] != (stat.st_size, stat.st_mtime):
                self._pending[key] = (stat.st_size, stat.st_mtime, now)
                continue
            if now - previous[2] < self.settle_seconds:
                continue
            try:
                with path.open("rb") as handle:   # Drive still holds a lock while syncing
                    handle.read(1)
                digest = file_hash(path)
            except OSError:
                continue
            self._pending.pop(key, None)
            original = self.ledger["hashes"].get(digest)
            duplicate_of = Path(original).name if original and original != key else None
            self.mark(path, "duplicate" if duplicate_of else "queued", digest)
            ready.append((path, duplicate_of))
        return ready
