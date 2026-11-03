// ===============================
// KNOCKOUT MVP RATING
// ===============================
// Who carried their own team in Captain's Cup maps, on the site's usual
// 57-99 scale. Used on the Knockout tab only; normal maps, Elo and the
// cards are not affected. No page code, so the Three.js game can import it.
//
// Carry uses the Elo engine's own team-relative terms (EloCalculator.java):
//   KD carry     = your map KD - your team's average map KD  (SND KD capped at 4)
//   Kill carry   = your share of your team's kills - 1 / team size
//   carry        = 10 x (KD carry x 0.5 + kill carry x 1.5)
// The 10 is the engine's "pool" for an even, full-margin map, fixed here so
// winning, losing and the score margin do not change it: it only says how
// much better or worse you played than your own teammates.
//
// The Knockout History shows these raw carries on every map and each
// player's series total; the highest series total is the series MVP (the
// trophy count on the cards). carryRating() turns a carry into the site's
// 57-99 scale against every map in history, if a rating is ever wanted.

import { percentile, scaleRating } from "./ratings.js";
import { loadAllHistory } from "./data.js";
import { loadAllKnockoutMonths } from "./knockoutData.js";

const KD_WEIGHT = 0.5;        // PerformanceCalculator.KD_WEIGHT
const KILL_WEIGHT = 1.5;      // PerformanceCalculator.DAMAGE_WEIGHT
const POOL = 10;              // K_FACTOR 20 x (1 - 0.5 expected) x margin 1

function mapKd(player, mode) {
    const kills = Number(player.kills) || 0;
    const deaths = Number(player.deaths) || 0;
    const kd = deaths === 0 ? kills : kills / deaths;
    return mode === "SND" ? Math.min(kd, 4) : kd;
}

// { playerId: carry } for one map. Empty when the map has no line-ups.
export function mapCarries(map) {
    const mode = map?.gameMode || map?.game?.gameMode;
    const out = new Map();
    Object.values(map?.game?.teams || {}).forEach(team => {
        if (!Array.isArray(team) || !team.length) return;
        const avgKd = team.reduce((sum, p) => sum + mapKd(p, mode), 0) / team.length;
        const teamKills = team.reduce((sum, p) => sum + (Number(p.kills) || 0), 0);
        team.forEach(p => {
            const killShare = teamKills ? (Number(p.kills) || 0) / teamKills : 0;
            const carry = POOL * ((mapKd(p, mode) - avgKd) * KD_WEIGHT + (killShare - 1 / team.length) * KILL_WEIGHT);
            out.set(Number(p.playerId), carry);
        });
    });
    return out;
}

// Every carry from every map in history: the yardstick for the 57-99 scale.
export function buildCarryScale(history) {
    const pool = [];
    (history || []).forEach(day => (day.maps || []).forEach(m => mapCarries(m).forEach(c => pool.push(c))));
    pool.sort((a, b) => a - b);
    return pool;
}

export function carryRating(carry, scale) {
    return scaleRating(percentile(carry, scale));
}

// { playerId: rating } for one map.
export function mapRatings(map, scale) {
    const out = new Map();
    mapCarries(map).forEach((carry, id) => out.set(id, carryRating(carry, scale)));
    return out;
}

// Averages map ratings over a set of maps:
// [{ playerId, rating, maps }] best first.
export function averageRatings(maps, scale) {
    const totals = new Map();
    maps.filter(Boolean).forEach(m => mapRatings(m, scale).forEach((rating, id) => {
        const t = totals.get(id) || { playerId: id, sum: 0, maps: 0 };
        t.sum += rating; t.maps += 1;
        totals.set(id, t);
    }));
    return [...totals.values()]
        .map(t => ({ playerId: t.playerId, rating: Math.round(t.sum / t.maps), maps: t.maps }))
        .sort((a, b) => b.rating - a.rating || b.maps - a.maps || a.playerId - b.playerId);
}

// Each player's total carry over a series: the sum of their map carries.
// [{ playerId, total, maps }] best first. Summing (not averaging) rewards
// carrying the team map after map rather than one big game.
export function seriesCarryTotals(maps) {
    const totals = new Map();
    maps.filter(Boolean).forEach(m => mapCarries(m).forEach((carry, id) => {
        const t = totals.get(id) || { playerId: id, total: 0, maps: 0 };
        t.total += carry; t.maps += 1;
        totals.set(id, t);
    }));
    return [...totals.values()].sort((a, b) => b.total - a.total || b.maps - a.maps || a.playerId - b.playerId);
}

// The series MVP: the highest total carry across the series' maps.
export function seriesMvp(series, mapsById) {
    const maps = (series?.mapIds || []).map(id => mapsById.get(id)).filter(Boolean);
    const board = seriesCarryTotals(maps);
    return board.length ? board[0].playerId : null;
}

// How many series MVPs each player has won, over every Cup month.
// Only finished series count (a winner is recorded), so a series in
// progress never hands out an MVP early. Cached for the page's lifetime.
let countsPromise = null;
export function loadMvpCounts() {
    if (!countsPromise) {
        countsPromise = Promise.all([loadAllHistory(), loadAllKnockoutMonths()]).then(([history, months]) => {
            const mapsById = new Map();
            history.forEach(day => (day.maps || []).forEach(m => mapsById.set(m.mapId, m)));
            const counts = new Map();
            months.forEach(month => (month.series || []).forEach(series => {
                if (!series.winner) return;
                const id = seriesMvp(series, mapsById);
                if (id !== null) counts.set(id, (counts.get(id) || 0) + 1);
            }));
            return counts;
        }).catch(error => {
            countsPromise = null;
            console.warn("MVP counts could not be loaded:", error);
            return new Map();
        });
    }
    return countsPromise;
}
