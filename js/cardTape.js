// ======================================================
// TALE OF THE TAPE (beside the card in the card popup)
// ======================================================
// The player's headline numbers slide out next to the floating card, so they
// can be read without turning the card over.

import { totalLosses, totalWins } from "./data.js";
import { kdOf } from "./cardHand.js";

const KD_FULL_BAR = 2;       // a 2.00 K/D fills the bar

// place = { cx, cy, w, h, s }: where the card floats on screen and the scene's scale (from js/playerCard.js).
export function showCardTape(p, players, place) {
    hideCardTape();
    const tape = document.createElement("div");
    tape.id = "cardTape";
    ["cx", "cy", "w", "h"].forEach(k => tape.style.setProperty("--" + k, place[k] + "px"));
    tape.style.setProperty("--s", place.s);

    const wins = totalWins(p), losses = totalLosses(p), winRate = wins + losses ? wins / (wins + losses) : 0;
    const elos = players.map(x => x.elo), low = Math.min(...elos) - 60, high = Math.max(...elos);
    const row = (label, value, share) =>
        `<div class="tape-row"><span>${label}</span><i><u style="width:${Math.max(4, Math.min(100, share * 100))}%"></u></i><b>${value}</b></div>`;
    const kdRow = (label, mode) => row(label, kdOf(p, mode).toFixed(2), kdOf(p, mode) / KD_FULL_BAR);

    tape.innerHTML = `
        <div class="tape-rank">RANK ${p.currentRank}</div>
        <h4>${p.name}</h4>
        ${row("Elo", Math.round(p.elo), (p.elo - low) / (high - low || 1))}
        ${row("Win rate", Math.round(winRate * 100) + "%", winRate)}
        ${kdRow("K/D")}
        ${kdRow("Hardpoint", "hp")}
        ${kdRow("S&amp;D", "snd")}
        ${kdRow("Overload", "overload")}`;
    document.getElementById("playerModal").append(tape);
}

export function hideCardTape() {
    document.getElementById("cardTape")?.remove();
}
