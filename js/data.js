// ===============================
// DATA LOADING
// ===============================
// Reads the JSON the CODStats exporter publishes. No page code, so the
// Three.js game can import it too.
//
//   current_stats.json        { players: { id: { elo, lifetimeKills, hpWins, ... } } }
//   history/index.json        { days: [ { date, file, mapCount } ] }
//   history/YYYY-MM-DD.json   { date, openingStats, maps: [ { mapId, game, elo: [...] } ] }
//   history/summary.json      optional small copy of every day, without the
//                             calculation traces (tools/build_history_summary.py)

import { INACTIVE_PLAYER_IDS, PLACEHOLDER_PLAYER_IDS, getPlayerName } from "./config.js";

const HISTORY_FOLDER = "history";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_FILE = /^[\w.-]+\.json$/;

async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
    return response.json();
}

// ---------------------------
// HISTORY INDEX
// ---------------------------
// Accepts the published { days: [...] } and the older { dates: [...] } and
// plain-array formats. Sorted oldest first.
export function normaliseHistoryIndex(payload) {
    const list = Array.isArray(payload) ? payload
        : Array.isArray(payload?.days) ? payload.days
        : Array.isArray(payload?.dates) ? payload.dates : [];
    return list
        .map(item => typeof item === "string" ? { date: item } : item)
        .filter(item => item && DATE_PATTERN.test(String(item.date)))
        .map(item => {
            const count = Number(item.mapCount ?? item.maps);
            const file = String(item.file || `${item.date}.json`);
            return {
                date: String(item.date),
                // Only accept a plain filename, never a path supplied by the index.
                file: SAFE_FILE.test(file) ? file : `${item.date}.json`,
                mapCount: Number.isFinite(count) ? count : null
            };
        })
        .sort((a, b) => a.date.localeCompare(b.date));
}

let indexPromise = null;
export function loadHistoryIndex({ fresh = false } = {}) {
    if (fresh || !indexPromise) {
        indexPromise = fetchJson(`${HISTORY_FOLDER}/index.json`)
            .then(normaliseHistoryIndex)
            .catch(error => { indexPromise = null; throw error; });
    }
    return indexPromise;
}

// ---------------------------
// FULL DAY FILES (with calculation traces)
// ---------------------------
const dayCache = new Map();

export function loadHistoryDay(entry) {
    if (!dayCache.has(entry.date)) {
        const promise = fetchJson(`${HISTORY_FOLDER}/${entry.file}`).then(day => {
            if (day?.date && day.date !== entry.date) throw new Error("History date does not match index");
            return day;
        });
        promise.catch(() => dayCache.delete(entry.date));
        dayCache.set(entry.date, promise);
    }
    return dayCache.get(entry.date);
}

export function clearHistoryCache() {
    dayCache.clear();
    summaryPromise = null;
    indexPromise = null;
}

// ---------------------------
// COMPACT HISTORY (every day, no traces)
// ---------------------------
// A compact day is { date, openingElo: { id: elo }, maps: [ { mapId, date, gameMode, game, elo } ] }.
function compactDay(day, date) {
    const openingElo = {};
    Object.entries(day?.openingStats || {}).forEach(([id, p]) => {
        const elo = Number(p?.elo);
        if (Number.isFinite(elo)) openingElo[id] = elo;
    });
    return { date: day?.date || date, openingElo, maps: Array.isArray(day?.maps) ? day.maps : [] };
}

// summary.json is used only when it covers exactly the days (and map counts)
// in index.json. Otherwise it is out of date and the day files are read instead.
function summaryMatches(summary, index) {
    const days = Array.isArray(summary?.days) ? summary.days : null;
    if (!days || days.length !== index.length) return false;
    const byDate = new Map(days.map(d => [d.date, d]));
    return index.every(entry => {
        const day = byDate.get(entry.date);
        if (!day || !Array.isArray(day.maps)) return false;
        return entry.mapCount === null || day.maps.length === entry.mapCount;
    });
}

let summaryPromise = null;

// Every day of history, oldest first, in the compact shape above.
export function loadAllHistory() {
    if (!summaryPromise) {
        summaryPromise = (async () => {
            const index = await loadHistoryIndex();
            try {
                const summary = await fetchJson(`${HISTORY_FOLDER}/summary.json`);
                if (summaryMatches(summary, index)) {
                    const byDate = new Map(summary.days.map(d => [d.date, d]));
                    return index.map(entry => {
                        const day = byDate.get(entry.date);
                        return { date: entry.date, openingElo: day.openingElo || {}, maps: day.maps };
                    });
                }
                console.info("history/summary.json is out of date; reading the day files instead.");
            } catch (_) {
                // No summary published: read the day files.
            }
            const days = await Promise.all(index.map(loadHistoryDay));
            return index.map((entry, i) => compactDay(days[i], entry.date));
        })().catch(error => { summaryPromise = null; throw error; });
    }
    return summaryPromise;
}

