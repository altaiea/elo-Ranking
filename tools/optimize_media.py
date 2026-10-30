"""Builds the web-sized card art and intro videos the site actually loads.

The originals in cards/ (N_back.png, N_back.webp, N_intro.mp4) are kept as the
master copies. This script writes smaller copies into cards/web/:

    N_thumb.webp   300 px wide, for the Cards carousel and team line-ups
    N_card.webp    at most 840 x 1200, for the big card in the player popup
    N_intro.mp4    same picture, re-encoded with no audio track (the site always
                   plays it muted) and "faststart" so it can play while it downloads

plus wings.webp and gun.webp next to the originals.

Run it again after adding or changing a card:  python tools/optimize_media.py
Needs Pillow (pip install pillow) and ffmpeg on PATH.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CARDS = ROOT / "cards"
OUT = CARDS / "web"


def save_webp(image: Image.Image, target: Path, quality: int) -> None:
    image.save(target, "WEBP", quality=quality, method=6)


def resized(image: Image.Image, max_w: int, max_h: int) -> Image.Image:
    copy = image.copy()
    copy.thumbnail((max_w, max_h), Image.LANCZOS)
    return copy


def card_art(player_id: int) -> None:
    source = CARDS / f"{player_id}_back.webp"
    if not source.exists():
        source = CARDS / f"{player_id}_back.png"
    if not source.exists():
        return
    with Image.open(source) as image:
        image.load()
        save_webp(resized(image, 300, 430), OUT / f"{player_id}_thumb.webp", 80)
        save_webp(resized(image, 840, 1200), OUT / f"{player_id}_card.webp", 84)


def intro(player_id: int) -> None:
    source = CARDS / f"{player_id}_intro.mp4"
    if not source.exists():
        return
    target = OUT / f"{player_id}_intro.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-i", str(source),
        "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "24",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(target),
    ], check=True)


def main() -> int:
    if not shutil.which("ffmpeg"):
        print("ffmpeg was not found on PATH.", file=sys.stderr)
        return 1
    OUT.mkdir(exist_ok=True)
    ids = sorted({int(p.name.split("_")[0]) for p in CARDS.glob("*_back.*")})
    for player_id in ids:
        card_art(player_id)
        intro(player_id)
        print(f"card {player_id} done")
    for name in ("wings", "gun"):
        with Image.open(ROOT / f"{name}.png") as image:
            image.load()
            save_webp(image, ROOT / f"{name}.webp", 86)
    with Image.open(ROOT / "wings.png") as image:
        image.load()
        save_webp(resized(image, 300, 450), ROOT / "wings_thumb.webp", 80)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
