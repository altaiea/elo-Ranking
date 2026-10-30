"""Optional digit-only Tesseract fallback for unresolved mode scores."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any

import cv2
import numpy as np


def tesseract_executable() -> str | None:
    """Find Tesseract from PATH, an override, or standard Windows locations."""
    override = os.environ.get("TESSERACT_CMD")
    candidates = [
        override,
        shutil.which("tesseract"),
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(candidate)
    return None


def _variants(crop: np.ndarray) -> list[np.ndarray]:
    enlarged = cv2.resize(crop, None, fx=5.0, fy=5.0, interpolation=cv2.INTER_LANCZOS4)
    gray = cv2.cvtColor(enlarged, cv2.COLOR_BGR2GRAY)
    _threshold, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return [gray, binary, cv2.bitwise_not(binary)]


def _recognise(executable: str, image: np.ndarray, page_mode: int) -> str:
    success, encoded = cv2.imencode(".png", image)
    if not success:
        return ""
    command = [
        executable, "stdin", "stdout", "--psm", str(page_mode),
        "-c", "tessedit_char_whitelist=0123456789",
    ]
    process = subprocess.run(
        command,
        input=encoded.tobytes(),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return process.stdout.decode("utf-8", errors="ignore").strip()


def _choose_reading(readings: list[str], mode: str | None) -> tuple[int | None, float]:
    values = []
    for reading in readings:
        digits = re.sub(r"\D", "", reading)
        if not digits or len(digits) > 3:
            continue
        value = int(digits)
        if mode == "Search and Destroy" and value > 6:
            continue
        values.append(value)
    if not values:
        return None, 0.0
    counts = Counter(values)
    value, votes = max(counts.items(), key=lambda item: (item[1], -item[0]))
    return value, votes / len(values)


def _digit_crop(
    frame: np.ndarray,
    region: tuple[int, int, int, int],
    side: str,
) -> np.ndarray:
    left, top, right, bottom = region
    width, height = right - left, bottom - top
    # Score digits sit toward the centre: use the inner 65% of each anchor crop
    # and remove the lowest portion containing round/progress marker bars.
    if side == "left":
        left += round(width * 0.35)
    else:
        right -= round(width * 0.35)
    top += round(height * 0.10)
    bottom -= round(height * 0.24)
    return frame[max(0, top):max(0, bottom), max(0, left):max(0, right)]


def read_score_with_tesseract(
    frame: np.ndarray,
    regions: list[tuple[int, int, int, int]],
    mode: str | None,
) -> dict[str, Any]:
    """Return two synthetic OCR detections when digit-only voting succeeds."""
    executable = tesseract_executable()
    if executable is None or len(regions) != 2:
        return {"rec_texts": [], "rec_scores": [], "rec_boxes": []}
    result: dict[str, list] = {"rec_texts": [], "rec_scores": [], "rec_boxes": []}
    for side, region in zip(("left", "right"), regions):
        crop = _digit_crop(frame, region, side)
        if crop.size == 0:
            return {"rec_texts": [], "rec_scores": [], "rec_boxes": []}
        readings = [
            _recognise(executable, variant, page_mode)
            for variant in _variants(crop)
            for page_mode in (7, 10, 13)
        ]
        value, confidence = _choose_reading(readings, mode)
        if value is None:
            return {"rec_texts": [], "rec_scores": [], "rec_boxes": []}
        result["rec_texts"].append(str(value))
        result["rec_scores"].append(confidence)
        result["rec_boxes"].append(list(region))
    return result
