// ===============================
// CARD RATINGS, TEAM MATHS, CHEMISTRY
// ===============================
// Pure maths on the published stats. No page code, so the Three.js game can
// show exactly the same numbers as the site.

import { INACTIVE_PLAYER_IDS, MODES } from "./config.js";

/* ---------------------------
   PERCENTILE ENGINE
---------------------------- */
export function percentile(value, array) {
    if (array.length <= 1) return 0;
    const below = array.filter(v => v < value).length;
    return below / (array.length - 1);
}

// Every rating on the site uses the same 57-99 scale.
export const scaleRating = pct => Math.round(57 + pct * 42);

export function computeModeRating(kdPct, wrPct, marginPct, slayerWeighted, gamesPlayed) {
    const weighted =
        0.6 * slayerWeighted +
        0.25 * marginPct +
        0.15 * wrPct;

    let rating = Math.round(57 + weighted * 42);
    if (gamesPlayed < 5 && rating > 95) rating = 95;
    return rating;
}

/* ---------------------------
   MODE COMPUTATION
---------------------------- */
export function computeMode(prefix, p, players) {
    // Inactive players keep their own stored card stats, but do not contribute
    // values to anybody's percentile comparison pool.
    const activePercentilePlayers = players.filter(x => !INACTIVE_PLAYER_IDS.has(x.id));
    const percentilePlayers = INACTIVE_PLAYER_IDS.has(p.id)
        ? [...activePercentilePlayers, p]
        : activePercentilePlayers;

    const kills = p[prefix + "Kills"];
    const deaths = p[prefix + "Deaths"];
    const wins = p[prefix + "Wins"];
    const losses = p[prefix + "Losses"];
    const marginTotal = p[prefix + "MarginTotal"];
    const marginCount = p[prefix + "MarginCount"];

    // Lifetime damage share
    const lifetimeDamage = p[prefix + "LifetimeDamage"] || 0;
    const lifetimeTeamDamage = p[prefix + "LifetimeTeamDamage"] || 0;
    const dmgShare = lifetimeTeamDamage === 0 ? 0 : lifetimeDamage / lifetimeTeamDamage;

    const kd = deaths === 0 ? kills : kills / deaths;
    const wr = (wins + losses) === 0 ? 0 : wins / (wins + losses);
    const margin = marginCount === 0 ? 0 : marginTotal / marginCount;

    const kdArr = percentilePlayers
        .filter(x => x[prefix + "Deaths"] + x[prefix + "Kills"] > 0)
        .map(x => x[prefix + "Kills"] / x[prefix + "Deaths"]);
    const kdPct = percentile(kd, kdArr);

    const wrArr = percentilePlayers
        .filter(x => x[prefix + "Wins"] + x[prefix + "Losses"] > 0)
        .map(x => x[prefix + "Wins"] / (x[prefix + "Wins"] + x[prefix + "Losses"]));
    const wrPct = percentile(wr, wrArr);

    const marginArr = percentilePlayers
        .filter(x => x[prefix + "MarginCount"] > 0)
        .map(x => x[prefix + "MarginTotal"] / x[prefix + "MarginCount"]);
    const marginPct = percentile(margin, marginArr);

    const dmgArr = percentilePlayers
        .filter(x => (x[prefix + "LifetimeTeamDamage"] || 0) > 0)
        .map(x => (x[prefix + "LifetimeDamage"] || 0) / x[prefix + "LifetimeTeamDamage"]);
    const dmgPct = percentile(dmgShare, dmgArr);

    const slayerWeighted = 0.7 * dmgPct + 0.3 * kdPct;
    const slayerRating = scaleRating(slayerWeighted);

    const gamesPlayed = wins + losses;
    const rating = computeModeRating(kdPct, wrPct, marginPct, slayerWeighted, gamesPlayed);

    return { kd, wr, margin, rating, wins, losses, dmgShare, slayerWeighted, kdPct, wrPct, marginPct, dmgPct, slayerRating };
}

