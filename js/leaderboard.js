// ===============================
// LEADERBOARD TAB
// ===============================
import { INACTIVE_PLAYER_IDS, cardAssets } from "./config.js";
import { playerHasActivity, totalLosses, totalWins } from "./data.js";
import { kdColor } from "./ui.js";
import { lastMonthWinner } from "./monthWinner.js";

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
    renderPodiumAndTiles(shown);
}

// ---------------------------
// PODIUM AND TILES
// ---------------------------
// What you see: the top three as a podium, everyone else as a tile.
// The table above is still filled in but hidden (seamless.css); the card hand reads it.
function renderPodiumAndTiles(shown) {
    let box = document.getElementById("lbAlt");
    if (!box) {
        box = document.createElement("div");
        box.id = "lbAlt";
        document.getElementById("leaderboard").before(box);
        // Only a player's name navigates to their card.
        box.addEventListener("click", e => {
            const item = e.target.closest(".lb-pod-name, .lb-t-name");
            const cell = item && document.querySelector(`#table-body .player-name[data-id="${item.dataset.id}"]`);
            if (cell) cell.click();
        });
    }
    const numbers = p => {
        const wins = totalWins(p), losses = totalLosses(p);
        const wl = losses ? wins / losses : wins, kd = p.lifetimeDeaths ? p.lifetimeKills / p.lifetimeDeaths : p.lifetimeKills;
        const today = !p.hasDailyComparison || !p.eloChange ? "<span></span>" :
            `<span class="${p.eloChange > 0 ? "arrow-up" : "arrow-down"}">${p.eloChange > 0 ? "▲" : "▼"} ${Math.abs(p.eloChange).toFixed(1)}</span>`;
        return { wins, losses, wl, kd, today };
    };
    const good = (value, text) => `<b style="color:${value >= 1 ? "#3ddc68" : "#ff5a4f"}">${text}</b>`;

    const podium = [shown[1], shown[0], shown[2]].filter(Boolean).map(p => {
        const n = numbers(p);
        return `<div class="lb-pod lb-pod-${p.currentRank}" data-id="${p.id}">
            <span class="lb-mini lb-pod-card" data-mini="${p.id}"><img src="${cardAssets.thumb(p.id)}" alt="" loading="lazy"></span>
            <span class="lb-pod-place">${p.currentRank}</span>
            <button type="button" class="lb-pod-name" data-id="${p.id}" aria-label="Open ${p.name} card">${p.name}</button>
            <span class="lb-pod-elo">${Math.round(p.elo)} ${n.today}</span>
            <span class="lb-pod-stats"><span>${good(n.wl, n.wl.toFixed(2))}<i>W/L</i></span><span><b>${n.wins}-${n.losses}</b><i>RECORD</i></span><span>${good(n.kd, n.kd.toFixed(2))}<i>K/D</i></span></span>
        </div>`;
    }).join("");

    // Elo meter: 12 blocks. The top player fills all of them; the scale starts a little under the lowest player.
    const BLOCKS = 12;
    const elos = shown.map(p => p.elo), low = Math.min(...elos) - 40, high = Math.max(...elos);
    const meter = p => {
        const lit = Math.max(1, Math.round((p.elo - low) / ((high - low) || 1) * BLOCKS));
        return `<span class="lb-bar">${Array.from({ length: BLOCKS }, (_, i) => `<i class="${i < lit ? "on" : ""}"></i>`).join("")}</span>`;
    };
    const tiles = shown.slice(3).map(p => {
        const n = numbers(p);
        return `<div class="lb-tile" data-id="${p.id}">
            <span class="lb-t-rank">${p.currentRank}</span>
            <span class="lb-mini lb-t-card" data-mini="${p.id}"><img src="${cardAssets.thumb(p.id)}" alt="" loading="lazy"></span>
            <button type="button" class="lb-t-name" data-id="${p.id}" aria-label="Open ${p.name} card">${p.name}</button>
            <span class="lb-t-elo"><b>${Math.round(p.elo)}</b>${n.today}${meter(p)}</span>
            <span class="lb-t-stat">${good(n.wl, n.wl.toFixed(2))}<i>W/L<em> · ${n.wins}-${n.losses}</em></i></span>
            <span class="lb-t-stat">${good(n.kd, n.kd.toFixed(2))}<i>K/D</i></span>
        </div>`;
    }).join("");
    box.innerHTML = `<div class="lb-podium">${podium}</div><div class="lb-tiles">${tiles}</div>`;
    // last month's number one: wings on their mini card too
    lastMonthWinner().then(id => box.querySelectorAll(`.lb-mini[data-mini="${id}"]`).forEach(el => el.classList.add("winged")));
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
