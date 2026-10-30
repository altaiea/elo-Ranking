# COD Scoreboard OCR

A structured PaddleOCR pipeline for extracting competitive Call of Duty
scoreboard data from images and recorded videos.

## Extracted data

- Game mode: Hardpoint, Search and Destroy, or Overload
- GUILD/left (Team A) and JSOC/right (Team B)
- Team scores and signed Team A score difference
- Four registry-matched players per team
- Each highlighted player's full Activision ID
- A selected-HUD name fallback when Paddle omits the `#` suffix
- Eliminations and deaths for every detected ID
- ID-only recovery of visually similar short names such as `20` → `ZU` and
  `CR1` → `CR7`, constrained by the expected match roster
- OCR and registry-match confidence
- Overload overtime result, including completion times or DNF

## Project structure

```text
codstats-python-clean/
├── codstats_ocr/          Core OCR, parsing and video aggregation package
├── docs/                  Pipeline and JSON format documentation
├── examples/              Small, runnable examples
├── sample_videos/         Place input recordings here
├── tests/                 Automated tests and fixtures
├── output/                Generated JSON (created automatically)
├── debug/                 Image OCR diagnostics (created automatically)
├── main.py                Command-line entry point
├── player_registry.json   Known player names and aliases
└── requirements.txt       Python dependencies
```

## Windows setup

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Process multiple videos

Place recordings in `sample_videos`, then run:

```powershell
.\.venv\Scripts\python.exe main.py
```

The CLI asks for every video's scoreboard start time before processing begins.
Accepted formats include `4.5` and `0:04.5`.

After each video, it prints every parsed value and asks whether the reading is
correct. The review menu can correct mode, standard score, Overload overtime,
player identity/team, eliminations and deaths before JSON and Elo export. Use
`--no-review` only for unattended runs.

## Process one input

```powershell
# Video
.\.venv\Scripts\python.exe main.py "sample_videos\match.mp4" --time 4.0

# Still image
.\.venv\Scripts\python.exe main.py "path\to\scoreboard.png"
```

The default sample interval is 0.40 seconds. If fewer than eight players with statistics are
found, a second interleaved pass adds 0.20-second coverage without repeating
the original timestamps.

If full-frame OCR misses an otherwise visible score, the scanner automatically
retries the two score areas as enlarged crops located from the GUILD and JSOC
anchors. If Paddle still cannot classify both sides, digit-only Tesseract reads
separate inner score crops using three preprocessing variants and majority
voting. These fallbacks run only when the normal score read fails.

Tesseract must be installed locally and available on `PATH`. Verify it with:

```powershell
tesseract --version
```

If it is installed elsewhere, set `TESSERACT_CMD` to the complete executable
path before running. The standard 64-bit Windows installation location is
detected automatically.

## Outputs

Each video creates `output/<video-name>.json`. Batch runs also create
`output/all_results.json`. Before moving to the next video, the CLI prints all
parsed mode, score, roster, ID, elimination and death values.

Every video is isolated and receives its own `debug/videos/<video-name>/`
directory. It contains the first full-frame reference, annotated score regions,
the annotated locked HUD layout, the HUD crop, and `layout.json` with the exact
coordinates and lock timestamp. No coordinates or OCR evidence carry from one
video into another.

Its `frames/` subdirectory contains one numbered folder for every frame actually
sampled by OCR (the normal 0.40-second pass and any 0.20-second fallback frames).
Each folder contains `original.jpg`, `all-ocr-boxes.jpg`,
`extraction-regions.jpg`, and `diagnostics.json`. These are diagnostic outputs;
they do not alter OCR decisions or the Elo export.

Run the fast batch diagnostics fork with:

```powershell
.\.venv\Scripts\python.exe main.py --debug-layouts
```

This processes every video in `sample_videos`. It stops each video as soon as
the mode, score, eight-player roster and HUD coordinates have been established,
then advances to the next video. It skips final validation and Elo export.
Normal runs do not write per-frame diagnostic images, avoiding that additional
disk and drawing overhead.

HUD and score coordinates require two nearby observations before locking. Once
the HUD is locked, four out of every five samples use only the compact HUD crop.
Until the mode, score and eight-player roster are complete, every fifth sample
performs a full-frame recovery scan. Score regions remain independently locked
so Paddle and the Tesseract fallback can retry the same two crops.
If only one usable layout observation appears, the four-second layout timeout
allows that candidate to lock rather than forcing full-frame OCR forever.

GUILD and JSOC alone never trigger score extraction. The scanner first requires
two widely separated LEVEL/PLAYER headers in the same frame, proving that the
actual two-sided leaderboard is visible. This prevents the earlier team-intro
screen from supplying false score coordinates or score values.

ELIMINATIONS and DEATHS are separate locked ownership columns. A numeric OCR
box is accepted only when its centre remains inside the corresponding column
(with a small movement tolerance). If one ID is missing a value, only that
lookup retries with a slightly wider column. Decimal/comma tokens and anything
under ELIM/D RATIO or OBJ. SCORE are excluded. Repeated readings are resolved
by the number of supporting frames and then OCR confidence.

A complete `Name#hash` identity remains preferred. If Paddle sees only the
selected HUD name, the parser accepts it only when it lies in the identity band
beside the owned stat columns and uniquely matches the registry. The observation
is marked as name-only and is upgraded if a later frame supplies the full ID.

To diagnose only one numbered video, pass its path. For example:

```powershell
.\.venv\Scripts\python.exe main.py ".\sample_videos\3.mp4" --debug-layouts
```

Replace `3` with any available video number. Its files are written to
`debug/videos/3/`; no other video is scanned.

The run also creates `output/cod_stats_YYYY-MM-DD.json` in the exact schema
required by EloSystem v2.1. Use `--date YYYY-MM-DD` when the match date differs
from today. Detailed OCR JSON remains separate for diagnostics.

See [docs/PIPELINE.md](docs/PIPELINE.md) for the processing design and
[docs/OUTPUT_SCHEMA.md](docs/OUTPUT_SCHEMA.md) for the JSON contract.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest
```

The tests cover the known clear scoreboard, registry OCR variations, isolated
numeric correction, HUD coordinate locking and Overload overtime rules.
