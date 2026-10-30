/* ======================================================
   HEAD-TO-HEAD TAB
====================================================== */
import { MODES } from "./config.js";
import { totalLosses, totalWins } from "./data.js";
import { cardRatings } from "./ratings.js";
import { fillCard } from "./playerCard.js";

let players = [];

const num = (value, decimals = 2) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
};
const percent = value => `${(Number(value || 0) * 100).toFixed(1)}%`;
const ratio = (kills, deaths) => Number(deaths || 0) === 0 ? num(kills) : num(Number(kills || 0) / Number(deaths));

function modeNumbers(p, mode) {
    const get = key => Number(p[mode.prefix + key] || 0);
    const maps = get("Wins") + get("Losses");
    const marginCount = get("MarginCount");
    const teamDamage = get("LifetimeTeamDamage");
    return {
        killsPerMap: maps ? get("Kills") / maps : 0,
        deathsPerMap: maps ? get("Deaths") / maps : 0,
        mapWinRate: maps ? get("Wins") / maps : 0,
        damageShare: teamDamage ? get("LifetimeDamage") / teamDamage : 0,
        // Same AvgM conversion as the mode panel.
        avgModeUnit: (marginCount ? get("MarginTotal") / marginCount : 0) * mode.marginScale
    };
}

// 1 point to the better player, half each for a tie.
function compareMetric(a, b, better) {
    const av = Number(a || 0), bv = Number(b || 0);
    if (av === bv) return 0.5;
    return better === "higher" ? (av > bv ? 1 : 0) : (av < bv ? 1 : 0);
}

function row(label, a, b, type = "number", better = "higher") {
    const numeric = type === "number" || type === "percent";
    const av = numeric ? Number(a || 0) : String(a);
    const bv = numeric ? Number(b || 0) : String(b);
    let aBetter = false, bBetter = false;
    if (numeric && av !== bv) {
        aBetter = better === "higher" ? av > bv : av < bv;
        bBetter = !aBetter;
    }
    const format = v => type === "percent" ? percent(v) : type === "number" ? num(v) : v;
    return `<div class="comparison-row">
        <div class="comparison-value left ${aBetter ? "better" : ""}">${format(av)}</div>
        <div class="comparison-label">${label}</div>
        <div class="comparison-value right ${bBetter ? "better" : ""}">${format(bv)}</div>
    </div>`;
}

function modeSection(mode, a, b) {
    const x = modeNumbers(a, mode);
    const y = modeNumbers(b, mode);
    const metrics = [
        ["KILLS / MAP", "killsPerMap", "number", "higher"],
        ["DEATHS / MAP", "deathsPerMap", "number", "lower"],
        ["MAP WIN %", "mapWinRate", "percent", "higher"],
        ["DAMAGE SHARE", "damageShare", "percent", "higher"],
        [mode.unitLabel, "avgModeUnit", "number", "higher"]
    ];
    const scoreA = metrics.reduce((sum, [, key, , better]) => sum + compareMetric(x[key], y[key], better), 0);
    const scoreB = metrics.length - scoreA;
    return {
        scoreA,
        scoreB,
        html: `<div class="comparison-section">
            <div class="comparison-section-title">${mode.name.toUpperCase()} <span class="mode-score">${a.name} ${num(scoreA, 1)} — ${num(scoreB, 1)} ${b.name}</span></div>
            ${metrics.map(([label, key, type, better]) => row(label, x[key], y[key], type, better)).join("")}
        </div>`
    };
}

function cardStage(p) {
    return `
        <div class="comparison-card-wrap">
            <div class="comparison-card-name">${p.name}</div>
            <div class="comparison-card-stage" data-player-id="${p.id}"></div>
        </div>`;
}

