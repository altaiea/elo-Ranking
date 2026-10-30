"""Isolated OCR subprocess. It never reads or writes Elo state."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path


# A packaged (PyInstaller) program ignores PYTHONIOENCODING / PYTHONUTF8, so its
# piped stdout falls back to the Windows cp1252 code page and crashes on the
# box-drawing characters terminal_ui prints, before the result file is saved.
# Force UTF-8 here; the app decodes the worker's output as UTF-8.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
OCR_ROOT = ROOT / "engines" / "ocr"
sys.path.insert(0, str(OCR_ROOT))

from codstats_ocr.scoreboard_parser import load_registry  # noqa: E402
from codstats_ocr.terminal_ui import print_game  # noqa: E402
from codstats_ocr.video_scanner import find_scoreboard_start, scan_video  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--start", default="0", help="seconds, or auto to find the scoreboard")
    args = parser.parse_args()

    registry_path = Path(os.environ.get("CODSTATS_REGISTRY", str(OCR_ROOT / "player_registry.json")))
    registry = load_registry(registry_path)
    debug_root = Path(os.environ.get("CODSTATS_DEBUG_DIR", str(ROOT / "data" / "debug")))
    debug_dir = debug_root / args.video.stem
    # Start clean: an older video with the same name must not leave frames
    # behind that would be read as this video's evidence.
    shutil.rmtree(debug_dir, ignore_errors=True)
    print(f"\n[1/1] {args.video.name}", flush=True)
    print("PaddleOCR: loading models and starting the video scan...", flush=True)
    try:
        if str(args.start).lower() == "auto":
            start = find_scoreboard_start(args.video, registry, progress=lambda message: print(message, flush=True))
        else:
            start = max(0.0, float(args.start))
        print(f"Start time: {start:.2f}s", flush=True)
        result = scan_video(
            args.video,
            registry,
            start,
            progress=lambda message: print(message, flush=True),
            debug_dir=debug_dir,
        )
    except Exception as error:
        # Even a video that cannot be read goes to validation, as a blank game
        # to fill in by hand next to the footage.
        print(f"Parser error: {type(error).__name__}: {error}", flush=True)
        result = {"source": args.video.name, "mode": {"value": None, "confidence": 0.0},
                  "modeScore": None, "teams": {}, "players": [], "framesScanned": 0,
                  "complete": False, "scanError": f"{type(error).__name__}: {error}"}
    try:
        print_game(result, title=f"Game result — {result['source']}")
    except Exception as error:  # the summary is cosmetic; never lose the result over it
        print(f"(Could not print the summary: {error})", flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Persist the OCR result before collecting optional UI diagnostics, so a
    # damaged debug file cannot erase a valid parse.
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    player_timestamps: dict[str, list[float]] = {}
    confidence_log = args.output.with_name(args.output.stem + "-confidence.jsonl")
    try:
        with confidence_log.open("w", encoding="utf-8") as log:
            for diagnostic_path in sorted((debug_dir / "frames").glob("*/diagnostics.json")):
                diagnostic = json.loads(diagnostic_path.read_text(encoding="utf-8"))
                timestamp = float(diagnostic.get("timestampSeconds", 0.0))
                log.write(json.dumps({
                    "timestampSeconds": timestamp,
                    "scanKind": diagnostic.get("scanKind"),
                    "ocr": diagnostic.get("ocr"),
                }, ensure_ascii=False) + "\n")
                selected = (diagnostic.get("parsed") or {}).get("selectedPlayer") or {}
                registry_id = selected.get("registryId")
                if registry_id is not None:
                    player_timestamps.setdefault(str(registry_id), []).append(timestamp)
        result["playerEvidenceTimestamps"] = player_timestamps
        result["confidenceLog"] = str(confidence_log)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        print(f"Warning: confidence diagnostics could not be prepared: {error}", flush=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"RESULT={args.output}", flush=True)


if __name__ == "__main__":
    main()
