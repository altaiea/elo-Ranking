// ======================================================
// LOCKER ROOM (top of the Ranks page) AND THE CARDS PAGE
// ======================================================
// Both show the hand of cards with the middle player's numbers underneath.
// On the Ranks page the hand and the leaderboard follow each other: turn the
// hand and the row lights up; click a row and the hand turns to that player.

import { createCardHand, showPlayerReadout } from "./cardHand.js";
import { openPlayerModal } from "./playerCard.js";
import { loadAllHistory } from "./data.js";
import { buildMonthlyRankings } from "./monthly.js";
import { monthKeyOf } from "./ui.js";

let players = [];
let lockerHand = null, cardsHand = null;
const byId = id => players.find(p => p.id === Number(id));

function markLeaderboardRow() {
    const id = lockerHand ? lockerHand.selected() : null;
    document.querySelectorAll("#table-body tr").forEach(row => {
        const cell = row.querySelector(".player-name");
        row.classList.toggle("locker-pick", !!cell && Number(cell.dataset.id) === id);
    });
    document.querySelectorAll("#lbAlt [data-id]").forEach(item => item.classList.toggle("locker-pick", Number(item.dataset.id) === id));
}

// onCompare(id) runs when a Compare button is pressed.
export function setupLocker({ onCompare }) {
    lockerHand = createCardHand(document.getElementById("lockerHand"), {
        onOpen: openPlayerModal,
        onSelect: id => { showPlayerReadout(document.getElementById("lockerReadout"), byId(id)); markLeaderboardRow(); }
    });
    cardsHand = createCardHand(document.getElementById("cardsHand"), {
        openOnArrive: true,                     // on the Cards page a tap on any card opens it
        onOpen: openPlayerModal,
        onSelect: id => showPlayerReadout(document.getElementById("cardsReadout"), byId(id))
    });

    const tbody = document.getElementById("table-body");
    new MutationObserver(() => setTimeout(markLeaderboardRow)).observe(tbody, { childList: true });   // the table is redrawn when the arrows arrive
    tbody.addEventListener("click", e => {
        if (e.target.closest("[data-dropdown-toggle]")) return;
        const cell = e.target.closest("tr")?.querySelector(".player-name");
        if (cell) lockerHand.goTo(cell.dataset.id);
    });

    document.addEventListener("click", e => {
        const button = e.target.closest && e.target.closest("[data-player-action]");
        if (!button) return;
        if (button.dataset.playerAction === "open") openPlayerModal(Number(button.dataset.id));
        else onCompare(Number(button.dataset.id));
    });
}

// Last month's number one wears the wings behind their card, in both hands.
// "Last month" is the month before the newest day in the history.
let wingsDone = false;
async function giveWingsToLastMonthsWinner() {
    if (wingsDone) return;
    wingsDone = true;
    try {
        const days = (await loadAllHistory()).filter(d => d && d.date);
        if (!days.length) return;
        const newest = days.map(d => String(d.date)).sort().pop();
        const lastMonth = monthKeyOf(new Date(Number(newest.slice(0, 4)), Number(newest.slice(5, 7)) - 2, 1));
        const winner = buildMonthlyRankings(days, lastMonth).records.find(r => r.monthlyRank === 1);
        if (!winner) return;
        document.querySelectorAll(`.hand-card[data-id="${winner.playerId}"]`).forEach(card => card.classList.add("winged"));
    } catch (error) {
        console.warn("Could not work out last month's winner for the wings.", error);
    }
}

export function showLocker(list) {
    players = list;
    giveWingsToLastMonthsWinner();
    showPlayerReadout(document.getElementById("lockerReadout"), byId(lockerHand.selected()));
    showPlayerReadout(document.getElementById("cardsReadout"), byId(cardsHand.selected()));
    markLeaderboardRow();
}

// A hidden hand has no width to lay itself out in, so redraw when its page opens.
export function redrawHands() {
    lockerHand.draw();
    cardsHand.draw();
}