// A face-up copy of the popup card, without the intro video.
function buildCard(p) {
    const container = document.querySelector("#playerModal .container").cloneNode(true);
    container.removeAttribute("id");
    const card = container.querySelector(".card");
    card.querySelector(".card-back-video")?.remove();
    fillCard(card, p, players).forEach(el => { el.style.visibility = "visible"; });
    card.querySelector(".back").style.opacity = "1";
    card.classList.add("flipped");
    return container;
}

function render() {
    const aId = Number(document.getElementById("comparePlayerA").value);
    const bId = Number(document.getElementById("comparePlayerB").value);
    const empty = document.getElementById("comparisonEmpty");
    const content = document.getElementById("comparisonContent");

    const a = players.find(p => p.id === aId);
    const b = players.find(p => p.id === bId);
    if (!a || !b || aId === bId) {
        empty.textContent = aId && bId && aId === bId
            ? "Select two different players to compare."
            : "Select two players to begin.";
        empty.style.display = "block";
        content.style.display = "none";
        return;
    }

    empty.style.display = "none";
    content.style.display = "grid";

    const modeResults = MODES.map(mode => modeSection(mode, a, b));
    const totalA = modeResults.reduce((sum, r) => sum + r.scoreA, 0);
    const totalB = modeResults.reduce((sum, r) => sum + r.scoreB, 0);
    const winRate = p => totalWins(p) / ((totalWins(p) + totalLosses(p)) || 1);

    content.innerHTML = `
        <div class="comparison-card-pair">
            ${cardStage(a)}
            <div class="comparison-vs-card">VS</div>
            ${cardStage(b)}
        </div>

        <div class="comparison-score final-head-to-head ${totalA > totalB ? "a-winner" : totalB > totalA ? "b-winner" : "tie"}">
            <strong>${a.name} ${num(totalA, 1)} — ${num(totalB, 1)} ${b.name}</strong>
            <span>HEAD-TO-HEAD</span>
            <small>15 points across 3 modes · 5 metrics per mode</small>
        </div>

        <div class="comparison-section">
            <div class="comparison-section-title">OVERALL</div>
            ${row("ELO", a.elo, b.elo)}
            ${row("CURRENT RANK", a.currentRank, b.currentRank, "number", "lower")}
            ${row("OVERALL RATING", cardRatings(a, players).overall, cardRatings(b, players).overall)}
            ${row("ELO CHANGE", a.eloChange, b.eloChange)}
        </div>

        <div class="comparison-section">
            <div class="comparison-section-title">LIFETIME</div>
            ${row("KILLS", a.lifetimeKills, b.lifetimeKills)}
            ${row("DEATHS", a.lifetimeDeaths, b.lifetimeDeaths, "number", "lower")}
            ${row("K/D", ratio(a.lifetimeKills, a.lifetimeDeaths), ratio(b.lifetimeKills, b.lifetimeDeaths), "text")}
            ${row("WINS", totalWins(a), totalWins(b))}
            ${row("LOSSES", totalLosses(a), totalLosses(b), "number", "lower")}
            ${row("WIN RATE", winRate(a), winRate(b), "percent")}
        </div>

        ${modeResults.map(r => r.html).join("")}
    `;

    content.querySelectorAll(".comparison-card-stage").forEach(stage => {
        const p = players.find(x => x.id === Number(stage.dataset.playerId));
        if (p) stage.replaceChildren(buildCard(p));
    });
}

export function setupComparisons() {
    ["comparePlayerA", "comparePlayerB"].forEach(id =>
        document.getElementById(id).addEventListener("change", render));
}

export function showComparisons(list) {
    players = list;
    const sorted = list.slice().sort((x, y) => x.name.localeCompare(y.name));
    ["comparePlayerA", "comparePlayerB"].forEach(id => {
        const select = document.getElementById(id);
        const selected = select.value;
        select.innerHTML = `<option value="">Select player</option>` +
            sorted.map(p => `<option value="${p.id}"${String(p.id) === selected ? " selected" : ""}>${p.name}</option>`).join("");
    });
    render();
}
