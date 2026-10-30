import argparse
import json
import re
from datetime import date
from pathlib import Path

import cv2

from codstats_ocr.config import DEFAULT_SAMPLE_INTERVAL, VIDEO_EXTENSIONS
from codstats_ocr.elo_exporter import build_elo_document
from codstats_ocr.ocr_reader import draw_detections, read_frame
from codstats_ocr.review import review_video_result
from codstats_ocr.scoreboard_parser import load_registry, parse_scoreboard_data
from codstats_ocr.terminal_ui import accent, heading, major_divider, print_batch_summary, print_game, success
from codstats_ocr.video_scanner import scan_video


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def natural_key(path: Path) -> list[object]:
    return [int(part) if part.isdigit() else part.lower()
            for part in re.split(r"(\d+)", path.name)]


def parse_start_time(raw: str) -> float:
    value = raw.strip()
    if not value:
        return 0.0
    if ":" in value:
        minutes, seconds = value.split(":", 1)
        return max(0.0, int(minutes) * 60 + float(seconds))
    return max(0.0, float(value))


def print_frame_report(result: dict) -> None:
    print(f"\nMode: {result['mode']['value'] or 'Not found'}")
    teams = result.get("teams")
    if teams:
        left, right = teams["teamA"], teams["teamB"]
        print(f"Score: {left['name']} {left['score']} - {right['score']} {right['name']}")
        for key, label in (("teamA", "Left / Team A"), ("teamB", "Right / Team B")):
            print(f"\n{label}")
            for player in teams[key].get("players", []):
                print(f"  {player['row']}. {player['name'] or 'UNRESOLVED'}")
    player = result.get("selectedPlayer")
    if player:
        print(f"\nSelected ID: {player['id']}")
        print(f"Eliminations: {player['eliminations']}")
        print(f"Deaths: {player['deaths']}")


def print_video_report(result: dict) -> None:
    print_game(result, title=f"Game result — {result['source']}")


def process_image(source: Path, registry: list[dict]) -> None:
    frame = cv2.imread(str(source))
    if frame is None:
        raise SystemExit(f"Could not read image: {source}")
    print("PaddleOCR: detecting frame text...")
    ocr_data = read_frame(frame)
    result = parse_scoreboard_data(ocr_data, registry)
    debug, output = PROJECT_ROOT / "debug", PROJECT_ROOT / "output"
    debug.mkdir(exist_ok=True)
    output.mkdir(exist_ok=True)
    (debug / f"{source.stem}-ocr.json").write_text(json.dumps(ocr_data, indent=2), encoding="utf-8")
    cv2.imwrite(str(debug / f"{source.stem}-boxes.jpg"), draw_detections(frame, ocr_data))
    result_path = output / f"{source.stem}.json"
    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print_frame_report(result)
    print(f"\nResult: {result_path}")
    print(f"Boxes: {debug / f'{source.stem}-boxes.jpg'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Read COD scoreboard images or videos")
    parser.add_argument("input", nargs="?", default=str(PROJECT_ROOT / "sample_videos"),
                        help="Image, video, or directory (default: sample_videos)")
    parser.add_argument("--time", type=float, help="Start time for one video; skips its prompt")
    parser.add_argument("--interval", type=float, default=DEFAULT_SAMPLE_INTERVAL,
                        help=f"Seconds between samples (default: {DEFAULT_SAMPLE_INTERVAL})")
    parser.add_argument("--date", default=date.today().isoformat(),
                        help="Match date for Elo export in YYYY-MM-DD format (default: today)")
    parser.add_argument("--no-review", action="store_true",
                        help="Skip interactive end-of-video validation")
    parser.add_argument(
        "--debug-layouts", action="store_true",
        help=("Batch diagnostic route: save sampled frames and boxes, then stop each "
              "video once mode, score, roster and HUD layout are established"),
    )
    args = parser.parse_args()
    source = Path(args.input)
    if not source.exists():
        raise SystemExit(f"File not found: {source}")
    registry = load_registry(PROJECT_ROOT / "player_registry.json")
    if source.is_file() and source.suffix.lower() not in VIDEO_EXTENSIONS:
        process_image(source, registry)
        return

    videos = [source] if source.is_file() else sorted(
        (path for path in source.iterdir() if path.suffix.lower() in VIDEO_EXTENSIONS),
        key=natural_key,
    )
    if not videos:
        raise SystemExit(f"No videos found in: {source}")
    print(heading("COD Stats v1.8"))
    print(major_divider(60))
    print(f"Found {len(videos)} input video{'s' if len(videos) != 1 else ''}.")
    print("Processing order:")
    for index, video in enumerate(videos, start=1):
        print(f"  {index}. {video.name}")
    print("\nEnter every scoreboard start time first.")
    start_times: dict[Path, float] = {}
    for video in videos:
        if args.time is not None and len(videos) == 1:
            start_times[video] = max(0.0, args.time)
            continue
        while True:
            try:
                prompt = f"Start time for {video.name} (seconds or M:SS, Enter = 0): "
                start_times[video] = parse_start_time(input(prompt))
                break
            except ValueError:
                print("Enter a number such as 4.5 or a time such as 0:04.5.")

    output = PROJECT_ROOT / "output"
    output.mkdir(exist_ok=True)
    diagnostics_root = PROJECT_ROOT / "debug" / "videos"
    if args.debug_layouts:
        diagnostics_root.mkdir(parents=True, exist_ok=True)
    results = []
    print(f"\n{heading(f'Parsing {len(videos)} game' + ('s' if len(videos) != 1 else '') + ' before review...')}")
    for index, video in enumerate(videos, start=1):
        print(f"\n{accent(f'[{index}/{len(videos)}] {video.name}')}")
        video_debug = diagnostics_root / video.stem
        result = scan_video(
            video, registry, start_times[video], args.interval,
            debug_dir=video_debug if args.debug_layouts else None,
            diagnostic_only=args.debug_layouts,
        )
        print_video_report(result)
        results.append(result)
        if args.debug_layouts:
            result_path = video_debug / "result.json"
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
            print(f"Result: {accent(result_path)}")
            print(f"HUD layout diagnostics: {video_debug}")

    if args.debug_layouts:
        summary_path = diagnostics_root / "debug-summary.json"
        summary_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(f"\nDiagnostic batch complete: {summary_path}")
        print("No validation or Elo export was run in diagnostic mode.")
        return

    if not args.no_review:
        print(f"\n{heading('Validation')}")
        print(major_divider(60))
        for index, (video, result) in enumerate(zip(videos, results), start=1):
            print(f"\n{accent(f'[{index}/{len(videos)}] {video.name}')}")
            results[index - 1] = review_video_result(
                result, registry, print_video_report
            )

    for video, result in zip(videos, results):
        result_path = output / f"{video.stem}.json"
        result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(f"Result: {accent(result_path)}")

    combined_path = output / "all_results.json"
    combined_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print_batch_summary(results, title="Series summary")
    print(f"\n{success('✓ Batch complete')} | Combined results: {accent(combined_path)}")

    try:
        elo_document, skipped = build_elo_document(results, args.date)
    except ValueError as error:
        raise SystemExit(f"Cannot create Elo export: {error}") from error
    if elo_document["games"]:
        elo_path = output / f"cod_stats_{args.date}.json"
        elo_path.write_text(json.dumps(elo_document, indent=2), encoding="utf-8")
        print(f"EloSystem import: {elo_path}")
    else:
        print("EloSystem import not created: no video passed the importer contract.")
    for item in skipped:
        print(f"Elo export skipped {item['source']}: {item['reason']}")


if __name__ == "__main__":
    main()
