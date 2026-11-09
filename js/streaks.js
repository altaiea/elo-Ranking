// ===============================
// MODE STREAKS
// ===============================
// Each player's current win streak in each game mode, worked out from the
// published match history (history/summary.json or the day files), so
// CODStats needs no change: every new export updates the streaks.
// No page code, so the Three.js game can import it too.
//
// A streak is consecutive map wins in ONE mode. Maps in other modes don't
// break it; a loss in that mode resets it to 0. Days are read oldest first and
// maps in the order the exporter wrote them.
//
// Fire on the card's orb (decided 2026-11-08, card-template/layered-v2):
//   3-4 wins = gold, 5-6 = red, 7 or more = purple. Same size at every tier.

import { loadAllHistory } from "./data.js";

export const STREAK_TIERS = [
    { min: 7, tier: "purple" },
    { min: 5, tier: "red" },
    { min: 3, tier: "gold" }
];

export const streakTier = wins => STREAK_TIERS.find(t => wins >= t.min)?.tier || null;

// Exporter mode names -> the stat prefixes used everywhere else (config.js MODES).
const MODE_KEY = { Hardpoint: "hp", SND: "snd", "Search & Destroy": "snd", Overload: "overload" };
export const STREAK_MODES = ["hp", "snd", "overload"];

const emptyRecord = () => Object.fromEntries(STREAK_MODES.map(m => [m, { current: 0, best: 0 }]));

// days: oldest first, as loadAllHistory() returns them.
// Returns Map(playerId -> { hp: { current, best }, snd: {...}, overload: {...} }).
export function buildModeStreaks(days) {
    const seen = new Set(), streaks = new Map();
    const rec = id => { if (!streaks.has(id)) streaks.set(id, emptyRecord()); return streaks.get(id); };
    (days || []).forEach(day => (day.maps || []).forEach(m => {
        if (!m || seen.has(m.mapId)) return;
        seen.add(m.mapId);
        const mode = MODE_KEY[m.gameMode || m.game?.gameMode];
        const win = Number(m.game?.result?.winningTeam);
        if (!mode || (win !== 1 && win !== 2)) return;
        [["A", 1], ["B", 2]].forEach(([side, team]) => {
            ((m.game.teams || {})[side] || []).forEach(pl => {
                const s = rec(Number(pl.playerId))[mode];
                if (win === team) { s.current++; s.best = Math.max(s.best, s.current); }
                else s.current = 0;
            });
        });
    }));
    return streaks;
}

let streaksPromise = null;

// Cached for the page's lifetime. Never rejects: no history means no streaks.
export function loadModeStreaks() {
    if (!streaksPromise) {
        streaksPromise = loadAllHistory().then(buildModeStreaks).catch(() => new Map());
    }
    return streaksPromise;
}
