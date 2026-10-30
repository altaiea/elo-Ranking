"""Central runtime configuration for the COD scoreboard OCR pipeline."""

DEFAULT_SAMPLE_INTERVAL = 0.40
TARGET_PLAYER_COUNT = 8
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}

# Layouts are video-local. Two nearby observations prevent a single noisy OCR
# frame from locking the wrong area, while periodic full-frame recovery keeps
# collecting any score or roster information that was initially missed.
HUD_CONFIRMATIONS_REQUIRED = 2
SCORE_CONFIRMATIONS_REQUIRED = 2
COORDINATE_TOLERANCE = 0.04
FULL_FRAME_RECHECK_INTERVAL = 5
LAYOUT_SEARCH_TIMEOUT_SECONDS = 4.0
