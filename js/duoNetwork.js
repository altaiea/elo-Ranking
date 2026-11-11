/* ======================================================
   DUO NETWORK
   Every pairing of players, for any window of time, drawn as a neon
   globe you can turn any way you like.

   This file owns the data, the pop-up, the sliders and the side panel.
   The 3D drawing itself is js/duoNetwork3d.js.

   How it opens instantly: a moment after the site loads, warmUp() quietly
   reads the history, downloads the 3D code and builds the whole pop-up while
   it is still hidden. Clicking DUOS then only has to show it.
====================================================== */
import { getPlayerName } from "./config.js";
import { loadAllHistory } from "./data.js";

const MODE_SHORT = { Hardpoint: "HP", SND: "SND", Overload: "OVL" };

/* ---------- colours ---------- */
// Change these to restyle the network. Every player gets their own colour
// from playerColour() below; these three are the win-rate colours.
export const COLOURS = {
    best: "#b8ff2e",     // duos that win BEST_FROM or more of their maps (lime)
    win: "#19e6ff",      // duos that win at least half (cyan)
    loss: "#ff2e7e"      // duos that lose more than they win (hot pink)
};
const BEST_FROM = 0.57;
export const band = wr => wr < 0.5 ? "loss" : wr >= BEST_FROM ? "best" : "win";
// One neon colour per player, spread evenly round the colour wheel. Players next to
// each other in the list get colours far apart, so neighbours are easy to tell apart.
function playerColour(i, n) {
    let step = Math.max(1, Math.round(n * 0.41));
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    while (gcd(step, n) !== 1) step++;
    const hue = Math.round(((i * step) % n) * 360 / n);
    const light = hue > 215 && hue < 290 ? 70 : 60;          // blues and violets need lifting to read as bright as the rest
    return `hsl(${hue}, 100%, ${light}%)`;
}

const h = html => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; };
const nm = id => getPlayerName(id);
const key = (a, b) => Math.min(a, b) + "-" + Math.max(a, b);
const fmtDay = d => { const t = new Date(d + "T00:00:00"); return isNaN(t) ? d : t.toLocaleDateString(undefined, { day: "numeric", month: "short" }); };
const pct = (w, d) => d ? Math.round(100 * w / d) + "%" : "–";

let S = null;        // everything the network knows, once the data has loaded
let loading = null;

/* ---------- data ---------- */
async function loadData() {
    if (S) return S;
    if (loading) return loading;
    loading = (async () => {
        const days = (await loadAllHistory()).filter(d => d && d.date);
        const seen = new Set(), events = [], dates = days.map(d => d.date);
        days.forEach((day, di) => (day.maps || []).forEach(m => {
            if (!m || !m.game || seen.has(m.mapId)) return;
            seen.add(m.mapId);
            const win = m.game.result && m.game.result.winningTeam;
            [["A", 1], ["B", 2]].forEach(([k, w]) => {
                const ids = ((m.game.teams || {})[k] || []).map(p => Number(p.playerId)).sort((a, b) => a - b);
                for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++)
                    events.push({ di, a: ids[i], b: ids[j], won: win === w ? 1 : win ? 0 : -1, mode: m.gameMode || m.game.gameMode });
            });
        }));
        // fixed order: busiest players first, so nobody jumps about while you scrub through time
        const total = new Map();
        events.forEach(e => { total.set(e.a, (total.get(e.a) || 0) + 1); total.set(e.b, (total.get(e.b) || 0) + 1); });
        const ids = [...total.keys()].sort((a, b) => total.get(b) - total.get(a) || a - b);
        // spread the players evenly over the globe (a spiral from top to bottom)
        const pos = {}, colour = {}, n = ids.length;
        ids.forEach((id, i) => {
            const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * 2.39996;
            pos[id] = [r * Math.cos(a), y, r * Math.sin(a)];
            colour[id] = playerColour(i, n);
        });
        S = {
            dates, events, ids, pos, colour, names: Object.fromEntries(ids.map(id => [id, nm(id)])),
            lo: 0, hi: dates.length - 1, min: 5, selA: null, selB: null, playing: null,
            byWinRate: false,        // false: lines take their two players' colours; true: lines coloured by win rate
            edges: {}, nodes: {}     // what the 3D drawing should show; filled in by update()
        };
        return S;
    })();
    return loading;
}

