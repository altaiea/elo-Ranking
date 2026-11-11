// ======================================================
// LOCKER ROOM (top of the Ranks page) AND THE CARDS PAGE
// ======================================================
// Both show the hand of cards with the middle player's numbers underneath.
// On the Ranks page the hand and the leaderboard follow each other: turn the
// hand and the row lights up; click a row and the hand turns to that player.

import { createCardHand, showPlayerReadout } from "./cardHand.js";
import { openPlayerModal } from "./playerCard.js";
import { lastMonthWinner } from "./monthWinner.js";

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
let wingsDone = false;
function giveWingsToLastMonthsWinner() {
    if (wingsDone) return;
    wingsDone = true;
    lastMonthWinner().then(id => {
        if (id) document.querySelectorAll(`.hand-card[data-id="${id}"]`).forEach(card => card.classList.add("winged"));
    });
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
