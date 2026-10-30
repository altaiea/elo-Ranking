from __future__ import annotations

import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable


MODES = {
    "HARDPOINT": "Hardpoint",
    "OVERLOAD": "Overload",
    "SEARCHANDDESTROY": "Search and Destroy",
    "SEARCHDESTROY": "Search and Destroy",
}
TEAM_NAMES = {"GUILD", "JSOC"}

# Applied only while matching player names and Activision IDs. Numeric fields
# (scores, eliminations and deaths) never pass through this table.
PLAYER_OCR_EQUIVALENTS = str.maketrans({
    "0": "O",
    "1": "I",
    "|": "I",
    "!": "I",
    "2": "Z",
    "5": "S",
    "7": "T",
    "8": "B",
    "$": "S",
    "@": "A",
})

NUMERIC_OCR_EQUIVALENTS = str.maketrans({
    "O": "0", "Q": "0", "D": "0",
    "I": "1", "L": "1", "|": "1", "!": "1",
    "Z": "2", "S": "5", "G": "6", "T": "7", "B": "8",
})


def normalise(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value).upper())


def normalise_player_text(value: str) -> str:
    """Normalise OCR noise for names/IDs without touching numeric stats."""
    text = str(value).upper().translate(PLAYER_OCR_EQUIVALENTS)
    # Scoreboard rows often begin with a row number and/or player level.
    text = re.sub(r"^\s*\d{1,3}\s*", "", text)
    return re.sub(r"[^A-Z0-9]", "", text)


def _player_text_variants(value: str) -> set[str]:
    """Return plausible readings for player text only, never numeric stats."""
    raw = re.sub(r"[^A-Z0-9]", "", str(value).upper())
    variants = {normalise_player_text(value), raw}
    if raw:
        variants.update({
            raw.translate(str.maketrans({"2": "Z", "0": "U", "1": "7"})),
            raw.translate(str.maketrans({"2": "Z", "0": "O", "1": "I"})),
        })
    return {variant for variant in variants if variant}


def _key_similarity(seen: str, wanted: str) -> float:
    direct = SequenceMatcher(None, seen, wanted).ratio()
    if len(seen) >= 3 and len(wanted) >= 3:
        shorter, longer = sorted((seen, wanted), key=len)
        contained = max(
            (
                SequenceMatcher(
                    None, shorter, longer[index:index + len(shorter)]
                ).ratio()
                for index in range(len(longer) - len(shorter) + 1)
            ),
            default=0.0,
        )
    else:
        contained = 0.0
    return max(direct, contained * 0.94)


def _player_similarity(observed: str, expected: str) -> float:
    """Score deletions, insertions and common glyph substitutions."""
    seen_variants = _player_text_variants(observed)
    wanted_variants = _player_text_variants(expected)
    if not seen_variants or not wanted_variants:
        return 0.0
    return max(
        _key_similarity(seen, wanted)
        for seen in seen_variants
        for wanted in wanted_variants
    )


def parse_numeric_text(value: str, max_digits: int = 3) -> tuple[int | None, bool]:
    """Read a numeric-region token, correcting only digit-shaped glyphs.

    The caller is responsible for proving that the token is inside a score or
    statistic region. This deliberately never runs on player-name text.
    """
    compact = re.sub(r"[\s.,:_-]", "", str(value).upper())
    if not compact or len(compact) > max_digits:
        return None, False
    allowed = set("0123456789OQDIL|!ZSGTB")
    if any(character not in allowed for character in compact):
        return None, False
    corrected = compact.translate(NUMERIC_OCR_EQUIVALENTS)
    if not corrected.isdigit():
        return None, False
    return int(corrected), corrected != compact


def parse_overtime_text(value: str) -> tuple[float | None, str | None]:
    """Return Overload overtime seconds and status from a confirmed score band."""
    raw = str(value).strip().upper()
    compact = re.sub(r"\s+", "", raw)
    if compact in {"-", "--", "—", "–", "DNF"}:
        return None, "dnf"
    corrected = compact.translate(NUMERIC_OCR_EQUIVALENTS)
    match = re.fullmatch(r"(\d{1,2}):(\d{1,2})(?:[.:](\d{1,2}))?", corrected)
    if not match:
        return None, None
    minutes, seconds, fraction = match.groups()
    seconds_value = int(seconds)
    if seconds_value >= 60:
        return None, None
    fraction_value = int(fraction) / (10 ** len(fraction)) if fraction else 0.0
    return int(minutes) * 60 + seconds_value + fraction_value, "time"


