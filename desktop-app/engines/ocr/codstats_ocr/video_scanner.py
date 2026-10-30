"""Multi-frame video aggregation for COD scoreboard recordings."""
from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable

import json

import cv2

from .config import (
    COORDINATE_TOLERANCE,
    DEFAULT_SAMPLE_INTERVAL,
    FULL_FRAME_RECHECK_INTERVAL,
    HUD_CONFIRMATIONS_REQUIRED,
    LAYOUT_SEARCH_TIMEOUT_SECONDS,
    SCORE_CONFIRMATIONS_REQUIRED,
    TARGET_PLAYER_COUNT,
)
from .ocr_reader import (
    draw_detections,
    merge_detections,
    read_frame,
    read_frame_region,
    read_frame_region_scaled,
)
from .scoreboard_parser import (
    locate_score_regions,
    locate_selected_player_region,
    locate_selected_stat_regions,
    match_player_id,
    normalise_player_text,
    parse_scoreboard_data,
)
from .tesseract_score_reader import read_score_with_tesseract, tesseract_executable


def _weighted_choice(readings: list[tuple[Any, float]]) -> tuple[Any, float]:
    if not readings:
        return None, 0.0
    totals: dict[Any, float] = defaultdict(float)
    counts: Counter = Counter()
    for value, confidence in readings:
        if value is not None:
            totals[value] += max(0.0, float(confidence))
            counts[value] += 1
    if not totals:
        return None, 0.0
    value = max(totals, key=lambda item: (totals[item], counts[item]))
    return value, min(1.0, totals[value] / max(1, counts[value]))


def _consensus_choice(readings: list[tuple[Any, float]]) -> tuple[Any, float]:
    """Choose player stats by supporting-frame count, then confidence."""
    usable = [(value, confidence) for value, confidence in readings if value is not None]
    if not usable:
        return None, 0.0
    counts = Counter(value for value, _confidence in usable)
    totals: dict[Any, float] = defaultdict(float)
    for value, confidence in usable:
        totals[value] += max(0.0, float(confidence))
    value = max(counts, key=lambda item: (counts[item], totals[item]))
    return value, min(1.0, totals[value] / counts[value])


def _box_is_near(
    first: tuple[int, int, int, int],
    second: tuple[int, int, int, int],
    frame_shape: tuple[int, ...],
) -> bool:
    """Return true when two video-local regions describe the same layout."""
    height, width = frame_shape[:2]
    tolerances = (width, height, width, height)
    return all(
        abs(a - b) <= dimension * COORDINATE_TOLERANCE
        for a, b, dimension in zip(first, second, tolerances)
    )


def _region_pair_is_near(
    first: list[tuple[int, int, int, int]],
    second: list[tuple[int, int, int, int]],
    frame_shape: tuple[int, ...],
) -> bool:
    return len(first) == len(second) == 2 and all(
        _box_is_near(a, b, frame_shape) for a, b in zip(first, second)
    )


