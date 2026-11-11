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

// One block of rows with a title. Returns its html and how many rows each player won.
//   rows: [label, a's value, b's value, type, better]
let openTab = 0;                 // which block the "tabs" layout shows
const openFolds = new Set();     // which blocks the "fold" layout has open
function section(index, title, a, b, rows) {
    const scoreA = rows.reduce((sum, [, x, y, , better = "higher"]) => sum + compareMetric(x, y, better), 0);
    const scoreB = rows.length - scoreA;
    return {
        scoreA, scoreB, title,
        html: `<div class="comparison-section${index === openTab ? " tab-on" : ""}${openFolds.has(index) ? " open" : ""}" data-section="${index}">
            <div class="comparison-section-title"><span class="cs-name">${title}</span>
                <span class="cs-bar ${scoreA > scoreB ? "a" : scoreB > scoreA ? "b" : ""}"><i style="width:${(scoreA / rows.length * 100).toFixed(0)}%"></i></span>
                <span class="mode-score">${a.name} ${num(scoreA, 1)} — ${num(scoreB, 1)} ${b.name}</span></div>
            <div class="cs-rows">${rows.map(r => row(...r)).join("")}</div>
        </div>`
    };
}

function modeSection(mode, a, b, index) {
    const x = modeNumbers(a, mode);
    const y = modeNumbers(b, mode);
    const metrics = [
        ["KILLS / MAP", "killsPerMap", "number", "higher"],
        ["DEATHS / MAP", "deathsPerMap", "number", "lower"],
        ["MAP WIN %", "mapWinRate", "percent", "higher"],
        ["DAMAGE SHARE", "damageShare", "percent", "higher"],
        [mode.unitLabel, "avgModeUnit", "number", "higher"]
    ];
    return section(index, mode.name.toUpperCase(), a, b, metrics.map(([label, key, type, better]) => [label, x[key], y[key], type, better]));
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

    const kd = p => Number(p.lifetimeDeaths || 0) === 0 ? Number(p.lifetimeKills || 0) : p.lifetimeKills / p.lifetimeDeaths;
    const winRate = p => totalWins(p) / ((totalWins(p) + totalLosses(p)) || 1);
    const overall = section(0, "OVERALL", a, b, [
        ["ELO", a.elo, b.elo],
        ["CURRENT RANK", a.currentRank, b.currentRank, "number", "lower"],
        ["OVERALL RATING", cardRatings(a, players).overall, cardRatings(b, players).overall],
        ["ELO CHANGE", a.eloChange, b.eloChange]
    ]);
    const lifetime = section(1, "LIFETIME", a, b, [
        ["KILLS", a.lifetimeKills, b.lifetimeKills],
        ["DEATHS", a.lifetimeDeaths, b.lifetimeDeaths, "number", "lower"],
        ["K/D", kd(a), kd(b)],
        ["WINS", totalWins(a), totalWins(b)],
        ["LOSSES", totalLosses(a), totalLosses(b), "number", "lower"],
        ["WIN RATE", winRate(a), winRate(b), "percent"]
    ]);
    const modeResults = MODES.map((mode, i) => modeSection(mode, a, b, i + 2));
    const sections = [overall, lifetime, ...modeResults];
    const totalA = modeResults.reduce((sum, r) => sum + r.scoreA, 0);
    const totalB = modeResults.reduce((sum, r) => sum + r.scoreB, 0);

    content.innerHTML = `
        <div class="comparison-card-pair">
            ${cardStage(a)}
            <div class="comparison-vs-card">VS</div>
            ${cardStage(b)}
        </div>

        <div class="comparison-score final-head-to-head ${totalA > totalB ? "a-winner" : totalB > totalA ? "b-winner" : "tie"}">
            <strong>${a.name} ${num(totalA, 1)} — ${num(totalB, 1)} ${b.name}</strong>
            <span>HEAD-TO-HEAD</span>
        </div>

        <!-- the page switch for the "tabs" layout (hidden in the others) -->
        <div class="h2h-tabs">${sections.map((sec, i) => `<button type="button" data-section="${i}" class="${i === openTab ? "on" : ""}">${sec.title === "SEARCH & DESTROY" ? "S&amp;D" : sec.title}</button>`).join("")}</div>
        <div class="h2h-sections">${sections.map(sec => sec.html).join("")}</div>
    `;

    content.querySelectorAll(".comparison-card-stage").forEach(stage => {
        const p = players.find(x => x.id === Number(stage.dataset.playerId));
        if (p) stage.replaceChildren(buildCard(p));
    });
}

export function setupComparisons() {
    ["comparePlayerA", "comparePlayerB"].forEach(id =>
        document.getElementById(id).addEventListener("change", render));
    // "tabs" layout: a button shows one block. "fold" layout: a title opens and closes its block.
    document.getElementById("comparisonContent").addEventListener("click", e => {
        const tab = e.target.closest(".h2h-tabs button"), title = e.target.closest(".comparison-section-title");
        const content = e.currentTarget;
        if (tab) {
            openTab = Number(tab.dataset.section);
            content.querySelectorAll(".h2h-tabs button").forEach(b => b.classList.toggle("on", b === tab));
            content.querySelectorAll(".comparison-section").forEach(sec => sec.classList.toggle("tab-on", Number(sec.dataset.section) === openTab));
        } else if (title && document.documentElement.dataset.h2h === "fold") {
            const sec = title.parentElement, i = Number(sec.dataset.section);
            openFolds.has(i) ? openFolds.delete(i) : openFolds.add(i);
            sec.classList.toggle("open");
        }
    });
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
