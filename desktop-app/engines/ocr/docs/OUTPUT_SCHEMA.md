# Output JSON contract

Each video produces one object with these top-level fields:

| Field | Meaning |
| --- | --- |
| `source` | Original video filename |
| `startTime` | User-provided scoreboard start time in seconds |
| `sampleInterval` | Effective sampling interval |
| `framesScanned` | Number of frames sent through OCR |
| `complete` | Whether eight IDs have eliminations and deaths |
| `mode` | Detected mode and confidence |
| `modeScore` | Scores, signed difference and optional overtime data |
| `teams` | Left/Team A and right/Team B four-player rosters |
| `players` | Full IDs with registry IDs, teams and statistics |
| `hudLayout` | Per-video selected-player HUD lock and timestamp |
| `scoreLayout` | Per-video Team A/Team B score regions |
| `statLayout` | Per-video ELIMINATIONS/DEATHS ownership regions |

## Score difference

`modeScore.difference` is always from Team A's perspective. A positive value
means Team A won; a negative value means Team B won.

For Overload overtime, `modeScore.overtime.active` is true and the difference
is restricted to `1` or `-1`. Each team contains its raw OCR time, seconds
value (or `null` for DNF), and status.

## Example player

```json
{
  "team": "teamA",
  "name": "kazzi11",
  "id": "Kazzie#8087654",
  "registryId": 2,
  "eliminations": 45,
  "deaths": 22,
  "confidence": {
    "id": 0.99,
    "eliminations": 0.99,
    "deaths": 0.99
  },
  "supportingFrames": 2
}
```

`output/all_results.json` contains these objects in processing order.

## EloSystem v2.1 export

`output/cod_stats_YYYY-MM-DD.json` follows EloSystem's schema version 1:

- `gameMode` is `Hardpoint`, `SND`, or `Overload`.
- `winningTeam` is `1` for Team A or `2` for Team B.
- `scoreDifference` is always a positive winning margin.
- `eliminations` is exported under the Elo field name `kills`.
- Team lists are named `A` and `B` and contain exactly four players each.
- Overload overtime uses `M:SS` or `DNF` and always has a margin of `1`.

Incomplete or unsafe OCR results are excluded from the Elo file and reported
clearly in the CLI so that one invalid video cannot invalidate the whole batch.
