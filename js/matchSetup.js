/* ======================================================
   TEAMS & MAPS TAB (one page)
   1. Tap players (no dropdowns). Auto: tap 8, get the fairest 4 v 4.
      Pick teams: choose Team A / Team B, then tap players into it.
   2. Roll a Bo5 / Bo7 / Bo9 map set.
   On phones the site keeps its 1100px desktop canvas, so this page sizes
   itself to the phone's real width and zooms up to fill it.
====================================================== */
import { cardAssets, INACTIVE_PLAYER_IDS } from "./config.js";
import { playerHasActivity } from "./data.js";
import { bestSplit } from "./ratings.js";
import { setupLineupClicks, showLineup } from "./teams.js";
import { renderMapSet } from "./maps.js";
import { reduceMotion } from "./ui.js";

const TEAM_SIZE = 4, NEEDED = 8;

let players = [];
let mode = "auto";            // "auto" | "manual"
let addTo = "A";              // manual mode: which team a tap adds to
let showInactive = false;
let seriesCount = 7;
const picked = new Map();     // id -> "X" (auto) or "A" / "B" (manual)

const $ = id => document.getElementById(id);
const byId = id => players.find(p => p.id === id);
const countOf = team => [...picked.values()].filter(t => t === team).length;

/* ---------------------------
   PHONE FIT
---------------------------- */
export function fitPhone() {
    const page = $("teamsPage"), box = $("matchSetup");
    if (!page || !box) return;
    const cs = getComputedStyle(page);
    const sw = screen.width, avail = (page.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) || document.body.clientWidth;
    const phone = sw <= 700 && avail > sw * 1.2;      // phone showing the 1100px canvas
    box.classList.toggle("ms-phone", phone);
    box.style.width = phone ? sw + "px" : "";
    box.style.zoom = phone ? String(avail / sw) : "";
}

/* ---------------------------
   PLAYER GRID
---------------------------- */
function visiblePlayers() {
    return players
        .filter(p => showInactive || picked.has(p.id) || (playerHasActivity(p) && !INACTIVE_PLAYER_IDS.has(p.id)))
        .sort((a, b) => b.elo - a.elo);
}

function renderPlayers() {
    $("msPlayers").innerHTML = visiblePlayers().map(p => {
        const t = picked.get(p.id);
        const cls = t ? (t === "X" ? " on" : " on team-" + t.toLowerCase()) : "";
        const tag = t ? `<i class="ms-tag">${t === "X" ? "✓" : t}</i>` : "";
        return `<button type="button" class="ms-chip${cls}" data-id="${p.id}" aria-pressed="${!!t}">
            <img src="${cardAssets.thumb(p.id)}" alt="" loading="lazy" decoding="async">
            ${tag}
            <span class="ms-name">${p.name}</span>
            <span class="ms-elo">${Math.round(p.elo)}</span>
        </button>`;
    }).join("");
    renderStatus();
}

function renderStatus() {
    const n = picked.size;
    $("msCount").textContent = `${n}/${NEEDED}`;
    $("msCount").classList.toggle("full", n === NEEDED);
    const a = countOf("A"), b = countOf("B");
    const btns = document.querySelectorAll(".ms-addto-btn");
    btns[0].querySelector("b").textContent = `${a}/${TEAM_SIZE}`;
    btns[1].querySelector("b").textContent = `${b}/${TEAM_SIZE}`;
    btns.forEach(x => x.classList.toggle("on", x.dataset.team === addTo));
    const go = $("msBuild");
    go.disabled = n !== NEEDED;
    go.textContent = n !== NEEDED ? `Pick ${NEEDED - n} more` : mode === "auto" ? "Find best match-up" : "Simulate match";
}

function togglePlayer(id) {
    if (picked.has(id)) {
        picked.delete(id);
    } else if (mode === "auto") {
        if (picked.size >= NEEDED) return nudge();
        picked.set(id, "X");
    } else {
        if (countOf(addTo) >= TEAM_SIZE) {
            const other = addTo === "A" ? "B" : "A";
            if (countOf(other) >= TEAM_SIZE) return nudge();
            addTo = other;
        }
        picked.set(id, addTo);
        if (countOf(addTo) === TEAM_SIZE && countOf(addTo === "A" ? "B" : "A") < TEAM_SIZE) addTo = addTo === "A" ? "B" : "A";
    }
    renderPlayers();
}

function nudge() {
    const c = $("msCount");
    if (!reduceMotion()) c.animate([{ scale: "1" }, { scale: "1.25" }, { scale: "1" }], { duration: 300 });
}

function setMode(next) {
    if (next === mode) return;
    mode = next;
    // keep the picks: auto -> manual fills A then B, manual -> auto just keeps the 8
    const ids = [...picked.keys()];
    picked.clear();
    ids.forEach((id, i) => picked.set(id, mode === "auto" ? "X" : (i < TEAM_SIZE ? "A" : "B")));
    addTo = countOf("A") < TEAM_SIZE ? "A" : "B";
    document.querySelectorAll("#msModeSeg button").forEach(b => b.classList.toggle("on", b.dataset.mode === mode));
    $("msAddTo").hidden = mode !== "manual";
    renderPlayers();
}

function build() {
    if (picked.size !== NEEDED) return;
    let teamA, teamB;
    if (mode === "auto") {
        ({ teamA, teamB } = bestSplit([...picked.keys()].map(byId)));
    } else {
        teamA = [...picked].filter(([, t]) => t === "A").map(([id]) => byId(id));
        teamB = [...picked].filter(([, t]) => t === "B").map(([id]) => byId(id));
    }
    showLineup(teamA, teamB);          // your line-up reveal, unchanged
}

/* ---------------------------
   MAPS: your map cards and reveal, one output, Bo5 / Bo7 / Bo9 switch
---------------------------- */
function rollMaps() {
    const loader = $("mapLoading"), out = $("mapSeriesOut");
    loader.style.display = "block";
    out.innerHTML = "";
    setTimeout(() => { loader.style.display = "none"; renderMapSet(seriesCount, out); }, 600);
}

/* ---------------------------
   SETUP
---------------------------- */
export function setupMatchSetup() {
    setupLineupClicks();
    $("msPlayers").addEventListener("click", e => {
        const chip = e.target.closest(".ms-chip");
        if (chip) togglePlayer(Number(chip.dataset.id));
    });
    document.querySelectorAll("#msModeSeg button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
    document.querySelectorAll(".ms-addto-btn").forEach(b => b.addEventListener("click", () => { addTo = b.dataset.team; renderStatus(); }));
    $("msInactive").addEventListener("click", () => {
        showInactive = !showInactive;
        $("msInactive").textContent = showInactive ? "Hide inactive" : "Show inactive";
        renderPlayers();
    });
    $("msClear").addEventListener("click", () => { picked.clear(); addTo = "A"; renderPlayers(); });
    $("msBuild").addEventListener("click", build);
    document.querySelectorAll("#msSeriesSeg button").forEach(b => b.addEventListener("click", () => {
        seriesCount = Number(b.dataset.count);
        document.querySelectorAll("#msSeriesSeg button").forEach(x => x.classList.toggle("on", x === b));
    }));
    $("msRoll").addEventListener("click", rollMaps);
    fitPhone();
    addEventListener("resize", fitPhone);
    document.querySelector('[data-tab="teamsPage"]').addEventListener("click", () => requestAnimationFrame(fitPhone));
}

export function showMatchSetup(list) {
    players = list;
    renderPlayers();
    fitPhone();
}
