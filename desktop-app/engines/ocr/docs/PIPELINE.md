# Processing pipeline

## 1. Input discovery and start times

`main.py` accepts one image, one video, or a directory. Video filenames are
naturally ordered, so `2.mp4` is processed before `10.mp4`. For a batch, the
CLI collects every start time before starting PaddleOCR.

## 2. Initial full-frame detection

Each video initially uses full-frame OCR. Layout anchors are used before field
values:

1. The mode matcher identifies Hardpoint, Search and Destroy, or Overload.
2. GUILD and JSOC locate the left and right scoreboard halves.
3. Large numeric detections between those anchors provide ordinary scores.
4. The two LEVEL/PLAYER headers establish four roster rows on each side.
5. Roster text is matched against `player_registry.json`.

Unresolved full IDs are reconciled against the expected eight-player match
roster. Only this identity path applies visual alternatives such as `2`/`Z`,
`0`/`U`, and `1`/`I`/`7`. Name length supports the comparison, optional hash
values are scored separately, and global one-to-one assignment prevents the
same registry player occupying two roster positions.

The full-frame stage continues until mode, score information and eight unique
registry players have been collected.

If both scores are not found, two narrow GUILD/JSOC-relative regions are
enlarged and retried with Paddle. If still unresolved, optional Tesseract runs
digit-only recognition over grayscale and binary variants. Per-side majority
voting supplies the fallback reading; Search and Destroy rejects values above
six. Tesseract never runs when Paddle already supplied a score.

## 3. Per-video HUD coordinate lock

The highlighted-player panel is located using three independent anchors:

- an Activision ID containing `#`;
- the ELIMINATIONS label and number below it;
- the DEATHS label and number below it.

When Paddle omits the `#` suffix, a name-only fallback is permitted solely in
the selected-player identity band beside these stat anchors. It must uniquely
match the registry, receives reduced identity confidence, and is replaced by a
later complete ID observation when available.

A padded region enclosing those anchors is locked. Padding is deliberately
wider than the first ID so longer names are not clipped. The lock applies only
to the current video and is discarded before processing the next recording.

## 4. Fast player-stat collection

After locking, PaddleOCR receives only the selected-player HUD crop rather
than the full frame. Every highlighted ID is registry-matched and stored with
its eliminations, deaths and confidence. Repeated stat readings are selected
first by supporting-frame count and then by confidence.

Processing stops immediately when eight unique IDs all have valid elimination
and death readings. If the first 0.40-second pass is incomplete, only the
interleaved 0.20-second timestamps are checked in the fallback pass.

## 5. Numeric isolation

Names and numbers use different correction paths. Player-name fuzzy matching
may tolerate OCR substitutions, but numeric substitutions are permitted only
inside a field already proven to be a score, elimination or death region.

ELIMINATIONS and DEATHS each own a separate label-derived column which is
locked for that video. A number's centre must remain inside its column, with a
small OCR-movement tolerance. A second, slightly wider attempt is local to the
missing field and current ID. Tokens containing a decimal point or comma are
rejected, and the ELIM/D RATIO and OBJ. SCORE columns are explicit exclusions.

## 6. Mode score rules

- Hardpoint: `Team A score - Team B score`
- Search and Destroy: `Team A rounds - Team B rounds`
- Standard Overload: `Team A score - Team B score`
- Overload overtime: lower completion time wins; a valid time beats DNF. The
  exported difference is `+1` for Team A or `-1` for Team B.

## 7. Reporting

At the end of every video, the structured result is written to JSON and the
CLI prints the complete parsed result before advancing to the next video.

Before writing, interactive validation lets the operator accept the result or
correct mode, score/overtime, registry identity, team, eliminations and deaths.
Manually corrected values receive full confidence and are marked
`manuallyValidated`. The Elo compatibility check runs again after review.