@dataclass(frozen=True)
class Detection:
    text: str
    confidence: float
    box: tuple[int, int, int, int]

    @property
    def x(self) -> float:
        return (self.box[0] + self.box[2]) / 2

    @property
    def y(self) -> float:
        return (self.box[1] + self.box[3]) / 2

    @property
    def height(self) -> int:
        return self.box[3] - self.box[1]


def detections_from_data(data: dict[str, Any]) -> list[Detection]:
    return [
        Detection(str(text).strip(), float(score), tuple(map(int, box)))
        for text, score, box in zip(
            data["rec_texts"], data["rec_scores"], data["rec_boxes"]
        )
        if str(text).strip()
    ]


def load_registry(path: str | Path) -> list[dict[str, Any]]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    answer = []
    for player_id, player in data.get("players", {}).items():
        candidates = [player["codName"], *player.get("aliases", [])]
        answer.append(
            {
                "id": int(player_id),
                "name": player["name"],
                "codName": player["codName"],
                "aliases": candidates,
                "hashes": [
                    re.sub(r"\D", "", str(value))
                    for value in player.get("hashes", [])
                    if re.sub(r"\D", "", str(value))
                ],
            }
        )
    return answer


def detect_mode(items: Iterable[Detection]) -> dict[str, Any]:
    best: tuple[str, float] | None = None
    for item in items:
        seen = normalise(item.text)
        for phrase, mode in MODES.items():
            similarity = SequenceMatcher(None, seen, phrase).ratio()
            if phrase in seen:
                similarity = 1.0
            score = item.confidence * similarity
            if similarity >= 0.72 and (best is None or score > best[1]):
                best = (mode, score)
    return {"value": best[0] if best else None, "confidence": best[1] if best else 0.0}


def _best_named_anchor(items: Iterable[Detection], expected: str) -> Detection | None:
    candidates = []
    for item in items:
        similarity = SequenceMatcher(None, normalise(item.text), expected).ratio()
        if similarity >= 0.70:
            candidates.append((similarity * item.confidence, item))
    return max(candidates, default=(0.0, None), key=lambda pair: pair[0])[1]


def _read_overload_overtime(
    items: list[Detection], left: Detection, right: Detection, midpoint: float, anchor_y: float
) -> dict[str, Any] | None:
    candidates = []
    for item in items:
        seconds, status = parse_overtime_text(item.text)
        if status is None:
            continue
        if not (left.box[2] < item.x < right.box[0]):
            continue
        if abs(item.y - anchor_y) > max(55, left.height * 1.15):
            continue
        candidates.append((item, seconds, status))

    def best(side: str):
        side_items = [
            candidate for candidate in candidates
            if (candidate[0].x < midpoint) == (side == "teamA")
        ]
        return min(side_items, default=None,
                   key=lambda candidate: (abs(candidate[0].y - anchor_y),
                                          abs(candidate[0].x - midpoint)))

    team_a, team_b = best("teamA"), best("teamB")
    timed = [candidate for candidate in (team_a, team_b)
             if candidate is not None and candidate[2] == "time"]
    if not timed:
        return None
    # A lone valid time means the opposite side did not finish. Paddle often
    # omits a thin dash entirely, so absence is treated the same as DNF here.
    if team_a is None:
        team_a = (None, None, "dnf")
    if team_b is None:
        team_b = (None, None, "dnf")
    a_seconds, b_seconds = team_a[1], team_b[1]
    if a_seconds is not None and b_seconds is not None:
        if a_seconds == b_seconds:
            return None
        winner = "teamA" if a_seconds < b_seconds else "teamB"
    elif a_seconds is not None:
        winner = "teamA"
    elif b_seconds is not None:
        winner = "teamB"
    else:
        return None
    return {
        "active": True,
        "teamA": {"raw": team_a[0].text if team_a[0] else "-",
                  "seconds": a_seconds, "status": team_a[2]},
        "teamB": {"raw": team_b[0].text if team_b[0] else "-",
                  "seconds": b_seconds, "status": team_b[2]},
        "winner": winner,
        "difference": 1 if winner == "teamA" else -1,
    }


