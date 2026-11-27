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
   The same prediction the site's Elo uses (Model TR: TrueSkill + 25% kill share; the score
   margin, counted from 20 Sep 2026, only changes how far ratings move, never the win chance).
   Each mode is predicted from the players' rating in that mode, without their
   Captain's Cup points (a reward, not skill). A team's strength is the sum of its
   four players' ratings. Win chance in a mode = Phi(gap / spread), where Phi is
   the normal curve and
       spread = sqrt(8 x 90^2 + the 8 players' (uncertainty in that mode^2 + 1.25^2)).
   90 is how much one map can swing per player (luck), the uncertainty is the
   player's +- (bigger for newer players) and 1.25 is the little uncertainty the
   model adds back every map. The overall win chance is the expected share of maps
   won on a usual night: 41.6% HP, 33.7% SND and 24.7% Overload, the same weights
   as the overall rating. These are exactly the engine's numbers
   (codstats/model_tr.py, win_chance), from current_stats.json.
---------------------------- */
export const MODE_WEIGHTS = { Hardpoint: 0.416, SND: 0.337, Overload: 0.247 };
const LUCK = 90;                 // eloModel.beta in current_stats.json
const DRIFT = 1.25;              // eloModel.tau
const NEW_PLAYER_UNCERTAINTY = 103;   // 25 x sqrt(4^2 + 1^2): a player with no maps yet

const modeRating = (p, mode) => {
    const value = Number(p?.modeElo?.[mode]);
    const rating = Number.isFinite(value) ? value : Number(p?.elo) || 0;     // no mode rating yet: use the overall
    return rating - (Number(p?.skill?.cupPoints) || 0);
};

const modeUncertainty = (p, mode) => {
    const value = Number(p?.skill?.modeUncertainty?.[mode]);
    return Number.isFinite(value) ? value : NEW_PLAYER_UNCERTAINTY;
};

// The normal curve Phi(x) (Abramowitz & Stegun 7.1.26, within 1e-7 of the exact value).
export function normalCdf(x) {
    const z = Math.abs(x) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * z);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export function modeWinChances(teamA, teamB) {
    const out = {};
    const everyone = teamA.concat(teamB);
    Object.keys(MODE_WEIGHTS).forEach(mode => {
        const gap = teamA.reduce((s, p) => s + modeRating(p, mode), 0) - teamB.reduce((s, p) => s + modeRating(p, mode), 0);
        const spread = Math.sqrt(everyone.length * LUCK * LUCK +
            everyone.reduce((s, p) => s + modeUncertainty(p, mode) ** 2 + DRIFT * DRIFT, 0));
        out[mode] = normalCdf(gap / spread);
    });
    return out;
}

export function teamStats(teamA, teamB) {
    const sum = team => team.reduce((s, p) => s + p.elo, 0);
    const eloA = sum(teamA);
    const eloB = sum(teamB);
    const avgA = eloA / teamA.length;
    const avgB = eloB / teamB.length;
    const modes = modeWinChances(teamA, teamB);
    const probA = Object.entries(MODE_WEIGHTS).reduce((s, [mode, w]) => s + w * modes[mode], 0);
    return { eloA, eloB, avgA, avgB, probA, probB: 1 - probA, modes };
}

// The fairest 4 v 4 split of 8 players: the one whose predicted win chance is closest
// to 50 / 50 (ties: the smaller total Elo difference).
export function bestSplit(players) {
    const combos = [];
    (function helper(start, combo) {
        if (combo.length === players.length / 2) { combos.push(combo); return; }
        for (let i = start; i < players.length; i++) helper(i + 1, combo.concat(players[i]));
    })(0, []);

    let best = null;
    let bestKey = [Infinity, Infinity];
    combos.forEach(teamA => {
        const teamB = players.filter(p => !teamA.includes(p));
        const key = [Math.abs(teamStats(teamA, teamB).probA - 0.5),
                     Math.abs(teamA.reduce((s, p) => s + p.elo, 0) - teamB.reduce((s, p) => s + p.elo, 0))];
        if (key[0] < bestKey[0] - 1e-12 || (Math.abs(key[0] - bestKey[0]) <= 1e-12 && key[1] < bestKey[1])) {
            bestKey = key;
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
