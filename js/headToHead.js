/* ======================================================
   HEAD-TO-HEAD TAB (Players > Head-to-Head)
   Two players side by side: their cards, then LIFETIME and one section per mode,
   each with its rows under Record / Gunfights / Objective headings.
   Each scored row gives 1 point to the better player (half each for a tie), and the
   points add up to the big score. Every map the two played on opposite teams (since
   29 May, rebuilt maps included) is counted as rows in those same sections: the
   map wins against each other in LIFETIME and per mode.
   The two players come from the hidden <select>s, filled by the card picker
   above (js/headToHeadPicker.js).
====================================================== */
import { MODES } from "./config.js";
import { loadAllHistory, loadRebuiltDays, totalLosses, totalWins } from "./data.js";
import { fillCard } from "./playerCard.js";

let players = [];

// ---------------------------
// EXTRA STATS (Nov 2026)
// ---------------------------
// Per-map averages of the extra stats the video parser reads (scoreboard photos
// fill the same ones). Only maps where a player's stat was read count, and a row
// is shown only when both players have it.
//   [label, key, group]: group is where the row sits in the mode section (see GROUPS)
const EXTRA_ROWS = {
    hp: [["SCORE / MAP", "score", "obj"], ["OBJ SCORE / MAP", "objScore", "obj"], ["HILL TIME / MAP (S)", "time", "obj"],
         ["CAPTURES / MAP", "captures", "obj"], ["OBJ KILLS / MAP", "objectiveKills", "fight"]],
    snd: [["SCORE / MAP", "score", "obj"], ["OBJ SCORE / MAP", "objScore", "obj"], ["PLANTS / MAP", "plants", "obj"],
          ["DEFUSES / MAP", "defuses", "obj"], ["OBJ KILLS / MAP", "objectiveKills", "fight"]],
    overload: [["SCORE / MAP", "score", "obj"], ["OBJ SCORE / MAP", "objScore", "obj"], ["OVERLOADS / MAP", "overloads", "obj"],
               ["OBJ KILLS / MAP", "objectiveKills", "fight"]]
};
// The small headings inside a section, in order.
const GROUPS = { record: "RECORD", fight: "GUNFIGHTS", obj: "OBJECTIVE" };
const GAME_MODE_PREFIX = { Hardpoint: "hp", SND: "snd", Overload: "overload" };
let extraAverages = null;      // prefix -> playerId -> stat -> { total, maps }
let extraLoading = null;

// ---------------------------
// MAPS AGAINST EACH OTHER (27 Nov 2026)
// ---------------------------
// Every map two players played on opposite teams, and who won it, overall and per mode
// (g = maps, d = maps with a known winner, w = the lower id's wins). Covers every map since
// 29 May 2026: the site history (20 Sep on) and the 462 maps rebuilt from the stats
// snapshots (data/rebuilt-days.json). The per-mode wins are scored rows in the mode sections.
let pairRecords = null;        // "low-high" -> { g, w, d, modes: { prefix: {g, w, d} } }
let pairLoading = null;

function loadPairRecords() {
    if (pairLoading) return pairLoading;
    pairLoading = Promise.all([loadAllHistory(), loadRebuiltDays()]).then(([days, rebuilt]) => {
        const out = new Map(), seen = new Set();
        const add = (rec, mode, won) => {
            mode = GAME_MODE_PREFIX[mode] || mode;          // "SND" -> "snd", keyed like MODES[].prefix
            const m = rec.modes[mode] || (rec.modes[mode] = { g: 0, w: 0, d: 0 });
            rec.g++; m.g++;
            if (won >= 0) { rec.d++; rec.w += won; m.d++; m.w += won; }
        };
        const pair = (x, y) => {
            const k = Math.min(x, y) + "-" + Math.max(x, y);
            return out.get(k) || out.set(k, { g: 0, w: 0, d: 0, modes: {} }).get(k);
        };
        const count = (id, mode, A, B, win) => {
            if (!id || seen.has(id)) return;
            seen.add(id);
            A.forEach(x => B.forEach(y => {              // opposite teams; "won" from the lower id's side
                const lowOnA = Math.min(x, y) === x;
                add(pair(x, y), mode, !win ? -1 : (win === 1) === lowOnA ? 1 : 0);
            }));
        };
        rebuilt.concat(days).forEach(day => (day.maps || []).forEach(map => {
            const g = map.game || {}, teams = g.teams || {};
            count(map.mapId, map.gameMode || g.gameMode, (teams.A || []).map(p => Number(p.playerId)),
                (teams.B || []).map(p => Number(p.playerId)), g.result && g.result.winningTeam);
        }));
        pairRecords = out;
        render();
    }).catch(error => {
        console.warn("Head-to-head map record unavailable:", error);
    });
    return pairLoading;
}

