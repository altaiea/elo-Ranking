// ===============================
// LEADERBOARD TAB
// ===============================
import { INACTIVE_PLAYER_IDS } from "./config.js";
import { playerHasActivity, totalLosses, totalWins } from "./data.js";
import { kdColor } from "./ui.js";

let players = [];
let showInactive = false;

// Arrow, colour class and dropdown text for a daily change.
function changeDisplay(p, change, digits) {
    if (!p.hasDailyComparison) return { thick: "—", cls: "arrow-none", thin: "No opening stats" };
    const shown = digits === null ? Math.abs(change) : Math.abs(change).toFixed(digits);
    if (change > 0) return { thick: "▲", cls: "arrow-up", thin: `↑ ${shown}` };
    if (change < 0) return { thick: "▼", cls: "arrow-down", thin: `↓ ${shown}` };
    return { thick: "—", cls: "arrow-none", thin: digits === null ? "– 0" : `– ${(0).toFixed(digits)}` };
}

function rowHtml(p) {
    const rank = changeDisplay(p, p.rankChange, null);
    const elo = changeDisplay(p, p.eloChange, 2);

    const wins = totalWins(p);
    const losses = totalLosses(p);
    const wl = losses === 0 ? wins : (wins / losses).toFixed(2);
    const kd = p.lifetimeDeaths === 0 ? p.lifetimeKills : (p.lifetimeKills / p.lifetimeDeaths).toFixed(2);

    // Medals (via CSS) replace the number for the top three.
    return `
<td class="rank">
    <div class="rank-container" data-dropdown>
        ${p.currentRank <= 3 ? "" : `<span class="rank-number" style="margin-right:6px;">${p.currentRank}</span>`}
        <span class="rank-arrow ${rank.cls} rank-arrow-btn" style="margin-left:6px;" data-dropdown-toggle>${rank.thick}</span>
        <div class="rank-dropdown"><div class="${rank.cls}">${rank.thin}</div></div>
    </div>
</td>
<td class="player-name" data-id="${p.id}">${p.name}</td>
<td class="elo-gold">
    <div class="elo-container" data-dropdown>
        <span class="elo-number">${p.elo.toFixed(2)}</span>
        <span class="elo-arrow ${elo.cls} elo-arrow-btn" data-dropdown-toggle>${elo.thick}</span>
        <div class="elo-dropdown"><div class="${elo.cls}">${elo.thin}</div></div>
    </div>
</td>
<td>
    <div class="wl-container" data-dropdown>
        <span class="wl-main" style="color:${wl >= 1 ? "#00ff00" : "#ff3c3c"}">${wl}</span>
        <span class="wl-arrow" data-dropdown-toggle>▼</span>
        <div class="wl-dropdown">
            <div class="wl-win">W ${wins}</div>
            <div class="wl-loss">L ${losses}</div>
        </div>
    </div>
</td>
<td><span class="kd-val" style="color:${kdColor(parseFloat(kd))}">${kd}</span></td>`;
}

function renderTable() {
    const tbody = document.getElementById("table-body");
    // Explicitly inactive players appear only when "Show Inactive Players" is on.
    // Their stored stats remain intact.
    const shown = players
        .filter(p => showInactive || (playerHasActivity(p) && !INACTIVE_PLAYER_IDS.has(p.id)))
        .sort((a, b) => a.currentRank - b.currentRank);

    tbody.replaceChildren(...shown.map(p => {
        const tr = document.createElement("tr");
        tr.innerHTML = rowHtml(p);
        return tr;
    }));
}

export function setupLeaderboard() {
    const toggle = document.getElementById("toggleInactive");
    toggle.addEventListener("change", () => {
        showInactive = toggle.checked;
        renderTable();
    });
}

export function showLeaderboard(list) {
    players = list;
    renderTable();
}

export function showLeaderboardError(message) {
    const tbody = document.getElementById("table-body");
    tbody.innerHTML = `<tr><td colspan="5" class="leaderboard-message">${message}</td></tr>`;
}
