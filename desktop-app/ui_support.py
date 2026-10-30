"""Presentation helpers for the desktop coordinator only."""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QPainter, QPen
from PySide6.QtWidgets import QWidget


class OverlayCanvas(QWidget):
    """Transparent coordinate overlay stacked above the video surface."""

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setAttribute(Qt.WA_TransparentForMouseEvents)
        self.regions: list[tuple[list[int], str, QColor]] = []
        self.source_width = 1920
        self.source_height = 1080
        self.enabled = True

    def set_source_size(self, width: int, height: int) -> None:
        if width > 0 and height > 0:
            self.source_width, self.source_height = width, height
            self.update()

    def set_layouts(self, result: dict) -> None:
        self.regions = []
        hud = (result.get("hudLayout") or {}).get("coordinates")
        score = (result.get("scoreLayout") or {}).get("coordinates") or []
        stats = (result.get("statLayout") or {}).get("coordinates") or []
        if hud:
            self.regions.append((hud, "LOCKED HUD", QColor("#00eaff")))
        for region, label in zip(score, ("GUILD SCORE", "JSOC SCORE")):
            self.regions.append((region, label, QColor("#d2a8ff")))
        for region, label in zip(stats, ("ELIMINATIONS", "DEATHS")):
            self.regions.append((region, label, QColor("#3fb950")))
        self.update()

    def paintEvent(self, _event) -> None:
        if not self.enabled or not self.regions:
            return
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        scale = min(self.width() / self.source_width, self.height() / self.source_height)
        draw_w, draw_h = self.source_width * scale, self.source_height * scale
        offset_x, offset_y = (self.width() - draw_w) / 2, (self.height() - draw_h) / 2
        for (left, top, right, bottom), label, colour in self.regions:
            painter.setPen(QPen(colour, 2))
            x, y = offset_x + left * scale, offset_y + top * scale
            width, height = (right - left) * scale, (bottom - top) * scale
            painter.drawRect(int(x), int(y), int(width), int(height))
            painter.fillRect(int(x), max(0, int(y) - 22), max(90, len(label) * 8), 21, QColor(0, 0, 0, 180))
            painter.drawText(int(x) + 4, max(15, int(y) - 6), label)


class ConfidenceChart(QWidget):
    """Plots every OCR confidence value against its video timestamp."""

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.points: list[tuple[float, float]] = []
        self.setMinimumHeight(150)

    def load(self, log_path: Path) -> None:
        self.points = []
        if log_path.is_file():
            for line in log_path.read_text(encoding="utf-8", errors="replace").splitlines():
                try:
                    item = json.loads(line)
                    timestamp = float(item.get("timestampSeconds", 0))
                    scores = (item.get("ocr") or {}).get("rec_scores", [])
                    self.points.extend((timestamp, float(score)) for score in scores)
                except (TypeError, ValueError, json.JSONDecodeError):
                    continue
        self.update()

    def paintEvent(self, _event) -> None:
        painter = QPainter(self); painter.setRenderHint(QPainter.Antialiasing)
        painter.fillRect(self.rect(), QColor("#15151a"))
        left, top, right, bottom = 48, 12, self.width() - 12, self.height() - 28
        painter.setPen(QPen(QColor("#25252d"), 1))
        for level in (0, .25, .5, .75, 1):
            y = bottom - level * (bottom - top)
            painter.drawLine(left, int(y), right, int(y))
            painter.drawText(4, int(y) + 5, f"{level:.0%}")
        if not self.points:
            painter.setPen(QColor("#8f929d")); painter.drawText(left + 12, top + 24, "No OCR confidence readings")
            return
        min_x, max_x = min(x for x, _ in self.points), max(x for x, _ in self.points)
        span = max(0.001, max_x - min_x)
        painter.setPen(QPen(QColor("#00eaff"), 3))
        for timestamp, score in self.points:
            x = left + (timestamp - min_x) / span * (right - left)
            y = bottom - max(0, min(1, score)) * (bottom - top)
            painter.drawPoint(int(x), int(y))
        painter.setPen(QColor("#8f929d"))
        painter.drawText(left, self.height() - 7, f"{min_x:.1f}s")
        painter.drawText(max(left, right - 55), self.height() - 7, f"{max_x:.1f}s")


def confidence_evidence(result: dict, log_path: Path) -> str:
    lines = ["FINAL CONSENSUS", "=" * 72]
    for player in result.get("players", []):
        confidence = player.get("confidence") or {}
        lines.append(
            f"{player.get('id') or player.get('name') or 'UNRESOLVED'} | "
            f"ID {float(confidence.get('id', 0)):.0%} | "
            f"E {float(confidence.get('eliminations', 0)):.0%} | "
            f"D {float(confidence.get('deaths', 0)):.0%} | "
            f"support {player.get('supportingFrames', 0)} frame(s)"
        )
    lines.extend(("", "ALL FRAME OCR EVIDENCE", "=" * 72))
    if log_path.is_file():
        lines.append(log_path.read_text(encoding="utf-8", errors="replace"))
    else:
        lines.append("No frame-level confidence log is available for this manually entered game.")
    return "\n".join(lines)


def check_update(manifest_url: str, current_version: str) -> dict | None:
    if not manifest_url.strip():
        return None
    with urllib.request.urlopen(manifest_url, timeout=8) as response:
        manifest = json.load(response)
    def version_parts(value: str) -> tuple[int, ...]:
        return tuple(int(part) for part in value.strip().lstrip("v").split("."))

    try:
        newer = version_parts(str(manifest.get("version", ""))) > version_parts(current_version)
    except ValueError:
        return None
    if newer:
        return manifest
    return None
