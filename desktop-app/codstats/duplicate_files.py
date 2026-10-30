"""Find byte-identical video files (read-only).

Files of different sizes can never be identical, so only same-size files are
compared: first a cheap fingerprint (size + first and last 1 MiB), then a full
BLAKE2b hash of the files that still match. Nothing is modified or deleted.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from pathlib import Path
from typing import Callable

CHUNK = 4 * 1024 * 1024
EDGE = 1024 * 1024


class DuplicateCheckCancelled(Exception):
    pass


def _fingerprint(path: Path, size: int) -> bytes:
    digest = hashlib.blake2b(digest_size=16)
    digest.update(str(size).encode())
    with path.open("rb") as handle:
        digest.update(handle.read(EDGE))
        if size > EDGE:
            handle.seek(max(0, size - EDGE))
            digest.update(handle.read(EDGE))
    return digest.digest()


def _full_hash(path: Path, tick: Callable[[int], None]) -> bytes:
    digest = hashlib.blake2b(digest_size=32)
    with path.open("rb") as handle:
        while True:
            block = handle.read(CHUNK)
            if not block:
                break
            digest.update(block)
            tick(len(block))
    return digest.digest()


def find_duplicates(paths: list[Path],
                    progress: Callable[[str, float], None] | None = None,
                    cancelled: Callable[[], bool] | None = None) -> list[list[Path]]:
    """Return groups (2+ files each, in the order given) whose bytes are identical."""
    def check() -> None:
        if cancelled is not None and cancelled():
            raise DuplicateCheckCancelled()

    by_size: dict[int, list[Path]] = defaultdict(list)
    for path in paths:
        try:
            size = Path(path).stat().st_size
        except OSError:
            continue
        if size > 0:
            by_size[size].append(Path(path))

    same_size = [group for group in by_size.values() if len(group) > 1]
    total = sum(path.stat().st_size for group in same_size for path in group) or 1
    done = 0

    def tick(amount: int) -> None:
        nonlocal done
        done += amount
        check()
        if progress:
            progress("Comparing identical-size videos…", min(1.0, done / total))

    order = {Path(p): index for index, p in enumerate(paths)}
    groups: list[list[Path]] = []
    for group in same_size:
        quick: dict[bytes, list[Path]] = defaultdict(list)
        for path in group:
            check()
            try:
                quick[_fingerprint(path, path.stat().st_size)].append(path)
            except OSError:
                continue
        for candidates in quick.values():
            if len(candidates) < 2:
                continue
            full: dict[bytes, list[Path]] = defaultdict(list)
            for path in candidates:
                try:
                    full[_full_hash(path, tick)].append(path)
                except OSError:
                    continue
            groups.extend(sorted(same, key=order.get) for same in full.values() if len(same) > 1)
    return sorted(groups, key=lambda g: order[g[0]])


def file_hash(path: Path) -> str:
    """Full BLAKE2b of one file, used by the parsed-video ledger."""
    return _full_hash(Path(path), lambda _amount: None).hex()