def read_teams(items: list[Detection], mode: str | None = None) -> dict[str, Any] | None:
    anchors = [anchor for name in TEAM_NAMES if (anchor := _best_named_anchor(items, name))]
    if len(anchors) != 2:
        return None
    left, right = sorted(anchors, key=lambda item: item.x)
    midpoint = (left.x + right.x) / 2
    anchor_y = (left.y + right.y) / 2

    # Scores are the large 1-3 digit readings between the two team-name anchors,
    # on the same horizontal band. Height helps reject small table values.
    numbers = [
        (item, *parse_numeric_text(item.text)) for item in items
        if parse_numeric_text(item.text)[0] is not None
        and left.box[2] < item.x < right.box[0]
        and abs(item.y - anchor_y) <= max(38, left.height * 0.8)
        and item.height >= min(left.height, right.height) * 0.55
    ]
    left_numbers = [candidate for candidate in numbers if candidate[0].x < midpoint]
    right_numbers = [candidate for candidate in numbers if candidate[0].x > midpoint]
    overtime = (
        _read_overload_overtime(items, left, right, midpoint, anchor_y)
        if mode == "Overload" else None
    )
    if (not left_numbers or not right_numbers) and overtime is None:
        return None

    left_result = (min(left_numbers, key=lambda candidate: abs(candidate[0].y - anchor_y))
                   if left_numbers else (None, None, False))
    right_result = (min(right_numbers, key=lambda candidate: abs(candidate[0].y - anchor_y))
                    if right_numbers else (None, None, False))
    left_score, left_value, left_corrected = left_result
    right_score, right_value, right_corrected = right_result
    result = {
        "teamA": {"name": left.text.upper(), "score": left_value,
                  "scoreRawText": left_score.text if left_score else None,
                  "scoreCorrected": left_corrected,
                  "scoreConfidence": left_score.confidence if left_score else 0.0},
        "teamB": {"name": right.text.upper(), "score": right_value,
                  "scoreRawText": right_score.text if right_score else None,
                  "scoreCorrected": right_corrected,
                  "scoreConfidence": right_score.confidence if right_score else 0.0},
    }
    if overtime:
        result["overtime"] = overtime
    return result


def locate_score_regions(
    data: dict[str, Any], frame_shape: tuple[int, ...]
) -> list[tuple[int, int, int, int]]:
    """Locate left/right score fallback crops using the two team-name anchors."""
    items = detections_from_data(data)
    anchors = [anchor for name in TEAM_NAMES if (anchor := _best_named_anchor(items, name))]
    frame_height, frame_width = frame_shape[:2]
    if len(anchors) == 2:
        left, right = sorted(anchors, key=lambda item: item.x)
        midpoint = (left.x + right.x) / 2
        anchor_y = (left.y + right.y) / 2
        half_width = max(80, round(frame_width * 0.115))
        centre_gap = max(12, round(frame_width * 0.012))
        half_height = max(45, round(frame_height * 0.065))
        top = max(0, round(anchor_y - half_height))
        bottom = min(frame_height, round(anchor_y + half_height))
        return [
            (max(0, round(midpoint - centre_gap - half_width)), top,
             min(frame_width, round(midpoint - centre_gap)), bottom),
            (max(0, round(midpoint + centre_gap)), top,
             min(frame_width, round(midpoint + centre_gap + half_width)), bottom),
        ]

    # HUD placement is resolution-relative. This fallback still isolates the
    # two score sides when Paddle reads only one team name. It deliberately
    # leaves a central gap so the game-mode emblem cannot merge into a digit.
    top, bottom = round(frame_height * 0.15), round(frame_height * 0.29)
    return [
        (round(frame_width * 0.39), top, round(frame_width * 0.49), bottom),
        (round(frame_width * 0.51), top, round(frame_width * 0.61), bottom),
    ]


