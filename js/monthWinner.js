// ======================================================
// LAST MONTH'S NUMBER ONE
// ======================================================
// Works out who finished first in the Monthly table for the month before the
// newest day in the history. Their card wears the wings (card_wings.webp):
// in both card hands (js/locker.js) and in the card popup (js/playerCard.js).

import { loadAllHistory } from "./data.js";
import { buildMonthlyRankings } from "./monthly.js";
import { monthKeyOf } from "./ui.js";

let winner = null;

// Resolves to the player's id, or null if it can't be worked out.
export function lastMonthWinner() {
    if (!winner) winner = (async () => {
        try {
            const days = (await loadAllHistory()).filter(d => d && d.date);
            if (!days.length) return null;
            const newest = days.map(d => String(d.date)).sort().pop();
            const lastMonth = monthKeyOf(new Date(Number(newest.slice(0, 4)), Number(newest.slice(5, 7)) - 2, 1));
            const first = buildMonthlyRankings(days, lastMonth).records.find(r => r.monthlyRank === 1);
            return first ? first.playerId : null;
        } catch (error) {
            console.warn("Could not work out last month's winner for the wings.", error);
            return null;
        }
    })();
    return winner;
}