class VideoEvidence:
    def __init__(self, registry: list[dict[str, Any]]) -> None:
        self.registry = registry
        self.mode: list[tuple[str, float]] = []
        self.scores: list[tuple[tuple[int, int], float]] = []
        self.score_details: list[tuple[tuple[Any, ...], float]] = []
        self.team_names: dict[str, list[tuple[str, float]]] = {
            "teamA": [], "teamB": []
        }
        self.rosters: dict[str, dict[int, list[tuple[dict, float]]]] = {
            "teamA": defaultdict(list), "teamB": defaultdict(list)
        }
        self.players: dict[str, list[dict]] = defaultdict(list)
        self.frames_scanned = 0

    def add(self, parsed: dict, timestamp: float | None = None) -> None:
        self.frames_scanned += 1
        mode = parsed.get("mode", {})
        if mode.get("value"):
            self.mode.append((mode["value"], mode.get("confidence", 0.0)))
        teams = parsed.get("teams")
        if teams:
            a, b = teams["teamA"], teams["teamB"]
            confidence = min(a.get("scoreConfidence", 0.0), b.get("scoreConfidence", 0.0))
            mode_score = parsed.get("modeScore") or {}
            overtime = mode_score.get("overtime") or {}
            if a.get("score") is not None and b.get("score") is not None:
                self.scores.append(((a["score"], b["score"]), confidence))
            normal_difference = (
                a["score"] - b["score"]
                if a.get("score") is not None and b.get("score") is not None
                else None
            )
            self.score_details.append(((
                a["score"], b["score"], mode_score.get("difference", normal_difference),
                bool(overtime.get("active")),
                (overtime.get("teamA") or {}).get("raw"),
                (overtime.get("teamA") or {}).get("seconds"),
                (overtime.get("teamB") or {}).get("raw"),
                (overtime.get("teamB") or {}).get("seconds"),
                overtime.get("winner"),
            ), confidence))
            for team_key in ("teamA", "teamB"):
                team = teams[team_key]
                if team.get("name"):
                    self.team_names[team_key].append((team["name"], team.get("scoreConfidence", 0.0)))
                for player in teams[team_key].get("players", []):
                    if player.get("resolved") or player.get("rawText"):
                        similarity = player.get("registrySimilarity") or 0.25
                        combined = player.get("ocrConfidence", 0.0) * similarity
                        self.rosters[team_key][int(player["row"])].append((player, combined))
        selected = parsed.get("selectedPlayer")
        if selected and selected.get("id"):
            key = str(selected.get("registryId") or normalise_player_text(selected["id"]))
            # Remember which video time this reading came from, so the review
            # screen can jump to where the parser actually read the player.
            # (Bookkeeping only: no OCR or matching decision uses this value.)
            selected = dict(selected)
            selected["sampleSeconds"] = timestamp
            self.players[key].append(selected)

    def unique_player_count(self) -> int:
        return len(self.players)

    def roster_player_count(self) -> int:
        return len({
            int(player["registryId"])
            for team in self.rosters.values()
            for candidates in team.values()
            for player, _confidence in candidates
            if player.get("registryId") is not None
        })

    def static_layout_ready(self) -> bool:
        return bool(self.mode and self.score_details
                    and self.roster_player_count() >= TARGET_PLAYER_COUNT)

    def all_players_complete(self) -> bool:
        return self.unique_player_count() >= TARGET_PLAYER_COUNT and all(
            any(item.get("eliminations") is not None and item.get("deaths") is not None
                for item in observations)
            for observations in self.players.values()
        )

    def result(self, source: Path, start_time: float, interval: float) -> dict:
        mode, mode_confidence = _weighted_choice(self.mode)
        score, score_confidence = _weighted_choice(self.scores)
        score_detail, detail_confidence = _weighted_choice(self.score_details)
        teams: dict[str, dict] = {}
        registry_team: dict[int, str] = {}

        # Choose roster entries globally, not independently per row. This stops
        # the same registry player winning two different rows across frames.
        assignments: dict[tuple[str, int], tuple[dict, float]] = {}
        used_registry_ids: set[int] = set()
        ranked_candidates: list[tuple[float, str, int, dict]] = []
        for team_key in ("teamA", "teamB"):
            for row in range(1, 5):
                for player, confidence in self.rosters[team_key].get(row, []):
                    candidate = dict(player)
                    if candidate.get("registryId") is None and candidate.get("rawText"):
                        matched = match_player_id(
                            candidate["rawText"], self.registry,
                            allow_unique_length=True,
                        )
                        if matched:
                            candidate.update({
                                "name": matched["name"],
                                "registryId": matched["registryId"],
                                "registrySimilarity": matched["similarity"],
                                "resolved": True,
                            })
                            confidence = (
                                candidate.get("ocrConfidence", 0.0)
                                * matched["similarity"]
                            )
                    ranked_candidates.append((confidence, team_key, row, candidate))
        ranked_candidates.sort(key=lambda item: item[0], reverse=True)
        for confidence, team_key, row, player in ranked_candidates:
            slot = (team_key, row)
            registry_id = player.get("registryId")
            if slot in assignments or registry_id is None:
                continue
            registry_id = int(registry_id)
            if registry_id in used_registry_ids:
                continue
            assignments[slot] = (player, confidence)
            used_registry_ids.add(registry_id)

        for team_key in ("teamA", "teamB"):
            team_name, team_name_confidence = _weighted_choice(self.team_names[team_key])
            rows = []
            for row in range(1, 5):
                assignment = assignments.get((team_key, row))
                if assignment:
                    player, confidence = assignment
                    player = dict(player)
                    player["combinedConfidence"] = confidence
                    rows.append(player)
                    if player.get("registryId") is not None:
                        registry_team[int(player["registryId"])] = team_key
                else:
                    rows.append({"row": row, "name": None, "resolved": False})
            teams[team_key] = {
                "name": team_name,
                "nameConfidence": team_name_confidence,
                "players": rows,
            }

        expected_registry_ids = set(registry_team)
        roster_filter = (
            expected_registry_ids
            if len(expected_registry_ids) == TARGET_PLAYER_COUNT
            else None
        )
        reconciled: dict[str, list[dict]] = defaultdict(list)
        for observations in self.players.values():
            for observation in observations:
                item = dict(observation)
                registry_id = item.get("registryId")
                if registry_id is None or (
                    expected_registry_ids and int(registry_id) not in expected_registry_ids
                ):
                    matched = match_player_id(
                        item.get("id", ""), self.registry,
                        allowed_registry_ids=roster_filter,
                        allow_unique_length=True,
                    )
                    if matched:
                        registry_id = matched["registryId"]
                        item["registryId"] = registry_id
                        item["name"] = matched["name"]
                        item["registrySimilarity"] = matched["similarity"]
                key = (
                    f"registry:{int(registry_id)}"
                    if registry_id is not None
                    else f"ocr:{normalise_player_text(item.get('id', ''))}"
                )
                reconciled[key].append(item)

        players = []
        player_sources: dict[str, dict] = {}
        for observations in reconciled.values():
            # Prefer a later complete Name#hash observation over an earlier,
            # even higher-confidence name-only fallback.
            representative = max(
                observations,
                key=lambda item: (
                    bool(item.get("fullIdResolved", "#" in item.get("id", ""))),
                    item.get("confidence", {}).get("id", 0.0),
                ),
            )
            eliminations, elim_confidence = _consensus_choice([
                (item.get("eliminations"), item.get("confidence", {}).get("eliminations", 0.0))
                for item in observations
            ])
            deaths, death_confidence = _consensus_choice([
                (item.get("deaths"), item.get("confidence", {}).get("deaths", 0.0))
                for item in observations
            ])
            registry_id = representative.get("registryId")
            timed = [item for item in observations if item.get("sampleSeconds") is not None]
            if registry_id is not None and timed:
                # Prefer the sample whose readings produced the chosen eliminations
                # and deaths (full ID first, then highest confidence).
                agreeing = [item for item in timed
                            if item.get("eliminations") == eliminations and item.get("deaths") == deaths]
                best = max(agreeing or timed, key=lambda item: (
                    bool(item.get("fullIdResolved", "#" in item.get("id", ""))),
                    item.get("confidence", {}).get("eliminations", 0.0)
                    + item.get("confidence", {}).get("deaths", 0.0)
                    + item.get("confidence", {}).get("id", 0.0),
                ))
                player_sources[str(int(registry_id))] = {
                    "best": round(float(best["sampleSeconds"]), 3),
                    "all": sorted({round(float(item["sampleSeconds"]), 3) for item in timed}),
                }
            players.append({
                "team": registry_team.get(int(registry_id)) if registry_id is not None else None,
                "name": representative.get("name"), "id": representative.get("id"),
                "registryId": registry_id, "eliminations": eliminations, "deaths": deaths,
                "confidence": {
                    "id": representative.get("confidence", {}).get("id", 0.0),
                    "eliminations": elim_confidence, "deaths": death_confidence,
                },
                "supportingFrames": len(observations),
            })
        players.sort(key=lambda item: (item["team"] or "teamZ", item["registryId"] or 9999))
        mode_score = None
        if score_detail is not None:
            (team_a_score, team_b_score, difference, is_overtime,
             team_a_raw, team_a_seconds, team_b_raw, team_b_seconds, winner) = score_detail
            mode_score = {
                "teamAName": teams["teamA"]["name"], "teamA": team_a_score,
                "teamBName": teams["teamB"]["name"], "teamB": team_b_score,
                "difference": difference,
                "confidence": detail_confidence,
                "overtime": ({
                    "active": True,
                    "teamA": {"raw": team_a_raw, "seconds": team_a_seconds,
                              "status": "time" if team_a_seconds is not None else "dnf"},
                    "teamB": {"raw": team_b_raw, "seconds": team_b_seconds,
                              "status": "time" if team_b_seconds is not None else "dnf"},
                    "winner": winner,
                    "difference": difference,
                } if is_overtime else None),
            }
        elif score is not None:
            mode_score = {
                "teamAName": teams["teamA"]["name"], "teamA": score[0],
                "teamBName": teams["teamB"]["name"], "teamB": score[1],
                "difference": score[0] - score[1], "confidence": score_confidence,
                "overtime": None,
            }
        return {
            "source": source.name, "startTime": start_time, "sampleInterval": interval,
            "framesScanned": self.frames_scanned,
            "complete": len(players) == TARGET_PLAYER_COUNT and all(
                item["eliminations"] is not None and item["deaths"] is not None for item in players
            ),
            "mode": {"value": mode, "confidence": mode_confidence},
            "modeScore": mode_score, "teams": teams, "players": players,
            "playerSources": player_sources,
        }


