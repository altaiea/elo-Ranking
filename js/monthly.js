/* ======================================================
   MONTHLY RANKINGS (Leaderboard tab button)
   For every map a player personally played in the month: where they stood on
   the overall Elo leaderboard straight after it. Players are ranked by maps in
   1st, then 2nd, then 3rd, and so on.
====================================================== */
import { getPlayerName } from "./config.js";
import { loadAllHistory, loadHistoryIndex } from "./data.js";
import { formatElo, monthKeyOf, monthLabel, ordinal, showPopup } from "./ui.js";

const MIN_MAPS_FOR_RANKING = 10;

function emptyRecord(playerId) {
    return {
        playerId: Number(playerId),
        name: getPlayerName(Number(playerId)),
        wins: 0,
        losses: 0,
        mapsPlayed: 0,
        highestElo: null,
        positionCounts: {}
    };
}

function positionVector(record, maxPosition) {
    const values = [];
    for (let position = 1; position <= maxPosition; position += 1) values.push(Number(record.positionCounts[position] || 0));
    return values;
}

function compareRecords(a, b, maxPosition) {
    const av = positionVector(a, maxPosition);
    const bv = positionVector(b, maxPosition);
    for (let i = 0; i < maxPosition; i += 1) {
        if (av[i] !== bv[i]) return bv[i] - av[i];
    }
    return String(a.name).localeCompare(String(b.name));
}

function sameStanding(a, b, maxPosition) {
    if (!a || !b) return false;
    for (let position = 1; position <= maxPosition; position += 1) {
        if (Number(a.positionCounts[position] || 0) !== Number(b.positionCounts[position] || 0)) return false;
    }
    return true;
}

function teamForPlayer(game, playerId) {
    const teams = game?.teams || {};
    for (const key of ["A", "B"]) {
        if ((teams[key] || []).some(player => Number(player.playerId) === Number(playerId))) return key;
    }
    return null;
}

function teamWonMap(game, teamKey) {
    const winningTeam = Number(game?.result?.winningTeam);
    return (teamKey === "A" && winningTeam === 1) || (teamKey === "B" && winningTeam === 2);
}

export function buildMonthlyRankings(days, monthKey) {
    const matchingDays = days.filter(day => String(day.date).startsWith(`${monthKey}-`));
    const records = new Map();
    const currentElo = new Map();
    const seenMaps = new Set();
    let mapCount = 0;
    let maxPosition = 0;

    for (const day of matchingDays) {
        // Each day records the complete leaderboard at its opening. Never use
        // today's current_stats.json as the baseline for an older month.
        const opening = day.openingElo;
        if (!opening || !Object.keys(opening).length) {
            throw new Error(`No opening leaderboard for ${day.date}; its monthly positions cannot be reconstructed reliably.`);
        }
        currentElo.clear();
        Object.entries(opening).forEach(([id, elo]) => {
            if (Number.isFinite(Number(elo))) currentElo.set(String(id), Number(elo));
        });
        if (!currentElo.size) throw new Error(`No valid opening ratings for ${day.date}.`);

        // The published per-day array keeps the engine's import order. Do not
        // re-sort it, or the Elo sequence would change.
        for (const map of day.maps) {
            const mapKey = String(map?.mapId || map?.fingerprint || "");
            if (mapKey && seenMaps.has(mapKey)) continue;
            if (mapKey) seenMaps.add(mapKey);
            const eloRows = Array.isArray(map?.elo) ? map.elo : [];
            if (!eloRows.length) continue;
            if (!String(map?.date || day.date).startsWith(`${monthKey}-`)) continue;

            const participants = new Set();
            for (const row of eloRows) {
                const playerId = Number(row?.playerId);
                const after = Number(row?.after);
                if (!Number.isInteger(playerId) || !Number.isFinite(after)) continue;
                participants.add(playerId);
                currentElo.set(String(playerId), after);
            }
            if (!participants.size) continue;
            mapCount += 1;

            // Same order as the main leaderboard: all ratings, descending, stable ties.
            const rankedIds = [...currentElo.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => Number(id));
            const rankById = new Map(rankedIds.map((id, index) => [id, index + 1]));
            maxPosition = Math.max(maxPosition, rankedIds.length);

            for (const row of eloRows) {
                const playerId = Number(row?.playerId);
                if (!participants.has(playerId)) continue;
                const teamKey = teamForPlayer(map?.game, playerId);
                if (!teamKey) continue; // Only actual participants earn map counts.
                if (!records.has(playerId)) records.set(playerId, emptyRecord(playerId));
                const record = records.get(playerId);
                const position = rankById.get(playerId);
                if (position) record.positionCounts[position] = (record.positionCounts[position] || 0) + 1;
                record.mapsPlayed += 1;
                for (const value of [Number(row.before), Number(row.after)]) {
                    if (Number.isFinite(value) && (record.highestElo === null || value > record.highestElo)) record.highestElo = value;
                }
                if (teamWonMap(map.game, teamKey)) record.wins += 1;
                else record.losses += 1;
            }
        }
    }

    // Eligibility changes monthly placement only, never Elo or position counts.
    const sorted = [...records.values()].sort((a, b) => {
        const aQualified = a.mapsPlayed >= MIN_MAPS_FOR_RANKING;
        const bQualified = b.mapsPlayed >= MIN_MAPS_FOR_RANKING;
        if (aQualified !== bQualified) return aQualified ? -1 : 1;
        return compareRecords(a, b, maxPosition);
    });
    let previous = null, displayedRank = 0, qualifiedIndex = 0;
    sorted.forEach(record => {
        record.qualified = record.mapsPlayed >= MIN_MAPS_FOR_RANKING;
        if (!record.qualified) { record.monthlyRank = null; return; }
        qualifiedIndex += 1;
        if (!sameStanding(record, previous, maxPosition)) displayedRank = qualifiedIndex;
        record.monthlyRank = displayedRank;
        previous = record;
    });
    return { monthKey, records: sorted, maxPosition, mapCount };
}

