"""Blue-and-black neon e-sports theme, matching the leaderboard website.

Colours come straight from the website's style.css:
  background #0d0d0f, panels #15151a, borders #25252d, text #e6e6e6,
  neon cyan #00eaff (light cyan #7feeff), muted grey #8f929d.
Only appearance lives here; no behaviour.
"""
from PySide6.QtGui import QColor
from PySide6.QtWidgets import QGraphicsDropShadowEffect

CYAN = "#00eaff"

STYLE = """
QMainWindow, QWidget { background:#0d0d0f; color:#e6e6e6; font:9.5pt 'Segoe UI'; }
QWidget#page { background:#0d0d0f; }
QToolTip { background:#15151a; color:#7feeff; border:1px solid #00eaff; padding:4px; }

QFrame#sidebar { background:#0a0a0c; border:0; border-right:1px solid rgba(0, 234, 255, 70); }
QLabel#brand { color:#00eaff; font-size:20pt; font-weight:800; padding:9px 10px 28px 10px; background:transparent; }
QLabel#sideNote { color:#5f6772; padding:10px; background:transparent; }
QPushButton#nav { background:transparent; color:#8f929d; text-align:left; border:0; border-left:3px solid transparent; border-radius:0; padding:11px 13px; font-weight:600; }
QPushButton#nav:hover { background:rgba(0, 234, 255, 22); color:#ffffff; }
QPushButton#nav:checked { background:rgba(0, 234, 255, 38); color:#00eaff; border-left:3px solid #00eaff; }

QLabel#title { color:#ffffff; font-size:23pt; font-weight:800; background:transparent; }
QLabel#subtitle { color:#8f929d; padding-bottom:8px; background:transparent; }
QLabel#summaryLabel { color:#8f929d; background:transparent; }
QLabel#summaryValue { color:#00eaff; font-size:22pt; font-weight:800; background:transparent; }
QLabel#sectionTitle { color:#00eaff; font-size:13pt; font-weight:700; background:transparent; }
QLabel { background:transparent; }

QFrame#summaryCard, QFrame#panel { background:#15151a; border:1px solid #25252d; border-top:2px solid #00eaff; border-radius:10px; }

QPushButton { background:#00eaff; color:#021014; border:1px solid #00eaff; border-radius:8px; padding:7px 12px; font-size:9pt; font-weight:700; }
QPushButton:hover { background:#7feeff; border-color:#7feeff; }
QPushButton:pressed { background:#00b8cc; }
QPushButton:disabled { background:#15151a; color:#4d5057; border:1px solid #25252d; }
QPushButton#secondary { background:#15151a; color:#7feeff; border:1px solid rgba(0, 234, 255, 90); }
QPushButton#secondary:hover { background:rgba(0, 234, 255, 36); color:#ffffff; border:1px solid #00eaff; }
QPushButton#danger { background:#15151a; color:#ff6b7a; border:1px solid rgba(255, 107, 122, 120); }
QPushButton#danger:hover { background:rgba(255, 107, 122, 36); color:#ffffff; border:1px solid #ff6b7a; }

QTableWidget, QTextEdit, QLineEdit, QComboBox, QSpinBox, QDoubleSpinBox, QPlainTextEdit {
  background:#15151a; border:1px solid #25252d; border-radius:7px; padding:5px; font-size:9pt;
  selection-background-color:rgba(0, 234, 255, 90); selection-color:#ffffff;
}
QLineEdit:focus, QTextEdit:focus, QComboBox:focus, QSpinBox:focus, QDoubleSpinBox:focus { border:1px solid #00eaff; }
QLineEdit, QComboBox, QSpinBox, QDoubleSpinBox { min-height:26px; }
QSpinBox, QDoubleSpinBox { min-width:72px; }
QComboBox { min-width:105px; }
QLineEdit { min-width:110px; }
QComboBox QAbstractItemView { background:#15151a; border:1px solid #00eaff; selection-background-color:rgba(0, 234, 255, 70); }
QTableWidget { gridline-color:#1f1f25; alternate-background-color:#121217; outline:0; }
QTableWidget::item { padding:7px; border:0; font-size:9pt; }
QTableWidget::item:hover { background:rgba(0, 234, 255, 20); }
QTableWidget::item:selected { background:rgba(0, 234, 255, 70); color:#ffffff; }
QTableWidget#leaderboard { background:#0d0d0f; border:0; }
QTableWidget#leaderboard::item { background:#15151a; color:#e6e6e6; border:0; padding:8px; font-size:9pt; font-weight:600; }
QHeaderView::section { background:#111118; color:#00eaff; padding:6px 5px; border:0; border-bottom:2px solid #00eaff; font-size:8.5pt; font-weight:700; }
QHeaderView::section:vertical { color:#8f929d; padding:0 6px; border:0; border-bottom:1px solid #1f1f25; font-weight:600; }
QTableCornerButton::section { background:#111118; border:0; }

QProgressBar { background:#15151a; border:1px solid #25252d; border-radius:5px; text-align:center; color:#e6e6e6; min-height:10px; }
QProgressBar::chunk { background:qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #0086a3, stop:1 #00eaff); border-radius:4px; }

QTabWidget::pane { border:0; top:-1px; background:#0d0d0f; }
QTabBar::tab { background:transparent; color:#8f929d; padding:8px 12px; font-size:9pt; font-weight:600; border:0; border-bottom:2px solid transparent; }
QTabBar::tab:hover { color:#ffffff; }
QTabBar::tab:selected { color:#00eaff; background:transparent; border-bottom:2px solid #00eaff; }

QSlider::groove:horizontal { height:5px; background:#25252d; border-radius:2px; }
QSlider::sub-page:horizontal { background:#00eaff; border-radius:2px; }
QSlider::handle:horizontal { width:14px; margin:-5px 0; background:#00eaff; border:0; border-radius:7px; }

QCheckBox, QRadioButton { spacing:8px; background:transparent; }
QCheckBox::indicator, QRadioButton::indicator { width:15px; height:15px; border:1px solid #00eaff; border-radius:4px; background:#15151a; }
QCheckBox::indicator:checked, QRadioButton::indicator:checked { background:#00eaff; }

QScrollBar:vertical { background:#0d0d0f; width:10px; margin:0; }
QScrollBar::handle:vertical { background:#1d4b55; border-radius:5px; min-height:30px; }
QScrollBar::handle:vertical:hover { background:#00eaff; }
QScrollBar:horizontal { background:#0d0d0f; height:10px; margin:0; }
QScrollBar::handle:horizontal { background:#1d4b55; border-radius:5px; min-width:30px; }
QScrollBar::handle:horizontal:hover { background:#00eaff; }
QScrollBar::add-line, QScrollBar::sub-line { width:0; height:0; }
QScrollBar::add-page, QScrollBar::sub-page { background:transparent; }

QMessageBox, QDialog { background:#0d0d0f; }
"""


def glow(widget, colour: str = CYAN, blur: int = 22, alpha: int = 170) -> None:
    """Soft neon glow around a label (purely visual)."""
    effect = QGraphicsDropShadowEffect(widget)
    shade = QColor(colour)
    shade.setAlpha(alpha)
    effect.setColor(shade)
    effect.setBlurRadius(blur)
    effect.setOffset(0, 0)
    widget.setGraphicsEffect(effect)