def scan_video(video_path: str | Path, registry: list[dict], start_time: float,
               interval: float = DEFAULT_SAMPLE_INTERVAL,
               progress: Callable[[str], None] = print,
               debug_dir: str | Path | None = None,
               diagnostic_only: bool = False) -> dict:
    path = Path(video_path)
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {path}")
    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = frame_count / fps if frame_count else start_time
    evidence = VideoEvidence(registry)
    first_timestamp = max(0.0, start_time)
    locked_region: tuple[int, int, int, int] | None = None
    hud_candidate: tuple[int, int, int, int] | None = None
    hud_candidate_count = 0
    locked_at: float | None = None
    locked_score_regions: list[tuple[int, int, int, int]] | None = None
    score_candidate: list[tuple[int, int, int, int]] | None = None
    score_candidate_count = 0
    score_locked_at: float | None = None
    locked_stat_regions: list[tuple[int, int, int, int]] | None = None
    stat_candidate: list[tuple[int, int, int, int]] | None = None
    stat_candidate_count = 0
    stats_locked_at: float | None = None
    intro_ignore_notice_shown = False
    full_frame_ready_announced = False
    tesseract_notice_shown = False
    diagnostic_frame_index = 0
    scanned_frame_index = 0
    diagnostics = Path(debug_dir) if debug_dir is not None else None
    if diagnostics is not None:
        diagnostics.mkdir(parents=True, exist_ok=True)

    def save_layout_image(name: str, frame, regions: list[tuple[int, int, int, int]],
                          labels: list[str]) -> None:
        if diagnostics is None:
            return
        image = frame.copy()
        colours = ((0, 255, 255), (255, 180, 0), (0, 255, 0))
        for index, (region, label) in enumerate(zip(regions, labels)):
            left, top, right, bottom = region
            colour = colours[index % len(colours)]
            cv2.rectangle(image, (left, top), (right, bottom), colour, 3)
            cv2.putText(image, label, (left, max(28, top - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, colour, 2, cv2.LINE_AA)
        cv2.imwrite(str(diagnostics / name), image)

    def save_sample_diagnostics(
        frame,
        timestamp: float,
        pass_label: str,
        scan_kind: str,
        ocr_data: dict,
        parsed: dict,
        score_regions: list[tuple[int, int, int, int]] | None,
        stat_regions: list[tuple[int, int, int, int]] | None,
    ) -> None:
        """Persist an exact audit trail for one frame actually sent to OCR."""
        nonlocal diagnostic_frame_index
        if diagnostics is None:
            return
        diagnostic_frame_index += 1
        frame_folder = diagnostics / "frames" / (
            f"{diagnostic_frame_index:04d}-{timestamp:08.3f}s"
        )
        frame_folder.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(frame_folder / "original.jpg"), frame)
        cv2.imwrite(
            str(frame_folder / "all-ocr-boxes.jpg"),
            draw_detections(frame, ocr_data),
        )

        regions: list[tuple[int, int, int, int]] = []
        labels: list[str] = []
        if score_regions:
            regions.extend(score_regions)
            labels.extend(("TEAM A SCORE", "TEAM B SCORE"))
        if stat_regions:
            regions.extend(stat_regions)
            labels.extend(("ELIMINATIONS ONLY", "DEATHS ONLY"))
        if locked_region is not None:
            regions.append(locked_region)
            labels.append("LOCKED HUD")
        region_image = frame.copy()
        colours = ((0, 255, 255), (255, 180, 0), (0, 255, 0))
        for index, (region, label) in enumerate(zip(regions, labels)):
            left, top, right, bottom = region
            colour = colours[index % len(colours)]
            cv2.rectangle(region_image, (left, top), (right, bottom), colour, 3)
            cv2.putText(region_image, label, (left, max(28, top - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, colour, 2, cv2.LINE_AA)
        cv2.imwrite(str(frame_folder / "extraction-regions.jpg"), region_image)
        (frame_folder / "diagnostics.json").write_text(
            json.dumps({
                "timestampSeconds": timestamp,
                "pass": pass_label,
                "scanKind": scan_kind,
                "scoreRegions": [list(region) for region in score_regions or []],
                "statRegions": [list(region) for region in stat_regions or []],
                "hudRegion": list(locked_region) if locked_region is not None else None,
                "ocr": ocr_data,
                "parsed": parsed,
            }, indent=2),
            encoding="utf-8",
        )

    def run_pass(timestamp: float, step: float, label: str) -> bool:
        nonlocal locked_region, hud_candidate, hud_candidate_count, locked_at
        nonlocal locked_score_regions, score_candidate, score_candidate_count
        nonlocal score_locked_at, full_frame_ready_announced, tesseract_notice_shown
        nonlocal locked_stat_regions, stat_candidate, stat_candidate_count
        nonlocal stats_locked_at
        nonlocal intro_ignore_notice_shown
        nonlocal scanned_frame_index
        total = max(1, int(max(0.0, duration - timestamp) / step) + 1)
        sample = 0
        progress(label)
        while timestamp <= duration + 1e-6:
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
            success, frame = capture.read()
            if not success:
                break
            scanned_frame_index += 1
            metadata_ready_before_scan = evidence.static_layout_ready()
            recovery_scan = (
                locked_region is not None
                and not metadata_ready_before_scan
                and (scanned_frame_index - 1) % FULL_FRAME_RECHECK_INTERVAL == 0
            )
            use_full_frame = locked_region is None or recovery_scan
            score_regions = locked_score_regions
            stat_regions = locked_stat_regions

            if use_full_frame:
                ocr_data = read_frame(frame)
                if diagnostics is not None and not (diagnostics / "full-frame-reference.jpg").exists():
                    cv2.imwrite(str(diagnostics / "full-frame-reference.jpg"), frame)
                parsed = parse_scoreboard_data(ocr_data, registry)

                # Score geometry is learned independently of successful digit
                # recognition. It is accepted after two nearby observations.
                observed_score_regions = (
                    locate_score_regions(ocr_data, frame.shape)
                    if parsed.get("leaderboardVisible") else []
                )
                if (not parsed.get("leaderboardVisible")
                        and not intro_ignore_notice_shown):
                    texts = {str(text).upper() for text in ocr_data.get("rec_texts", [])}
                    if any("GUILD" in text for text in texts) and any(
                            "JSOC" in text for text in texts):
                        progress(
                            "    GUILD/JSOC introduction screen ignored; waiting for "
                            "both leaderboard headers."
                        )
                        intro_ignore_notice_shown = True
                if observed_score_regions:
                    if (score_candidate is not None and _region_pair_is_near(
                            score_candidate, observed_score_regions, frame.shape)):
                        score_candidate_count += 1
                    else:
                        score_candidate = observed_score_regions
                        score_candidate_count = 1
                    score_confirmation_ready = (
                        score_candidate_count >= SCORE_CONFIRMATIONS_REQUIRED
                        or timestamp - first_timestamp >= LAYOUT_SEARCH_TIMEOUT_SECONDS
                    )
                    if locked_score_regions is None and score_confirmation_ready:
                        locked_score_regions = observed_score_regions
                        score_locked_at = timestamp
                        progress(
                            "    Score coordinates locked: "
                            f"A={locked_score_regions[0]}, B={locked_score_regions[1]}"
                        )
                        save_layout_image(
                            "score-regions.jpg", frame, locked_score_regions,
                            ["TEAM A SCORE", "TEAM B SCORE"],
                        )
                    score_regions = locked_score_regions or observed_score_regions

                if (parsed.get("leaderboardVisible")
                        and parsed.get("mode", {}).get("value")
                        and not parsed.get("modeScore")):
                    if score_regions:
                        progress("    Score not found in full frame; trying enlarged anchor crops...")
                        recovered = [
                            read_frame_region_scaled(frame, region)
                            for region in score_regions
                        ]
                        ocr_data = merge_detections(ocr_data, *recovered)
                        parsed = parse_scoreboard_data(ocr_data, registry)
                        if parsed.get("modeScore"):
                            progress("    Score recovered from enlarged anchor crops.")
                        else:
                            if not tesseract_notice_shown:
                                if tesseract_executable():
                                    progress("    Paddle score unresolved; trying digit-only Tesseract...")
                                else:
                                    progress(
                                        "    Paddle score unresolved; Tesseract is not installed "
                                        "or not on PATH."
                                    )
                                tesseract_notice_shown = True
                            tesseract_data = read_score_with_tesseract(
                                frame, score_regions, parsed.get("mode", {}).get("value")
                            )
                            if tesseract_data["rec_texts"]:
                                ocr_data = merge_detections(ocr_data, tesseract_data)
                                parsed = parse_scoreboard_data(ocr_data, registry)
                                if parsed.get("modeScore"):
                                    progress("    Score recovered with Tesseract voting.")

                observed_stat_regions = locate_selected_stat_regions(ocr_data, frame.shape)
                if observed_stat_regions:
                    if (stat_candidate is not None and _region_pair_is_near(
                            stat_candidate, observed_stat_regions, frame.shape)):
                        stat_candidate_count += 1
                    else:
                        stat_candidate = observed_stat_regions
                        stat_candidate_count = 1
                    if (locked_stat_regions is None
                            and stat_candidate_count >= HUD_CONFIRMATIONS_REQUIRED):
                        locked_stat_regions = observed_stat_regions
                        stats_locked_at = timestamp
                        progress(
                            "    Stat columns locked: "
                            f"eliminations={locked_stat_regions[0]}, "
                            f"deaths={locked_stat_regions[1]}"
                        )
                        save_layout_image(
                            "stat-regions.jpg", frame, locked_stat_regions,
                            ["ELIMINATIONS ONLY", "DEATHS ONLY"],
                        )
                    stat_regions = locked_stat_regions or observed_stat_regions
                    parsed = parse_scoreboard_data(ocr_data, registry, stat_regions)
                evidence.add(parsed, timestamp)

                # The selected-player crop is also confirmed geometrically;
                # recognised stat digits are not required by its locator.
                candidate_region = locate_selected_player_region(
                    ocr_data, frame.shape, registry
                )
                if candidate_region is not None and locked_region is None:
                    if (hud_candidate is not None
                            and _box_is_near(hud_candidate, candidate_region, frame.shape)):
                        hud_candidate_count += 1
                    else:
                        hud_candidate = candidate_region
                        hud_candidate_count = 1
                    progress(
                        f"    HUD coordinate confirmation: "
                        f"{hud_candidate_count}/{HUD_CONFIRMATIONS_REQUIRED}"
                    )
                    hud_confirmation_ready = (
                        hud_candidate_count >= HUD_CONFIRMATIONS_REQUIRED
                        or timestamp - first_timestamp >= LAYOUT_SEARCH_TIMEOUT_SECONDS
                    )
                    if hud_confirmation_ready:
                        locked_region = candidate_region
                        locked_at = timestamp
                        left, top, right, bottom = locked_region
                        progress(
                            f"    HUD coordinates locked for this video: "
                            f"x={left}:{right}, y={top}:{bottom}"
                        )
                        save_layout_image(
                            "locked-hud-layout.jpg", frame, [locked_region], ["LOCKED HUD"]
                        )
                        if diagnostics is not None:
                            cv2.imwrite(
                                str(diagnostics / "locked-hud-crop.jpg"),
                                frame[top:bottom, left:right],
                            )
                if (locked_region is not None and evidence.static_layout_ready()
                        and not full_frame_ready_announced):
                    full_frame_ready_announced = True
                    progress(
                        "    Full-frame setup complete; subsequent frames use only the locked HUD."
                    )
            else:
                ocr_data = read_frame_region(frame, locked_region)
                parsed = parse_scoreboard_data(ocr_data, registry, locked_stat_regions)
                evidence.add(parsed, timestamp)
            sample += 1
            if use_full_frame and recovery_scan:
                scan_kind = "full-frame recovery"
            elif use_full_frame:
                scan_kind = "full-frame layout search"
            else:
                scan_kind = "locked HUD"
            save_sample_diagnostics(
                frame, timestamp, label, scan_kind, ocr_data, parsed,
                score_regions, stat_regions,
            )
            progress(
                f"    [{sample}/{total}] {timestamp:.2f}s — {scan_kind} — "
                f"{evidence.unique_player_count()}/{TARGET_PLAYER_COUNT} players with stats found"
            )
            if (diagnostic_only and locked_region is not None
                    and evidence.static_layout_ready()):
                progress(
                    "    Diagnostic target reached: mode, score, eight-player roster "
                    "and HUD layout found. Moving to the next video."
                )
                return True
            if evidence.static_layout_ready() and evidence.all_players_complete():
                progress(
                    f"    Mode, score, roster and all {TARGET_PLAYER_COUNT} "
                    "IDs/statistics found. "
                    "Moving to the next video."
                )
                return True
            timestamp += step
        return False

    fallback_used = False
    scan_error = None
    try:
        finished = run_pass(first_timestamp, interval, f"  First pass: every {interval:.2f}s")
        if (not finished and evidence.unique_player_count() < TARGET_PLAYER_COUNT
                and interval >= DEFAULT_SAMPLE_INTERVAL):
            fallback_used = True
            progress(
                f"  Only {evidence.unique_player_count()}/{TARGET_PLAYER_COUNT} players with stats found. "
                "Checking the missing 0.20s frames..."
            )
            # Scan only the timestamps between the first pass samples. Together
            # the two passes provide 0.20-second coverage without re-reading the
            # same frames.
            run_pass(first_timestamp + interval / 2, interval, "  Fallback pass: offset by 0.20s")
    except Exception as error:  # keep what was read so far; validation fills the gaps
        scan_error = f"{type(error).__name__}: {error}"
        progress(f"  Scan stopped early ({scan_error}). Keeping the readings found so far.")
    finally:
        capture.release()
    effective_interval = interval / 2 if fallback_used else interval
    result = evidence.result(path, start_time, effective_interval)
    if scan_error:
        result["scanError"] = scan_error
        result["complete"] = False
    result["hudLayout"] = {
        "locked": locked_region is not None,
        "coordinates": list(locked_region) if locked_region is not None else None,
        "lockedAtSeconds": locked_at,
        "fullFrameSetupComplete": evidence.static_layout_ready(),
    }
    result["scoreLayout"] = {
        "locked": locked_score_regions is not None,
        "coordinates": (
            [list(region) for region in locked_score_regions]
            if locked_score_regions is not None else None
        ),
        "lockedAtSeconds": score_locked_at,
    }
    result["statLayout"] = {
        "locked": locked_stat_regions is not None,
        "coordinates": (
            [list(region) for region in locked_stat_regions]
            if locked_stat_regions is not None else None
        ),
        "lockedAtSeconds": stats_locked_at,
    }
    if diagnostics is not None:
        (diagnostics / "layout.json").write_text(
            json.dumps({
                "hud": result["hudLayout"],
                "score": result["scoreLayout"],
                "stats": result["statLayout"],
            }, indent=2),
            encoding="utf-8",
        )
    return result


def find_scoreboard_start(video_path: str | Path, registry: list[dict], step: float = 2.0,
                          progress: Callable[[str], None] = print) -> float:
    """Coarse search for the first frame that shows the leaderboard.

    Used for videos that arrive from the Google Drive folder, where nobody has
    chosen a start time. Returns a time a little before the leaderboard, or
    0.0 if it was never seen (the normal scan then covers the whole video).
    """
    path = Path(video_path)
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {path}")
    try:
        fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = frame_count / fps if frame_count else 0.0
        timestamp = 0.0
        progress(f"  Finding the scoreboard: checking every {step:.0f}s of {duration:.0f}s")
        while timestamp <= duration:
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
            success, frame = capture.read()
            if not success:
                break
            if parse_scoreboard_data(read_frame(frame), registry).get("leaderboardVisible"):
                start = max(0.0, timestamp - step)
                progress(f"  Scoreboard first seen near {timestamp:.1f}s; parsing from {start:.1f}s")
                return start
            timestamp += step
    finally:
        capture.release()
    progress("  Scoreboard not found in the coarse search; parsing the whole video.")
    return 0.0
