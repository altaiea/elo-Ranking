"""Build the download zip: the app, a copy of the website and the latest published data.

    python tools/make_download.py [output.zip]

Run from a clone of elo-Ranking. The website copy skips the intro .mp4 files
(the in-app browser cannot play them; "Open in browser" still shows the live
site). No tokens or local settings are included.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
REPO = APP.parent
SKIP_PARTS = {".venv", "__pycache__", ".pytest_cache", "dist", "models", ".git", ".idea"}
SKIP_NAMES = {"upload-config.json"}
SITE_SUFFIXES = {".html", ".js", ".css", ".png", ".webp", ".svg", ".jpg", ".ico"}
SITE_FOLDERS = ("cards", "maps", "game", "assets", "css", "js")
SEED_FILES = ("current_stats.json", "previous_stats.json")


def add(zf: zipfile.ZipFile, path: Path, name: str) -> None:
    zf.write(path, name)


def main() -> None:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else APP / "dist" / "CODStats-v4.zip"
    output.parent.mkdir(parents=True, exist_ok=True)
    top = "CODStats-v4"
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in sorted(APP.rglob("*")):
            relative = path.relative_to(APP)
            if path.is_dir() or SKIP_PARTS & set(relative.parts) or path.name in SKIP_NAMES:
                continue
            if relative.parts[0] in ("site", "seed-data"):
                continue
            add(zf, path, f"{top}/{relative.as_posix()}")
        for path in sorted(REPO.iterdir()):
            if path.is_file() and path.suffix.lower() in SITE_SUFFIXES:
                add(zf, path, f"{top}/site/{path.name}")
        for folder in SITE_FOLDERS:
            for path in sorted((REPO / folder).rglob("*")) if (REPO / folder).is_dir() else []:
                if path.is_file() and path.suffix.lower() != ".mp4":
                    add(zf, path, f"{top}/site/{path.relative_to(REPO).as_posix()}")
        for name in SEED_FILES:
            if (REPO / name).is_file():
                add(zf, REPO / name, f"{top}/seed-data/{name}")
        for path in sorted((REPO / "history").glob("*.json")):
            add(zf, path, f"{top}/seed-data/history/{path.name}")
        add(zf, APP / "engines" / "ocr" / "player_registry.json", f"{top}/seed-data/player_registry.json")
    print(f"Wrote {output} ({output.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