// The card's three mode ratings and the overall rating (their average).
export function cardRatings(p, players) {
    const modes = {};
    MODES.forEach(m => { modes[m.prefix] = computeMode(m.prefix, p, players); });
    const overall = Math.round((modes.hp.rating + modes.snd.rating + modes.overload.rating) / 3);
    return { ...modes, overall };
}

// Rating tier drives the premium visual treatment.
export function ratingTierClass(overall) {
    if (overall >= 98) return "rating-98";
    if (overall >= 90) return "rating-90";
    if (overall >= 80) return "rating-80";
    return "";
}

/* ---------------------------
   TEAM MATHS (auto + manual builders)
   Elo's expected-score formula compares two ratings, so each team is
   represented by its AVERAGE rating (the same way the Elo engine does it).
---------------------------- */
export function teamStats(teamA, teamB) {
    const sum = team => team.reduce((s, p) => s + p.elo, 0);
    const eloA = sum(teamA);
    const eloB = sum(teamB);
    const avgA = eloA / teamA.length;
    const avgB = eloB / teamB.length;
    const probA = 1 / (1 + Math.pow(10, (avgB - avgA) / 400));
    return { eloA, eloB, avgA, avgB, probA, probB: 1 - probA };
}

// The 4 v 4 split of 8 players with the smallest total Elo difference.
export function bestSplit(players) {
    const combos = [];
    (function helper(start, combo) {
        if (combo.length === players.length / 2) { combos.push(combo); return; }
        for (let i = start; i < players.length; i++) helper(i + 1, combo.concat(players[i]));
    })(0, []);

    let best = null;
    let bestDiff = Infinity;
    combos.forEach(teamA => {
        const teamB = players.filter(p => !teamA.includes(p));
        const diff = Math.abs(teamA.reduce((s, p) => s + p.elo, 0) - teamB.reduce((s, p) => s + p.elo, 0));
        if (diff < bestDiff) {
            bestDiff = diff;
            best = { teamA, teamB };
        }
    });
    return best;
}

/* ---------------------------
   PLAYER CHEMISTRY
   For every pair that has played on the same team: win rate together,
   nudged toward 50% for small samples, ranked against all other pairs
   and turned into a 57-99 rating (same idea as the mode ratings).
   Pairs with fewer than CHEM_MIN_GAMES maps stay grey.
---------------------------- */
export const CHEM_MIN_GAMES = 10;   // maps together before a pair gets a colour
const CHEM_SHRINK = 10;              // pulls small samples toward 50 %

export const chemKey = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;
export const chemBand = r => r < 65 ? "red" : r < 80 ? "amber" : r < 95 ? "green" : "purple";

export function buildChemistry(days) {
    const seen = new Set(), pairs = new Map();
    days.forEach(day => (day.maps || []).forEach(m => {
        if (!m || seen.has(m.mapId)) return;
        seen.add(m.mapId);
        const win = m.game?.result?.winningTeam;
        if (win !== 1 && win !== 2) return;
        [["A", 1], ["B", 2]].forEach(([k, w]) => {
            const ids = ((m.game.teams || {})[k] || []).map(p => Number(p.playerId));
            for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
                const key = chemKey(ids[i], ids[j]);
                const e = pairs.get(key) || { ids: [ids[i], ids[j]], games: 0, wins: 0 };
                e.games++;
                if (win === w) e.wins++;
                pairs.set(key, e);
            }
        });
    }));
    const list = [...pairs.values()].filter(e => e.games >= CHEM_MIN_GAMES);
    list.forEach(e => { e.value = (e.wins + 0.5 * CHEM_SHRINK) / (e.games + CHEM_SHRINK); });
    const pool = list.filter(e => !e.ids.some(id => INACTIVE_PLAYER_IDS.has(id))).map(e => e.value);
    list.forEach(e => { e.rating = scaleRating(percentile(e.value, pool)); e.band = chemBand(e.rating); });
    return new Map(list.map(e => [chemKey(e.ids[0], e.ids[1]), e]));
}
