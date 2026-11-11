# Elo Leaderboard site

A static site (HTML, CSS and plain JavaScript modules, no build step). GitHub
Pages serves the files exactly as they are in this folder, so publishing is
still: export from CODStats, then push with GitHub Desktop.

## Where things live

| Path | What it is |
| --- | --- |
| `index.html` | Page markup for every tab. Lists every `js/` file as a `modulepreload` so they all download at once: add a line there when you add a file |
| `style.css` | All styling, in Knockout gold |
| `script.js` | Entry file; it only loads `js/main.js`. Kept at this path because the CODStats exporter checks for it |
| `js/main.js` | Start-up: loading screen, tabs, background loading of card pictures |
| `js/config.js` | Player names, inactive players, card files, map pool, game modes. Edit this when someone joins |
| `js/data.js` | Reads `current_stats.json` and `history/`. No page code |
| `js/ratings.js` | Card ratings, team win chances, chemistry. No page code |
| `js/tabs.js` | The four menu groups (Ranks, Match Day, Players, Knockout) and the switch under the title for the pages inside Ranks and Players |
| `js/leaderboard.js`, `teams.js`, `history.js`, `duoNetwork.js`, `monthly.js`, `comparisons.js`, `maps.js` | One file per page or feature |
| `js/cardHand.js`, `js/locker.js`, `locker.css` | The hand of cards (drag, flick, settle on a card), used at the top of Ranks (the Locker room) and on the Cards page |
| `js/fightNight.js` | Head-to-Head: pick the two players from their cards |
| `seamless.css` | Makes Monthly, History, the duo network, Head-to-Head and Match Day look like the main leaderboard. Loads last; remove its `<link>` in `index.html` to switch it off |
| `headers/` | The pictures beside the Ranks and Players titles (set in `js/tabs.js`) |
| `js/cardTape.js` | The tale of the tape: a player's numbers beside the card popup |
| `js/carousel.js` | The old spinning ring for the Cards page. No longer loaded; kept in case you want it back |
| `js/matchSetup.js` | The Match Day tab: tap-to-pick players, Bo5/Bo7/Bo9 maps. Uses `teams.js` (line-up reveal) and `maps.js` (map sets) |
| `js/layout.js`, `layout.css` | Side menu (bottom bar on phones) and the Knockout-style gold theme |
| `js/playerCard.js`, `js/modeModal.js` | The card popup (float, flip, intro video) and the mode wheel |
| `js/ui.js` | Shared helpers: formatting, colours, click sound, popup |
| `js/knockout.js` | The Knockout tab (Captain's Cup): tiers, brackets, seeding table |
| `js/knockoutRules.js` | Cup rules and bracket maths (tiers, seeding, 1.5x / 2x, +20). No page code |
| `js/knockoutCards.js` | Stats for the Knockout card (cup maps only). No page code |

`config.js`, `data.js` and `ratings.js` have no page code on purpose: the
Three.js game can `import` them and show exactly the same names, numbers and
ratings as the site.

## Data files (written by the CODStats exporter)

- `current_stats.json`: every player's current Elo and lifetime stats.
- `history/index.json`: the list of days, `{ "days": [ { date, file, mapCount } ] }`.
- `history/YYYY-MM-DD.json`: each map of that day with every player's Elo change
  and the full calculation trace. Only opened when you click a day in History.
- `history/summary.json`: the same history without the calculation traces
  (about 30 times smaller). The leaderboard arrows, Teams chemistry, Duo network
  and Monthly rankings use it. If it is missing or older than `index.json`, the
  site reads the day files instead, so it can never show wrong numbers, only
  load slower. Rebuild it with `python tools/build_history_summary.py`.
- `knockout/YYYY-MM.json` and `knockout/index.json`: Captain's Cup results
  (series played, winners, map ids). See `knockout/README.md`.
- `daily_stats/`, `previous_stats*.json`: kept for the exporter; the site does not read them.

## Card pictures and intro videos

The originals stay in `cards/` (`N_back.png`, `N_back.webp`, `N_intro.mp4`).
The site loads smaller copies from `cards/web/`:

- `N_thumb.webp` (300 px wide) for the carousel and team line-ups
- `N_card.webp` (up to 840 x 1200) for the card popup
- `N_intro.mp4` re-encoded without sound and set to start playing while it downloads

After adding or changing a card or intro, run `python tools/optimize_media.py`
(needs Pillow and ffmpeg), then add the player to `js/config.js`.

Empty
