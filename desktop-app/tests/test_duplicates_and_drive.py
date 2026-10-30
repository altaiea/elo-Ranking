from __future__ import annotations

import sys
import time
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))

from codstats.drive_watcher import DriveWatcher  # noqa: E402
from codstats.duplicate_scores import find_suspects, same_map  # noqa: E402


def result(source, score=(250, 200), stats=None, mode="Hardpoint"):
    stats = stats or {pid: (20 + pid, 15) for pid in range(1, 9)}
    return {"source": source, "mode": {"value": mode}, "modeScore": {"teamA": score[0], "teamB": score[1]},
            "players": [{"registryId": pid, "eliminations": k, "deaths": d} for pid, (k, d) in stats.items()]}


def test_two_recordings_of_one_map_are_suspects():
    first, second = result("a.mp4"), result("b.mp4")
    assert same_map(first, second)
    assert find_suspects([first, second]) == [(1, 0)]


def test_partial_read_still_matches_and_different_stats_do_not():
    seven = result("b.mp4", stats={pid: (20 + pid, 15) for pid in range(1, 8)})
    assert same_map(result("a.mp4"), seven)
    changed = result("c.mp4", stats={pid: (20 + pid, 16) for pid in range(1, 9)})
    assert not same_map(result("a.mp4"), changed)
    assert not same_map(result("a.mp4"), result("d.mp4", score=(250, 199)))


def test_history_maps_are_checked_too():
    report = {"source": "old.mp4", "date": "2026-10-28", "gameMode": "Hardpoint",
              "game": {"result": {"type": "score", "score": {"teamA": 250, "teamB": 200}},
                       "teams": {"A": [{"playerId": p, "kills": 20 + p, "deaths": 15} for p in (1, 2, 3, 4)],
                                 "B": [{"playerId": p, "kills": 20 + p, "deaths": 15} for p in (5, 6, 7, 8)]}}}
    suspects = find_suspects([result("new.mp4")], [report])
    assert suspects and suspects[0][1] is report


def test_drive_watcher_waits_for_upload_then_reports_once(tmp_path):
    folder = tmp_path / "drive"; folder.mkdir()
    watcher = DriveWatcher(folder, tmp_path / "ledger.json", settle_seconds=0.2)
    video = folder / "1.mp4"; video.write_bytes(b"x" * 1000)
    (folder / "2.mp4.crdownload").write_bytes(b"partial")
    assert watcher.poll() == []                     # first sighting: not settled yet
    time.sleep(0.3)
    assert watcher.poll() == [(video, None)]
    assert watcher.poll() == []                     # never twice
    copy = folder / "sub" / "1 copy.mp4"; copy.parent.mkdir(); copy.write_bytes(b"x" * 1000)
    watcher.poll(); time.sleep(0.3)
    assert watcher.poll() == [(copy, "1.mp4")]      # byte-identical re-upload is flagged
    restarted = DriveWatcher(folder, tmp_path / "ledger.json", settle_seconds=0.0)
    assert restarted.poll() == []                   # the ledger survives a restart