// a's wins and b's wins in a set of maps against each other (q = a record or one mode of it)
function winsOf(q, a, b) {
    return a.id < b.id ? [q.w, q.d - q.w] : [q.d - q.w, q.w];
}

// The two players' record on opposite teams, or null if they never met.
function versus(a, b) {
    const rec = pairRecords && pairRecords.get(Math.min(a.id, b.id) + "-" + Math.max(a.id, b.id));
    return rec && rec.d ? rec : null;
}

// The scored row for one mode: who won more of the maps they played against each other.
function versusRow(mode, a, b) {
    const rec = versus(a, b), q = rec && rec.modes[mode.prefix];
    return q && q.d ? [`MAP WINS VS EACH OTHER (${q.d})`, ...winsOf(q, a, b), "number", "higher", "record"] : null;
}

function loadExtraAverages() {
    if (extraLoading) return extraLoading;
    extraLoading = loadAllHistory().then(days => {
        const out = { hp: {}, snd: {}, overload: {} };
        days.forEach(day => (day.maps || []).forEach(map => {
            const prefix = GAME_MODE_PREFIX[map.gameMode || map.game?.gameMode];
            const stats = map.extras?.players;
            if (!prefix || !stats) return;
            Object.entries(stats).forEach(([id, values]) => {
                const player = out[prefix][id] || (out[prefix][id] = {});
                EXTRA_ROWS[prefix].forEach(([, key]) => {
                    const value = Number(values?.[key]);
                    if (values?.[key] === null || values?.[key] === undefined || !Number.isFinite(value)) return;
                    const cell = player[key] || (player[key] = { total: 0, maps: 0 });
                    cell.total += value; cell.maps += 1;
                });
            });
        }));
        extraAverages = out;
        render();
    }).catch(error => {
        console.warn("Head-to-head extra stats unavailable:", error);
    });
    return extraLoading;
}

function extraRows(prefix, a, b) {
    if (!extraAverages) return [];
    const of = (p, key) => {
        const cell = extraAverages[prefix]?.[String(p.id)]?.[key];
        return cell && cell.maps ? cell.total / cell.maps : null;
    };
    return (EXTRA_ROWS[prefix] || [])
        .map(([label, key, group]) => [label, of(a, key), of(b, key), group])
        .filter(([, x, y]) => x !== null && y !== null)
        .map(([label, x, y, group]) => [label, x, y, "avg", "higher", group]);
}

const num = (value, decimals = 2) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
};
// A per-map average, always to the same places for its size: 4,972 / 43.7 / 7.80
const avg = value => {
    const n = Number(value) || 0, size = Math.abs(n), places = size >= 100 ? 0 : size >= 10 ? 1 : 2;
    return n.toLocaleString(undefined, { minimumFractionDigits: places, maximumFractionDigits: places });
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
    const numeric = type === "number" || type === "percent" || type === "avg";
    const av = numeric ? Number(a || 0) : String(a);
    const bv = numeric ? Number(b || 0) : String(b);
    let aBetter = false, bBetter = false;
    if (numeric && av !== bv) {
        aBetter = better === "higher" ? av > bv : av < bv;
        bBetter = !aBetter;
    }
    const format = v => type === "percent" ? percent(v) : type === "avg" ? avg(v) : type === "number" ? num(v) : v;
    return `<div class="comparison-row">
        <div class="comparison-value left ${aBetter ? "better" : ""}">${format(av)}</div>
        <div class="comparison-label">${label}</div>
        <div class="comparison-value right ${bBetter ? "better" : ""}">${format(bv)}</div>
    </div>`;
}