function aggregate(lo, hi) {
    const pairs = new Map();
    S.events.forEach(e => {
        if (e.di < lo || e.di > hi) return;
        const k = e.a + "-" + e.b;
        let p = pairs.get(k);
        if (!p) pairs.set(k, p = { a: e.a, b: e.b, g: 0, w: 0, d: 0, modes: {} });
        p.g++; if (e.won >= 0) { p.d++; p.w += e.won; }
        const m = p.modes[e.mode] || (p.modes[e.mode] = { g: 0, w: 0, d: 0 });
        m.g++; if (e.won >= 0) { m.d++; m.w += e.won; }
    });
    return pairs;
}

/* ---------- the pop-up ---------- */
let box = null, icon = null, building = null;

function buildUi() {
    const ui = h(`
<div class="duo-ui">
  <div class="duo-stage"><div class="duo-tip"></div><div class="duo-hint"><span class="mouse">Drag to spin &nbsp;·&nbsp; drag outside the globe to roll &nbsp;·&nbsp; scroll to zoom</span><span class="touch">Drag to spin &nbsp;·&nbsp; two fingers to roll and zoom</span></div></div>
  <header class="duo-top">
    <h2>DUO <b>NETWORK</b></h2>
    <div class="duo-seg" role="group" aria-label="Line colours">
      <button type="button" data-mode="players" aria-pressed="true">PLAYERS</button>
      <button type="button" data-mode="winrate" aria-pressed="false">WIN RATE</button>
    </div>
    <button type="button" class="duo-btn duo-reset">RESET VIEW</button>
    <button type="button" class="duo-btn duo-close" aria-label="Close">&#10005;</button>
  </header>
  <aside class="duo-side" id="duoSide"></aside>
  <footer class="duo-bottom">
    <div class="duo-legend" id="duoLegend"></div>
    <div class="duo-controls">
      <button type="button" class="duo-btn duo-play">&#9654; REPLAY</button>
      <div class="duo-range">
        <div class="duo-range-labels"><span id="duoFrom"></span><span id="duoTo"></span></div>
        <div class="duo-track"><div class="duo-fill" id="duoFill"></div>
          <input type="range" id="duoLo" min="0" step="1" aria-label="From"><input type="range" id="duoHi" min="0" step="1" aria-label="To"></div>
      </div>
      <label class="duo-min">MIN MAPS <select id="duoMin"><option>1</option><option>3</option><option selected>5</option><option>10</option><option>20</option></select></label>
      <button type="button" class="duo-btn duo-all">ALL TIME</button>
    </div>
  </footer>
</div>`);
    box.appendChild(ui);
    S.ui = ui;
    const lo = ui.querySelector("#duoLo"), hi = ui.querySelector("#duoHi");
    lo.max = hi.max = S.dates.length - 1; lo.value = S.lo; hi.value = S.hi;
    const onRange = which => {
        let a = +lo.value, b = +hi.value;
        if (a > b) { if (which === "lo") { a = b; lo.value = a; } else { b = a; hi.value = b; } }
        stopPlay(); S.lo = a; S.hi = b; update({ pulse: true });
    };
    lo.addEventListener("input", () => onRange("lo")); hi.addEventListener("input", () => onRange("hi"));
    ui.querySelector("#duoMin").addEventListener("change", e => { S.min = +e.target.value; update({ pulse: true }); });
    ui.querySelector(".duo-all").addEventListener("click", () => { stopPlay(); S.lo = 0; S.hi = S.dates.length - 1; lo.value = 0; hi.value = S.hi; update({ pulse: true }); });
    ui.querySelector(".duo-play").addEventListener("click", togglePlay);
    ui.querySelector(".duo-close").addEventListener("click", close);
    ui.querySelector(".duo-reset").addEventListener("click", () => { if (S.gl) S.gl.reset(); });
    ui.querySelectorAll(".duo-seg button").forEach(b => b.addEventListener("click", () => {
        S.byWinRate = b.dataset.mode === "winrate";
        ui.querySelectorAll(".duo-seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
        update();
    }));
    // the small box that follows the mouse over a line; k is "lowId-highId", or null to hide it
    const tip = ui.querySelector(".duo-tip"), stage = ui.querySelector(".duo-stage");
    S.showTip = (k, x, y) => {
        const p = k && S.agg.get(k);
        if (!p || p.g < S.min) { tip.style.display = "none"; return; }
        const r = stage.getBoundingClientRect(), zoom = r.width / stage.offsetWidth || 1;
        tip.innerHTML = `<b>${nm(p.a)} + ${nm(p.b)}</b><br>${p.g} maps &nbsp;·&nbsp; ${p.w}–${p.d - p.w} (${pct(p.w, p.d)})`;
        tip.style.display = "block"; tip.style.left = ((x - r.left) / zoom + 14) + "px"; tip.style.top = ((y - r.top) / zoom + 14) + "px";
    };
    return stage;
}

// Reads the data, downloads the 3D code and builds everything, hidden. Safe to call more than once.
function warmUp() {
    if (building) return building;
    building = (async () => {
        const [, three] = await Promise.all([loadData(), import("./duoNetwork3d.js").catch(err => { console.warn("Duo network: 3D is not available.", err); return null; })]);
        const stage = buildUi();
        S.gl = three && three.createGlobe3D(stage, S, {
            pickNode,
            pickEdge: k => { const [a, b] = k.split("-").map(Number); S.selA = a; S.selB = b; update({ pulse: true }); },
            hoverEdge: (k, x, y) => S.showTip(k, x, y)
        });
        if (!S.gl) stage.insertAdjacentHTML("beforeend", "<div class='duo-nogl'>This browser cannot draw the 3D globe. The lists on the right still work.</div>");
        update();
        box.classList.add("ready");
        if (!box.hidden && S.gl) S.gl.open();
    })();
    building.catch(err => { console.error(err); building = null; box.classList.add("failed"); });
    return building;
}

function open() {
    box.hidden = false; box.classList.remove("failed");
    document.documentElement.classList.add("dn-open");
    if (S && S.gl) S.gl.open();          // already built: on screen in this same frame
    else warmUp();                        // clicked before the warm-up finished: it appears the moment it is ready
    const x = box.querySelector(".duo-close"); if (x) x.focus();
}
function close() {
    box.hidden = true;
    document.documentElement.classList.remove("dn-open");
    if (S) { stopPlay(); if (S.gl) S.gl.close(); }
    icon.focus();
}

function pickNode(id) {
    if (S.selA === null || S.selB !== null) { S.selA = id; S.selB = null; }
    else if (S.selA === id) { S.selA = null; }
    else { S.selB = id; }
    update({ pulse: true });
}

function stopPlay() { if (S.playing) { clearInterval(S.playing); S.playing = null; S.ui.querySelector(".duo-play").innerHTML = "&#9654; REPLAY"; } }
function togglePlay() {
    if (S.playing) { stopPlay(); return; }
    const lo = S.ui.querySelector("#duoLo"), hi = S.ui.querySelector("#duoHi");
    S.lo = 0; S.hi = 0; lo.value = 0; hi.value = 0; S.selB = null;
    S.ui.querySelector(".duo-play").innerHTML = "&#10074;&#10074; PAUSE";
    update({ pulse: true });
    S.playing = setInterval(() => {
        if (S.hi >= S.dates.length - 1) { stopPlay(); return; }
        S.hi++; hi.value = S.hi; update({ pulse: true });
    }, 900);
}

/* ---------- work out what to show ---------- */
// Fills S.edges and S.nodes for the 3D drawing, then redraws the labels, legend and side panel.
function update(opts) {
    const agg = S.agg = aggregate(S.lo, S.hi);
    const shown = [...agg.values()].filter(p => p.g >= S.min);
    const maxG = Math.max(10, ...shown.map(p => p.g));
    const focus = S.selA, duo = S.selA !== null && S.selB !== null ? key(S.selA, S.selB) : null;
    const played = {};
    S.edges = {};
    shown.forEach(p => {
        const k = p.a + "-" + p.b, touches = focus !== null && (p.a === focus || p.b === focus);
        played[p.a] = (played[p.a] || 0) + p.g; played[p.b] = (played[p.b] || 0) + p.g;
        S.edges[k] = {
            a: p.a, b: p.b,
            weight: Math.sqrt(p.g / maxG),                       // 0 to 1: how thick the line is
            wr: p.d ? p.w / p.d : 0.5,
            byWinRate: S.byWinRate || touches,                   // a picked player's lines always show win rate
            state: k === duo ? "duo" : touches ? "lit" : focus !== null ? "dim" : "plain"
        };
    });
    const maxPlayed = Math.max(1, ...Object.values(played));
    S.ids.forEach(id => {
        const picked = id === S.selA || id === S.selB;
        const linked = focus !== null && S.edges[key(id, focus)];
        S.nodes[id] = { picked, faded: focus !== null && !picked && !linked, size: Math.sqrt((played[id] || 0) / maxPlayed) };
    });
    if (S.gl) S.gl.sync(opts);
    const ui = S.ui, last = S.dates.length - 1;
    ui.querySelector("#duoFrom").textContent = fmtDay(S.dates[S.lo]);
    ui.querySelector("#duoTo").textContent = fmtDay(S.dates[S.hi]);
    const f = ui.querySelector("#duoFill"); f.style.left = (last ? S.lo / last * 100 : 0) + "%"; f.style.width = (last ? (S.hi - S.lo) / last * 100 : 100) + "%";
    const sw = (c, t) => `<span><i style="background:${c};box-shadow:0 0 10px ${c}"></i>${t}</span>`;
    ui.querySelector("#duoLegend").innerHTML = S.byWinRate || focus !== null
        ? sw(COLOURS.best, `Wins ${Math.round(BEST_FROM * 100)}%+`) + sw(COLOURS.win, "Wins half or more") + sw(COLOURS.loss, "Loses more than wins") + "<span>Thicker line = more maps together</span>"
        : "<span>Each line blends its two players' colours</span><span>Thicker line = more maps together</span>";
    renderSide(agg);
}

function renderSide(agg) {
    const side = S.ui.querySelector("#duoSide");
    const range = `${fmtDay(S.dates[S.lo])} – ${fmtDay(S.dates[S.hi])}`;
    const name = id => `<b style="color:${S.colour[id]}">${nm(id)}</b>`;
    const wrColour = (w, d) => COLOURS[band(d ? w / d : 0.5)];
    let totalPairs = 0; agg.forEach(p => { totalPairs += p.g; });
    const mapCount = Math.round(totalPairs / 12);                 // a 4v4 map makes 6 pairs on each side
    if (S.selA !== null && S.selB !== null) {
        const a = Math.min(S.selA, S.selB), b = Math.max(S.selA, S.selB), p = agg.get(a + "-" + b) || { g: 0, w: 0, d: 0, modes: {} };
        const ranked = [...agg.values()].sort((x, y) => y.g - x.g);
        const rank = ranked.findIndex(x => x.a === a && x.b === b) + 1;
        const modes = ["Hardpoint", "SND", "Overload"].map(mname => { const m = p.modes[mname]; return `<div class="duo-mode"><span>${MODE_SHORT[mname]}</span><b>${m ? m.g : 0}</b><i>${m ? m.w + "–" + (m.d - m.w) : "–"}</i></div>`; }).join("");
        side.innerHTML = `
<div class="duo-kicker">DUO &nbsp;·&nbsp; ${range}</div>
<div class="duo-title">${name(a)} <span>+</span> ${name(b)}</div>
<div class="duo-big"><div><b>${p.g}</b><small>maps together</small></div><div><b>${p.w}–${p.d - p.w}</b><small>record</small></div><div><b style="color:${wrColour(p.w, p.d)}">${pct(p.w, p.d)}</b><small>win rate</small></div></div>
<div class="duo-modes">${modes}</div>
<div class="duo-note">${p.g ? `#${rank} most played of ${ranked.length} duos` : "No maps together in this window"}</div>
<button type="button" class="duo-btn duo-clear">CLEAR</button>`;
    } else if (S.selA !== null) {
        const me = S.selA;
        const rows = [...agg.values()].filter(p => p.a === me || p.b === me).map(p => ({ o: p.a === me ? p.b : p.a, g: p.g, w: p.w, d: p.d })).sort((x, y) => y.g - x.g);
        side.innerHTML = `
<div class="duo-kicker">PARTNERS &nbsp;·&nbsp; ${range}</div>
<div class="duo-title">${name(me)}</div>
<div class="duo-list">${rows.map(r => `<button type="button" class="duo-row${r.g < S.min ? " faint" : ""}" data-o="${r.o}"><span class="duo-rn" style="color:${S.colour[r.o]}">${nm(r.o)}</span><span class="duo-rg">${r.g}</span><span class="duo-rr">${r.w}–${r.d - r.w}</span><span class="duo-rw" style="color:${wrColour(r.w, r.d)}">${pct(r.w, r.d)}</span></button>`).join("") || "<div class='duo-note'>No maps in this window.</div>"}</div>
<button type="button" class="duo-btn duo-clear">CLEAR</button>`;
        side.querySelectorAll(".duo-row").forEach(r => r.addEventListener("click", () => { S.selB = +r.dataset.o; update({ pulse: true }); }));
    } else {
        const vis = [...agg.values()].filter(p => p.g >= Math.max(S.min, 8) && p.d >= 8).map(p => ({ ...p, wr: p.w / p.d }));
        const top = [...vis].sort((x, y) => y.wr - x.wr).slice(0, 3), bot = [...vis].sort((x, y) => x.wr - y.wr).slice(0, 3);
        const most = [...agg.values()].sort((x, y) => y.g - x.g).slice(0, 3);
        const li = (p, f) => `<button type="button" class="duo-li" data-k="${p.a}-${p.b}"><span>${name(p.a)} + ${name(p.b)}</span><i>${f(p)}</i></button>`;
        const wrText = q => `<em style="color:${COLOURS[band(q.wr)]}">${Math.round(q.wr * 100)}%</em> · ${q.g}`;
        const block = (title, list, f) => `<div class="duo-block"><div class="duo-kicker">${title}</div>${list.map(p => li(p, f)).join("") || "<div class='duo-note'>–</div>"}</div>`;
        side.innerHTML = `
<div class="duo-kicker">${range}</div>
<div class="duo-title">${mapCount} <span>maps</span></div>
<div class="duo-note">Tap a player, then a second one to see the duo.</div>
<div class="duo-blocks">${block("MOST PLAYED", most, q => q.g + " maps")}${block("BEST WIN RATE", top, wrText)}${block("WORST WIN RATE", bot, wrText)}</div>`;
        side.querySelectorAll(".duo-li").forEach(li => li.addEventListener("click", () => { const [a, b] = li.dataset.k.split("-").map(Number); S.selA = a; S.selB = b; update({ pulse: true }); }));
    }
    const clr = side.querySelector(".duo-clear");
    if (clr) clr.addEventListener("click", () => { S.selA = S.selB = null; update({ pulse: true }); });
}

/* ---------- mount ---------- */
// A small icon on the Leaderboard / Monthly / History line opens the network full screen.
function mount() {
    const head = document.getElementById("subRow");
    if (!head || document.getElementById("duoNet")) return;
    icon = h(`<button type="button" class="dn-icon" id="duoIcon" aria-label="Open the duo network" title="Duo network">
<svg viewBox="0 0 48 48" aria-hidden="true"><g class="dn-icon-spin"><path d="M24 7 L9 33 M24 7 L39 33 M9 33 L39 33 M24 7 Q24 26 31 20 M9 33 Q24 24 31 20 M39 33 L31 20"/><circle cx="24" cy="7" r="3.4"/><circle cx="9" cy="33" r="3.4"/><circle cx="39" cy="33" r="3.4"/><circle cx="31" cy="20" r="2.6"/></g></svg>
<span>DUOS</span></button>`);
    head.appendChild(icon);
    box = h(`<div id="duoNet" class="duo-pop" role="dialog" aria-modal="true" aria-label="Duo network" hidden><div class="duo-wait">Loading the network…<button type="button" class="duo-btn duo-wait-close">CLOSE</button></div></div>`);
    document.body.appendChild(box);
    box.querySelector(".duo-wait-close").addEventListener("click", close);
    icon.addEventListener("click", open);
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !box.hidden) close(); });
    // get everything ready in the background once the page itself has settled
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1200));
    const start = () => idle(() => warmUp(), { timeout: 3000 });
    if (document.readyState === "complete") start(); else addEventListener("load", start, { once: true });
    icon.addEventListener("pointerenter", warmUp, { once: true });
}
export const setupDuoNetwork = mount;