def _player_headers(items: list[Detection]) -> list[Detection]:
    candidates: list[Detection] = []
    for item in items:
        text = normalise(item.text)
        if len(text) >= 8 and SequenceMatcher(None, text, "LEVELPLAYER").ratio() >= 0.68:
            candidates.append(item)
    # Lower-resolution frames commonly split LEVEL and PLAYER into separate
    # detections (and may read PLAYER as PLATER). Join each neighbouring pair.
    level_parts = [item for item in items if SequenceMatcher(None, normalise(item.text), "LEVEL").ratio() >= 0.75]
    player_parts = [item for item in items if SequenceMatcher(None, normalise(item.text), "PLAYER").ratio() >= 0.72]
    for level in level_parts:
        neighbours = [
            player for player in player_parts
            if 0 <= player.box[0] - level.box[2] <= max(30, level.height * 2)
            and abs(player.y - level.y) <= max(12, level.height)
        ]
        if neighbours:
            player = min(neighbours, key=lambda item: item.box[0] - level.box[2])
            candidates.append(Detection(
                "LEVELPLAYER", min(level.confidence, player.confidence),
                (level.box[0], min(level.box[1], player.box[1]),
                 player.box[2], max(level.box[3], player.box[3])),
            ))
    ordered = sorted(candidates, key=lambda item: item.x)
    distinct: list[Detection] = []
    for candidate in ordered:
        candidate_width = candidate.box[2] - candidate.box[0]
        previous_width = distinct[-1].box[2] - distinct[-1].box[0] if distinct else 0
        if not distinct or abs(candidate.x - distinct[-1].x) > max(
            30, candidate_width, previous_width
        ):
            distinct.append(candidate)
        elif candidate.confidence > distinct[-1].confidence:
            distinct[-1] = candidate
    if len(distinct) < 2:
        return distinct
    left, right = distinct[0], distinct[-1]
    # The genuine leaderboard has one header on each scoreboard half. This
    # rejects duplicate/split detections from a single team panel.
    left_width = left.box[2] - left.box[0]
    right_width = right.box[2] - right.box[0]
    minimum_separation = max(120, round(max(left_width, right_width) * 1.5))
    return [left, right] if right.x - left.x >= minimum_separation else [left]


def _registry_match(
    observed: str,
    registry: list[dict[str, Any]],
    excluded_ids: set[int] | None = None,
) -> dict[str, Any] | None:
    key = normalise_player_text(observed)
    if not key:
        return None
    ranked = []
    for player in registry:
        if excluded_ids and player["id"] in excluded_ids:
            continue
        similarity = max(_player_similarity(observed, alias) for alias in player["aliases"])
        ranked.append((similarity, player))
    if not ranked:
        return None
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    best_score, best = ranked[0]
    second_score = ranked[1][0] if len(ranked) > 1 else 0.0
    # Short names need stronger evidence because one wrong character is substantial.
    threshold = 0.72 if len(key) >= 5 else 0.78
    if best_score < threshold or best_score - second_score < 0.08:
        return None
    return {"registryId": best["id"], "name": best["codName"], "similarity": best_score}


