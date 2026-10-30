# CODStats v4 (desktop)

The video parser, the Elo engine and the export to the website, all in Python.
The Java EloSystem is no longer needed.

## Install (Windows)

1. Unzip `CODStats-v4.zip` anywhere (or use this folder inside your elo-Ranking clone).
2. Double-click **Setup (run once).cmd**. It makes a `.venv` here with PySide6 and PaddleOCR.
3. Double-click **Start CODStats.cmd**.

On the first start the app copies your existing data from `Documents\CODStats`
into its own folder, `Documents\CODStats-v4`. The old folder and the old app
are only read, never changed, so CODStats v3 keeps working side by side.
Series history is not copied, and the series win/loss counts are dropped.

## A normal session

1. **Video import → Google Drive folder → Choose folder.** Pick the folder in
   Google Drive for desktop that people upload to (usually `G:\My Drive\...`).
   Press **Start watching**. New uploads are queued once Drive has finished
   syncing them, and parsed straight away if "Parse new videos as soon as they
   arrive" is ticked. You can still add videos by hand.
2. **Duplicates** are caught twice. A byte-for-byte copy is skipped on arrival.
   After the parse, any two games with the same mode, the exact same score and
   the same stats for every player read in both (for example two people
   recording the same map) get a question: same map, or a different one?
   Imported maps from the last three days are checked too.
3. **Validation.** Every video lands here, even if the parser only read 7 of 8
   players, missed the score, or could not read the video at all. Missing
   pieces are listed at the top and the rows are highlighted. Games read with
   90%+ confidence are pre-approved; "Next needing a check" skips to the rest.
4. **Import to Elo.** Pick the date the maps were played, check the list, press
   Import. Maps already in Elo are skipped automatically.
5. **Export to GitHub Desktop.** One click copies the stats and history into
   your site clone and opens GitHub Desktop; then Commit and Push.

## Elo rules (rules version 2, from the first map imported with this app)

Earlier maps keep the ratings the Java engine gave them.

- Win points: own Elo vs the enemy team average, K = 20, same margin caps as before.
- K/D and kill share count equally: K/D weight 0.36, damage (kills × 100 share) weight 2.5.
- SnD: the team average K/D uses the same 4.0 cap as the player.
- A winner can never lose Elo on a map: the winning team's K/D and damage
  adjustments are scaled down together so no winner's penalty is more than 80%
  of their win points. Losers are not capped, so a big carry can gain on a loss.
- Whatever the map created or destroyed is shared back to the winners in
  proportion to their change, so every map sums to exactly zero.

Each player's calculation is saved with the map (Map history → View
calculation, and the History tab on the site). New maps show two extra steps,
"Winner guard scale" and "Leak share", and carry `"rulesVersion": 2`.

## Data files

Same formats the website reads: `elo/stats.json` (published as
`current_stats.json`), `elo/history/YYYY-MM-DD.json`, `history/index.json`, and
the new light `history/summary.json`. All writes are atomic (temp file, then
rename), and `stats.json.bak` is kept before each save.

Two different videos with the same file name on the same day are both counted
(the second is stored as `date|name#2`); the same game is never counted twice,
whatever its name or date.

## For developers

```
python -m pytest tests engines/ocr/tests
python tools/make_download.py            # builds dist/CODStats-v4.zip
```

`codstats/elo/` is the Elo engine, `codstats/drive_watcher.py` the Drive
watcher, `codstats/duplicate_*.py` the two duplicate checks,
`codstats/github_export.py` the GitHub Desktop export, `ocr_worker.py` the
separate OCR process and `engines/ocr/codstats_ocr` the OCR itself.
