# ELO Ranking --- Optimised Build README

## Purpose

This build keeps the supplied webpage's existing functionality and adds
performance optimisations plus a consistent coordinate-override system
for all 16 players.

## Player coordinate overrides

Every player from 1 through 16 now receives a dedicated class:

`player1-adjust` through `player16-adjust`

The same class is applied in both:

-   the normal player card/modal
-   the Head-to-Head comparison card

This means a player's CSS coordinate override follows that player into
Head-to-Head instead of being limited to the main modal.

Existing player-specific coordinate values from the supplied CSS have
been preserved. Players that did not already have custom CSS now have
neutral `0px` hooks. You can manually edit the player's `.rating`,
`.col1.row1`, `.col2.row1`, and `.col3.row1` rules in `style.css`.

Example:

``` css
.player6-adjust .rating {
    position: relative;
    top: 0px !important;
    left: 0px !important;
}

.player6-adjust .col1.row1 {
    transform: translate(0px, 0px) !important;
}
```

Change only those pixel values to reposition that player's numbers.

## Lossless WebP card backs

The original `cards/1_back.png` through `cards/16_back.png` files are
retained.

A matching lossless WebP file is included for every player:

`cards/1_back.webp` through `cards/16_back.webp`

`script.js` references the WebP versions. The WebPs were encoded in
lossless mode and verified against the PNG source pixels after decoding.

Do not deploy `script.js` without also deploying the `.webp` files in
the `cards` folder.

## Intro MP4 quality

The intro MP4 files from the supplied ZIP are preserved byte-for-byte.
They have NOT been re-encoded.

A lossless video re-encode would generally make these files
substantially larger and could reduce browser compatibility, so it would
work against the performance goal. Keeping the original MP4 bytes
preserves exactly the quality present in the supplied source files and
avoids the blur/pixelation introduced by the previous compressed build.

The supplied ZIP contains intro videos for players 1--12 and 15. It does
not contain `cards/16_intro.mp4`, although the existing JavaScript
references that path. No replacement video was invented. If SION should
have an intro, add the real file as `cards/16_intro.mp4`.

## Background cache warming

After the normal page `load` event and an idle opportunity, the browser
begins warming the cache for:

-   all 16 lossless WebP card backs
-   the existing full-quality intro MP4 files

Video requests are staggered instead of being started simultaneously.
The existing modal readiness logic is still used when a player is
opened; cache warming does not bypass it.

## Carousel optimisation

The original carousel speed, drag sensitivity and easing constants are
unchanged.

The carousel now avoids applying transform/compositing work while:

-   the browser tab is hidden, or
-   the Cards page itself is not visible

Timing is reset while hidden so returning to the Cards tab does not
create a large animation jump.

The existing `will-change: transform` browser hint remains in use for
the carousel slider.

## What was not intentionally changed

No ELO formula, player statistics calculation, player data, score logic,
team logic, series/history logic, modal flip/readiness rule, comparison
calculation, card artwork layout, existing custom coordinate value,
carousel speed/easing constant, or other gameplay/stat functionality was
intentionally changed.

## Deployment

Deploy the complete project folder. In particular, keep together:

-   `index.html`
-   `style.css`
-   `script.js`
-   `README.md`
-   `wings.png`
-   the complete `cards/` folder
-   the existing JSON/stat/history files and folders

The original PNG card backs remain as source/back-up assets, but the
current JavaScript loads the matching lossless WebP files.
