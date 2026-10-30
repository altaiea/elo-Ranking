"""PaddleOCR adapter producing the stable format used by scoreboard_parser."""
import logging
import os
import warnings
from contextlib import redirect_stderr, redirect_stdout
from functools import lru_cache
from io import StringIO

os.environ.setdefault("FLAGS_use_mkldnn", "0")
os.environ.setdefault("FLAGS_minloglevel", "3")
os.environ.setdefault("GLOG_minloglevel", "3")
warnings.filterwarnings("ignore", message=r".*No ccache found.*")

import cv2
import numpy as np
from paddleocr import PaddleOCR


@lru_cache(maxsize=1)
def engine():
    return PaddleOCR(
        lang="en",
        ocr_version="PP-OCRv6",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=False,
        text_rec_score_thresh=0.15,
    )


def _dictionary(prediction):
    value = prediction.json if hasattr(prediction, "json") else prediction
    if callable(value):
        value = value()
    if isinstance(value, dict) and isinstance(value.get("res"), dict):
        value = value["res"]
    return value if isinstance(value, dict) else {}


def read_frame(frame: np.ndarray) -> dict:
    if frame is None or frame.size == 0:
        raise ValueError("OCR received an empty frame")
    hidden = StringIO()
    with redirect_stdout(hidden), redirect_stderr(hidden):
        predictions = list(engine().predict(frame))
    texts, scores, boxes = [], [], []
    for prediction in predictions:
        result = _dictionary(prediction)
        polygons = result.get("rec_polys", result.get("dt_polys", []))
        for index, text in enumerate(result.get("rec_texts", [])):
            if not str(text).strip() or index >= len(polygons):
                continue
            points = np.asarray(polygons[index], dtype=np.float32).reshape(-1, 2)
            texts.append(str(text).strip())
            scores.append(float(result.get("rec_scores", [0] * len(texts))[index]))
            boxes.append([
                int(points[:, 0].min()), int(points[:, 1].min()),
                int(points[:, 0].max()), int(points[:, 1].max()),
            ])
    return {"rec_texts": texts, "rec_scores": scores, "rec_boxes": boxes}


def read_frame_region(frame: np.ndarray, box: tuple[int, int, int, int]) -> dict:
    """OCR one locked video region and return detections in frame coordinates."""
    height, width = frame.shape[:2]
    left, top, right, bottom = box
    left, top = max(0, int(left)), max(0, int(top))
    right, bottom = min(width, int(right)), min(height, int(bottom))
    if right <= left or bottom <= top:
        raise ValueError(f"Invalid OCR region: {box}")
    data = read_frame(frame[top:bottom, left:right])
    data["rec_boxes"] = [
        [x1 + left, y1 + top, x2 + left, y2 + top]
        for x1, y1, x2, y2 in data["rec_boxes"]
    ]
    return data


def read_frame_region_scaled(
    frame: np.ndarray,
    box: tuple[int, int, int, int],
    scale: float = 3.0,
) -> dict:
    """Enlarge and OCR a difficult region, returning full-frame coordinates."""
    height, width = frame.shape[:2]
    left, top, right, bottom = box
    left, top = max(0, int(left)), max(0, int(top))
    right, bottom = min(width, int(right)), min(height, int(bottom))
    if right <= left or bottom <= top:
        return {"rec_texts": [], "rec_scores": [], "rec_boxes": []}
    crop = frame[top:bottom, left:right]
    enlarged = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    data = read_frame(enlarged)
    data["rec_boxes"] = [
        [
            round(x1 / scale) + left,
            round(y1 / scale) + top,
            round(x2 / scale) + left,
            round(y2 / scale) + top,
        ]
        for x1, y1, x2, y2 in data["rec_boxes"]
    ]
    return data


def merge_detections(*results: dict) -> dict:
    """Combine OCR result dictionaries while suppressing exact duplicates."""
    merged = {"rec_texts": [], "rec_scores": [], "rec_boxes": []}
    seen: set[tuple[str, tuple[int, int, int, int]]] = set()
    for result in results:
        for text, score, box in zip(
            result.get("rec_texts", []),
            result.get("rec_scores", []),
            result.get("rec_boxes", []),
        ):
            key = (str(text), tuple(map(int, box)))
            if key in seen:
                continue
            seen.add(key)
            merged["rec_texts"].append(str(text))
            merged["rec_scores"].append(float(score))
            merged["rec_boxes"].append(list(map(int, box)))
    return merged


def draw_detections(frame: np.ndarray, data: dict) -> np.ndarray:
    output = frame.copy()
    for text, score, box in zip(data["rec_texts"], data["rec_scores"], data["rec_boxes"]):
        left, top, right, bottom = box
        cv2.rectangle(output, (left, top), (right, bottom), (0, 255, 0), 2)
        cv2.putText(output, f"{text} {score:.0%}", (left, max(18, top - 5)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 0), 1, cv2.LINE_AA)
    return output