def match_player_id(
    full_id: str,
    registry: list[dict[str, Any]],
    allowed_registry_ids: set[int] | None = None,
    excluded_registry_ids: set[int] | None = None,
    allow_unique_length: bool = False,
) -> dict[str, Any] | None:
    """Resolve one full HUD ID using name, length and optional hash evidence."""
    visible_name, separator, raw_hash = str(full_id).partition("#")
    observed_hash = re.sub(r"\D", "", raw_hash) if separator else ""
    observed_variants = _player_text_variants(visible_name)
    if not observed_variants:
        return None

    candidates = [
        player for player in registry
        if (allowed_registry_ids is None or int(player["id"]) in allowed_registry_ids)
        and (excluded_registry_ids is None
             or int(player["id"]) not in excluded_registry_ids)
    ]
    ranked: list[tuple[float, float, float, dict[str, Any]]] = []
    observed_lengths = {len(value) for value in observed_variants}
    for player in candidates:
        name_similarity = max(
            _player_similarity(visible_name, alias) for alias in player["aliases"]
        )
        expected_length = len(re.sub(r"[^A-Z0-9]", "", player["codName"].upper()))
        length_similarity = 1.0 if expected_length in observed_lengths else 0.0
        registered_hashes = player.get("hashes", [])
        hash_similarity = max(
            (SequenceMatcher(None, observed_hash, value).ratio()
             for value in registered_hashes if observed_hash and value),
            default=0.0,
        )
        if registered_hashes and observed_hash:
            combined = name_similarity * 0.65 + length_similarity * 0.10 + hash_similarity * 0.25
        else:
            combined = name_similarity * 0.88 + length_similarity * 0.12
        ranked.append((combined, name_similarity, hash_similarity, player))
    if not ranked:
        return None

    ranked.sort(key=lambda item: item[0], reverse=True)
    best_score, best_name_score, best_hash_score, best = ranked[0]
    second_score = ranked[1][0] if len(ranked) > 1 else 0.0
    accepted = best_score >= 0.76 and best_score - second_score >= 0.06

    if not accepted and allow_unique_length:
        same_length = [
            item for item in ranked
            if len(re.sub(r"[^A-Z0-9]", "", item[3]["codName"].upper()))
            in observed_lengths
        ]
        if len(same_length) == 1 and same_length[0][1] >= 0.60:
            best_score, best_name_score, best_hash_score, best = same_length[0]
            accepted = True
    if not accepted:
        return None
    return {
        "registryId": int(best["id"]),
        "name": best["codName"],
        "similarity": best_score,
        "nameSimilarity": best_name_score,
        "hashSimilarity": best_hash_score if best.get("hashes") else None,
    }


