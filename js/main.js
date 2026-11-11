// ======================================================
// SITE START-UP
// ======================================================
// Loads the leaderboard data, wires every tab, then fetches the card pictures
// quietly in the background. Each tab lives in its own file in js/.

import { cardAssets } from "./config.js";
import { loadPlayersQuick } from "./data.js";
import { setupLeaderboard, showLeaderboard, showLeaderboardError } from "./leaderboard.js";
import { chemEnsure } from "./teams.js";
import { setupComparisons, showComparisons } from "./comparisons.js";
import { renderHistoryList } from "./history.js";
import { setupDuoNetwork } from "./duoNetwork.js";
import { showMonthlyRankings } from "./monthly.js";
import { fitPhone, setupMatchSetup, showMatchSetup } from "./matchSetup.js";
import { fitPhonePages, setLayoutPage, setupLayout } from "./layout.js";
import { showKnockout } from "./knockout.js";
import { redrawHands, setupLocker, showLocker } from "./locker.js";
import { setupFightNight, showFightNight, startComparison } from "./fightNight.js";
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
    setupLayout();
    setupPopup();
    setupDropdowns();
    setupModeModal();
    setupPlayerModal(() => players);
    setupLeaderboard();
    setupComparisons();
    setupMatchSetup();
    setupDuoNetwork();
    setupFightNight();
    // Compare (under a hand of cards) opens Head-to-Head with that player as Player 1.
    let showTab = () => {};
    setupLocker({ onCompare: id => { startComparison(id); showTab("comparisonsPage"); }, showCards: () => showTab("cardsPage") });

    showTab = setupTabs(tab => {
        setLayoutPage(tab);   // phones: Match Day and Players use the phone layout
        if (tab === "teamsPage") {
            chemEnsure().catch(() => {});   // warm the chemistry data the first time Match Day opens
            requestAnimationFrame(fitPhone); // size the phone layout now the page is visible (also after a link or Back)
        }
        if (tab === "leaderboardPage" || tab === "cardsPage") redrawHands();
        if (tab === "monthlyPage") showMonthlyRankings();
        if (tab === "knockoutPage") showKnockout();
        requestAnimationFrame(fitPhonePages);   // phones: zoom the open page to fit the screen's width
    });
    renderHistoryList();

    // Escape closes the top-most layer.
    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        if (closeModeModal()) return;
        if (isPlayerModalOpen()) closePlayerModal();
    });

    // The leaderboard shows as soon as current_stats.json arrives; the daily
    // arrows are added when the history summary has downloaded.
    const playersLoaded = boot.step(loadPlayersQuick().then(({ players: list, withArrows }) => {
        players = list;
        showLeaderboard(players);
        showMatchSetup(players);
        showComparisons(players);
        showFightNight(players);
        showLocker(players);
        withArrows.then(full => {
            if (!full) return;
            players = full;
            showLeaderboard(players);
            showLocker(players);
        });
    }).catch(error => {
        console.error("Could not load leaderboard:", error);
        showLeaderboardError("The leaderboard could not be loaded. Please refresh the page.");
    }));
    const wings = boot.step(loadImage(cardAssets.wings));

    Promise.all([playersLoaded, wings]).then(() => {
        boot.finish();
        // The full card art and intros, one by one, on fast connections.
        whenIdle(warmAllInBackground);
    });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
