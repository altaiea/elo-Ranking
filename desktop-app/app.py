"""4 V 4 desktop: parse match videos, validate them, apply Elo, export to the site.

Everything is Python now. The OCR runs in its own process (ocr_worker.py) so
a crash in PaddleOCR never takes the window down; Elo is the codstats.elo
package, applied only when you press "Import to Elo".
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import date, datetime
from pathlib import Path

from PySide6.QtCore import QDate, QProcess, QProcessEnvironment, QThread, QTimer, Qt, QUrl, Signal
from PySide6.QtGui import QColor, QDesktopServices, QImageReader
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
from PySide6.QtMultimediaWidgets import QVideoWidget
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QComboBox, QDateEdit, QDialog, QDialogButtonBox, QDoubleSpinBox, QFileDialog,
    QFormLayout, QFrame, QGridLayout, QHBoxLayout, QHeaderView, QLabel, QLineEdit, QMainWindow, QMessageBox,
    QProgressBar, QProgressDialog, QPushButton, QScrollArea, QSlider, QSpinBox, QStackedLayout, QStackedWidget,
    QTabWidget, QTableWidget, QTableWidgetItem, QTextEdit, QVBoxLayout, QWidget,
)

from codstats import paths
from codstats.paths import (APPROVED, DATA_ROOT, DEBUG_ROOT, DRIVE_LEDGER, ELO_DATA_ROOT, HISTORY_ROOT, OCR_ROOT,
                            REGISTRY_PATH, ROOT, SITE_ROOT, STAGING, STATS_PATH)

FIRST_START_NOTE = paths.ensure_data()

sys.path.insert(0, str(OCR_ROOT))
from codstats_ocr.elo_exporter import EloExportError, build_elo_document, convert_game  # noqa: E402
from codstats_ocr.review import set_overtime_result, set_standard_score  # noqa: E402
from codstats.drive_watcher import DriveWatcher, suggest_drive_folders  # noqa: E402
from codstats.duplicate_files import DuplicateCheckCancelled, find_duplicates  # noqa: E402
from codstats.duplicate_scores import find_suspects  # noqa: E402
from codstats.elo.history import day_files, read_day  # noqa: E402
from codstats.elo.importer import EloImporter, ImportError_  # noqa: E402
from codstats.github_export import (ExportError, github_desktop_url, looks_like_site_repo, prepare_export,  # noqa: E402
                                    suggest_repos, write_export)
from sync_client import (SyncError, fetch_current_stats, fetch_github_dataset, local_only_imports,  # noqa: E402
                         publish_day, publish_snapshot, replace_with_github_dataset, safely_replace_stats)
from theme import STYLE, glow  # noqa: E402  (blue/black neon theme, matches the website)
from ui_support import ConfidenceChart, OverlayCanvas, check_update, confidence_evidence  # noqa: E402
from upload_request import UploadError, build_package, connection_problem, load_config as load_upload_config, send_package  # noqa: E402
from website_view import make_website_page  # noqa: E402

APP_VERSION = "4.0.0"
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
DRIVE_POLL_MS = 10_000
AUTO_APPROVE_CONFIDENCE = 0.90
GITHUB_FOLDER_CONFIG = DATA_ROOT / "github-desktop-folder.json"


def button(text: str, *, secondary: bool = False, danger: bool = False) -> QPushButton:
    result = QPushButton(text)
    if secondary:
        result.setObjectName("secondary")
    if danger:
        result.setObjectName("danger")
    return result


def header(title: str, subtitle: str) -> QVBoxLayout:
    layout = QVBoxLayout()
    title_label = QLabel(title)
    title_label.setObjectName("title")
    glow(title_label, blur=18, alpha=120)
    subtitle_label = QLabel(subtitle)
    subtitle_label.setObjectName("subtitle")
    subtitle_label.setWordWrap(True)
    layout.addWidget(title_label)
    layout.addWidget(subtitle_label)
    return layout


def summary_card(label: str, value: str) -> tuple[QFrame, QLabel]:
    card = QFrame(); card.setObjectName("summaryCard")
    layout = QVBoxLayout(card); layout.setContentsMargins(17, 14, 17, 14)
    caption = QLabel(label); caption.setObjectName("summaryLabel")
    number = QLabel(value); number.setObjectName("summaryValue")
    layout.addWidget(caption); layout.addWidget(number)
    return card, number


def numbered_video_key(path: Path) -> tuple[int, int | str]:
    """Sort numeric video stems as 1, 2, ... 10; keep a safe fallback."""
    try:
        return 0, int(path.stem)
    except ValueError:
        return 1, path.name.casefold()


def start_spin(value: float = 0.0) -> QDoubleSpinBox:
    """Start-time box for the queue. 0 shows as "Auto": the worker finds the scoreboard itself."""
    spin = QDoubleSpinBox(); spin.setRange(0, 99999); spin.setDecimals(2); spin.setSuffix(" s")
    spin.setSpecialValueText("Auto")
    spin.setValue(value)
    return spin


def read_json(path: Path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


class StartTimeDialog(QDialog):
    """Let the user scrub a queued video and choose where OCR should begin."""

    def __init__(self, video: Path, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._confirmed_seconds = 0.0
        self.setWindowTitle(f"Choose start time — {video.name}")
        self.resize(900, 650)

        outer = QVBoxLayout(self)
        outer.setContentsMargins(22, 20, 22, 20)
        outer.setSpacing(12)
        title = QLabel(video.name)
        title.setObjectName("title")
        description = QLabel("Scroll to where the scoreboard appears and press \"Use this time\", "
                             "or press \"Find it for me\" and the parser will look for it.")
        description.setObjectName("subtitle"); description.setWordWrap(True)
        outer.addWidget(title)
        outer.addWidget(description)

        self.video_widget = QVideoWidget()
        self.video_widget.setMinimumSize(720, 405)
        outer.addWidget(self.video_widget, 1)

        self.player = QMediaPlayer(self)
        self.audio = QAudioOutput(self)
        self.audio.setVolume(0.35)
        self.player.setAudioOutput(self.audio)
        self.player.setVideoOutput(self.video_widget)

        controls = QHBoxLayout()
        self.play_button = button("Play", secondary=True)
        self.play_button.clicked.connect(self._toggle_playback)
        self.timeline = QSlider(Qt.Horizontal)
        self.timeline.setRange(0, 0)
        self.timeline.sliderMoved.connect(self.player.setPosition)
        self.time_label = QLabel("00:00 / 00:00")
        controls.addWidget(self.play_button)
        controls.addWidget(self.timeline, 1)
        controls.addWidget(self.time_label)
        outer.addLayout(controls)

        selection = QHBoxLayout()
        selection.addWidget(QLabel("Start OCR at second"))
        self.start_time = QDoubleSpinBox()
        self.start_time.setRange(0, 99999)
        self.start_time.setDecimals(2)
        self.start_time.setSingleStep(0.25)
        self.start_time.setSuffix(" s")
        self.start_time.valueChanged.connect(self._seek_from_seconds)
        selection.addWidget(self.start_time)
        selection.addStretch()
        outer.addLayout(selection)

        actions = QDialogButtonBox(QDialogButtonBox.Cancel)
        automatic = actions.addButton("Find it for me", QDialogButtonBox.ActionRole)
        confirm = actions.addButton("Use this time", QDialogButtonBox.AcceptRole)
        confirm.setDefault(True)
        automatic.clicked.connect(self._automatic)
        actions.accepted.connect(self._confirm_selection)
        actions.rejected.connect(self.reject)
        outer.addWidget(actions)

        self.player.durationChanged.connect(self._duration_changed)
        self.player.positionChanged.connect(self._position_changed)
        self.player.playbackStateChanged.connect(self._state_changed)
        self.player.setSource(QUrl.fromLocalFile(str(video.resolve())))

    @staticmethod
    def _clock(milliseconds: int) -> str:
        seconds = max(0, milliseconds // 1000)
        return f"{seconds // 60:02d}:{seconds % 60:02d}"

    def _duration_changed(self, duration: int) -> None:
        self.timeline.setRange(0, max(0, duration))
        if duration > 0:
            self.start_time.setMaximum(duration / 1000.0)
        self._position_changed(self.player.position())

    def _position_changed(self, position: int) -> None:
        if not self.timeline.isSliderDown():
            self.timeline.setValue(position)
        self.start_time.blockSignals(True)
        self.start_time.setValue(position / 1000.0)
        self.start_time.blockSignals(False)
        self.time_label.setText(f"{self._clock(position)} / {self._clock(self.player.duration())}")

    def _seek_from_seconds(self, seconds: float) -> None:
        self.player.setPosition(round(seconds * 1000))

    def _toggle_playback(self) -> None:
        if self.player.playbackState() == QMediaPlayer.PlayingState:
            self.player.pause()
        else:
            self.player.play()

    def _state_changed(self, state: QMediaPlayer.PlaybackState) -> None:
        self.play_button.setText("Pause" if state == QMediaPlayer.PlayingState else "Play")

    def selected_seconds(self) -> float:
        return self._confirmed_seconds

    def _automatic(self) -> None:
        self._confirmed_seconds = 0.0          # 0 = Auto
        self.accept()

    def _confirm_selection(self) -> None:
        # QMediaPlayer.stop() resets its position, so retain the user's chosen
        # timestamp before closing the dialog and stopping playback.
        self._confirmed_seconds = self.start_time.value()
        self.accept()

    def done(self, result: int) -> None:
        self.player.stop()
        super().done(result)


class Task(QThread):
    """Runs one blocking call (network, big file copies) off the UI thread."""
    succeeded = Signal(object)
    failed = Signal(str)

    def __init__(self, function, parent=None) -> None:
        super().__init__(parent)
        self.function = function

    def run(self) -> None:
        try:
            value = self.function()
        except Exception as error:  # never let a background thread crash the app
            self.failed.emit(str(error) or type(error).__name__)
        else:
            self.succeeded.emit(value)


class UploadWorker(QThread):
    """Runs the GitHub upload request off the UI thread."""
    progress = Signal(str)
    finished_ok = Signal(dict)
    failed = Signal(str)

    def __init__(self, config: dict, package, requester: str, note: str, parent=None) -> None:
        super().__init__(parent)
        self.config, self.package, self.requester, self.note = config, package, requester, note

    def run(self) -> None:
        try:
            result = send_package(self.config, self.package, self.requester, self.note,
                                  progress=self.progress.emit)
        except UploadError as error:
            self.failed.emit(str(error))
        except Exception as error:  # never let a background thread crash the app
            self.failed.emit(f"Unexpected error: {error}")
        else:
            self.finished_ok.emit(result)


class DriveWorker(QThread):
    """Polls the Google Drive folder every few seconds and reports settled new videos."""
    found = Signal(list)          # [(path str, duplicate_of str | None)]
    problem = Signal(str)

    def __init__(self, folder: Path, parent=None) -> None:
        super().__init__(parent)
        self.watcher = DriveWatcher(folder, DRIVE_LEDGER)
        self._running = True

    def stop(self) -> None:
        self._running = False

    def run(self) -> None:
        reported = False
        while self._running:
            if not self.watcher.folder.is_dir():
                if not reported:
                    self.problem.emit(f"Drive folder not available: {self.watcher.folder}")
                    reported = True
            else:
                reported = False
                try:
                    ready = self.watcher.poll()
                except Exception as error:
                    self.problem.emit(f"Drive check failed: {error}")
                    ready = []
                if ready:
                    self.found.emit([(str(path), duplicate) for path, duplicate in ready])
            for _ in range(DRIVE_POLL_MS // 250):
                if not self._running:
                    return
                self.msleep(250)


class Desktop(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("4 V 4")
        self.resize(1280, 800)
        self.settings = paths.load_settings()
        self.videos: list[Path] = []
        self.results: list[dict] = []
        self.review_index = 0
        self.parse_rows: list[int] = []
        self.process_row = -1
        self.process: QProcess | None = None
        self.process_output_text = ""
        self.reported_result_path: Path | None = None
        self.current_parse_started_at = 0.0
        self.stop_requested = False
        self.registry = self._load_registry()
        self.tasks: list[QThread] = []
        self.drive_worker: DriveWorker | None = None

        self.pages = QStackedWidget()
        self.import_page = self._build_import_page()
        self.review_page = self._build_review_page()
        self.preview_page = self._build_preview_page()
        self.elo_page = self._build_elo_page()
        self.registry_page = self._build_registry_page()
        self.sync_page = self._build_sync_page()
        self.site_page = make_website_page(SITE_ROOT, DATA_ROOT, header, button)
        for page in (self.import_page, self.review_page, self.preview_page, self.elo_page,
                     self.registry_page, self.sync_page, self.site_page):
            self.pages.addWidget(page)
        shell = QWidget(); shell_layout = QHBoxLayout(shell)
        shell_layout.setContentsMargins(0, 0, 0, 0); shell_layout.setSpacing(0)
        shell_layout.addWidget(self._build_sidebar())
        shell_layout.addWidget(self.pages, 1)
        self.setCentralWidget(shell)
        self.pages.currentChanged.connect(self._sync_navigation)
        self._sync_navigation()
        if FIRST_START_NOTE:
            self.log.append(FIRST_START_NOTE)
        self._prune_debug_folders()
        if self.settings.get("driveWatch") and self.settings.get("driveFolder"):
            self._start_drive_watch(Path(self.settings["driveFolder"]))
        QTimer.singleShot(1500, self._check_for_updates)

    # ------------------------------------------------------------------ shell
    def _build_sidebar(self) -> QFrame:
        sidebar = QFrame(); sidebar.setObjectName("sidebar"); sidebar.setFixedWidth(190)
        layout = QVBoxLayout(sidebar); layout.setContentsMargins(14, 18, 14, 16); layout.setSpacing(7)
        brand = QLabel("4 V 4"); brand.setObjectName("brand"); glow(brand, blur=26, alpha=200)
        layout.addWidget(brand)
        self.nav_buttons: list[tuple[QPushButton, QWidget]] = []
        entries = (("  Video import", self.import_page), ("  Validation", self.review_page),
                   ("  Import to Elo", self.preview_page), ("  Leaderboard", self.site_page),
                   ("  Map history", self.elo_page), ("  Player registry", self.registry_page),
                   ("  Stats sync", self.sync_page))
        for text, page in entries:
            control = QPushButton(text); control.setObjectName("nav"); control.setCheckable(True)
            control.clicked.connect(lambda _checked=False, destination=page: self._navigate(destination))
            layout.addWidget(control); self.nav_buttons.append((control, page))
        layout.addStretch()
        note = QLabel(f"v{APP_VERSION}\nData: {DATA_ROOT.name}"); note.setObjectName("sideNote")
        layout.addWidget(note)
        return sidebar

    def _navigate(self, page: QWidget) -> None:
        if page in (self.review_page, self.preview_page) and not self.results:
            QMessageBox.information(self, "Nothing to review", "Parse videos or add a manual game first.")
            self._sync_navigation()
            return
        if page is self.elo_page:
            self.refresh_elo_data()
        if page is self.site_page:
            self.site_page.refresh()
        if page is self.preview_page:
            self.show_preview()
            return
        self.pages.setCurrentWidget(page)

    def _sync_navigation(self, *_args) -> None:
        if not hasattr(self, "nav_buttons"): return
        current = self.pages.currentWidget()
        for control, page in self.nav_buttons:
            control.setChecked(page is current)

    def _load_registry(self) -> list[dict]:
        payload = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        return [dict(value, id=int(key)) for key, value in payload["players"].items()]

    def _save_settings(self) -> None:
        paths.save_settings(self.settings)

    def _run_task(self, function, on_success, on_failure=None) -> None:
        task = Task(function, self)
        task.succeeded.connect(on_success)
        task.failed.connect(on_failure or (lambda message: QMessageBox.warning(self, "Something went wrong", message)))
        task.finished.connect(lambda: self.tasks.remove(task) if task in self.tasks else None)
        self.tasks.append(task)
        task.start()

    def _prune_debug_folders(self, keep_days: int = 14) -> None:
        """Debug frames are only needed while validating; drop old ones so they don't pile up."""
        cutoff = time.time() - keep_days * 86400
        try:
            for folder in DEBUG_ROOT.iterdir():
                if folder.is_dir() and folder.stat().st_mtime < cutoff:
                    shutil.rmtree(folder, ignore_errors=True)
        except OSError:
            pass

    # ------------------------------------------------------------ import page
    def _build_import_page(self) -> QWidget:
        page = QWidget(); page.setObjectName("page")
        outer = QVBoxLayout(page)
        outer.setContentsMargins(30, 25, 30, 25); outer.setSpacing(14)
        outer.addLayout(header("Video import", "Add recordings or let the Google Drive folder bring them in. "
                                               "Every video is parsed, then checked by you beside the footage."))
        controls = QHBoxLayout()
        add_files = button("Add videos")
        add_folder = button("Add folder", secondary=True)
        remove = button("Remove selected", secondary=True)
        manual = button("Add manual game", secondary=True)
        add_files.clicked.connect(self.add_videos)
        add_folder.clicked.connect(self.add_folder)
        remove.clicked.connect(self.remove_selected)
        manual.clicked.connect(self.add_manual)
        for item in (add_files, add_folder, remove, manual): controls.addWidget(item)
        controls.addStretch()
        outer.addLayout(controls)

        outer.addWidget(self._build_drive_panel())

        summaries = QHBoxLayout(); summaries.setSpacing(13)
        queue_card, self.queued_value = summary_card("Videos queued", "0")
        parsed_card, self.parsed_value = summary_card("Parsed", "0")
        review_card, self.review_value = summary_card("Needs your check", "0")
        for card in (queue_card, parsed_card, review_card): summaries.addWidget(card)
        outer.addLayout(summaries)

        self.queue = QTableWidget(0, 4)
        self.queue.setAlternatingRowColors(True); self.queue.verticalHeader().setVisible(False)
        self.queue.setHorizontalHeaderLabels(["Video", "Start time", "From", "Status"])
        self.queue.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        for column in (1, 2, 3):
            self.queue.horizontalHeader().setSectionResizeMode(column, QHeaderView.ResizeToContents)
        self.queue.verticalHeader().setDefaultSectionSize(40)
        self.queue.setMinimumHeight(200)
        self.queue.setToolTip("Start time \"Auto\" means the parser finds the scoreboard itself.")
        outer.addWidget(self.queue, 1)
        self.progress = QProgressBar()
        self.progress.setRange(0, 100); self.progress.setValue(0); self.progress.setFormat("0%")
        self.progress_label = QLabel("Waiting to parse")
        self.progress_label.setObjectName("subtitle")
        outer.addWidget(self.progress_label)
        outer.addWidget(self.progress)
        self.log = QTextEdit(); self.log.setReadOnly(True); self.log.setMaximumHeight(150)
        outer.addWidget(self.log)
        self.run_button = button("Parse new videos")
        self.run_button.clicked.connect(self.start_batch)
        self.stop_button = button("Stop parse", secondary=True)
        self.stop_button.clicked.connect(self.stop_parse)
        self.stop_button.setEnabled(False)
        run_row = QHBoxLayout(); run_row.addStretch(); run_row.addWidget(self.stop_button); run_row.addWidget(self.run_button)
        outer.addLayout(run_row)
        return page

    def _build_drive_panel(self) -> QFrame:
        panel = QFrame(); panel.setObjectName("panel")
        layout = QVBoxLayout(panel); layout.setContentsMargins(16, 12, 16, 12); layout.setSpacing(8)
        top = QHBoxLayout()
        title = QLabel("Google Drive folder"); title.setObjectName("sectionTitle")
        self.drive_folder_label = QLabel(self.settings.get("driveFolder") or "Not chosen yet")
        self.drive_folder_label.setObjectName("subtitle")
        choose = button("Choose folder", secondary=True); choose.clicked.connect(self.choose_drive_folder)
        self.drive_toggle = button("Start watching")
        self.drive_toggle.clicked.connect(self.toggle_drive_watch)
        top.addWidget(title); top.addSpacing(12); top.addWidget(self.drive_folder_label, 1)
        top.addWidget(choose); top.addWidget(self.drive_toggle)
        layout.addLayout(top)
        options = QHBoxLayout()
        self.auto_parse = QCheckBox("Parse new videos as soon as they arrive")
        self.auto_parse.setChecked(self.settings.get("driveAutoParse", True))
        self.auto_approve = QCheckBox(f"Pre-approve games read with {AUTO_APPROVE_CONFIDENCE:.0%}+ confidence (you still confirm the import)")
        self.auto_approve.setChecked(self.settings.get("autoApprove", True))
        for box, key in ((self.auto_parse, "driveAutoParse"), (self.auto_approve, "autoApprove")):
            box.toggled.connect(lambda value, setting=key: (self.settings.__setitem__(setting, value), self._save_settings()))
            options.addWidget(box)
        options.addStretch()
        layout.addLayout(options)
        self.drive_status = QLabel("Install Google Drive for desktop, then choose the Drive folder people upload to.")
        self.drive_status.setObjectName("subtitle"); self.drive_status.setWordWrap(True)
        layout.addWidget(self.drive_status)
        return panel

    def choose_drive_folder(self) -> None:
        suggestions = suggest_drive_folders()
        start = self.settings.get("driveFolder") or (str(suggestions[0]) if suggestions else str(Path.home()))
        folder = QFileDialog.getExistingDirectory(self, "Choose the Google Drive folder people upload videos to", start)
        if not folder:
            return
        was_watching = self.drive_worker is not None
        self._stop_drive_watch()
        self.settings["driveFolder"] = folder; self._save_settings()
        self.drive_folder_label.setText(folder)
        watcher = DriveWatcher(Path(folder), DRIVE_LEDGER)
        waiting = [path for path in watcher.videos() if not watcher.known(path)]
        if waiting:
            answer = QMessageBox.question(
                self, "Videos already in the folder",
                f"{len(waiting)} video(s) are already in this folder.\n\n"
                "Parse them too? Choose No if they were already parsed with the old app.")
            if answer != QMessageBox.Yes:
                count = watcher.mark_existing_as_seen()
                self.log.append(f"Drive: {count} existing video(s) marked as already handled.")
        if was_watching or QMessageBox.question(self, "Start watching?", "Start watching this folder now?") == QMessageBox.Yes:
            self._start_drive_watch(Path(folder))

    def toggle_drive_watch(self) -> None:
        if self.drive_worker is not None:
            self._stop_drive_watch()
            self.settings["driveWatch"] = False; self._save_settings()
            return
        folder = self.settings.get("driveFolder")
        if not folder:
            self.choose_drive_folder(); return
        self._start_drive_watch(Path(folder))

    def _start_drive_watch(self, folder: Path) -> None:
        self._stop_drive_watch()
        worker = DriveWorker(folder, self)
        worker.found.connect(self._drive_found)
        worker.problem.connect(lambda message: self.drive_status.setText(message))
        self.drive_worker = worker
        worker.start()
        self.settings["driveWatch"] = True; self._save_settings()
        self.drive_toggle.setText("Stop watching")
        self.drive_status.setText(f"Watching {folder}. New videos are picked up once Drive has finished syncing them.")

    def _stop_drive_watch(self) -> None:
        if self.drive_worker is not None:
            self.drive_worker.stop(); self.drive_worker.wait(3000)
            self.drive_worker = None
        if hasattr(self, "drive_toggle"):
            self.drive_toggle.setText("Start watching")
            self.drive_status.setText("Not watching.")

    def _drive_found(self, items: list) -> None:
        added = []
        for path_text, duplicate_of in items:
            path = Path(path_text)
            if duplicate_of:
                self.log.append(f"Drive: skipped {path.name}, it is a byte-for-byte copy of {duplicate_of}.")
                continue
            if path in self.videos:
                continue
            added.append(path)
        if not added:
            return
        for path in added:
            self._add_queue_row(path, 0.0, "Drive")
        self.log.append(f"Drive: {len(added)} new video(s): " + ", ".join(p.name for p in added))
        self.drive_status.setText(f"Last new video {datetime.now():%H:%M}: {added[-1].name}")
        self._update_summaries()
        if self.auto_parse.isChecked() and (self.process is None):
            self.start_batch()

    # ------------------------------------------------------------ review page
    def _build_review_page(self) -> QWidget:
        page = QWidget(); page.setObjectName("page")
        outer = QVBoxLayout(page)
        outer.setContentsMargins(26, 14, 26, 12); outer.setSpacing(10)
        self.review_title = QLabel("Review")
        self.review_title.setObjectName("title")
        self.review_title.setStyleSheet("font-size:15pt;")   # compact heading: leaves room for all 8 players
        outer.addWidget(self.review_title)
        self.review_flags = QLabel(); self.review_flags.setWordWrap(True)
        outer.addWidget(self.review_flags)
        content = QHBoxLayout()
        content.setSpacing(26)

        video_side = QVBoxLayout()
        video_side.setSpacing(12)
        video_container = QWidget()
        video_stack = QStackedLayout(video_container)
        video_stack.setStackingMode(QStackedLayout.StackAll)
        self.video_widget = QVideoWidget()
        self.video_widget.setMinimumSize(460, 260)
        self.overlay = OverlayCanvas()
        video_stack.addWidget(self.video_widget)
        video_stack.addWidget(self.overlay)
        video_side.addWidget(video_container)
        self.audio = QAudioOutput()
        self.media = QMediaPlayer()
        self.media.setAudioOutput(self.audio)
        self.media.setVideoOutput(self.video_widget)
        video_buttons = QHBoxLayout()
        video_buttons.setSpacing(10)
        play = button("Play / Pause", secondary=True)
        toggle_boxes = button("Toggle boxes", secondary=True)
        jump_hud = button("Jump to HUD", secondary=True)
        jump_score = button("Jump to score", secondary=True)
        jump_stats = button("Jump to stats", secondary=True)
        for control in (play, toggle_boxes, jump_hud, jump_score, jump_stats):
            control.setStyleSheet("font-size:8.5pt; padding:8px 12px;")
            video_buttons.addWidget(control)
        play.clicked.connect(self.toggle_video)
        toggle_boxes.clicked.connect(self.toggle_boxes)
        jump_hud.clicked.connect(lambda: self.jump_layout("hudLayout"))
        jump_score.clicked.connect(lambda: self.jump_layout("scoreLayout"))
        jump_stats.clicked.connect(lambda: self.jump_layout("statLayout"))
        video_buttons.addStretch()
        video_side.addLayout(video_buttons)
        self.timeline = QSlider(Qt.Horizontal)
        self.timeline.sliderMoved.connect(self.media.setPosition)
        self.media.durationChanged.connect(self.timeline.setMaximum)
        self.media.positionChanged.connect(self.timeline.setValue)
        video_side.addWidget(self.timeline)
        content.addLayout(video_side, 6)

        form_side = QVBoxLayout()
        form_side.setSpacing(10)
        form = QGridLayout()          # compact: mode + result type share a row
        form.setVerticalSpacing(8); form.setHorizontalSpacing(12)
        self.mode = QComboBox()
        self.mode.addItems(["Hardpoint", "Search and Destroy", "Overload"])
        self.result_type = QComboBox()
        self.result_type.addItems(["Standard score", "Overload overtime"])
        self.result_type.currentIndexChanged.connect(self.update_result_controls)
        self.mode.currentTextChanged.connect(self.update_result_controls)
        self.score_a, self.score_b = QSpinBox(), QSpinBox()
        for spin in (self.score_a, self.score_b):
            spin.setRange(0, 999); spin.setMinimumWidth(58)
        score_row = QHBoxLayout(); score_row.setSpacing(10)
        score_row.addWidget(QLabel("Team A")); score_row.addWidget(self.score_a)
        score_row.addWidget(QLabel("Team B")); score_row.addWidget(self.score_b)
        form.addWidget(QLabel("Mode"), 0, 0); form.addWidget(self.mode, 0, 1)
        form.addWidget(QLabel("Result type"), 0, 2); form.addWidget(self.result_type, 0, 3)
        form.addWidget(QLabel("Score"), 1, 0); form.addLayout(score_row, 1, 1, 1, 3)
        self.ot_a, self.ot_b = QLineEdit(), QLineEdit()
        for field in (self.ot_a, self.ot_b):
            field.setPlaceholderText("M:SS or DNF"); field.setMinimumWidth(88)
        overtime_row = QHBoxLayout(); overtime_row.setSpacing(10)
        overtime_row.addWidget(QLabel("Team A")); overtime_row.addWidget(self.ot_a)
        overtime_row.addWidget(QLabel("Team B")); overtime_row.addWidget(self.ot_b)
        for control in (self.mode, self.result_type, self.score_a, self.score_b, self.ot_a, self.ot_b):
            control.setStyleSheet("padding:3px 8px; min-height:20px;")      # slimmer fields, same function
        form.addWidget(QLabel("Overtime"), 2, 0); form.addLayout(overtime_row, 2, 1, 1, 3)
        form.setColumnStretch(1, 1); form.setColumnStretch(3, 1)
        form_side.addLayout(form)

        self.players = QTableWidget(8, 6)
        self.players.setHorizontalHeaderLabels(["Team", "Player", "Full ID", "Elims", "Deaths", "Evidence"])
        self.players.horizontalHeader().setDefaultAlignment(Qt.AlignCenter)
        self.players.horizontalHeader().setMinimumSectionSize(46)
        for column, mode in ((0, QHeaderView.Fixed), (1, QHeaderView.Stretch), (2, QHeaderView.Stretch),
                             (3, QHeaderView.Fixed), (4, QHeaderView.Fixed), (5, QHeaderView.Fixed)):
            self.players.horizontalHeader().setSectionResizeMode(column, mode)
        for column, width in ((0, 78), (3, 68), (4, 68), (5, 74)):
            self.players.setColumnWidth(column, width)
        self.players.verticalHeader().setDefaultSectionSize(36)
        self.players.horizontalHeader().setFixedHeight(34)
        # Exactly header + 8 rows (+ frame), so no player is ever cropped or scrolled out of view.
        self.players.setFixedHeight(34 + 8 * 36 + 6)
        self.players.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.players.setStyleSheet("QTableWidget { font-size:8.5pt; padding:0px; } QHeaderView::section { font-size:8pt; padding:7px 4px; } QComboBox, QLineEdit, QSpinBox { font-size:8.5pt; padding:4px 5px; min-height:24px; }")
        for row in range(8):
            team = QComboBox(); team.addItems(["Team A", "Team B"]); team.setMinimumWidth(58); team.setToolTip("Team")
            registry = QComboBox(); registry.setMinimumWidth(105); registry.setToolTip("Registry player")
            self._fill_registry_selector(registry)
            full_id = QLineEdit(); full_id.setMinimumWidth(78); full_id.setToolTip("Full player ID")
            eliminations, deaths = QSpinBox(), QSpinBox()
            for spin, tip in ((eliminations, "Eliminations"), (deaths, "Deaths")):
                spin.setRange(0, 999); spin.setMinimumWidth(48); spin.setToolTip(tip)
            for column, widget in enumerate((team, registry, full_id, eliminations, deaths)):
                self.players.setCellWidget(row, column, widget)
            jump = button("Jump", secondary=True)
            jump.setStyleSheet("font-size:8.5pt; padding:0px 8px; min-height:0px;")
            jump.setFixedHeight(28)
            jump.clicked.connect(lambda _checked=False, player_row=row: self.jump_player(player_row))
            holder = QWidget(); holder.setObjectName("jumpHolder")
            holder.setStyleSheet("QWidget#jumpHolder { background:transparent; }")
            holder_layout = QHBoxLayout(holder); holder_layout.setContentsMargins(4, 3, 4, 3); holder_layout.addWidget(jump)
            self.players.setCellWidget(row, 5, holder)
        form_side.addWidget(self.players)
        evidence_tabs = QTabWidget()
        self.confidence_chart = ConfidenceChart()
        self.confidence_view = QTextEdit(); self.confidence_view.setReadOnly(True)
        self.raw_result_view = QTextEdit(); self.raw_result_view.setReadOnly(True)
        evidence_tabs.addTab(self.confidence_chart, "OCR confidence graph")
        evidence_tabs.addTab(self.confidence_view, "OCR confidence evidence")
        evidence_tabs.addTab(self.raw_result_view, "Raw result")
        evidence_tabs.setMinimumHeight(90)
        evidence_tabs.setMaximumHeight(190)
        form_side.addWidget(evidence_tabs, 1)     # the evidence panel absorbs any leftover or missing height
        self.review_status = QLabel()
        self.review_status.setWordWrap(True)
        form_side.addWidget(self.review_status)
        actions = QHBoxLayout(); actions.setSpacing(10)
        previous = button("Previous", secondary=True)
        next_check = button("Next needing a check", secondary=True)
        drop = button("Remove this game", danger=True)
        save_next = button("Approve and next")
        preview = button("Import to Elo…")
        previous.clicked.connect(self.previous_result)
        next_check.clicked.connect(self.next_needing_check)
        drop.clicked.connect(self.drop_current_result)
        save_next.clicked.connect(self.approve_next)
        preview.clicked.connect(self.show_preview)
        for control in (previous, next_check, drop): actions.addWidget(control)
        actions.addStretch(); actions.addWidget(save_next); actions.addWidget(preview)
        form_side.addLayout(actions)
        content.addLayout(form_side, 5)
        outer.addLayout(content)
        # Safety net: on a short window the page scrolls instead of cropping its bottom.
        scroll = QScrollArea(); scroll.setObjectName("page")
        scroll.setWidgetResizable(True); scroll.setFrameShape(QFrame.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setWidget(page)
        return scroll

    def _fill_registry_selector(self, selector: QComboBox) -> None:
        selector.clear(); selector.addItem("UNRESOLVED", None)
        for person in sorted(self.registry, key=lambda item: item["id"]):
            selector.addItem(f"{person['id']:>2}  {person['codName']} ({person['name']})", person["id"])

    # -------------------------------------------------- map history / Elo page
    def _build_elo_page(self) -> QWidget:
        page = QWidget(); page.setObjectName("page"); outer = QVBoxLayout(page)
        outer.setContentsMargins(30, 25, 30, 25); outer.setSpacing(14)
        outer.addLayout(header("Map history", "Ratings and every imported map, with the full Elo calculation for each player."))
        tabs = QTabWidget(); self.elo_tabs = tabs
        self.leaderboard = QTableWidget(0, 7)
        self.leaderboard.setObjectName("leaderboard")
        self.leaderboard.setShowGrid(False)
        self.leaderboard.verticalHeader().setVisible(False)
        self.leaderboard.setHorizontalHeaderLabels(["Rank", "Player", "Elo", "Lifetime E", "Lifetime D", "K/D", "Maps W-L"])
        self.leaderboard.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)

        map_history_page = QWidget(); map_history_layout = QVBoxLayout(map_history_page)
        self.map_history = QTableWidget(0, 10)
        self.map_history.setHorizontalHeaderLabels(["Date", "Source", "Mode", "Score", "Player", "Kills", "Deaths",
                                                    "Elo Before", "Change", "Elo After"])
        self.map_history.setShowGrid(False)
        self.map_history.verticalHeader().setVisible(False)
        self.map_history.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        for column in (0, 2, 3, 4, 5, 6, 7, 8, 9):
            self.map_history.horizontalHeader().setSectionResizeMode(column, QHeaderView.ResizeToContents)
        self.map_history.setSelectionBehavior(QTableWidget.SelectRows)
        self.map_history.setSelectionMode(QTableWidget.SingleSelection)
        self.map_history.cellDoubleClicked.connect(lambda _row, _column: self._show_selected_elo_calculation())
        map_history_layout.addWidget(self.map_history)
        history_actions = QHBoxLayout()
        history_hint = QLabel("Double-click a player row (or select it and press the button) to see how their Elo change was worked out.")
        history_hint.setWordWrap(True)
        view_calculation = button("View selected calculation", secondary=True)
        view_calculation.clicked.connect(self._show_selected_elo_calculation)
        history_actions.addWidget(history_hint); history_actions.addStretch(); history_actions.addWidget(view_calculation)
        map_history_layout.addLayout(history_actions)

        tabs.addTab(map_history_page, "Map history")
        tabs.addTab(self.leaderboard, "Ratings")
        outer.addWidget(tabs)
        actions = QHBoxLayout(); refresh = button("Refresh")
        refresh.clicked.connect(self.refresh_elo_data)
        actions.addStretch(); actions.addWidget(refresh); outer.addLayout(actions)
        return page

    # ------------------------------------------------------------ import page
    def _build_preview_page(self) -> QWidget:
        page = QWidget(); page.setObjectName("page")
        outer = QVBoxLayout(page)
        outer.setContentsMargins(30, 25, 30, 25); outer.setSpacing(14)
        outer.addLayout(header("Import to Elo", "Check the list, pick the date the maps were played, then import. "
                                                "Nothing changes until you press Import."))
        date_row = QHBoxLayout()
        date_row.addWidget(QLabel("Maps played on"))
        self.match_date = QDateEdit(QDate.currentDate()); self.match_date.setCalendarPopup(True)
        self.match_date.setDisplayFormat("yyyy-MM-dd")
        date_row.addWidget(self.match_date); date_row.addStretch()
        outer.addLayout(date_row)
        self.preview_table = QTableWidget(0, 7)
        self.preview_table.setHorizontalHeaderLabels(["Source", "Mode", "Score", "Winner", "Margin", "Players", "Status"])
        self.preview_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        for column in range(1, 7):
            self.preview_table.horizontalHeader().setSectionResizeMode(column, QHeaderView.ResizeToContents)
        self.preview_table.verticalHeader().setDefaultSectionSize(40)
        self.preview_table.setMinimumHeight(300)
        self.preview_table.cellDoubleClicked.connect(self._open_preview_row)
        outer.addWidget(self.preview_table)
        self.preview_message = QLabel()
        self.preview_message.setWordWrap(True)
        outer.addWidget(self.preview_message)
        actions = QHBoxLayout()
        back = button("Back to validation", secondary=True)
        export = button("Save approved JSON", secondary=True)
        self.import_button = button("Import to Elo")
        clear = button("Clear finished games", danger=True)
        back.clicked.connect(lambda: self.pages.setCurrentWidget(self.review_page))
        export.clicked.connect(self.export_approved)
        self.import_button.clicked.connect(self.import_to_elo)
        clear.clicked.connect(self.clear_finished)
        actions.addWidget(back); actions.addStretch(); actions.addWidget(clear); actions.addWidget(export); actions.addWidget(self.import_button)
        outer.addLayout(actions)
        return page

    def _read_app_config(self) -> dict:
        return read_json(ROOT / "app-config.json", {}) or {}

    # -------------------------------------------------------------- sync page
    def _build_sync_page(self) -> QWidget:
        page = QWidget(); page.setObjectName("page")
        outer = QVBoxLayout(page); outer.setContentsMargins(30, 25, 30, 25); outer.setSpacing(14)
        outer.addLayout(header("Stats sync", "Send your stats to the website with GitHub Desktop, or load the published stats."))

        github_panel = QFrame(); github_panel.setObjectName("panel")
        github_layout = QVBoxLayout(github_panel); github_layout.setContentsMargins(16, 14, 16, 14); github_layout.setSpacing(8)
        github_title = QLabel("Export to GitHub Desktop"); github_title.setObjectName("sectionTitle")
        self.github_repo_label = QLabel(); self.github_repo_label.setObjectName("subtitle"); self.github_repo_label.setWordWrap(True)
        github_row = QHBoxLayout()
        change_repo = button("Change folder", secondary=True); change_repo.clicked.connect(self.choose_github_repo)
        self.export_github_button = button("Export to GitHub Desktop")
        self.export_github_button.clicked.connect(lambda: self.export_to_github_folder())
        github_row.addWidget(self.github_repo_label, 1); github_row.addWidget(change_repo); github_row.addWidget(self.export_github_button)
        github_layout.addWidget(github_title); github_layout.addLayout(github_row)
        outer.addWidget(github_panel)
        self._refresh_github_repo_label()

        form = QFormLayout()
        config = self._read_app_config()
        self.api_url = QLineEdit(str(config.get("apiBaseUrl", "")))
        self.api_url.setPlaceholderText("https://your-api.example.com")
        saved_github_url = str((read_json(DATA_ROOT / "github-sync.json", {}) or {}).get("baseUrl", ""))
        self.github_data_url = QLineEdit(saved_github_url or str(config.get("githubDataBaseUrl", "")))
        self.github_data_url.setPlaceholderText("https://YOURNAME.github.io/YOUR-REPO or raw GitHub folder URL")
        self.publisher_name = QLineEdit(str(config.get("publisherName", "")))
        self.publisher_name.setPlaceholderText("Name shown on public audit reports")
        self.api_token = QLineEdit(); self.api_token.setEchoMode(QLineEdit.Password)
        self.api_token.setPlaceholderText("Publishing token (not saved)")
        form.addRow("GitHub data URL", self.github_data_url); form.addRow("API URL", self.api_url)
        form.addRow("Publisher", self.publisher_name); form.addRow("Publish token", self.api_token)
        outer.addLayout(form)
        self.sync_table = QTableWidget(0, 3)
        self.sync_table.setHorizontalHeaderLabels(["Rank", "Player ID", "Published Elo"])
        self.sync_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        outer.addWidget(self.sync_table)
        self.sync_status = QTextEdit(); self.sync_status.setReadOnly(True); self.sync_status.setMaximumHeight(130)
        self.sync_status.setPlainText(f"Local data: {DATA_ROOT}")
        outer.addWidget(self.sync_status)
        upload_panel = QFrame(); upload_panel.setObjectName("panel")
        upload_layout = QVBoxLayout(upload_panel); upload_layout.setContentsMargins(16, 14, 16, 14); upload_layout.setSpacing(8)
        upload_title = QLabel("Request upload"); upload_title.setObjectName("sectionTitle")
        upload_hint = QLabel("For friends running their own copy: send stats to the league owner's GitHub as a pull request. "
                             "Nothing goes live until the owner merges it.")
        upload_hint.setObjectName("subtitle"); upload_hint.setWordWrap(True)
        self.upload_name = QLineEdit(str(config.get("publisherName", ""))); self.upload_name.setPlaceholderText("Your name")
        self.upload_note = QLineEdit(); self.upload_note.setPlaceholderText("Optional note for the owner")
        self.upload_connection = QLabel(); self.upload_connection.setObjectName("subtitle"); self.upload_connection.setWordWrap(True)
        upload_row = QHBoxLayout()
        self.upload_preview_button = button("Preview upload", secondary=True)
        self.upload_send_button = button("Request upload", secondary=True)
        self.upload_preview_button.clicked.connect(self.preview_upload_request)
        self.upload_send_button.clicked.connect(self.send_upload_request)
        upload_row.addWidget(self.upload_name, 1); upload_row.addWidget(self.upload_note, 2)
        upload_row.addWidget(self.upload_preview_button); upload_row.addWidget(self.upload_send_button)
        for item in (upload_title, upload_hint):
            upload_layout.addWidget(item)
        upload_layout.addLayout(upload_row); upload_layout.addWidget(self.upload_connection)
        outer.addWidget(upload_panel)
        self._refresh_upload_connection()
        self.upload_worker = None
        actions = QHBoxLayout()
        github_sync = button("Sync from GitHub", secondary=True)
        preview = button("Preview latest", secondary=True)
        download = button("Download latest", secondary=True)
        publish = button("Publish local history", secondary=True)
        export = button("Export stats.json", secondary=True)
        open_data = button("Open data folder", secondary=True)
        github_sync.clicked.connect(self.sync_from_github)
        preview.clicked.connect(self.preview_remote_stats)
        download.clicked.connect(self.download_remote_stats)
        publish.clicked.connect(self.publish_local_history)
        export.clicked.connect(self.export_current_stats)
        open_data.clicked.connect(lambda: QDesktopServices.openUrl(QUrl.fromLocalFile(str(DATA_ROOT))))
        for control in (github_sync, preview, download, publish, export, open_data): actions.addWidget(control)
        actions.addStretch(); outer.addLayout(actions)
        return page

    def sync_from_github(self) -> None:
        base = self.github_data_url.text().strip().rstrip("/")
        if not base:
            QMessageBox.information(self, "GitHub URL required", "Enter the GitHub Pages/site root or raw GitHub data-folder URL first.")
            return
        if QMessageBox.question(
            self, "Sync from GitHub?",
            "Replace local current stats and map history with the approved versions currently in GitHub?\n\n"
            "If a GitHub file does not exist, that part will start from scratch."
        ) != QMessageBox.Yes:
            return
        self.sync_status.setPlainText(f"Downloading from {base}…")

        def work():
            current, previous, history_index, days = fetch_github_dataset(base)
            return replace_with_github_dataset(
                stats_path=STATS_PATH, previous_path=ELO_DATA_ROOT / "previous_stats.json",
                history_root=HISTORY_ROOT, current=current, previous=previous,
                history_index=history_index, days=days)

        def done(result) -> None:
            try:
                (DATA_ROOT / "github-sync.json").write_text(json.dumps({"baseUrl": base}, indent=2) + "\n", encoding="utf-8")
            except OSError:
                pass
            self.refresh_elo_data()
            current_text = "current_stats.json loaded" if result["current"] else "no current_stats.json — fresh stats"
            previous_text = "previous_stats.json loaded" if result["previous"] else "no previous_stats.json"
            self.sync_status.setPlainText(f"GitHub sync complete from {base}.\n"
                                          f"{current_text}; {previous_text}; {result['historyDays']} history day(s) loaded.")

        self._run_task(work, done, lambda message: (self.sync_status.setPlainText(message),
                                                    QMessageBox.warning(self, "GitHub sync failed", message)))

    def _api_base(self) -> str:
        return self.api_url.text().strip().rstrip("/")

    def preview_remote_stats(self) -> None:
        base = self._api_base()
        if not base:
            QMessageBox.information(self, "API URL required", "Enter the API URL first."); return

        def done(remote) -> None:
            ranked = sorted(remote.get("players", {}).items(), key=lambda item: float(item[1].get("elo", 0)), reverse=True)
            self.sync_table.setRowCount(len(ranked))
            for row, (player_id, values) in enumerate(ranked):
                for col, value in enumerate((row + 1, player_id, f"{float(values.get('elo', 0)):.2f}")):
                    self.sync_table.setItem(row, col, QTableWidgetItem(str(value)))
            self.sync_status.setPlainText(f"Previewed {len(ranked)} players from {base}. Local stats were not changed.")

        self._run_task(lambda: fetch_current_stats(base), done,
                       lambda message: QMessageBox.warning(self, "Preview failed", message))

    def download_remote_stats(self) -> None:
        base = self._api_base()
        if not base:
            QMessageBox.information(self, "API URL required", "Enter the API URL first."); return

        def done(remote) -> None:
            local = read_json(STATS_PATH, {"players": {}, "importedGames": {}})
            unpublished = local_only_imports(local, remote)
            if unpublished:
                QMessageBox.warning(self, "Local maps are newer", f"Download blocked because this computer has {len(unpublished)} local map(s) that are not in the published state. Publish/export them first.")
                return
            if QMessageBox.question(self, "Use published stats?", "Replace the local Elo state with the currently published state? A backup will be created first.") != QMessageBox.Yes:
                return
            backup = safely_replace_stats(STATS_PATH, remote)
            self.refresh_elo_data()
            self.sync_status.setPlainText(f"Downloaded the published state. Backup: {backup}" if backup else "Downloaded the published state.")

        self._run_task(lambda: fetch_current_stats(base), done,
                       lambda message: QMessageBox.warning(self, "Download failed", message))

    def publish_local_history(self) -> None:
        base, token = self._api_base(), self.api_token.text().strip()
        publisher = self.publisher_name.text().strip()
        if not base or not token or not publisher:
            QMessageBox.information(self, "Publishing details required", "Enter the API URL, publisher name and an authorised publish token."); return

        def work():
            published_maps = 0
            for day_path in day_files(HISTORY_ROOT):
                day = read_day(day_path)
                day["publishedBy"] = publisher
                published_maps += int(publish_day(base, day, token).get("mapsAccepted", 0))
            publish_snapshot(base, json.loads(STATS_PATH.read_text(encoding="utf-8")), token)
            return published_maps

        self.sync_status.setPlainText("Publishing…")
        self._run_task(work, lambda count: self.sync_status.setPlainText(
            f"Publish complete. {count} map report(s) accepted/updated and current stats published."),
            lambda message: QMessageBox.warning(self, "Publish failed", message))

    def _refresh_upload_connection(self) -> None:
        settings = load_upload_config(ROOT, DATA_ROOT)
        problem = connection_problem(settings)
        self.upload_connection.setText(
            f"Upload connection: {settings['repo']} (branch {settings['branch']}), token found." if not problem else problem)

    def preview_upload_request(self) -> None:
        try:
            package = build_package(DATA_ROOT)
        except UploadError as error:
            QMessageBox.warning(self, "Nothing to upload", str(error)); return
        self.sync_status.setPlainText(package.describe())

    def send_upload_request(self) -> None:
        settings = load_upload_config(ROOT, DATA_ROOT)
        self._refresh_upload_connection()
        problem = connection_problem(settings)
        if problem:
            QMessageBox.information(self, "Upload is not set up", problem); return
        requester = self.upload_name.text().strip()
        if not requester:
            QMessageBox.information(self, "Your name", "Enter your name so the owner knows who sent this."); return
        try:
            package = build_package(DATA_ROOT)
        except UploadError as error:
            QMessageBox.warning(self, "Nothing to upload", str(error)); return
        answer = QMessageBox.question(
            self, "Request upload?",
            f"Send {package.players} players and {package.maps} map report(s) across {package.days} history day(s) "
            f"to {settings['repo']} as a pull request?\n\nNothing changes on the live site until the owner reviews and merges it.")
        if answer != QMessageBox.Yes:
            return
        self.upload_send_button.setEnabled(False); self.upload_preview_button.setEnabled(False)
        self.sync_status.setPlainText("Sending upload request…")
        worker = UploadWorker(settings, package, requester, self.upload_note.text().strip(), self)
        worker.progress.connect(lambda message: self.sync_status.setPlainText(message))
        worker.finished_ok.connect(self._upload_finished)
        worker.failed.connect(self._upload_failed)
        self.upload_worker = worker
        worker.start()

    def _upload_buttons_ready(self) -> None:
        self.upload_send_button.setEnabled(True); self.upload_preview_button.setEnabled(True)

    def _upload_finished(self, result: dict) -> None:
        self._upload_buttons_ready()
        message = str(result.get("message", "Done."))
        self.sync_status.setPlainText(message)
        url = str(result.get("pullRequestUrl", ""))
        if result.get("status") == "ok" and url.startswith("https://"):
            if QMessageBox.question(self, "Upload requested", message + "\n\nOpen the pull request in your browser?") == QMessageBox.Yes:
                QDesktopServices.openUrl(QUrl(url))
        else:
            QMessageBox.information(self, "Upload request", message)

    def _upload_failed(self, message: str) -> None:
        self._upload_buttons_ready()
        self.sync_status.setPlainText(f"Upload request failed:\n{message}")
        QMessageBox.warning(self, "Upload request failed", message)

    # --------------------------------------------------- GitHub Desktop export
    def _github_repo(self) -> Path | None:
        saved = str((read_json(GITHUB_FOLDER_CONFIG, {}) or {}).get("path", ""))
        if saved and looks_like_site_repo(Path(saved)):
            return Path(saved)
        found = suggest_repos(ROOT)
        return found[0] if found else None

    def _refresh_github_repo_label(self) -> None:
        repo = self._github_repo()
        self.github_repo_label.setText(f"Website folder: {repo}" if repo else
                                       "Website folder not found yet. Press Change folder and pick your elo-Ranking clone.")

    def choose_github_repo(self) -> Path | None:
        current = self._github_repo()
        folder = QFileDialog.getExistingDirectory(self, "Select your local elo-Ranking GitHub Desktop folder",
                                                  str(current or Path.home() / "Documents" / "GitHub"))
        if not folder:
            return None
        repo = Path(folder).resolve()
        if not looks_like_site_repo(repo):
            QMessageBox.warning(self, "Not the website folder", "Choose the folder GitHub Desktop opened (it has index.html, script.js and a .git folder).")
            return None
        GITHUB_FOLDER_CONFIG.write_text(json.dumps({"path": str(repo)}, indent=2) + "\n", encoding="utf-8")
        self._refresh_github_repo_label()
        return repo

    def export_to_github_folder(self, *, ask: bool = True) -> None:
        """One click: copy stats and history into the site clone, then open GitHub Desktop on it."""
        repo = self._github_repo() or self.choose_github_repo()
        if repo is None:
            return
        try:
            manifest = prepare_export(data_root=DATA_ROOT, repo=repo)
        except (ExportError, OSError) as error:
            QMessageBox.warning(self, "Export cannot proceed", str(error))
            return
        maps = sum(len(day["maps"]) for _, day in manifest["days"])
        if ask and QMessageBox.question(
                self, "Export to GitHub Desktop?",
                f"Copy the current stats and {maps} map report(s) across {len(manifest['days'])} day(s) into:\n{repo}\n\n"
                "GitHub Desktop opens afterwards so you can Commit and Push.") != QMessageBox.Yes:
            return
        try:
            result = write_export(manifest)
            GITHUB_FOLDER_CONFIG.write_text(json.dumps({"path": str(repo)}, indent=2) + "\n", encoding="utf-8")
        except (ExportError, OSError, ValueError) as error:
            QMessageBox.warning(self, "Export failed", str(error))
            return
        self.sync_status.setPlainText(
            f"Ready in GitHub Desktop: {result['maps']} map(s), {result['history_days']} history day(s).\n"
            f"Folder: {repo}\nNow Commit to main and Push origin in GitHub Desktop.")
        self.log.append(f"Exported to {repo}. Commit and Push in GitHub Desktop.")
        if not QDesktopServices.openUrl(QUrl(github_desktop_url(repo))):
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(repo)))

    def export_current_stats(self) -> None:
        if not STATS_PATH.exists():
            QMessageBox.warning(self, "Nothing to export", "No local stats.json exists yet."); return
        target, _ = QFileDialog.getSaveFileName(self, "Export current stats", "current_stats.json", "JSON files (*.json)")
        if not target: return
        shutil.copy2(STATS_PATH, target)
        QMessageBox.information(self, "Export complete", f"Exported current stats to:\n{target}")

    # ---------------------------------------------------------- registry page
    def _build_registry_page(self) -> QWidget:
        page = QWidget(); page.setObjectName("page")
        outer = QVBoxLayout(page)
        outer.setContentsMargins(30, 25, 30, 25); outer.setSpacing(14)
        outer.addLayout(header("Player registry",
                               "The names the parser looks for and the IDs Elo uses. Permanent IDs keep each player's history together."))
        self.registry_table = QTableWidget(0, 4)
        self.registry_table.setHorizontalHeaderLabels(["Permanent ID", "Player name", "In-game name", "OCR aliases (comma separated)"])
        self.registry_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeToContents)
        for column in (1, 2, 3):
            self.registry_table.horizontalHeader().setSectionResizeMode(column, QHeaderView.Stretch)
        self.registry_table.verticalHeader().setVisible(False)
        outer.addWidget(self.registry_table)
        self.registry_status = QLabel("Changes are saved to the registry only. Ratings are not edited.")
        self.registry_status.setObjectName("subtitle"); self.registry_status.setWordWrap(True)
        outer.addWidget(self.registry_status)
        actions = QHBoxLayout()
        add_player = button("Add player", secondary=True)
        reload_players = button("Reload", secondary=True)
        save_players = button("Save registry")
        add_player.clicked.connect(self.add_registry_row)
        reload_players.clicked.connect(self.load_registry_table)
        save_players.clicked.connect(self.save_registry)
        actions.addWidget(add_player); actions.addWidget(reload_players); actions.addStretch(); actions.addWidget(save_players)
        outer.addLayout(actions)
        self.load_registry_table()
        return page

    def load_registry_table(self) -> None:
        if not hasattr(self, "registry_table"): return
        self.registry_table.setRowCount(len(self.registry))
        for row, person in enumerate(sorted(self.registry, key=lambda item: item["id"])):
            values = (person["id"], person.get("name", ""), person.get("codName", ""), ", ".join(person.get("aliases", [])))
            for column, value in enumerate(values):
                item = QTableWidgetItem(str(value))
                if column == 0: item.setFlags(item.flags() & ~Qt.ItemIsEditable)
                self.registry_table.setItem(row, column, item)
        self.registry_status.setText("Loaded the player registry.")

    def add_registry_row(self) -> None:
        used = {int(person["id"]) for person in self.registry}
        next_id = 1
        while next_id in used: next_id += 1
        row = self.registry_table.rowCount(); self.registry_table.insertRow(row)
        for column, value in enumerate((next_id, "", "", "")):
            self.registry_table.setItem(row, column, QTableWidgetItem(str(value)))
        self.registry_table.scrollToBottom(); self.registry_table.setCurrentCell(row, 1)

    def save_registry(self) -> None:
        players: dict[str, dict] = {}
        for row in range(self.registry_table.rowCount()):
            values = [self.registry_table.item(row, column).text().strip() if self.registry_table.item(row, column) else "" for column in range(4)]
            try:
                registry_id = int(values[0])
            except ValueError:
                self.registry_status.setText(f"Row {row + 1}: permanent ID must be a whole number."); return
            if registry_id <= 0 or str(registry_id) in players:
                self.registry_status.setText(f"Row {row + 1}: permanent IDs must be positive and unique."); return
            if not values[1] or not values[2]:
                self.registry_status.setText(f"Row {row + 1}: player name and in-game name are required."); return
            record = {"name": values[1], "codName": values[2]}
            aliases = list(dict.fromkeys(alias.strip() for alias in values[3].split(",") if alias.strip()))
            if aliases: record["aliases"] = aliases
            players[str(registry_id)] = record
        backup_dir = DATA_ROOT / "registry-backups"; backup_dir.mkdir(exist_ok=True)
        if REGISTRY_PATH.exists():
            shutil.copy2(REGISTRY_PATH, backup_dir / f"player_registry-{datetime.now():%Y%m%d-%H%M%S}.json")
        temporary = REGISTRY_PATH.with_suffix(".json.tmp")
        temporary.write_text(json.dumps({"players": players}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        temporary.replace(REGISTRY_PATH)
        self.registry = self._load_registry()
        self._refresh_registry_selectors()
        self.load_registry_table()
        self.registry_status.setText("Registry saved. The parser uses it from the next video. New players start at 900 Elo.")

    def _refresh_registry_selectors(self) -> None:
        for row in range(self.players.rowCount()):
            selector = self.players.cellWidget(row, 1)
            selected = selector.currentData()
            selector.blockSignals(True); self._fill_registry_selector(selector)
            index = selector.findData(selected); selector.setCurrentIndex(max(0, index)); selector.blockSignals(False)

    # ------------------------------------------------------------ queue + OCR
    def add_videos(self) -> None:
        files, _ = QFileDialog.getOpenFileNames(self, "Select videos", "", "Videos (*.mp4 *.mov *.mkv *.avi *.webm)")
        self._append_videos(Path(file) for file in files)

    def add_folder(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "Select video folder")
        if folder:
            videos = (p for p in Path(folder).iterdir() if p.suffix.lower() in VIDEO_EXTENSIONS)
            self._append_videos(sorted(videos, key=numbered_video_key))

    def _drop_duplicate_videos(self, incoming: list) -> list | None:
        """First duplicate check: byte-compare videos being added (and the ones already queued).

        Returns the list to add, or None if the user cancelled. Files on disk are
        never changed; "skip" only keeps the repeat out of the queue.
        """
        if len(self.videos) + len(incoming) < 2:
            return incoming
        everything = list(self.videos) + list(incoming)
        dialog = QProgressDialog("Checking for duplicate videos…", "Cancel", 0, 1000, self)
        dialog.setWindowTitle("Duplicate check"); dialog.setWindowModality(Qt.WindowModal)
        dialog.setMinimumDuration(400); dialog.setValue(0)

        def progress(message: str, fraction: float) -> None:
            dialog.setLabelText(message); dialog.setValue(int(fraction * 1000))
            QApplication.processEvents()

        def cancelled() -> bool:
            QApplication.processEvents()
            return dialog.wasCanceled()

        try:
            groups = find_duplicates(everything, progress, cancelled)
        except DuplicateCheckCancelled:
            self.log.append("Duplicate check cancelled; no videos were added.")
            return None
        finally:
            dialog.close()
        queued = set(self.videos)
        redundant: dict = {}
        for group in groups:
            keeper = group[0]
            for extra in group[1:]:
                if extra not in queued:
                    redundant[extra] = keeper
        if not redundant:
            return incoming
        # Byte-identical copies are always the same map: skip them without asking.
        for extra, keeper in redundant.items():
            self.log.append(f"Skipped duplicate: {extra.name} (byte-for-byte the same as {keeper.name})")
        return [path for path in incoming if path not in redundant]

    def _append_videos(self, paths) -> None:
        incoming: list = []
        for path in paths:
            if path in self.videos or path in incoming: continue
            incoming.append(path)
        incoming = self._drop_duplicate_videos(incoming)
        if not incoming:
            return
        ask = QMessageBox.question(
            self, "Start times",
            f"Choose a start time for each of the {len(incoming)} video(s)?\n\n"
            "Yes: scrub each video to the scoreboard.\nNo: let the parser find the scoreboard itself (Auto).")
        for path in incoming:
            start = 0.0
            if ask == QMessageBox.Yes:
                start_dialog = StartTimeDialog(path, self)
                if start_dialog.exec() != QDialog.Accepted:
                    continue
                start = start_dialog.selected_seconds()
            self._add_queue_row(path, start, "You")
        self._update_summaries()

    def _add_queue_row(self, path: Path, start: float, origin: str) -> None:
        self.videos.append(path)
        row = self.queue.rowCount(); self.queue.insertRow(row)
        self.queue.setItem(row, 0, QTableWidgetItem(str(path)))
        self.queue.setCellWidget(row, 1, start_spin(start))
        self.queue.setItem(row, 2, QTableWidgetItem(origin))
        self.queue.setItem(row, 3, QTableWidgetItem("Waiting"))

    def _status(self, row: int) -> str:
        item = self.queue.item(row, 3)
        return item.text() if item else ""

    def _set_status(self, row: int, text: str) -> None:
        if 0 <= row < self.queue.rowCount():
            self.queue.item(row, 3).setText(text)

    def remove_selected(self) -> None:
        if self.process is not None:
            QMessageBox.information(self, "Parsing", "Stop the parse before removing videos."); return
        for row in sorted({item.row() for item in self.queue.selectedItems()}, reverse=True):
            self.queue.removeRow(row); self.videos.pop(row)
        self._update_summaries()

    def _update_summaries(self) -> None:
        if not hasattr(self, "queued_value"): return
        statuses = [self._status(row) for row in range(self.queue.rowCount())]
        self.queued_value.setText(str(sum(1 for s in statuses if s == "Waiting")))
        self.parsed_value.setText(str(sum(1 for s in statuses if s.startswith("Parsed"))))
        self.review_value.setText(str(sum(1 for r in self.results if not r.get("approved") and not r.get("droppedAsDuplicate"))))

    def add_manual(self) -> None:
        name, _ = QFileDialog.getOpenFileName(self, "Optional video for manual review", "", "Videos (*.mp4 *.mov *.mkv *.avi *.webm);;All files (*)")
        path = Path(name) if name else Path(f"manual-game-{len(self.results)+1}.mp4")
        result = self._blank_result(self._unique_source(path.name))
        result["videoPath"] = str(path) if name else ""
        self.results.append(result)
        self.review_index = len(self.results) - 1
        self.load_review()
        self.pages.setCurrentWidget(self.review_page)

    def start_batch(self) -> None:
        if self.process is not None:
            return
        self.parse_rows = [row for row in range(self.queue.rowCount()) if self._status(row) == "Waiting"]
        if not self.parse_rows:
            if not self.videos:
                QMessageBox.information(self, "No videos", "Add at least one video first.")
            return
        self.run_button.setEnabled(False)
        self.run_button.setText("Parsing…")
        self.stop_requested = False
        self.stop_button.setText("Stop parse")
        self.stop_button.setEnabled(True)
        STAGING.mkdir(parents=True, exist_ok=True)
        self.batch_first_result = len(self.results)
        self.progress.setRange(0, 100); self.progress.setValue(0); self.progress.setFormat("%p%")
        self._run_next()

    def _finish_batch(self) -> None:
        self.process = None
        self.run_button.setEnabled(True)
        self.run_button.setText("Parse new videos")
        self.stop_button.setEnabled(False)
        self.stop_button.setText("Stop parse")
        new_results = self.results[self.batch_first_result:]
        if not new_results:
            return
        self._check_score_duplicates()
        self._auto_approve(new_results)
        # More videos may have arrived from Drive while this batch ran.
        if any(self._status(row) == "Waiting" for row in range(self.queue.rowCount())) and self.auto_parse.isChecked():
            self.log.append("More videos arrived while parsing; parsing them now.")
            self.start_batch(); return
        self.log.append("All videos parsed. Validation is ready.")
        waiting = [i for i, r in enumerate(self.results) if not r.get("approved") and not r.get("droppedAsDuplicate")]
        self.review_index = waiting[0] if waiting else self.batch_first_result
        self.load_review(); self.pages.setCurrentWidget(self.review_page)
        self.activateWindow()
        self._update_summaries()

    def _run_next(self) -> None:
        if self.stop_requested or not self.parse_rows:
            self._finish_batch()
            return
        row = self.parse_rows.pop(0)
        self.process_row = row
        video = self.videos[row]
        done = self.queue.rowCount() - len(self.parse_rows)
        self.progress.setValue(0)
        self.progress_label.setText(f"Processing {video.name}")
        self.process_buffer = ""
        self.process_output_text = ""
        self.reported_result_path = None
        self.current_parse_started_at = time.time()
        self.current_pass = "First pass"
        start = self.queue.cellWidget(row, 1).value()
        output = STAGING / f"{datetime.now():%Y%m%d-%H%M%S}-{row + 1:02d}-{video.stem}.json"
        self._set_status(row, "Parsing")
        self._update_summaries()
        self.log.append(f"[{done}/{self.queue.rowCount()}] {video.name}")
        self.process = QProcess(self)
        environment = QProcessEnvironment.systemEnvironment()
        environment.insert("PYTHONUNBUFFERED", "1")
        # Force UTF-8 at the process boundary: the worker prints box characters,
        # and a Windows pipe would otherwise default to cp1252.
        environment.insert("PYTHONIOENCODING", "utf-8")
        environment.insert("PYTHONUTF8", "1")
        environment.insert("NO_COLOR", "1")
        environment.insert("CODSTATS_REGISTRY", str(REGISTRY_PATH))
        environment.insert("CODSTATS_DEBUG_DIR", str(DEBUG_ROOT))
        bundled_tesseract = ROOT / "tools" / "tesseract" / "tesseract.exe"
        bundled_models = ROOT / "models"
        if bundled_models.exists():
            environment.insert("PADDLE_PDX_CACHE_HOME", str(bundled_models))
        if bundled_tesseract.exists():
            environment.insert("TESSERACT_CMD", str(bundled_tesseract))
            environment.insert("PATH", f"{bundled_tesseract.parent};{environment.value('PATH')}")
        self.process.setProcessEnvironment(environment)
        self.process.setProcessChannelMode(QProcess.MergedChannels)
        self.process.readyReadStandardOutput.connect(self._read_process_output)
        self.process.errorOccurred.connect(self._process_error)
        self.process.finished.connect(lambda code, _status: self._parsed(code, output, video, row))
        start_argument = "auto" if start <= 0 else str(start)
        self.process.start(sys.executable, [str(ROOT / "ocr_worker.py"), str(video), str(output), "--start", start_argument])

    def _read_process_output(self) -> None:
        if self.process is None:
            return
        output = bytes(self.process.readAllStandardOutput()).decode(errors="replace")
        if not output:
            return
        self.process_output_text += output
        self.log.append(output.rstrip())
        combined = self.process_buffer + output
        lines = combined.splitlines(keepends=True)
        self.process_buffer = ""
        if lines and not lines[-1].endswith(("\n", "\r")):
            self.process_buffer = lines.pop()
        video = self.videos[self.process_row].name if 0 <= self.process_row < len(self.videos) else ""
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("RESULT="):
                reported = stripped.partition("=")[2].strip()
                if reported:
                    self.reported_result_path = Path(reported)
            if "Finding the scoreboard" in line:
                self.current_pass = "Finding scoreboard"
            elif "First pass:" in line:
                self.current_pass = "First pass"
            elif "Fallback pass:" in line:
                self.current_pass = "Fallback pass"
            match = re.search(r"\[(\d+)/(\d+)\]\s+([0-9.]+)s", line)
            if not match:
                continue
            sample, total = int(match.group(1)), max(1, int(match.group(2)))
            percent = min(100, round(sample / total * 100))
            self.progress.setValue(percent)
            self.progress_label.setText(f"{video} — {self.current_pass} — sample {sample}/{total} — {percent}%")
        self.log.ensureCursorVisible()

    def _process_error(self, error: QProcess.ProcessError) -> None:
        if error != QProcess.ProcessError.FailedToStart:
            return
        self._set_status(self.process_row, "Could not start")
        self.log.append("The OCR worker could not start. Check the Python environment (run setup.ps1), then try again.")
        self.progress_label.setText("OCR worker could not start")
        self.parse_rows = []
        self.process = None
        self._finish_batch()

    def stop_parse(self) -> None:
        if self.process is None or self.process.state() == QProcess.ProcessState.NotRunning:
            return
        self.stop_requested = True
        self.stop_button.setEnabled(False)
        self.stop_button.setText("Stopping…")
        self.log.append("Stop requested. Ending the active OCR process…")
        active_process = self.process
        active_process.terminate()
        QTimer.singleShot(3000, lambda process=active_process: process.kill()
                          if process.state() != QProcess.ProcessState.NotRunning else None)

    def _read_result_json(self, output: Path, video: Path) -> tuple[dict | None, str | None]:
        """Load the JSON the OCR worker wrote for this video.

        Tries the path the worker reported, then the path it was given, then
        any fresh staging JSON whose source is this video (in case the final
        RESULT= line was missed). A result without a score is still accepted:
        validation is where missing pieces get filled in.
        """
        candidates: list[Path] = []
        if self.reported_result_path is not None:
            candidates.append(self.reported_result_path)
        candidates.append(output)
        try:
            fresh = sorted(STAGING.glob("*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
        except OSError:
            fresh = []
        for path in fresh:
            try:
                if path.stat().st_mtime + 1.0 >= self.current_parse_started_at:
                    candidates.append(path)
            except OSError:
                continue

        seen: set[str] = set()
        errors: list[str] = []
        wanted_source = video.name.casefold()
        for candidate_path in candidates:
            key = str(candidate_path)
            if key in seen:
                continue
            seen.add(key)
            if not candidate_path.exists():
                errors.append(f"{candidate_path.name} was not created")
                continue
            candidate = read_json(candidate_path)
            if not isinstance(candidate, dict):
                errors.append(f"{candidate_path.name} could not be read")
                continue
            if candidate_path not in (output, self.reported_result_path):
                source = str(candidate.get("source") or "").casefold()
                if source and Path(source).name.casefold() != wanted_source:
                    continue
            return candidate, None
        return None, "; ".join(errors) if errors else "no result JSON was available"

    def _unique_source(self, name: str) -> str:
        """Two different videos can share a name (two uploaders' "1.mp4"); keep each game's source unique."""
        taken = {str(r.get("source", "")).casefold() for r in self.results}
        if name.casefold() not in taken:
            return name
        stem, suffix = Path(name).stem, Path(name).suffix
        number = 2
        while f"{stem} ({number}){suffix}".casefold() in taken:
            number += 1
        return f"{stem} ({number}){suffix}"

    def _parsed(self, code: int, output: Path, video: Path, row: int, retry: int = 0) -> None:
        if self.stop_requested:
            self._set_status(row, "Waiting")
            self.progress_label.setText(f"Parse stopped — {video.name}")
            self.log.append("Parsing stopped. The interrupted video is back to Waiting.")
            self.parse_rows = []
            self._finish_batch()
            self._update_summaries()
            return

        # QProcess can emit finished before the last readyRead is handled; drain it.
        if self.process is not None:
            remaining = bytes(self.process.readAllStandardOutput()).decode(errors="replace")
            if remaining:
                self.process_output_text += remaining
                self.log.append(remaining.rstrip())
        for line in self.process_output_text.splitlines():
            stripped = line.strip()
            if stripped.startswith("RESULT="):
                reported = stripped.partition("=")[2].strip()
                if reported:
                    self.reported_result_path = Path(reported)

        result, load_error = self._read_result_json(output, video)
        if result is None and code == 0 and retry < 20:
            self._set_status(row, "Loading parsed result")
            QTimer.singleShot(100, lambda: self._parsed(code, output, video, row, retry + 1))
            return

        if result is None:
            # The worker died without writing anything. Still send the video to
            # validation as a blank game, so it can be filled in from the footage.
            reason = load_error or f"worker exited with code {code}"
            self.log.append(f"The parser could not read {video.name} ({reason}). It is in validation as a blank game.")
            result = self._blank_result(video.name)
            result["scanError"] = reason
        result["source"] = self._unique_source(str(result.get("source") or video.name))
        result["videoPath"] = str(video)
        self.results.append(result)
        found = sum(1 for p in result.get("players") or []
                    if p.get("registryId") is not None and p.get("eliminations") is not None and p.get("deaths") is not None)
        self._set_status(row, "Parsed" if result.get("complete") else f"Parsed — check needed ({found}/8 players)")
        self.progress.setValue(100)
        self.process = None
        self._run_next()
        self._update_summaries()

    def _blank_result(self, source: str) -> dict:
        return {"source": source, "mode": {"value": "Hardpoint", "confidence": 0},
                "modeScore": {"teamAName": "GUILD", "teamA": 0, "teamBName": "JSOC", "teamB": 0,
                              "difference": 0, "confidence": 0, "overtime": None},
                "teams": {"teamA": {"name": "GUILD", "players": []}, "teamB": {"name": "JSOC", "players": []}},
                "players": [], "framesScanned": 0, "complete": False}

    # --------------------------------------------- duplicates + auto-approval
    def _recent_history_maps(self, days: int = 3) -> list[dict]:
        reports = []
        for path in day_files(HISTORY_ROOT)[-days:]:
            try:
                reports.extend(read_day(path).get("maps") or [])
            except (OSError, ValueError):
                continue
        return reports

    def _check_score_duplicates(self) -> None:
        """Second duplicate check: same mode, exact score and same stats, from two different recordings."""
        for index, other in find_suspects(self.results, self._recent_history_maps()):
            result = self.results[index]
            if index < self.batch_first_result or result.get("duplicateAnswered"):
                continue
            if isinstance(other, int):
                twin = self.results[other]
                where = f"\"{twin.get('source')}\" in this session"
            else:
                where = f"\"{other.get('source')}\", already imported on {other.get('date')}"
            score = result.get("modeScore") or {}
            box = QMessageBox(self)
            box.setWindowTitle("Same map twice?")
            box.setIcon(QMessageBox.Question)
            box.setText(f"\"{result.get('source')}\" has the same mode, score ({score.get('teamA')}-{score.get('teamB')}) "
                        f"and player stats as {where}.")
            box.setInformativeText("This usually means two people recorded the same map. Is it a different map?")
            same = box.addButton("Same map: leave it out", QMessageBox.AcceptRole)
            box.addButton("Different map: keep both", QMessageBox.RejectRole)
            box.setDefaultButton(same)
            box.exec()
            result["duplicateAnswered"] = True
            if box.clickedButton() is same:
                result["droppedAsDuplicate"] = True
                result["approved"] = False
                self.log.append(f"Left out {result.get('source')}: same map as {where}.")
            else:
                result["confirmedDifferentMap"] = True

    def _auto_approve(self, results: list[dict]) -> None:
        if not self.auto_approve.isChecked():
            return
        count = 0
        for result in results:
            if result.get("droppedAsDuplicate") or result.get("scanError") or not result.get("complete"):
                continue
            players = result.get("players") or []
            confident = len(players) == 8 and all(
                min(float((p.get("confidence") or {}).get(key, 0)) for key in ("id", "eliminations", "deaths")) >= AUTO_APPROVE_CONFIDENCE
                for p in players)
            confident = confident and float((result.get("mode") or {}).get("confidence") or 0) >= AUTO_APPROVE_CONFIDENCE
            confident = confident and float((result.get("modeScore") or {}).get("confidence") or 0) >= AUTO_APPROVE_CONFIDENCE
            if not confident:
                continue
            try:
                convert_game(result)
            except EloExportError:
                continue
            result["approved"] = True; result["autoApproved"] = True
            count += 1
        if count:
            self.log.append(f"Pre-approved {count} game(s) read with high confidence. They are still listed for a quick look.")

    # ---------------------------------------------------------- validation UI
    def _needs(self, result: dict) -> list[str]:
        """Plain-English list of what the parser could not read."""
        needs = []
        if result.get("scanError"):
            needs.append(f"the parser stopped early ({result['scanError']})")
        if not (result.get("mode") or {}).get("value"):
            needs.append("the mode")
        if not result.get("modeScore") or (result.get("modeScore") or {}).get("teamA") is None:
            needs.append("the score")
        players = result.get("players") or []
        unresolved = sum(1 for p in players if p.get("registryId") is None)
        missing = max(0, 8 - len(players)) + unresolved
        if missing:
            needs.append(f"{missing} player name(s)")
        no_stats = sum(1 for p in players if p.get("eliminations") is None or p.get("deaths") is None)
        if no_stats:
            needs.append(f"stats for {no_stats} player(s)")
        return needs

    def load_review(self) -> None:
        if not self.results: return
        self.review_index = max(0, min(self.review_index, len(self.results) - 1))
        result = self.results[self.review_index]
        self.review_title.setText(f"Review {self.review_index+1}/{len(self.results)} — {result.get('source', '?')}")
        needs = self._needs(result)
        if result.get("droppedAsDuplicate"):
            flag, colour = "Left out as a duplicate. Approve it to put it back.", "#ffb454"
        elif result.get("approved"):
            flag = "Approved" + (" automatically (high confidence). Have a quick look." if result.get("autoApproved") else ".")
            colour = "#3fb950"
        elif needs:
            flag, colour = "Fill in: " + ", ".join(needs) + ". Rows that need you are highlighted.", "#ffb454"
        else:
            flag, colour = "Everything was read. Compare with the video, then approve.", "#7feeff"
        self.review_flags.setText(flag); self.review_flags.setStyleSheet(f"color:{colour}; font-weight:600;")
        path = result.get("videoPath")
        if path and Path(path).exists(): self.media.setSource(QUrl.fromLocalFile(path))
        else: self.media.setSource(QUrl())
        self.overlay.set_layouts(result)
        reference = DEBUG_ROOT / Path(str(result.get("source", "unknown"))).stem / "full-frame-reference.jpg"
        if reference.exists():
            size = QImageReader(str(reference)).size()
            self.overlay.set_source_size(size.width(), size.height())
        mode = (result.get("mode") or {}).get("value") or "Hardpoint"
        self.mode.setCurrentText(mode)
        score = result.get("modeScore") or {}
        overtime = score.get("overtime") or {}
        self.result_type.setCurrentIndex(1 if overtime.get("active") else 0)
        self.score_a.setValue(int(score.get("teamA") or 0)); self.score_b.setValue(int(score.get("teamB") or 0))
        self.ot_a.setText(str((overtime.get("teamA") or {}).get("raw") or ""))
        self.ot_b.setText(str((overtime.get("teamB") or {}).get("raw") or ""))

        # Team A rows first, then Team B; players the parser could not place
        # fill the team that is short, and empty rows go where a player is missing.
        records = list(result.get("players") or [])[:8]
        team_a = [p for p in records if p.get("team") == "teamA"][:4]
        team_b = [p for p in records if p.get("team") == "teamB"][:4]
        loose = [p for p in records if p not in team_a and p not in team_b]
        for player in loose:
            (team_a if len(team_a) < 4 else team_b).append(dict(player, team="teamA" if len(team_a) < 4 else "teamB"))
        team_a += [{"team": "teamA"}] * (4 - len(team_a))
        team_b += [{"team": "teamB"}] * (4 - len(team_b))
        for row, player in enumerate(team_a[:4] + team_b[:4]):
            team = self.players.cellWidget(row, 0); registry = self.players.cellWidget(row, 1)
            full_id = self.players.cellWidget(row, 2); elims = self.players.cellWidget(row, 3); deaths = self.players.cellWidget(row, 4)
            team.setCurrentText("Team B" if player.get("team") == "teamB" else "Team A")
            index = registry.findData(player.get("registryId")); registry.setCurrentIndex(max(0, index))
            full_id.setText(str(player.get("id") or "")); elims.setValue(int(player.get("eliminations") or 0)); deaths.setValue(int(player.get("deaths") or 0))
            missing = player.get("registryId") is None or player.get("eliminations") is None or player.get("deaths") is None
            for widget in (registry, elims, deaths, full_id):
                widget.setStyleSheet("border:1px solid #ffb454;" if missing else "")
            self.players.cellWidget(row, 5).setEnabled(bool(self._evidence_times(result, player.get("registryId"))))
        log_path = Path(result.get("confidenceLog") or "__missing__")
        self.confidence_chart.load(log_path)
        self.confidence_view.setPlainText(confidence_evidence(result, log_path))
        self.raw_result_view.setPlainText(json.dumps(result, indent=2, ensure_ascii=False))
        self.update_result_controls()
        self.jump_cursor = {}
        self.review_status.setText("Edit any field, compare it with the video, then approve this game.")

    def save_form(self) -> bool:
        result = copy.deepcopy(self.results[self.review_index])
        result["mode"] = {"value": self.mode.currentText(), "confidence": 1.0, "manuallyValidated": True}
        a, b = self.score_a.value(), self.score_b.value()
        try:
            if self.mode.currentText() == "Overload" and self.result_type.currentIndex() == 1:
                set_overtime_result(result, self.ot_a.text(), self.ot_b.text())
            else:
                set_standard_score(result, a, b)
        except ValueError as error:
            self.review_status.setText(str(error)); return False
        records = []
        used = set()
        for row in range(8):
            team = self.players.cellWidget(row, 0).currentText()
            registry_id = self.players.cellWidget(row, 1).currentData()
            if registry_id is None: self.review_status.setText(f"Row {row+1}: select a registry player."); return False
            if registry_id in used: self.review_status.setText(f"Row {row+1}: that registry player is already used."); return False
            used.add(registry_id)
            person = next(item for item in self.registry if item["id"] == registry_id)
            records.append({"team": "teamA" if team == "Team A" else "teamB", "name": person["codName"],
                            "id": self.players.cellWidget(row, 2).text().strip() or person["codName"],
                            "registryId": registry_id, "eliminations": self.players.cellWidget(row, 3).value(),
                            "deaths": self.players.cellWidget(row, 4).value(),
                            "confidence": {"id": 1.0, "eliminations": 1.0, "deaths": 1.0}, "manuallyValidated": True})
        result["players"] = records
        result.setdefault("teams", {})
        for key, team_name in (("teamA", "GUILD"), ("teamB", "JSOC")):
            members = [p for p in records if p["team"] == key]
            if len(members) != 4: self.review_status.setText(f"{team_name} must contain exactly four players."); return False
            result["teams"][key] = {"name": team_name, "players": [{"row": i+1, "name": p["name"], "registryId": p["registryId"], "resolved": True} for i, p in enumerate(members)]}
        try: convert_game(result)
        except EloExportError as error: self.review_status.setText(str(error)); return False
        result["complete"] = True; result["approved"] = True
        result.pop("droppedAsDuplicate", None); result.pop("autoApproved", None)
        self.results[self.review_index] = result
        return True

    def approve_next(self) -> None:
        if not self.save_form(): return
        self._update_summaries()
        self.next_needing_check(after_approve=True)

    def next_needing_check(self, after_approve: bool = False) -> None:
        count = len(self.results)
        for step in range(1, count + 1):
            index = (self.review_index + step) % count
            result = self.results[index]
            if not result.get("approved") and not result.get("droppedAsDuplicate"):
                self.review_index = index; self.load_review(); return
        if after_approve or QMessageBox.question(self, "All checked", "Every game is approved or left out. Go to Import to Elo?") == QMessageBox.Yes:
            self.show_preview()

    def drop_current_result(self) -> None:
        if not self.results: return
        result = self.results[self.review_index]
        if QMessageBox.question(self, "Remove game?", f"Leave \"{result.get('source')}\" out of this import? The video file is not touched.") != QMessageBox.Yes:
            return
        result["droppedAsDuplicate"] = True; result["approved"] = False
        self._update_summaries()
        self.next_needing_check(after_approve=True)

    def previous_result(self) -> None:
        if self.review_index > 0: self.review_index -= 1; self.load_review()

    def toggle_video(self) -> None:
        if self.media.playbackState() == QMediaPlayer.PlayingState: self.media.pause()
        else: self.media.play()

    def update_result_controls(self) -> None:
        overtime = self.mode.currentText() == "Overload" and self.result_type.currentIndex() == 1
        self.score_a.setEnabled(not overtime); self.score_b.setEnabled(not overtime)
        self.ot_a.setEnabled(overtime); self.ot_b.setEnabled(overtime)
        self.result_type.setEnabled(self.mode.currentText() == "Overload")

    def toggle_boxes(self) -> None:
        self.overlay.enabled = not self.overlay.enabled
        self.overlay.update()

    def jump_layout(self, key: str) -> None:
        if not self.results: return
        timestamp = (self.results[self.review_index].get(key) or {}).get("lockedAtSeconds")
        if timestamp is not None:
            self._seek_to(timestamp)

    def _seek_to(self, seconds: float) -> None:
        """Show the frame at this time and stay paused there (reliable even before first play)."""
        self.media.pause()
        self.media.setPosition(max(0, int(float(seconds) * 1000)))

    @staticmethod
    def _evidence_times(result: dict, registry_id) -> list[float]:
        """Video times where the parser read this player, best reading first."""
        if registry_id is None:
            return []
        source = (result.get("playerSources") or {}).get(str(registry_id))
        if source and source.get("best") is not None:
            best = float(source["best"])
            return [best] + [float(t) for t in source.get("all", []) if abs(float(t) - best) > 1e-6]
        legacy = (result.get("playerEvidenceTimestamps") or {}).get(str(registry_id), [])
        return sorted({float(t) for t in legacy})

    def jump_player(self, row: int) -> None:
        if not self.results: return
        result = self.results[self.review_index]
        registry_id = self.players.cellWidget(row, 1).currentData()
        times = self._evidence_times(result, registry_id)
        if not times:
            self.review_status.setText(f"Row {row+1}: the parser has no recorded video time for this player.")
            return
        # First press: the reading the parser used. Further presses: the other frames, one at a time.
        cursor = getattr(self, "jump_cursor", {})
        position = cursor.get(registry_id, -1) + 1
        if position >= len(times):
            position = 0
        cursor[registry_id] = position
        self.jump_cursor = cursor
        self._seek_to(times[position])
        label = "used for the result" if position == 0 else f"other reading {position} of {len(times) - 1}"
        self.review_status.setText(f"Row {row+1}: jumped to {times[position]:.2f}s ({label}).")

    # ------------------------------------------------------------ import step
    def _importable(self) -> list[dict]:
        return [r for r in self.results if r.get("approved") and not r.get("droppedAsDuplicate") and not r.get("imported")]

    def show_preview(self) -> None:
        if not self.results: return
        importer = EloImporter(ELO_DATA_ROOT)
        self.preview_table.setRowCount(len(self.results)); errors = []
        ready = 0
        for row, result in enumerate(self.results):
            status, colour = "Needs a check", "#ffb454"
            try:
                game = convert_game(result); score = game["result"].get("score") or game["result"].get("overtime")
                values = [game["source"], game["gameMode"], f"{score['teamA']}-{score['teamB']}",
                          f"Team {game['result']['winningTeam']}", str(game["result"]["scoreDifference"]), "8"]
                if result.get("imported"):
                    status, colour = "Imported", "#8f929d"
                elif result.get("droppedAsDuplicate"):
                    status, colour = "Left out", "#8f929d"
                elif importer.status(game) == "imported":
                    status, colour = "Already in Elo (will be skipped)", "#8f929d"
                elif result.get("approved"):
                    status, colour = "Ready" + (" (auto)" if result.get("autoApproved") else ""), "#3fb950"
                    ready += 1
            except Exception as error:
                values = [result.get("source", "?"), "—", "—", "—", "—", str(len(result.get("players") or []))]
                if result.get("droppedAsDuplicate"):
                    status, colour = "Left out", "#8f929d"
                else:
                    errors.append(f"{result.get('source', '?')}: {error}")
            for column, value in enumerate(values + [status]):
                item = QTableWidgetItem(value)
                if column == 6: item.setForeground(QColor(colour))
                self.preview_table.setItem(row, column, item)
        waiting = sum(1 for r in self.results if not r.get("approved") and not r.get("droppedAsDuplicate") and not r.get("imported"))
        message = f"{ready} game(s) ready to import."
        if waiting:
            message += f" {waiting} still need a check (double-click a row to open it); they are not imported."
        self.preview_message.setText(message)
        self.import_button.setEnabled(ready > 0)
        self.pages.setCurrentWidget(self.preview_page)

    def _open_preview_row(self, row: int, _column: int) -> None:
        self.review_index = row; self.load_review(); self.pages.setCurrentWidget(self.review_page)

    def _approved_document(self) -> tuple[dict, list]:
        return build_elo_document(self._importable(), self.match_date.date().toString("yyyy-MM-dd"))

    def export_approved(self) -> Path | None:
        document, skipped = self._approved_document()
        if skipped:
            QMessageBox.warning(self, "Cannot save", "\n".join(f"{x['source']}: {x['reason']}" for x in skipped)); return None
        APPROVED.mkdir(parents=True, exist_ok=True)
        # One file per save (time-stamped), so a second batch on the same day never overwrites the first.
        path = APPROVED / f"cod_stats_{document['date']}_{datetime.now():%H%M%S}.json"
        path.write_text(json.dumps(document, indent=2), encoding="utf-8")
        self.log.append(f"Saved approved games to {path}")
        return path

    def import_to_elo(self) -> None:
        document, skipped = self._approved_document()
        if skipped:
            QMessageBox.warning(self, "Import blocked", "\n".join(f"{x['source']}: {x['reason']}" for x in skipped)); return
        if not document["games"]:
            QMessageBox.information(self, "Nothing to import", "Approve at least one game first."); return
        if QMessageBox.question(
                self, "Import to Elo?",
                f"Apply {len(document['games'])} map(s) played on {document['date']} to the ratings?\n\n"
                "Maps already in Elo are skipped automatically.") != QMessageBox.Yes:
            return
        self.export_approved()
        try:
            outcome = EloImporter(ELO_DATA_ROOT).import_games(document["date"], document["games"],
                                                              [person["id"] for person in self.registry])
        except (ImportError_, ValueError, OSError) as error:
            QMessageBox.warning(self, "Import failed", f"Nothing was changed.\n\n{error}"); return
        imported_sources = {game["source"] for game in document["games"]}
        for result in self._importable():
            if result.get("source") in imported_sources:
                result["imported"] = True
        self.refresh_elo_data()
        self.site_page.loaded and self.site_page.refresh()
        text = f"Imported {outcome['imported']} map(s)."
        if outcome["skipped"]:
            text += f" Skipped {len(outcome['skipped'])} already in Elo: " + ", ".join(map(str, outcome["skipped"]))
        self.log.append(text)
        self.show_preview()
        if QMessageBox.question(self, "Imported", text + "\n\nExport to GitHub Desktop now?") == QMessageBox.Yes:
            self.export_to_github_folder(ask=False)

    def clear_finished(self) -> None:
        keep = [r for r in self.results if not r.get("imported") and not r.get("droppedAsDuplicate")]
        if QMessageBox.question(self, "Clear finished games?",
                                f"Remove {len(self.results) - len(keep)} imported or left-out game(s) from this list? "
                                "Ratings and video files are not touched.") != QMessageBox.Yes:
            return
        self.results = keep
        self.review_index = 0
        for row in range(self.queue.rowCount() - 1, -1, -1):
            if self._status(row).startswith("Parsed"):
                self.queue.removeRow(row); self.videos.pop(row)
        self._update_summaries()
        if self.results: self.show_preview()
        else: self.pages.setCurrentWidget(self.import_page)

    # ---------------------------------------------------------- map history
    def refresh_elo_data(self) -> None:
        stats = (read_json(STATS_PATH, {}) or {}).get("players", {})
        registry = {str(person["id"]): person for person in self.registry}
        ranked = sorted(stats.items(), key=lambda item: float(item[1].get("elo", 900)), reverse=True)
        self.leaderboard.setRowCount(len(ranked))
        for row, (player_id, values) in enumerate(ranked):
            person = registry.get(str(player_id), {})
            kills, deaths = int(values.get("lifetimeKills", 0)), int(values.get("lifetimeDeaths", 0))
            kd = kills / deaths if deaths else float(kills)
            wins = sum(int(values.get(f"{m}Wins", 0)) for m in ("hp", "snd", "overload"))
            losses = sum(int(values.get(f"{m}Losses", 0)) for m in ("hp", "snd", "overload"))
            rank = ("🥇", "🥈", "🥉")[row] if row < 3 else str(row + 1)
            cells = [rank, person.get("codName") or person.get("name") or f"Player {player_id}",
                     f"{float(values.get('elo', 0)):.1f}", kills, deaths, f"{kd:.2f}", f"{wins}-{losses}"]
            for column, value in enumerate(cells): self.leaderboard.setItem(row, column, QTableWidgetItem(str(value)))

        map_rows = []
        for day_path in reversed(day_files(HISTORY_ROOT)):
            try:
                day_payload = read_day(day_path)
            except (OSError, ValueError):
                continue
            day_date = str(day_payload.get("date") or day_path.stem)
            for map_index, map_payload in enumerate(reversed(day_payload.get("maps") or []), start=1):
                game = map_payload.get("game") or {}
                result = game.get("result") or {}
                score_data = result.get("score") or result.get("overtime") or {}
                score = f"{score_data.get('teamA', '—')}-{score_data.get('teamB', '—')}"
                mode = str(map_payload.get("gameMode") or game.get("gameMode") or "?")
                source = str(map_payload.get("source") or game.get("source") or f"Map {map_index}")
                elo_by_player = {str(item.get("playerId")): item for item in (map_payload.get("elo") or [])}
                for team_key in ("A", "B"):
                    for player in ((game.get("teams") or {}).get(team_key) or []):
                        player_id = str(player.get("playerId"))
                        elo = elo_by_player.get(player_id, {})
                        person = registry.get(player_id, {})
                        map_rows.append((day_date, source, mode, score,
                                         person.get("codName") or person.get("name") or f"Player {player_id}",
                                         int(player.get("kills", 0)), int(player.get("deaths", 0)),
                                         elo.get("before"), elo.get("change"), elo.get("after"), elo.get("calculationTrace")))

        self.map_history.setRowCount(len(map_rows))
        for row, item in enumerate(map_rows):
            before, change, after, trace = item[7], item[8], item[9], item[10]
            cells = list(item[:7]) + [
                f"{float(before):.2f}" if before is not None else "—",
                f"{float(change):+.2f}" if change is not None else "—",
                f"{float(after):.2f}" if after is not None else "—"]
            for column, value in enumerate(cells):
                cell = QTableWidgetItem(str(value))
                if column == 0:
                    cell.setData(Qt.UserRole, trace)
                if column == 8 and change is not None:
                    cell.setForeground(QColor("#3fb950" if float(change) >= 0 else "#ff6b7a"))
                self.map_history.setItem(row, column, cell)

    def _show_selected_elo_calculation(self) -> None:
        row = self.map_history.currentRow()
        if row < 0:
            QMessageBox.information(self, "Elo calculation", "Select a player row in Map history first.")
            return
        first = self.map_history.item(row, 0)
        trace = first.data(Qt.UserRole) if first else None
        if not isinstance(trace, dict) or not isinstance(trace.get("steps"), list) or not trace.get("steps"):
            QMessageBox.information(self, "Elo calculation", "This historical map does not contain a recorded calculation trace.")
            return

        def exact(value) -> str:
            if value is None:
                return "—"
            if isinstance(value, bool):
                return "true" if value else "false"
            return str(value)

        engine = "new Python rules" if trace.get("rulesVersion", 1) >= 2 else "original Java rules"
        lines = [
            f"Player: {self.map_history.item(row, 4).text()}",
            f"Map: {self.map_history.item(row, 1).text()} · {self.map_history.item(row, 2).text()}",
            f"Calculated with: {engine}",
            f"Starting Elo: {exact(trace.get('before'))}",
            f"Final change: {exact(trace.get('change'))}",
            f"Updated Elo: {exact(trace.get('after'))}",
            "",
        ]
        for index, step in enumerate(trace.get("steps") or [], start=1):
            lines.append(f"{index}. {step.get('name') or f'Step {index}'}")
            if step.get("formula"):
                lines.append(f"   Formula: {step.get('formula')}")
            inputs = step.get("inputs") or {}
            if isinstance(inputs, dict) and inputs:
                lines.append("   Inputs: " + ", ".join(f"{key}={exact(value)}" for key, value in inputs.items()))
            lines.append(f"   Result: {exact(step.get('result'))}")
            lines.append("")

        dialog = QDialog(self)
        dialog.setWindowTitle("Recorded Elo calculation")
        dialog.resize(820, 650)
        layout = QVBoxLayout(dialog)
        note = QLabel("The calculation exactly as it was recorded when the map was imported.")
        note.setWordWrap(True)
        layout.addWidget(note)
        viewer = QTextEdit()
        viewer.setReadOnly(True)
        viewer.setPlainText("\n".join(lines))
        layout.addWidget(viewer)
        buttons = QDialogButtonBox(QDialogButtonBox.Close)
        buttons.rejected.connect(dialog.reject)
        layout.addWidget(buttons)
        dialog.exec()

    # ------------------------------------------------------------- updates
    def _check_for_updates(self) -> None:
        url = str(self._read_app_config().get("updateManifestUrl", ""))
        if not url:
            return
        self._run_task(lambda: check_update(url, APP_VERSION), self._offer_update, lambda _message: None)

    def _offer_update(self, manifest) -> None:
        if not manifest: return
        if QMessageBox.question(self, "Update available", f"4 V 4 {manifest['version']} is available. Download it now?") != QMessageBox.Yes:
            return
        destination = Path.home() / "Downloads" / str(manifest.get("filename") or "codstats-desktop-update.zip")

        def work():
            urllib.request.urlretrieve(str(manifest["downloadUrl"]), destination)
            expected_hash = str(manifest.get("sha256", "")).lower().strip()
            if expected_hash and hashlib.sha256(destination.read_bytes()).hexdigest() != expected_hash:
                destination.unlink(missing_ok=True)
                raise ValueError("The downloaded update failed its SHA-256 safety check.")
            return destination

        def done(path) -> None:
            if path.suffix.lower() == ".exe" and QMessageBox.question(
                    self, "Update downloaded", f"Verified update downloaded to:\n{path}\n\nClose 4 V 4 and install it now?") == QMessageBox.Yes:
                subprocess.Popen([str(path)])
                QApplication.quit()
            else:
                QMessageBox.information(self, "Update downloaded", f"Downloaded to:\n{path}")

        self._run_task(work, done, lambda message: QMessageBox.warning(self, "Update failed", message))

    def closeEvent(self, event) -> None:
        self._stop_drive_watch()
        if self.process is not None and self.process.state() != QProcess.ProcessState.NotRunning:
            self.process.kill(); self.process.waitForFinished(2000)
        if hasattr(self.site_page, "shutdown"):
            self.site_page.shutdown()
        super().closeEvent(event)


def main() -> None:
    app = QApplication(sys.argv); app.setStyleSheet(STYLE)
    window = Desktop(); window.show()
    raise SystemExit(app.exec())


if __name__ == "__main__":
    main()