// One block of rows with a title and its score, the rows under small headings (GROUPS).
// wide = runs the full width (Lifetime), its groups side by side.
//   rows: [label, a's value, b's value, type, better, group]
function section(title, a, b, rows, wide = false) {
    const scoreA = rows.reduce((sum, [, x, y, , better = "higher"]) => sum + compareMetric(x, y, better), 0);
    const scoreB = rows.length - scoreA;
    const groups = Object.keys(GROUPS).map(g => [g, rows.filter(r => r[5] === g)]).filter(([, list]) => list.length);
    return {
        scoreA, scoreB,
        html: `<div class="comparison-section${wide ? " wide" : ""}">
            <div class="comparison-section-title">${title} <span class="mode-score">${a.name} ${num(scoreA, 1)} — ${num(scoreB, 1)} ${b.name}</span></div>
            <div class="cs-groups">${groups.map(([g, list]) => `<div class="cs-group">
                <div class="cs-group-title">${GROUPS[g]}</div>
                ${list.map(r => row(...r.slice(0, 5))).join("")}
            </div>`).join("")}</div>
        </div>`
    };
}

function modeSection(mode, a, b) {
    const x = modeNumbers(a, mode);
    const y = modeNumbers(b, mode);
    const metrics = [
        ["MAP WIN %", "mapWinRate", "percent", "higher", "record"],
        [mode.unitLabel, "avgModeUnit", "avg", "higher", "record"],
        ["KILLS / MAP", "killsPerMap", "avg", "higher", "fight"],
        ["DEATHS / MAP", "deathsPerMap", "avg", "lower", "fight"],
        ["DAMAGE SHARE", "damageShare", "percent", "higher", "fight"]
    ];
    const rows = metrics.map(([label, key, type, better, group]) => [label, x[key], y[key], type, better, group]);
    const against = versusRow(mode, a, b);
    if (against) rows.splice(1, 0, against);
    return section(mode.name.toUpperCase(), a, b, rows.concat(extraRows(mode.prefix, a, b)));
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
    container.classList.remove("winged");          // the popup's wings are for the player it last showed
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
    const meetings = versus(a, b);
    const lifetime = section("LIFETIME", a, b, [
        ["WINS", totalWins(a), totalWins(b), "number", "higher", "record"],
        ["LOSSES", totalLosses(a), totalLosses(b), "number", "lower", "record"],
        ["WIN RATE", winRate(a), winRate(b), "percent", "higher", "record"],
        ...(meetings ? [[`MAP WINS VS EACH OTHER (${meetings.d})`, ...winsOf(meetings, a, b), "number", "higher", "record"]] : []),
        ["KILLS", a.lifetimeKills, b.lifetimeKills, "number", "higher", "fight"],
        ["DEATHS", a.lifetimeDeaths, b.lifetimeDeaths, "number", "lower", "fight"],
        ["K/D", kd(a), kd(b), "avg", "higher", "fight"]
    ], true);
    const modeResults = MODES.map(mode => modeSection(mode, a, b));
    const sections = [lifetime, ...modeResults];
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
            <span>STATS WON ACROSS THE THREE MODES</span>
        </div>

        <!-- Lifetime runs the full width (record and gunfights side by side); the three modes sit side by side under it -->
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
}

export function showComparisons(list) {
    players = list;
    loadExtraAverages();
    loadPairRecords();
    const sorted = list.slice().sort((x, y) => x.name.localeCompare(y.name));
    ["comparePlayerA", "comparePlayerB"].forEach(id => {
        const select = document.getElementById(id);
        const selected = select.value;
        select.innerHTML = `<option value="">Select player</option>` +
            sorted.map(p => `<option value="${p.id}"${String(p.id) === selected ? " selected" : ""}>${p.name}</option>`).join("");
    });
    render();
}
