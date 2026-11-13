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
| `seamless.css` | Makes Monthly, History, Head-to-Head and Match Day look like the main leaderboard. Loads last; remove its `<link>` in `index.html` to switch it off |
| `headers/` | The pictures beside the Ranks and Players titles (the file names are set in `js/tabs.js`) |
| `js/duoNetwork.js` | The duo network: data, the full-screen pop-up, sliders and side panel. A small icon beside the Ranks title opens it. It gets everything ready in the background just after the site loads, so it opens instantly |
| `js/duoNetwork3d.js` | The 3D drawing of the duo network: a neon globe you can spin, roll and zoom. Downloaded in the background after the page has loaded |
| `vendor/three-duo.min.js` | three.js, the 3D library `duoNetwork3d.js` uses, cut down to the parts it needs. Not written by hand: do not edit |
| `js/cardTape.js` | The tale of the tape: a player's numbers beside the card popup |
| `js/matchSetup.js` | The Match Day tab: tap-to-pick players, Bo5/Bo7/Bo9 maps. Uses `teams.js` (line-up reveal) and `maps.js` (map sets) |
| `js/layout.js`, `layout.css` | Side menu (bottom bar on phones) and the Knockout-style gold theme |
| `js/playerCard.js`, `js/modeModal.js` | The card popup (float, flip, intro video) and the mode wheel |
| `js/ui.js` | Shared helpers: formatting, colours, popup |
| `js/knockout.js` | The Knockout tab (Captain's Cup): tiers, brackets, seeding table |
| `js/knockoutRules.js` | Cup rules and bracket maths (tiers, seeding, 1.5x / 2x, +20). No page code |
| `js/knockoutCards.js` | Stats for the Knockout card (cup maps only). No page code |
| `js/knockoutCardsView.js`, `knockoutRulesView.js`, `knockoutHistoryView.js`, `knockoutPanels.js` | The three Knockout panels (Cards, Rules, History) and the code they share |
| `js/knockoutData.js`, `js/knockoutMvp.js` | Reads `knockout/`; the carry and match rating behind the series MVP. No page code |
| `js/monthWinner.js`, `js/streaks.js` | Last month's number one (the wings) and win streaks (the fire on a card) |

`config.js`, `data.js`, `ratings.js` and `knockoutMvp.js` have no page code on purpose: the
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
- `daily_stats/`, `previous_stats.json`: kept for the exporter; the site does not read them.

## Card pictures and intro videos

The originals stay in `cards/` (`N_back.png`, `N_back.webp`, `N_intro.mp4`).
The site loads smaller copies from `cards/web/`:

- `N_thumb.webp` (300 px wide) for the card hands and team line-ups
- `N_card.webp` (up to 840 x 1200) for the card popup
- `N_intro.mp4` re-encoded without sound and set to start playing while it downloads

After adding or changing a card or intro, run `python tools/optimize_media.py`
(needs Pillow and ffmpeg), then add the player to `js/config.js`.
The originals are never downloaded by visitors; only `cards/web/` is.

## Clean-up, 13 Nov 2026

Removed because nothing used them (all still in git history): the old card carousel
(`js/carousel.js`) and its click sound, the hidden hands image under the card popup,
about 235 CSS rules for pages that no longer exist (the first team generator, the 2D duo
network, the old maps page), `CircleC.png`, `hands.webp`, `headers/players.webp`,
`headers/ranks.webp`, `assets/duo-gold-surround.svg` and `previous_stats_monthly_tab.json`.
Every tab was screenshotted before and after: identical.

Faster: `history/summary.json` is now downloaded once per visit instead of twice, and the
font is WOFF2 (56 KB instead of 163 KB). Functions in `data.js` and `knockoutMvp.js` that the
site itself does not call (`loadPlayers`, `carryRating`, ...) are kept for the game.
