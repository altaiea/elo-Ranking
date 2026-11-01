// ===============================
// KNOCKOUT CARD STATS
// ===============================
// The Knockout card counts Captain's Cup maps only. Every one of those maps
// still counts towards the overall card and Elo as normal; this is an extra
// view on top. A map counts when a series in knockout/YYYY-MM.json lists its
// mapId (series.mapIds), or when the history marks it with a "cup" field.
// No page code, so the Three.js game can import it too.

import { getPlayerName } from "./config.js";
import { loadAllHistory, loadAllKnockoutSeries } from "./data.js";
import { statsFromMaps } from "./ratings.js";

let poolPromise = null;

export function isKnockoutMap(map, cupMapIds) {
    return !!map && (!!map.cup || cupMapIds.has(String(map.mapId)));
}

// { players: [...card stats], byId: Map, mapCount }
export function loadKnockoutCardPool() {
    if (!poolPromise) {
        poolPromise = (async () => {
            const [history, series] = await Promise.all([loadAllHistory(), loadAllKnockoutSeries()]);
            const cupMapIds = new Set(series.flatMap(s => (s.mapIds || []).map(String)));
            const maps = history.flatMap(day => day.maps || []).filter(map => isKnockoutMap(map, cupMapIds));
            const players = [...statsFromMaps(maps).values()].map(p => ({ ...p, name: getPlayerName(p.id) }));
            return { players, byId: new Map(players.map(p => [p.id, p])), mapCount: new Set(maps.map(m => m.mapId)).size };
        })().catch(error => { poolPromise = null; throw error; });
    }
    return poolPromise;
}