def _read_side(
    items: list[Detection],
    header: Detection,
    registry: list[dict[str, Any]],
    used_registry_ids: set[int],
) -> list[dict[str, Any]]:
    # Explicit row numbers establish the grid. If OCR merges a row number with
    # a level/name (e.g. "44iShxdows"), infer that missing row from the grid.
    numbered = sorted(
        [item for item in items if re.fullmatch(r"[1-4]", item.text)
         and header.box[0] - 70 <= item.x <= header.box[0]
         and header.box[3] < item.y < header.box[3] + 230],
        key=lambda item: item.y,
    )
    anchors = {int(item.text): item.y for item in numbered}
    steps = [
        (anchors[b] - anchors[a]) / (b - a)
        for a in anchors for b in anchors if b > a
    ]
    row_step = sorted(steps)[len(steps) // 2] if steps else header.height * 1.9
    if anchors:
        base_y = sum(y - (row - 1) * row_step for row, y in anchors.items()) / len(anchors)
    else:
        base_y = header.box[3] + header.height * 1.45

    result = []
    row_tolerance = max(6.0, min(16.0, row_step * 0.43))
    for row in range(1, 5):
        row_y = anchors.get(row, base_y + (row - 1) * row_step)
        fragments = [
            item for item in items
            if header.box[0] - 5 <= item.box[0]
            and item.box[2] <= header.box[2] + 45
            and item.y > header.box[3] + 3
            and abs(item.y - row_y) <= row_tolerance
            and not re.fullmatch(r"[1-4]", item.text)
        ]
        ordered_fragments = sorted(fragments, key=lambda item: item.x)
        raw = " ".join(part.text for part in ordered_fragments).strip()
        level_stripped = re.sub(r"^\d{1,3}\s*", "", raw).strip()
        candidate_texts = [raw, level_stripped]
        candidate_texts.extend(part.text.strip() for part in ordered_fragments)
        candidate_texts = [
            candidate for candidate in dict.fromkeys(candidate_texts)
            if len(normalise_player_text(candidate)) >= 2
        ]
        display_text = level_stripped or raw
        ocr_confidence = min((part.confidence for part in fragments), default=0.0)
        # One OCR box may only represent one HUD row, and one registry player
        # may only appear once in the eight-player roster.
        matches = [
            match
            for candidate in candidate_texts
            if (match := _registry_match(candidate, registry, used_registry_ids)) is not None
        ] if registry else []
        matched = max(matches, key=lambda match: match["similarity"], default=None)
        if matched:
            used_registry_ids.add(matched["registryId"])
        result.append({
            "row": row,
            "rawText": raw or None,
            "name": matched["name"] if matched else (display_text or None),
            "registryId": matched["registryId"] if matched else None,
            "ocrConfidence": ocr_confidence,
            "registrySimilarity": matched["similarity"] if matched else None,
            "resolved": matched is not None if registry else bool(raw),
        })
    return result


def _label(items: list[Detection], expected: str) -> Detection | None:
    ranked = []
    for item in items:
        seen = normalise(item.text)
        similarity = SequenceMatcher(None, seen, expected).ratio()
        if similarity >= 0.68:
            ranked.append((similarity * item.confidence, item))
    return max(ranked, default=(0.0, None), key=lambda pair: pair[0])[1]


def _number_below(
    items: list[Detection],
    label: Detection,
    locked_region: tuple[int, int, int, int] | None = None,
    forbidden_labels: tuple[Detection, ...] = (),
) -> Detection | None:
    label_width = label.box[2] - label.box[0]
    # Try the normal stat column first. If this selected player's OCR box is
    # slightly displaced, retry only this lookup with a modestly wider column.
    tolerances = (
        max(8, round(label_width * 0.08)),
        max(18, round(label_width * 0.18)),
    )
    for tolerance in tolerances:
        candidates = [
            item for item in items
            if not re.search(r"[.,]", item.text)
            and parse_numeric_text(item.text)[0] is not None
            and item.y > label.y
            and item.y < label.y + max(120, label.height * 5)
            and (
                (locked_region[0] - tolerance <= item.x <= locked_region[2] + tolerance
                 and locked_region[1] <= item.y <= locked_region[3])
                if locked_region is not None
                else label.box[0] - tolerance <= item.x <= label.box[2] + tolerance
            )
            and not any(
                forbidden.box[0] - tolerance <= item.x <= forbidden.box[2] + tolerance
                and item.y > forbidden.y
                for forbidden in forbidden_labels
            )
        ]
        if candidates:
            return min(
                candidates,
                key=lambda item: (item.y - label.y, abs(item.x - label.x)),
            )
    return None


def _selected_name_fallback(
    items: list[Detection],
    registry: list[dict[str, Any]],
    eliminations_label: Detection,
    deaths_label: Detection,
) -> tuple[Detection, dict[str, Any]] | None:
    """Find a registry name only in the selected-player identity band.

    This is deliberately not a general name search. The selected identity is
    rendered immediately left of the ELIMINATIONS column and on roughly the
    same horizontal band as the stat labels. Leaderboard names on the right
    side or higher rows are therefore ineligible.
    """
    if not registry:
        return None
    label_height = max(eliminations_label.height, deaths_label.height)
    label_y = (eliminations_label.y + deaths_label.y) / 2
    maximum_gap = max(35, label_height * 2.2)
    left_limit = eliminations_label.box[0] + max(12, label_height)
    minimum_right = eliminations_label.box[0] - max(
        320, (eliminations_label.box[2] - eliminations_label.box[0]) * 3
    )
    excluded = {
        "ELIMINATIONS", "DEATHS", "ELIMDRATIO", "OBJSCORE", "TIME",
        "LEVEL", "PLAYER", "SCORE", "GUILD", "JSOC",
    }
    ranked: list[tuple[float, Detection, dict[str, Any]]] = []
    for item in items:
        if "#" in item.text or normalise(item.text) in excluded:
            continue
        if parse_numeric_text(item.text)[0] is not None:
            continue
        if item.box[2] > left_limit or item.box[2] < minimum_right:
            continue
        vertical_gap = abs(item.y - label_y)
        if vertical_gap > maximum_gap:
            continue
        matched = match_player_id(item.text, registry)
        if matched is None:
            continue
        geometry = max(0.0, 1.0 - vertical_gap / maximum_gap)
        score = matched["similarity"] * 0.65 + item.confidence * 0.25 + geometry * 0.10
        ranked.append((score, item, matched))
    if not ranked:
        return None
    _score, identity, matched = max(ranked, key=lambda candidate: candidate[0])
    return identity, matched


def read_selected_player_stats(
    items: list[Detection],
    registry: list[dict[str, Any]],
    stat_regions: list[tuple[int, int, int, int]] | None = None,
) -> dict[str, Any] | None:
    # A complete Activision ID is preferred. When Paddle omits its hash suffix,
    # a tightly constrained selected-HUD name fallback may still own the stats.
    id_candidates = [item for item in items if "#" in item.text]
    eliminations_label = _label(items, "ELIMINATIONS")
    deaths_label = _label(items, "DEATHS")
    if not eliminations_label or not deaths_label:
        return None
    forbidden_labels = tuple(
        label for label in (
            _label(items, "ELIMDRATIO"),
            _label(items, "OBJSCORE"),
        )
        if label is not None
    )
    eliminations_region = stat_regions[0] if stat_regions and len(stat_regions) == 2 else None
    deaths_region = stat_regions[1] if stat_regions and len(stat_regions) == 2 else None
    eliminations = _number_below(
        items, eliminations_label, eliminations_region, forbidden_labels
    )
    deaths = _number_below(items, deaths_label, deaths_region, forbidden_labels)
    if not eliminations or not deaths:
        return None
    if id_candidates:
        identity = max(id_candidates, key=lambda item: item.confidence)
        matched = match_player_id(identity.text, registry) if registry else None
        identity_source = "full_id"
        identity_confidence = identity.confidence
        visible_name = identity.text.rsplit("#", 1)[0].strip()
        identity_text = identity.text
    else:
        fallback = _selected_name_fallback(
            items, registry, eliminations_label, deaths_label
        )
        if fallback is None:
            return None
        identity, matched = fallback
        identity_source = "selected_hud_name"
        # Name-only evidence is intentionally weaker than a complete ID.
        identity_confidence = min(identity.confidence, matched["similarity"]) * 0.85
        visible_name = identity.text.strip()
        identity_text = matched["name"]
    eliminations_value, eliminations_corrected = parse_numeric_text(eliminations.text)
    deaths_value, deaths_corrected = parse_numeric_text(deaths.text)
    return {
        "id": identity_text,
        "rawIdentityText": identity.text,
        "identitySource": identity_source,
        "fullIdResolved": identity_source == "full_id",
        "name": matched["name"] if matched else visible_name,
        "registryId": matched["registryId"] if matched else None,
        "eliminations": eliminations_value,
        "deaths": deaths_value,
        "rawNumericText": {
            "eliminations": eliminations.text,
            "deaths": deaths.text,
        },
        "numericCorrected": {
            "eliminations": eliminations_corrected,
            "deaths": deaths_corrected,
        },
        "confidence": {
            "id": identity_confidence,
            "eliminations": eliminations.confidence,
            "deaths": deaths.confidence,
        },
    }


def locate_selected_stat_regions(
    data: dict[str, Any], frame_shape: tuple[int, ...]
) -> list[tuple[int, int, int, int]]:
    """Locate video-local ELIMINATIONS and DEATHS ownership columns."""
    items = detections_from_data(data)
    labels = (_label(items, "ELIMINATIONS"), _label(items, "DEATHS"))
    if any(label is None for label in labels):
        return []
    frame_height, frame_width = frame_shape[:2]
    regions = []
    for label in labels:
        assert label is not None
        width = label.box[2] - label.box[0]
        padding = max(8, round(width * 0.08))
        regions.append((
            max(0, label.box[0] - padding),
            max(0, label.box[1]),
            min(frame_width, label.box[2] + padding),
            min(frame_height, round(label.y + max(120, label.height * 5))),
        ))
    return regions


def locate_selected_player_region(
    data: dict[str, Any], frame_shape: tuple[int, ...],
    registry: list[dict[str, Any]] | None = None,
) -> tuple[int, int, int, int] | None:
    """Locate a reusable, padded HUD crop from ID/eliminations/deaths anchors.

    The crop is intentionally wider than the currently visible ID so a longer
    player name on a later frame is not clipped. Coordinates are valid only for
    the current video and are discarded before the next video.
    """
    items = detections_from_data(data)
    ids = [item for item in items if "#" in item.text]
    eliminations_label = _label(items, "ELIMINATIONS")
    deaths_label = _label(items, "DEATHS")
    if eliminations_label is None or deaths_label is None:
        return None
    if ids:
        identity = max(ids, key=lambda item: item.confidence)
    else:
        fallback = _selected_name_fallback(
            items, registry or [], eliminations_label, deaths_label
        )
        if fallback is None:
            return None
        identity, _matched = fallback
    eliminations = _number_below(items, eliminations_label)
    deaths = _number_below(items, deaths_label)

    frame_height, frame_width = frame_shape[:2]
    # The labels and full ID are enough to establish the stable HUD layout.
    # Include recognised numbers when available, but do not make successful
    # digit recognition a prerequisite for locking the crop.
    anchors = tuple(item for item in (
        identity, eliminations_label, eliminations, deaths_label, deaths
    ) if item is not None)
    # Roughly 12% of frame width on both sides of the current ID handles much
    # longer Activision IDs while retaining one small combined OCR operation.
    left = min(item.box[0] for item in anchors)
    right = max(item.box[2] for item in anchors)
    top = min(item.box[1] for item in anchors)
    bottom = max(item.box[3] for item in anchors)
    if eliminations is None or deaths is None:
        # The value row sits immediately below the two stat labels. This extra
        # depth keeps it inside the crop even when Paddle missed it initially.
        bottom = max(bottom, max(eliminations_label.box[3], deaths_label.box[3])
                     + round(frame_height * 0.10))
    id_padding = max(30, round(frame_width * 0.12))
    vertical_padding = max(14, round(frame_height * 0.018))
    return (
        max(0, left - id_padding),
        max(0, top - vertical_padding),
        min(frame_width, right + id_padding),
        min(frame_height, bottom + vertical_padding),
    )


def parse_scoreboard_data(
    data: dict[str, Any],
    registry: list[dict[str, Any]] | None = None,
    stat_regions: list[tuple[int, int, int, int]] | None = None,
) -> dict[str, Any]:
    items = detections_from_data(data)
    mode = detect_mode(items)
    headers = _player_headers(items)
    leaderboard_visible = len(headers) == 2
    # GUILD and JSOC also appear on a pre-leaderboard introduction screen.
    # Team names and score digits are valid only when both leaderboard halves
    # are proven by their LEVEL/PLAYER headers in this same frame.
    teams = read_teams(items, mode["value"]) if leaderboard_visible else None
    if teams:
        used_registry_ids: set[int] = set()
        teams["teamA"]["players"] = _read_side(
            items, headers[0], registry or [], used_registry_ids
        )
        teams["teamB"]["players"] = _read_side(
            items, headers[1], registry or [], used_registry_ids
        )
    all_players = (
        teams["teamA"].get("players", []) + teams["teamB"].get("players", [])
        if teams else []
    )
    complete = bool(
        mode["value"] and teams
        and len(teams["teamA"].get("players", [])) == 4
        and len(teams["teamB"].get("players", [])) == 4
        and all(player["resolved"] for player in all_players)
    )
    selected_player = read_selected_player_stats(items, registry or [], stat_regions)
    mode_score = None
    if teams:
        overtime = teams.get("overtime") if mode["value"] == "Overload" else None
        mode_score = {
            "teamA": teams["teamA"]["score"],
            "teamB": teams["teamB"]["score"],
            "difference": (
                overtime["difference"] if overtime
                else teams["teamA"]["score"] - teams["teamB"]["score"]
            ),
            "overtime": overtime,
        }
    return {"complete": complete, "leaderboardVisible": leaderboard_visible,
            "mode": mode, "modeScore": mode_score,
            "teams": teams, "selectedPlayer": selected_player}


def parse_scoreboard(ocr_json: str | Path, registry_json: str | Path | None = None) -> dict[str, Any]:
    data = json.loads(Path(ocr_json).read_text(encoding="utf-8"))
    registry = load_registry(registry_json) if registry_json else None
    return parse_scoreboard_data(data, registry)
