# Captain's Cup results

One file per month, `YYYY-MM.json`, plus `index.json` listing the months
that have a file (`{ "months": ["2026-11"] }`). Add each new month there. The Knockout tab works out the tiers and
the bracket itself from the previous month's final Monthly Rankings, so a
month's file only needs the series that have been played.

```json
{
  "month": "2026-11",
  "seededFrom": "2026-10",
  "series": [
    {
      "captains": [3, 6],
      "winner": 3,
      "score": [5, 3],
      "format": "1x Bo9",
      "wager": false,
      "dates": ["2026-11-04"]
    }
  ]
}
```

- `captains`: the two captains' player ids (same ids as `current_stats.json`).
  The site finds the bracket match by this pair, so the order does not matter.
- `winner`: the captain whose team won the series.
- `score`: maps won by each captain, in the same order as `captains`.
  For "2x Bo5" give the combined map score.
- `format`: "2x Bo5", "1x Bo7" or "1x Bo9". The final is always "1x Bo9".
- `wager`: true when both captains agreed the 2x Elo wager for this series
  (each captain can do this once a month). Otherwise the captains get 1.5x.
- `dates`: the history days the series' maps were played on.
- `mapIds`: the `mapId` of every map in the series (from `history/`). These
  maps make up the Knockout card. They still count for the overall card and
  Elo as normal. (A map in `history/` with a `"cup"` field counts too.)
- Optional `tiers`: `[[ids], [ids], ...]` overrides the automatic tiers for
  the month, for example when someone is away.

The Elo side (1.5x / 2x for captains and the +20 tier-winner bonus) is not
applied by the site. It belongs in the CODStats Elo engine; the numbers are
in `js/knockoutRules.js`.
