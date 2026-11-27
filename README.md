# Elo Leaderboard site

A static site: plain HTML, CSS and JavaScript modules, with no build step. GitHub Pages
serves this folder exactly as it is, so publishing is: Export in CODStats, then push
with GitHub Desktop.

The ratings are **Model TR** (TrueSkill + 25% kill share, with the score margin counted
on maps from 20 Sep 2026). The app works them out on Export; the site only shows them.

## Never rename or move these

The CODStats app depends on them:

- `index.html` and `script.js`: Export checks both exist before it writes anything.
- `current_stats.json`, `previous_stats.json`, `daily_stats/`, `history/`, `knockout/`:
  written by Export, committed by the app, and read back by the app's sync and its
  built-in site preview.
- `js/config.js`, `js/data.js`, `js/ratings.js`, `js/knockoutMvp.js`: the Three.js game
  imports them by name.

## Start-up and shared code

| File | What it does |
| --- | --- |
| `index.html` | The markup for every tab. Lists every `js/` file as a `modulepreload` so they all download at once: add a line there when you add a file |
| `script.js` | Three lines that load `js/main.js` |
| `js/main.js` | Start-up: loading screen, wires every tab, then quietly loads card pictures |
| `js/tabs.js` | The four menu groups (Ranks, Match Day, Players, Knockout) and the switch under the title. Remembers the open page in the address bar (`…/#cards`) |
| `js/layout.js` | The side menu (a bar along the bottom on phones) and phone sizing |
| `js/config.js` | Player names, inactive players, card and map files, game modes. **Edit this when someone joins** |
| `js/data.js` | Reads `current_stats.json`, `history/` and `data/rebuilt-days.json`. No page code |
| `js/ratings.js` | Card ratings, Match Day win chances (Model TR's own formula) and chemistry. No page code |
| `js/ui.js` | Small shared helpers: number formatting, colours, the pop-up box |

## Ranks

| File | What it does |
| --- | --- |
| `js/leaderboard.js` | Podium and tiles, daily arrows, the mode ratings and ± shown when you click an Elo |
| `js/locker.js` | The hand of cards at the top of Ranks (the Locker room) and on the Cards page |
| `js/cardHand.js` | How a hand of cards moves: drag, flick, settle on a card |
| `js/monthly.js` | Monthly rankings from May 2026. Also used for Captain's Cup seeding |
| `js/monthWinner.js` | Last month's number one, who wears the wings |
| `js/history.js` | History: days by week, every map, each player's Model TR calculation |
| `js/duoNetwork.js` | The duo network pop-up (the icon beside the Ranks title): data, sliders, side panel |
| `js/duoNetwork3d.js` | The 3D globe of the duo network, loaded in the background |
| `vendor/three-duo.min.js` | three.js cut down to the parts the globe uses. Not hand-written: don't edit |

## Players

| File | What it does |
| --- | --- |
| `js/playerCard.js` | The card pop-up: float, flip, intro video, mode circles |
| `js/cardTape.js` | The player's numbers beside the card pop-up |
| `js/modeModal.js` | The mode wheel that opens from a card's mode circle |
| `js/streaks.js` | Win streaks per mode (the fire on a card) |
| `js/headToHead.js` | Head-to-Head: the scored Lifetime and mode sections, including the map wins against each other |
| `js/headToHeadPicker.js` | Picking the two players from their cards ("fight night") |

## Match Day

| File | What it does |
| --- | --- |
| `js/matchSetup.js` | The Match Day page: tap players, auto or manual teams, Bo5 / Bo7 / Bo9 |
| `js/lineup.js` | The line-up pop-up: card deal, chemistry lines, the win chance panel |
| `js/maps.js` | Rolls the map set (no repeats in a Bo5; none within a mode in a Bo7 or Bo9) |

## Knockout (Captain's Cup)

| File | What it does |
| --- | --- |
| `js/knockout.js` | The Knockout tab: tiers, brackets, seeding table |
| `js/knockoutRules.js` | Cup rules and bracket maths (tiers, seeding, 1.5x / 2x, +20). No page code |
| `js/knockoutData.js` | Reads `knockout/` |
| `js/knockoutPanels.js` | Opens one of the Cards, Rules and History panels at a time |
| `js/knockoutCardsView.js`, `js/knockoutCards.js` | The KO cards and their Cup-only stats |
| `js/knockoutRulesView.js` | The Rules panel, written from the numbers in `knockoutRules.js` |
| `js/knockoutHistoryView.js` | Every Cup series of the month, with match ratings and the MVP |
| `js/knockoutMvp.js` | The carry and match rating behind the series MVP. No page code |

## Styles

They load in this order (see `index.html`); later files win.

| File | What it does |
| --- | --- |
| `style.css` | Base styles: page, cards, pop-ups, History, Monthly, Head-to-Head, Knockout. A contents note sits at the top |
| `matchSetup.css` | The Match Day page |
| `layout.css` | Side menu, bottom bar and the gold theme |
| `locker.css` | Ranks and Players page headers, card hands, the Black Ops One font |
| `sharedLook.css` | Gives Monthly, History, Head-to-Head and Match Day the leaderboard's look |
| `duoNetwork.css` | The duo network pop-up only |

## Data written by Export

Never edit these by hand: the next Export rewrites them.

- `current_stats.json`: every player's Elo, mode ratings, ± and lifetime stats.
- `history/index.json`: the list of days, `{ "days": [ { date, file, mapCount } ] }`.
- `history/YYYY-MM-DD.json`: each map of that day with every player's Elo change and the
  full Model TR calculation. Only opened when you click a day in History.
- `history/summary.json`: the same history without the calculations (about 30 times
  smaller). Most pages read this. If it is missing or older than `index.json`, the site
  reads the day files instead, so it can never show wrong numbers, only load slower.
  Rebuild it by hand with `python tools/build_history_summary.py`.
- `knockout/YYYY-MM.json` and `knockout/index.json`: Captain's Cup results. See
  `knockout/README.md`.
- `daily_stats/`, `previous_stats.json`: kept for the app; the site does not read them.

## Fixed data

- `data/rebuilt-days.json`: the 462 maps from 29 May to 19 Sep 2026, rebuilt from the stats
  snapshots, with Model TR Elo (no score margin) and each day's opening leaderboard. The
  site history starts on 20 Sep, so Monthly (May to September) and the Head-to-Head map wins
  against each other add these. It sits outside `history/`, so Export never touches it.

## Pictures, videos and tools

- `cards/web/`: the card pictures and intro videos the site loads (`N_thumb.webp`,
  `N_card.webp`, `N_intro.mp4`).
- `cards/`: the full-size originals (`N_back.png`, `N_back.webp`, `N_intro.mp4`) and the
  streak fire. Visitors never download the originals.
- `maps/`, `headers/`, `fonts/`, `knockout/hooded-warrior.webp`: map pictures, page header
  art, the font and the Knockout art.
- `wings.webp`, `card_wings.webp`, `wings_thumb.webp`, `gun.webp`, `target.svg`: the wings,
  the line-up pistol and the firing-range target. `wings.png` and `gun.png` are the
  originals the tools work from.
- `tools/optimize_media.py`: after adding or changing a card or intro, run it (needs
  Pillow and ffmpeg), then add the player to `js/config.js`.
- `tools/make_card_wings.py`: makes `card_wings.webp` from the card template's wings.

## Change log

- **27 Nov 2026.** Model TR goes live. Head-to-Head scores the maps the two
  played against each other (rebuilt maps included), Monthly goes back to May, and History shows the Model TR calculation in plain words.
  Tidy: `comparisons.js` → `headToHead.js`, `fightNight.js` → `headToHeadPicker.js`,
  `teams.js` → `lineup.js`, `duo-surround.css` → `duoNetwork.css`, `seamless.css` →
  `sharedLook.css`; about 130 lines of CSS for removed pages and the editor folders
  (`.idea/`, `SpinCard.iml`) removed. Every tab screenshotted before and after.
- **13 Nov 2026.** Removed the old card carousel, its click sound, about 235 unused CSS
  rules and unused pictures (all still in git history). `history/summary.json` is
  downloaded once per visit instead of twice, and the font is WOFF2.