function positionBreakdown(record, maxPosition) {
    const largest = Math.max(1, ...Object.values(record.positionCounts || {}).map(Number));
    const lines = [];
    for (let position = 1; position <= maxPosition; position += 1) {
        const count = Number(record.positionCounts[position] || 0);
        if (!count) continue;
        lines.push(`<div class="monthly-position-line">
            <span>${ordinal(position)}</span>
            <div class="monthly-position-track"><div class="monthly-position-fill${position === 1 ? " monthly-position-first" : ""}" style="width:${(count / largest) * 100}%"></div></div>
            <strong>${count}</strong>
        </div>`);
    }
    return lines.join("") || "No counted positions.";
}

async function renderMonth(monthKey) {
    const content = document.getElementById("monthlyRankingsBody");
    if (!content) return;
    content.classList.remove("monthly-empty");
    content.innerHTML = `<div class="monthly-loading">Loading ${monthLabel(monthKey)}…</div>`;
    try {
        const monthly = buildMonthlyRankings(await loadAllHistory(), monthKey);
        if (!monthly.records.length) {
            content.innerHTML = `<div class="monthly-empty">No approved map history is available for ${monthLabel(monthKey)}.</div>`;
            return;
        }
        const status = monthKey === monthKeyOf(new Date()) ? "In progress" : "Final report";
        const more = r => MIN_MAPS_FOR_RANKING - r.mapsPlayed;
        content.innerHTML = `
            <div class="monthly-summary"><span class="monthly-report-status">${status} · ${monthLabel(monthKey)}</span> · ${monthly.mapCount} approved map${monthly.mapCount === 1 ? "" : "s"} recorded · Minimum ${MIN_MAPS_FOR_RANKING} personally played maps to qualify</div>
            <div class="monthly-table-wrap">
                <table class="monthly-table">
                    <thead><tr><th>Rank</th><th>Player</th><th>Maps in 1st</th><th>W/L</th><th>Peak Elo</th></tr></thead>
                    <tbody>
                        ${monthly.records.map(record => `<tr class="monthly-player-row" data-monthly-player="${record.playerId}" tabindex="0" role="button" aria-expanded="false">
                                <td class="monthly-rank">${record.qualified ? record.monthlyRank : '<span class="monthly-provisional">Provisional</span>'}</td>
                                <td class="monthly-player-name">${record.name}</td>
                                <td class="monthly-first-count">${Number(record.positionCounts[1] || 0)}</td>
                                <td>${record.wins}–${record.losses}</td>
                                <td>${formatElo(record.highestElo)}</td>
                            </tr>
                            <tr class="monthly-breakdown-row" data-monthly-breakdown="${record.playerId}" hidden>
                                <td colspan="5">
                                    <div class="monthly-player-summary">${record.mapsPlayed} maps played · ${record.wins}–${record.losses} W/L · Peak Elo ${formatElo(record.highestElo)}${record.qualified ? "" : ` · ${more(record)} more map${more(record) === 1 ? "" : "s"} to qualify`}</div>
                                    <div class="monthly-position-breakdown">${positionBreakdown(record, monthly.maxPosition)}</div>
                                </td>
                            </tr>`).join("")}
                    </tbody>
                </table>
            </div>`;
        content.querySelectorAll(".monthly-player-row").forEach(row => {
            const toggle = () => {
                const detail = content.querySelector(`[data-monthly-breakdown="${row.dataset.monthlyPlayer}"]`);
                detail.hidden = !detail.hidden;
                row.setAttribute("aria-expanded", String(!detail.hidden));
            };
            row.addEventListener("click", toggle);
            row.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
            });
        });
    } catch (error) {
        content.textContent = `Monthly rankings could not be loaded: ${String(error.message || error)}`;
        content.classList.add("monthly-empty");
    }
}

export async function openMonthlyRankings() {
    try {
        const days = await loadHistoryIndex();
        const currentMonth = monthKeyOf(new Date());
        const months = [...new Set(days.map(day => String(day.date).slice(0, 7)))]
            .filter(month => /^\d{4}-\d{2}$/.test(month) && month <= currentMonth).sort().reverse();
        // On the first of every month the last completed month becomes the
        // default final report. The ongoing month remains selectable.
        const selected = months.find(month => month < currentMonth) || months[0] || currentMonth;
        const selectable = months.length ? months : [currentMonth];
        showPopup(`
            <div class="monthly-rankings-popup">
                <div class="monthly-popup-header">
                    <div>
                        <h2>Monthly Rankings</h2>
                        <p>Maps personally played at each overall Elo position after the map. Rankings compare maps in 1st, then 2nd, then 3rd.</p>
                    </div>
                    <label class="monthly-month-label">Month
                        <select id="monthlyMonthSelect">${selectable.map(month => `<option value="${month}" ${month === selected ? "selected" : ""}>${monthLabel(month)}${month === currentMonth ? " · In progress" : " · Final"}</option>`).join("")}</select>
                    </label>
                </div>
                <div id="monthlyRankingsBody"></div>
            </div>`, { className: "monthly-popup-card" });
        const select = document.getElementById("monthlyMonthSelect");
        select.addEventListener("change", () => renderMonth(select.value));
        renderMonth(selected);
    } catch (error) {
        showPopup(`<div class="monthly-rankings-popup"><h2>Monthly Rankings</h2><div class="monthly-empty">Monthly rankings could not be loaded.</div></div>`,
            { className: "monthly-popup-card" });
        console.error("Could not open monthly rankings:", error);
    }
}
