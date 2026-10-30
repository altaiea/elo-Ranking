// ======================================================
// SITE START-UP
// ======================================================
// Loads the leaderboard data, wires every tab, then fetches the card pictures
// quietly in the background. Each tab lives in its own file in js/.

import { cardAssets } from "./config.js";
import { loadPlayers } from "./data.js";
import { setupLeaderboard, showLeaderboard, showLeaderboardError } from "./leaderboard.js";
import { setupTeams, showTeams, chemEnsure } from "./teams.js";
import { setupComparisons, showComparisons } from "./comparisons.js";
import { renderHistoryList } from "./history.js";
import { setupDuoNetwork } from "./duoNetwork.js";
import { openMonthlyRankings } from "./monthly.js";
import { setupMaps } from "./maps.js";
import { preloadCarouselImages, setupCarousel } from "./carousel.js";
import { closePlayerModal, isPlayerModalOpen, setupPlayerModal, warmAllInBackground } from "./playerCard.js";
import { closeModeModal, setupModeModal } from "./modeModal.js";
import { setupTabs } from "./tabs.js";
import { setupDropdowns, setupPopup } from "./ui.js";

let players = [];

// ---------------------------
// LOADING SCREEN
// ---------------------------
// Waits only for what the first screen needs (the stats and the card wings),
// never for card art, videos or the map history.
const boot = (() => {
    const box = document.getElementById("bootLoader");
    const fill = document.getElementById("blFill");
    const pct = document.getElementById("blPct");
    let total = 0, done = 0;
    const step = promise => {
        total++;
        return Promise.resolve(promise).finally(() => {
            done++;
            const p = Math.round(done / total * 100);
            if (fill) fill.style.width = p + "%";
            if (pct) pct.textContent = p + "%";
        });
    };
    const finish = () => {
        if (!box) return;
        box.classList.add("done");
        setTimeout(() => box.remove(), 600);
    };
    return { step, finish };
})();

function loadImage(src) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = img.onerror = resolve;
        img.src = src;
    });
}

function whenIdle(fn, timeout = 3000) {
    if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout });
    else setTimeout(fn, 500);
}

function start() {
    setupPopup();
    setupDropdowns();
    setupModeModal();
    setupPlayerModal(() => players);
    setupLeaderboard();
    setupTeams();
    setupComparisons();
    setupMaps();
    setupDuoNetwork();
    document.getElementById("monthlyRankingsButton").addEventListener("click", openMonthlyRankings);

    const showCarousel = setupCarousel(() => players.length > 0);
    setupTabs(tab => {
        if (tab === "teamsPage") chemEnsure().catch(() => {});   // warm the chemistry data the first time Teams opens
        if (tab === "carouselPage") showCarousel({ deal: true });
    });
    renderHistoryList();

    // Escape closes the top-most layer.
    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        if (closeModeModal()) return;
        if (isPlayerModalOpen()) closePlayerModal();
    });

    const playersLoaded = boot.step(loadPlayers().then(list => {
        players = list;
        showLeaderboard(players);
        showTeams(players);
        showComparisons(players);
    }).catch(error => {
        console.error("Could not load leaderboard:", error);
        showLeaderboardError("The leaderboard could not be loaded. Please refresh the page.");
    }));
    const wings = boot.step(loadImage(cardAssets.wings));

    Promise.all([playersLoaded, wings]).then(() => {
        boot.finish();
        // Small things first (the 16 carousel thumbnails, ~400 KB in all),
        // then the full card art and intros one by one on fast connections.
        whenIdle(() => {
            preloadCarouselImages();
            warmAllInBackground();
        });
    });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
