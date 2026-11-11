// ======================================================
// FIGHT NIGHT (Head-to-Head page)
// ======================================================
// Pick the two players from their cards. The two <select>s that
// js/comparisons.js reads stay in the page (hidden) and hold the choice, so
// the comparison itself is unchanged.

import { CARD_PLAYER_IDS, cardAssets } from "./config.js";

let players = [];
let nextSlot = "A";                       // which side the next tapped card fills
const byId = id => players.find(p => p.id === Number(id));
const selectFor = slot => document.getElementById("comparePlayer" + slot);
const root = () => document.getElementById("fightNight");

function draw() {
    const slotHtml = (slot, number) => {
        const p = byId(selectFor(slot).value);
        return `<button type="button" class="fight-slot ${slot === "B" ? "b" : "a"}${nextSlot === slot ? " on" : ""}" data-slot="${slot}">
            ${p ? `<img src="${cardAssets.thumb(p.id)}" alt="">` : ""}
            <span><small>PLAYER ${number}</small><b>${p ? p.name : "Pick a card"}</b></span>
        </button>`;
    };
    const a = Number(selectFor("A").value), b = Number(selectFor("B").value);
    root().innerHTML = `
        <div class="fight-vs">${slotHtml("A", 1)}<span class="fight-vs-mark">VS</span>${slotHtml("B", 2)}</div>
        <div class="fight-strip">${CARD_PLAYER_IDS.filter(byId).map(id =>
            `<button type="button" data-id="${id}" class="${id === a ? "a" : id === b ? "b" : ""}" aria-label="${byId(id).name}"><img src="${cardAssets.thumb(id)}" alt="" loading="lazy"></button>`).join("")}</div>`;
}

// Puts a player on one side and refreshes the comparison.
export function setFighter(slot, id) {
    const select = selectFor(slot);
    select.value = String(id);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    draw();
}

// From a Compare button: that player becomes Player 1 and the next tap picks Player 2.
export function startComparison(id) {
    if (selectFor("B").value === String(id)) setFighter("B", "");
    setFighter("A", id);
    nextSlot = "B";
    draw();
}

export function setupFightNight() {
    root().addEventListener("click", e => {
        const slot = e.target.closest("[data-slot]"), card = e.target.closest("[data-id]");
        if (slot) { nextSlot = slot.dataset.slot; draw(); }
        if (card) {
            const other = nextSlot === "A" ? "B" : "A";
            if (selectFor(other).value === card.dataset.id) return;   // already on the other side
            const filling = nextSlot;
            nextSlot = other;
            setFighter(filling, card.dataset.id);
        }
    });
}

export function showFightNight(list) {
    players = list;
    draw();
}
