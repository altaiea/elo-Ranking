// ===============================
// KNOCKOUT CARD STATS
// ===============================
// The Knockout card counts Captain's Cup maps only. Every one of those maps
// still counts towards the overall card and Elo as normal; this is an extra
// view on top, built beside the existing code rather than inside it.
// A map counts when a series in knockout/YYYY-MM.json lists its mapId
// (series.mapIds), or when the history marks it with a "cup" field.
// No page code, so the Three.js game can import it too.

import { getPlayerName } from "./config.js";
import { createEmptyPlayerStats, loadAllHistory } from "./data.js";
import { buildMonthlyRankings } from "./monthly.js";
import { loadAllKnockoutMonths } from "./knockoutData.js";
import { buildTiers, previousMonthKey, tierKey, tierName } from "./knockoutRules.js";

// Rebuilds the card fields of current_stats.json from history maps, using the
// Elo engine's own rules: margin T = score difference / cap (Hardpoint 200,
// SND 6, Overload 8, at most 1), +T for the winners and -T for the losers,
// and damage = kills x 100 (the engine's legacy damage).
const MODE_PREFIX_BY_NAME = { Hardpoint: "hp", SND: "snd", Overload: "overload" };
const MARGIN_CAP = { hp: 200, snd: 6, overload: 8 };

export function statsFromMaps(maps) {
    const out = new Map();
    const seen = new Set();
    for (const m of maps) {
        if (!m || seen.has(m.mapId)) continue;
        seen.add(m.mapId);
        const prefix = MODE_PREFIX_BY_NAME[m.gameMode];
        const result = m.game?.result || {};
        const win = Number(result.winningTeam);
        if (!prefix || (win !== 1 && win !== 2)) continue;
        const t = Math.min(1, (Number(result.scoreDifference) || 0) / MARGIN_CAP[prefix]);
        [["A", 1], ["B", 2]].forEach(([key, teamNo]) => {
            const team = (m.game.teams || {})[key] || [];
            const teamKills = team.reduce((sum, pl) => sum + (Number(pl.kills) || 0), 0);
            const won = win === teamNo;
            team.forEach(pl => {
                const id = Number(pl.playerId);
                if (!out.has(id)) out.set(id, { ...createEmptyPlayerStats(), id, mapsPlayed: 0 });
                const s = out.get(id);
                const k = Number(pl.kills) || 0, d = Number(pl.deaths) || 0;
                s.mapsPlayed += 1;
                s.lifetimeKills += k; s.lifetimeDeaths += d;
                s[prefix + "Kills"] += k; s[prefix + "Deaths"] += d;
                s[prefix + (won ? "Wins" : "Losses")] += 1;
                s[prefix + "MarginTotal"] += won ? t : -t;
                s[prefix + "MarginCount"] += 1;
                s[prefix + "LifetimeDamage"] += k * 100;
                s[prefix + "LifetimeTeamDamage"] += teamKills * 100;
            });
        });
    }
    return out;
}

// The tiers of one cup month: the file's own override, or the previous
// month's final Monthly Rankings.
export function tiersForMonth(history, monthKey, override) {
    if (Array.isArray(override) && override.length) {
        return override.map((ids, index) => ({ index, key: tierKey(index), name: tierName(index), playerIds: ids.map(Number) }));
    }
    const ranked = buildMonthlyRankings(history, previousMonthKey(monthKey)).records.filter(r => r.qualified);
    return buildTiers(ranked.map(r => r.playerId));
}

let poolPromise = null;

// { players: [...card stats with .tier and .month], byId: Map, mapCount }
// .tier / .month are the most recent cup month the player captained or played in.
export function loadKnockoutCardPool() {
    if (!poolPromise) {
        poolPromise = (async () => {
            const [history, months] = await Promise.all([loadAllHistory(), loadAllKnockoutMonths()]);
            const cupMapIds = new Set(months.flatMap(f => f.series.flatMap(s => (s.mapIds || []).map(String))));
            const maps = history.flatMap(day => day.maps || []).filter(m => m && (m.cup || cupMapIds.has(String(m.mapId))));
            const stats = statsFromMaps(maps);

            // Where each player last fought: their tier in the latest month with cup maps.
            const placed = new Map();
            for (const file of months) {
                const ids = new Set(file.series.flatMap(s => (s.mapIds || []).map(String)));
                const monthMaps = maps.filter(m => ids.has(String(m.mapId)) || String(m.date || "").startsWith(file.month));
                if (!monthMaps.length) continue;
                const tiers = tiersForMonth(history, file.month, file.tiers);
                const tierOf = new Map(tiers.flatMap(t => t.playerIds.map(id => [id, t])));
                monthMaps.forEach(m => ["A", "B"].forEach(k => ((m.game?.teams || {})[k] || []).forEach(pl => {
                    const id = Number(pl.playerId);
                    placed.set(id, { month: file.month, tier: tierOf.get(id) || null });
                })));
            }

            const players = [...stats.values()].map(p => ({ ...p, name: getPlayerName(p.id), ...(placed.get(p.id) || {}) }));
            players.sort((a, b) => (a.tier?.index ?? 99) - (b.tier?.index ?? 99) || b.mapsPlayed - a.mapsPlayed);
            return { players, byId: new Map(players.map(p => [p.id, p])), mapCount: new Set(maps.map(m => m.mapId)).size };
        })().catch(error => { poolPromise = null; throw error; });
    }
    return poolPromise;
}
