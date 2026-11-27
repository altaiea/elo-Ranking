/* ======================================================
   HEAD-TO-HEAD TAB (Players > Head-to-Head)
   Two players side by side: their cards, then
   - MAPS AGAINST EACH OTHER: every map they played on opposite teams and who
     won it (a record only, not scored),
   - LIFETIME and one section per mode: each row gives 1 point to the better
     player (half each for a tie), and the points add up to the big score.
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
const EXTRA_ROWS = {
    hp: [["SCORE / MAP", "score"], ["OBJ SCORE / MAP", "objScore"], ["HILL TIME / MAP (S)", "time"],
         ["CAPTURES / MAP", "captures"], ["OBJ KILLS / MAP", "objectiveKills"]],
    snd: [["SCORE / MAP", "score"], ["OBJ SCORE / MAP", "objScore"], ["PLANTS / MAP", "plants"],
          ["DEFUSES / MAP", "defuses"], ["OBJ KILLS / MAP", "objectiveKills"]],
    overload: [["SCORE / MAP", "score"], ["OBJ SCORE / MAP", "objScore"], ["OVERLOADS / MAP", "overloads"],
               ["OBJ KILLS / MAP", "objectiveKills"]]
};
const GAME_MODE_PREFIX = { Hardpoint: "hp", SND: "snd", Overload: "overload" };
let extraAverages = null;      // prefix -> playerId -> stat -> { total, maps }
let extraLoading = null;

// ---------------------------
// MAPS AGAINST EACH OTHER (27 Nov 2026)
// ---------------------------
// Every map two players played on opposite teams, and who won it, overall and per mode,
// plus their record on the same team. Covers every map since 29 May 2026: the site history
// (20 Sep on) and the 462 maps rebuilt from the stats snapshots (data/rebuilt-days.json).
// Shown as a record only: it does not count toward the HEAD-TO-HEAD score.
let pairRecords = null;        // "low-high" -> { against: {g, w, d, modes}, together: {...} }, w = the lower id's wins
let pairLoading = null;
let firstSiteDate = null;

function loadPairRecords() {
    if (pairLoading) return pairLoading;
    pairLoading = Promise.all([loadAllHistory(), loadRebuiltDays()]).then(([days, rebuilt]) => {
        const out = new Map(), seen = new Set();
        const blank = () => ({ g: 0, w: 0, d: 0, modes: {} });
        const add = (rec, mode, won) => {
            mode = GAME_MODE_PREFIX[mode] || mode;          // "SND" -> "snd", keyed like MODES[].prefix
            const m = rec.modes[mode] || (rec.modes[mode] = { g: 0, w: 0, d: 0 });
            rec.g++; m.g++;
            if (won >= 0) { rec.d++; rec.w += won; m.d++; m.w += won; }
        };
        const pair = (x, y) => {
            const k = Math.min(x, y) + "-" + Math.max(x, y);
            return out.get(k) || out.set(k, { against: blank(), together: blank() }).get(k);
        };
        const count = (id, mode, A, B, win) => {
            if (!id || seen.has(id)) return;
            seen.add(id);
            A.forEach(x => B.forEach(y => {              // opposite teams; "won" from the lower id's side
                const lowOnA = Math.min(x, y) === x;
                add(pair(x, y).against, mode, !win ? -1 : (win === 1) === lowOnA ? 1 : 0);
            }));
            [[A, 1], [B, 2]].forEach(([team, w]) => team.forEach((x, i) => team.slice(i + 1).forEach(y =>
                add(pair(x, y).together, mode, !win ? -1 : win === w ? 1 : 0))));
        };
        days.forEach(day => { if (!firstSiteDate || day.date < firstSiteDate) firstSiteDate = day.date; });
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

// a's side of a pair record
function sideOf(rec, a, b) {
    const flip = a.id > b.id, mine = q => flip ? q.d - q.w : q.w;
    const modes = {};
    Object.entries(rec.modes).forEach(([k, q]) => { modes[k] = { g: q.g, w: mine(q), d: q.d }; });
    return { g: rec.g, w: mine(rec), d: rec.d, modes };
}

function versusSection(a, b) {
    if (!pairRecords) return "";
    const rec = pairRecords.get(Math.min(a.id, b.id) + "-" + Math.max(a.id, b.id));
    const vs = rec ? sideOf(rec.against, a, b) : { g: 0, w: 0, d: 0, modes: {} };
    const tog = rec ? rec.together : { g: 0, w: 0, d: 0 };
    const bw = q => q.d - q.w;
    const rows = vs.g ? [
        ["MAP WINS", vs.w, bw(vs)],
        ["WIN %", vs.d ? vs.w / vs.d : 0, vs.d ? bw(vs) / vs.d : 0, "percent"],
        ...MODES.map(mode => {
            const m = vs.modes[mode.prefix] || { g: 0, w: 0, d: 0 };
            return [`${mode.name.toUpperCase()} WINS (${m.g})`, m.w, bw(m)];
        })
    ] : [];
    const together = tog.g
        ? `Same team: ${tog.g} maps, ${tog.w}–${tog.d - tog.w} (${tog.d ? Math.round(100 * tog.w / tog.d) : 0}% won)`
        : "Never on the same team";
    return `<div class="comparison-section wide h2h-maps">
        <div class="comparison-section-title">MAPS AGAINST EACH OTHER <span class="mode-score">${vs.g} maps · ${a.name} ${vs.w} — ${bw(vs)} ${b.name}</span></div>
        <div class="cs-rows">${vs.g ? rows.map(r => row(...r)).join("") : `<div class="h2h-maps-note">Never on opposite teams.</div>`}</div>
        <div class="h2h-maps-note">${together}. All maps since 29 May${firstSiteDate ? `; maps before ${firstSiteDate.slice(8, 10)}/${firstSiteDate.slice(5, 7)} are rebuilt from the stats snapshots` : ""}. Not counted in the score above.</div>
    </div>`;
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
        .map(([label, key]) => [label, of(a, key), of(b, key)])
        .filter(([, x, y]) => x !== null && y !== null)
        .map(([label, x, y]) => [label, x, y, "number", "higher"]);
}

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

// One block of rows with a title and its score. wide = runs the full width (Lifetime).
//   rows: [label, a's value, b's value, type, better]
function section(title, a, b, rows, wide = false) {
    const scoreA = rows.reduce((sum, [, x, y, , better = "higher"]) => sum + compareMetric(x, y, better), 0);
    const scoreB = rows.length - scoreA;
    return {
        scoreA, scoreB,
        html: `<div class="comparison-section${wide ? " wide" : ""}">
            <div class="comparison-section-title">${title} <span class="mode-score">${a.name} ${num(scoreA, 1)} — ${num(scoreB, 1)} ${b.name}</span></div>
            <div class="cs-rows">${rows.map(r => row(...r)).join("")}</div>
        </div>`
    };
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
    const rows = metrics.map(([label, key, type, better]) => [label, x[key], y[key], type, better]);
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
    const lifetime = section("LIFETIME", a, b, [
        ["KILLS", a.lifetimeKills, b.lifetimeKills],
        ["DEATHS", a.lifetimeDeaths, b.lifetimeDeaths, "number", "lower"],
        ["K/D", kd(a), kd(b)],
        ["WINS", totalWins(a), totalWins(b)],
        ["LOSSES", totalLosses(a), totalLosses(b), "number", "lower"],
        ["WIN RATE", winRate(a), winRate(b), "percent"]
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
            <span>HEAD-TO-HEAD</span>
        </div>

        <!-- Lifetime runs the full width as one column; the three modes sit side by side under it -->
        <div class="h2h-sections">${versusSection(a, b)}${sections.map(sec => sec.html).join("")}</div>
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