// Opening Elo of the newest history day: the baseline for the daily arrows.
// Uses summary.json when it is current, so the big day file is not needed.
async function loadLatestOpeningElo() {
    const index = await loadHistoryIndex();
    const latest = index[index.length - 1];
    if (!latest) return null;
    try {
        const summary = await fetchJson(`${HISTORY_FOLDER}/summary.json`);
        if (summaryMatches(summary, index)) {
            const day = summary.days.find(d => d.date === latest.date);
            if (day?.openingElo && Object.keys(day.openingElo).length) return day.openingElo;
        }
    } catch (_) {
        // fall through to the day file
    }
    return compactDay(await loadHistoryDay(latest), latest.date).openingElo;
}

// ---------------------------
// PLAYERS
// ---------------------------
export function createEmptyPlayerStats() {
    return {
        elo: 0,
        lifetimeKills: 0, lifetimeDeaths: 0,
        mapKills: 0, mapDeaths: 0,
        hpKills: 0, hpDeaths: 0,
        sndKills: 0, sndDeaths: 0,
        overloadKills: 0, overloadDeaths: 0,
        hpWins: 0, hpLosses: 0,
        sndWins: 0, sndLosses: 0,
        overloadWins: 0, overloadLosses: 0,
        hpMarginTotal: 0, hpMarginCount: 0,
        sndMarginTotal: 0, sndMarginCount: 0,
        overloadMarginTotal: 0, overloadMarginCount: 0,
        hpDamage: 0, hpDamageShare: 0,
        sndDamage: 0, sndDamageShare: 0,
        overloadDamage: 0, overloadDamageShare: 0,
        hpLifetimeDamage: 0, hpLifetimeTeamDamage: 0,
        sndLifetimeDamage: 0, sndLifetimeTeamDamage: 0,
        overloadLifetimeDamage: 0, overloadLifetimeTeamDamage: 0
    };
}

export const totalWins = p => (p.hpWins || 0) + (p.sndWins || 0) + (p.overloadWins || 0);
export const totalLosses = p => (p.hpLosses || 0) + (p.sndLosses || 0) + (p.overloadLosses || 0);

export function playerHasActivity(p) {
    return (totalWins(p) + totalLosses(p) + (p.lifetimeKills || 0) + (p.lifetimeDeaths || 0)) > 0;
}

// Ranks players and attaches today's change against the opening ratings.
// Ranking pool = players who are active AND not flagged inactive. Inactive
// players and empty placeholders never take a rank number from, or push
// arrows onto, the pool. They are numbered after it.
export function buildPlayers(currentPlayers, openingElo) {
    const source = { ...currentPlayers };
    PLACEHOLDER_PLAYER_IDS.forEach(id => {
        if (!source[id]) source[id] = createEmptyPlayerStats();
    });

    const players = Object.entries(source).map(([id, p]) => ({
        ...createEmptyPlayerStats(),
        ...p,
        id: Number(id),
        name: getPlayerName(Number(id))
    }));

    const inPool = p => !INACTIVE_PLAYER_IDS.has(p.id) && playerHasActivity(p);
    const byElo = (a, b) => b.elo - a.elo;
    const pool = players.filter(inPool).sort(byElo);
    const rest = players.filter(p => !inPool(p)).sort(byElo);
    pool.forEach((p, i) => { p.currentRank = i + 1; p.inRankPool = true; });
    rest.forEach((p, i) => { p.currentRank = pool.length + i + 1; p.inRankPool = false; });

    const opening = new Map();
    Object.entries(openingElo || {}).forEach(([id, elo]) => {
        if (Number.isFinite(Number(elo))) opening.set(Number(id), Number(elo));
    });
    const openingRank = new Map(
        [...opening.entries()]
            .filter(([id]) => pool.some(p => p.id === id))
            .sort((a, b) => b[1] - a[1])
            .map(([id], i) => [id, i + 1])
    );

    return [...pool, ...rest].map(p => {
        const hasOpening = opening.has(p.id) && Number.isFinite(Number(p.elo));
        const rankComparable = hasOpening && p.inRankPool && openingRank.has(p.id);
        return {
            ...p,
            hasDailyComparison: hasOpening,
            eloChange: hasOpening ? Number(p.elo) - opening.get(p.id) : 0,
            rankChange: rankComparable ? openingRank.get(p.id) - p.currentRank : 0
        };
    });
}

// current_stats.json plus the opening ratings of the newest history day.
// The leaderboard must still load if the history is missing: missing opening
// values produce no comparison arrow, not a false zero change.
export async function loadPlayers() {
    const [current, openingElo] = await Promise.all([
        fetchJson("current_stats.json"),
        loadLatestOpeningElo().catch(error => {
            console.warn("Daily opening Elo unavailable; hiding daily comparison arrows:", error);
            return null;
        })
    ]);
    return buildPlayers(current.players || {}, openingElo);
}
