// ===============================
// KNOCKOUT MVP RATING
// ===============================
// Who carried their own team in Captain's Cup maps, on the site's usual
// 57-99 scale. Used on the Knockout tab only; normal maps, Elo and the
// cards are not affected. No page code, so the Three.js game can import it.
//
// Carry uses the team-relative terms of the first (Java) Elo engine, rules version 1.
// Note: the current engine (CODStats v4, codstats/elo/rules.py) weighs K/D 0.36 and
// kills 2.5 instead; this MVP rating still uses the old 0.5 / 1.5 (flagged 13 Nov 2026).
//   KD carry     = your map KD - your team's average map KD  (SND KD capped at 4)
//   Kill carry   = your share of your team's kills - 1 / team size
//   carry        = 10 x (KD carry x 0.5 + kill carry x 1.5)
// The 10 is the engine's "pool" for an even, full-margin map, fixed here so
// winning, losing and the score margin do not change it: it only says how
// much better or worse you played than your own teammates.
//
// The rated carry is half that and half the same sum against the whole
// lobby (all players on the map), so beating everyone counts as well as
// beating your teammates.
//
// The Knockout History shows each map's carry as a match rating out of 10
// (matchRating) and each player's series average; the best series average is
// the series MVP (the trophy count on the cards). carryRating() turns a carry into the site's
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
// lobby = true compares each player with all players on the map instead of
// only their own team.
export function mapCarries(map, lobby = false) {
    const mode = map?.gameMode || map?.game?.gameMode;
    const out = new Map();
    const teams = Object.values(map?.game?.teams || {}).filter(t => Array.isArray(t) && t.length);
    (lobby ? [teams.flat()] : teams).forEach(group => {
        const avgKd = group.reduce((sum, p) => sum + mapKd(p, mode), 0) / group.length;
        const groupKills = group.reduce((sum, p) => sum + (Number(p.kills) || 0), 0);
        group.forEach(p => {
            const killShare = groupKills ? (Number(p.kills) || 0) / groupKills : 0;
            const carry = POOL * ((mapKd(p, mode) - avgKd) * KD_WEIGHT + (killShare - 1 / group.length) * KILL_WEIGHT);
            out.set(Number(p.playerId), carry);
        });
    });
    return out;
}

// The rated carry: half against your own team, half against the whole lobby.
export function mapCombinedCarries(map) {
    const team = mapCarries(map);
    const lobby = mapCarries(map, true);
    const out = new Map();
    team.forEach((c, id) => out.set(id, (c + (lobby.get(id) ?? c)) / 2));
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
// [{ playerId, total, maps }] best first.
export function seriesCarryTotals(maps) {
    const totals = new Map();
    maps.filter(Boolean).forEach(m => mapCarries(m).forEach((carry, id) => {
        const t = totals.get(id) || { playerId: id, total: 0, maps: 0 };
        t.total += carry; t.maps += 1;
        totals.set(id, t);
    }));
    return [...totals.values()].sort((a, b) => b.total - a.total || b.maps - a.maps || a.playerId - b.playerId);
}

// Match rating out of 10, like a football player rating, so it never reads
// as Elo: 6 is an average game for your team, 7+ good, 8+ a carry, under 5
// a rough night. Over all history most maps land between 3.6 and 8.6.
export const matchRating = carry => Math.min(10, Math.max(1, 6 + carry / 2));

// { playerId: rating out of 10 } for one map.
export function mapMatchRatings(map) {
    const out = new Map();
    mapCombinedCarries(map).forEach((carry, id) => out.set(id, matchRating(carry)));
    return out;
}

// Each player's series rating: the average of their map ratings out of 10,
// so steady games beat one big map. [{ playerId, rating, maps }] best first.
export function seriesRatings(maps) {
    const totals = new Map();
    maps.filter(Boolean).forEach(m => mapMatchRatings(m).forEach((rating, id) => {
        const t = totals.get(id) || { playerId: id, sum: 0, maps: 0 };
        t.sum += rating; t.maps += 1;
        totals.set(id, t);
    }));
    return [...totals.values()]
        .map(t => ({ playerId: t.playerId, rating: t.sum / t.maps, maps: t.maps }))
        .sort((a, b) => b.rating - a.rating || b.maps - a.maps || a.playerId - b.playerId);
}

// The series MVP: the best series rating.
export function seriesMvp(series, mapsById) {
    const maps = (series?.mapIds || []).map(id => mapsById.get(id)).filter(Boolean);
    const board = seriesRatings(maps);
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
