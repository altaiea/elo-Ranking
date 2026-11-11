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
let cardsHand = null;
const byId = id => players.find(p => p.id === Number(id));

// onCompare(id) runs when a Compare button is pressed.
export function setupLocker({ onCompare, showCards }) {
    cardsHand = createCardHand(document.getElementById("cardsHand"), {
        openOnArrive: true,                     // on the Cards page a tap on any card opens it
        onOpen: openPlayerModal,
        onSelect: id => showPlayerReadout(document.getElementById("cardsReadout"), byId(id))
    });

    const openFromRanks = id => {
        if (!byId(id)) return;
        showCards();
        cardsHand.draw();
        cardsHand.goTo(id);
        openPlayerModal(Number(id));
    };
    document.getElementById("table-body").addEventListener("click", e => {
        if (e.target.closest("[data-dropdown-toggle]")) return;
        const cell = e.target.closest("tr")?.querySelector(".player-name");
        if (cell) openFromRanks(cell.dataset.id);
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
    showPlayerReadout(document.getElementById("cardsReadout"), byId(cardsHand.selected()));
}

// A hidden hand has no width to lay itself out in, so redraw when its page opens.
export function redrawHands() {
    cardsHand.draw();
}
