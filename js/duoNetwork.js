/* ======================================================
   DUO NETWORK  (History tab)
   Every pairing of players, for any window of time.
====================================================== */
import { getPlayerName } from "./config.js";
import { loadAllHistory } from "./data.js";

const SVGNS = "http://www.w3.org/2000/svg";
const CX = 340, CY = 330, R = 228, LABEL_R = R + 30;
const MODE_SHORT = { Hardpoint: "HP", SND: "SND", Overload: "OVL" };
const CYAN = [0, 234, 255], DIM_CYAN = [38, 82, 96], RED = [255, 77, 77], DIM_RED = [110, 48, 52];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const clamp01 = x => Math.max(0, Math.min(1, x));
// winning (or even) duos are cyan, brighter the better they do; duos that lose more than they win are red
const winColour = wr => wr >= 0.5
    ? `rgb(${mix(DIM_CYAN, CYAN, 0.35 + 0.65 * clamp01((wr - 0.5) / 0.22))})`
    : `rgb(${mix(DIM_RED, RED, 0.35 + 0.65 * clamp01((0.5 - wr) / 0.22))})`;
const el = (tag, attrs, parent) => { const n = document.createElementNS(SVGNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; };
const h = (html) => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; };
const nm = id => getPlayerName(id);
const fmtDay = d => { const t = new Date(d + "T00:00:00"); return isNaN(t) ? d : t.toLocaleDateString(undefined, { day: "numeric", month: "short" }); };

let S = null;        // state once data has loaded
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
        // fixed ring order: busiest players first, so the layout never jumps while you scrub time
        const total = new Map();
        events.forEach(e => { total.set(e.a, (total.get(e.a) || 0) + 1); total.set(e.b, (total.get(e.b) || 0) + 1); });
        const ids = [...total.keys()].sort((a, b) => total.get(b) - total.get(a) || a - b);
        S = { dates, events, ids, lo: 0, hi: dates.length - 1, min: 5, selA: null, selB: null, playing: null };
        return S;
    })();
    return loading;
}

function aggregate(lo, hi) {
    const pairs = new Map();
    S.events.forEach(e => {
        if (e.di < lo || e.di > hi) return;
        const key = e.a + "-" + e.b;
        let p = pairs.get(key);
        if (!p) pairs.set(key, p = { a: e.a, b: e.b, g: 0, w: 0, d: 0, modes: {}, byDay: {} });
        p.g++; if (e.won >= 0) { p.d++; p.w += e.won; }
        const m = p.modes[e.mode] || (p.modes[e.mode] = { g: 0, w: 0, d: 0 });
        m.g++; if (e.won >= 0) { m.d++; m.w += e.won; }
        const bd = p.byDay[e.di] || (p.byDay[e.di] = { g: 0, w: 0 });
        bd.g++; bd.w += e.won === 1 ? 1 : 0;
    });
    return pairs;
}

/* ---------- ui ---------- */
function build(root) {
    const wrap = h(`
<div class="dn-wrap">
  <div class="dn-controls">
<button type="button" class="dn-play" title="Replay the history day by day">&#9654; REPLAY</button>
<div class="dn-range">
  <div class="dn-range-labels"><span id="dnFrom"></span><span id="dnTo"></span></div>
  <div class="dn-track"><div class="dn-fill" id="dnFill"></div>
    <input type="range" id="dnLo" min="0" step="1"><input type="range" id="dnHi" min="0" step="1"></div>
</div>
<label class="dn-min">min maps <select id="dnMin"><option>1</option><option>3</option><option selected>5</option><option>10</option><option>20</option></select></label>
<button type="button" class="dn-all" title="Whole history">ALL TIME</button>
  </div>
  <div class="dn-main">
<div class="dn-stage"><svg viewBox="0 0 680 660" class="dn-svg"></svg><div class="dn-tip"></div></div>
<div class="dn-side" id="dnSide"></div>
  </div>
</div>`);
    root.appendChild(wrap);
    const svg = wrap.querySelector(".dn-svg");
    el("g", { id: "dnRipples" }, svg);
    const gE = el("g", { id: "dnEdges" }, svg), gHit = el("g", { id: "dnHits" }, svg), gSel = el("g", { id: "dnSel" }, svg), gN = el("g", { id: "dnNodes" }, svg);
    const pos = {};
    S.ids.forEach((id, i) => { const a = -Math.PI / 2 + 2 * Math.PI * i / S.ids.length; pos[id] = { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a), a, i }; });
    S.pos = pos; S.edges = {}; S.nodes = {};
    for (let i = 0; i < S.ids.length; i++) for (let j = i + 1; j < S.ids.length; j++) {
        const a = Math.min(S.ids[i], S.ids[j]), b = Math.max(S.ids[i], S.ids[j]), pa = pos[a], pb = pos[b];   // keys are always low-high, same as the data
        const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2, qx = CX + (mx - CX) * 0.22, qy = CY + (my - CY) * 0.22;
        const d = `M${pa.x.toFixed(1)},${pa.y.toFixed(1)} Q${qx.toFixed(1)},${qy.toFixed(1)} ${pb.x.toFixed(1)},${pb.y.toFixed(1)}`;
        const path = el("path", { d, class: "dn-edge", fill: "none", "stroke-linecap": "round" }, gE);
        const hit = el("path", { d, class: "dn-hit", fill: "none", "data-k": a + "-" + b }, gHit);
        S.edges[a + "-" + b] = { path, hit, d, a, b };
    }
    S.selPath = el("path", { class: "dn-selpath", fill: "none", d: "M0,0" }, gSel);
    S.ids.forEach(id => {
        const p = pos[id], g = el("g", { class: "dn-node", "data-id": id, transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})` }, gN);
        el("circle", { r: 20, class: "dn-nhit" }, g);
        const dot = el("circle", { r: 9, class: "dn-dot" }, g);
        const lx = (LABEL_R - R) * Math.cos(p.a), ly = (LABEL_R - R) * Math.sin(p.a);
        const anc = Math.abs(Math.cos(p.a)) < 0.25 ? "middle" : Math.cos(p.a) > 0 ? "start" : "end";
        const t = el("text", { x: lx.toFixed(1), y: (ly + 5).toFixed(1), "text-anchor": anc, class: "dn-name" }, g); t.textContent = nm(id);
        S.nodes[id] = { g, dot };
    });
    // events
    const lo = wrap.querySelector("#dnLo"), hi = wrap.querySelector("#dnHi");
    lo.max = hi.max = S.dates.length - 1; lo.value = S.lo; hi.value = S.hi;
    const onRange = (which) => {
        let a = +lo.value, b = +hi.value;
        if (a > b) { if (which === "lo") { a = b; lo.value = a; } else { b = a; hi.value = b; } }
        stopPlay(); S.lo = a; S.hi = b; update({ ripple: true, origin: S.selA });
    };
    lo.addEventListener("input", () => onRange("lo")); hi.addEventListener("input", () => onRange("hi"));
    wrap.querySelector("#dnMin").addEventListener("change", e => { S.min = +e.target.value; update({ ripple: true, origin: S.selA }); });
    wrap.querySelector(".dn-all").addEventListener("click", () => { stopPlay(); S.lo = 0; S.hi = S.dates.length - 1; lo.value = 0; hi.value = S.hi; update({ ripple: true, origin: S.selA }); });
    wrap.querySelector(".dn-play").addEventListener("click", togglePlay);
    gN.addEventListener("click", e => { const g = e.target.closest(".dn-node"); if (g) pickNode(+g.dataset.id); });
    gHit.addEventListener("click", e => { const k = e.target.getAttribute("data-k"); if (!k) return; const [a, b] = k.split("-").map(Number); S.selA = a; S.selB = b; update({ ripple: true, origin: a }); });
    const tip = wrap.querySelector(".dn-tip"), stage = wrap.querySelector(".dn-stage");
    gHit.addEventListener("mousemove", e => {
        const k = e.target.getAttribute("data-k"); if (!k) { tip.style.display = "none"; return; }
        const p = S.agg.get(k); const [a, b] = k.split("-").map(Number);
        if (!p || p.g < S.min) { tip.style.display = "none"; return; }
        const r = stage.getBoundingClientRect();
        tip.innerHTML = `<b>${nm(a)} + ${nm(b)}</b><br>${p.g} maps &nbsp;·&nbsp; ${p.w}–${p.d - p.w} (${p.d ? Math.round(100 * p.w / p.d) : 0}%)`;
        tip.style.display = "block"; tip.style.left = (e.clientX - r.left + 14) + "px"; tip.style.top = (e.clientY - r.top + 14) + "px";
    });
    gHit.addEventListener("mouseleave", () => { tip.style.display = "none"; });
    S.wrap = wrap;
}

function pickNode(id) {
    if (S.selA === null || (S.selA !== null && S.selB !== null)) { S.selA = id; S.selB = null; }
    else if (S.selA === id) { S.selA = null; }
    else { S.selB = id; }
    update({ ripple: true, origin: id });
}

function stopPlay() { if (S.playing) { clearInterval(S.playing); S.playing = null; S.wrap.querySelector(".dn-play").innerHTML = "&#9654; REPLAY"; } }
function togglePlay() {
    if (S.playing) { stopPlay(); return; }
    const lo = S.wrap.querySelector("#dnLo"), hi = S.wrap.querySelector("#dnHi");
    S.lo = 0; S.hi = 0; lo.value = 0; hi.value = 0; S.selB = null;
    S.wrap.querySelector(".dn-play").innerHTML = "&#10074;&#10074; PAUSE";
    update({ ripple: true, origin: S.selA });
    S.playing = setInterval(() => {
        if (S.hi >= S.dates.length - 1) { stopPlay(); return; }
        S.hi++; hi.value = S.hi; update({ ripple: true, origin: null });
    }, 1100);
}

/* ---------- drawing ---------- */
function ripple(originId) {
    const g = S.wrap.querySelector("#dnRipples");
    const o = originId != null && S.pos[originId] ? S.pos[originId] : { x: CX, y: CY, i: 0 };
    for (let k = 0; k < 3; k++) {
        const c = el("circle", { cx: o.x, cy: o.y, r: 6, class: "dn-ring" }, g);
        const anim = c.animate([{ r: 6, opacity: 0.65, strokeWidth: 3 }, { r: R * 1.5, opacity: 0, strokeWidth: 0.5 }], { duration: 1500, delay: k * 220, easing: "cubic-bezier(.2,.7,.3,1)", fill: "both" });
        anim.onfinish = () => c.remove();
    }
}

function update(opts) {
    opts = opts || {};
    const agg = S.agg = aggregate(S.lo, S.hi);
    const maxG = Math.max(10, ...[...agg.values()].filter(p => p.g >= S.min).map(p => p.g));
    const n = S.ids.length;
    const originI = opts.origin != null && S.pos[opts.origin] ? S.pos[opts.origin].i : null;
    const focus = S.selA;
    Object.keys(S.edges).forEach(k => {
        const e = S.edges[k], p = agg.get(k);
        const show = p && p.g >= S.min;
        const wr = p && p.d ? p.w / p.d : 0.5;
        const touches = focus !== null && (e.a === focus || e.b === focus);
        const dim = focus !== null && !touches;
        const style = show
            ? { sw: 1 + 8.5 * Math.sqrt(p.g / maxG), col: winColour(wr), op: dim ? 0.07 : 0.35 + 0.55 * Math.min(1, p.g / 18) }
            : { sw: 0.5, col: "rgb(70,78,92)", op: 0 };
        const ia = S.pos[e.a].i, ib = S.pos[e.b].i;
        const ring = i => originI === null ? 0 : Math.min(Math.abs(i - originI), n - Math.abs(i - originI));
        const delay = opts.ripple ? (originI === null ? Math.abs(ia - ib) * 14 + (Math.min(ia, ib)) * 12 : Math.min(ring(ia), ring(ib)) * 70) : 0;
        const apply = () => { e.path.style.strokeWidth = style.sw + "px"; e.path.style.stroke = style.col; e.path.style.opacity = style.op; e.hit.style.pointerEvents = show ? "stroke" : "none"; };
        clearTimeout(e.t); delay ? (e.t = setTimeout(apply, delay)) : apply();
    });
    Object.keys(S.nodes).forEach(id => {
        const nd = S.nodes[id], sel = id == S.selA || id == S.selB;
        nd.g.classList.toggle("sel", sel);
        nd.g.classList.toggle("faded", focus !== null && !sel && !(S.edges[Math.min(+id, focus) + "-" + Math.max(+id, focus)] && agg.get(Math.min(+id, focus) + "-" + Math.max(+id, focus)) && agg.get(Math.min(+id, focus) + "-" + Math.max(+id, focus)).g >= S.min));
        if (opts.ripple) {
            const d = originI === null ? S.pos[id].i * 30 : Math.min(Math.abs(S.pos[id].i - originI), n - Math.abs(S.pos[id].i - originI)) * 70;
            nd.dot.animate([{ r: 9 }, { r: 15 }, { r: 9 }], { duration: 600, delay: d, easing: "ease-out" });
        }
    });
    // selected duo overlay
    if (S.selA !== null && S.selB !== null) {
        const k = Math.min(S.selA, S.selB) + "-" + Math.max(S.selA, S.selB), e = S.edges[k];
        S.selPath.setAttribute("d", e.d); S.selPath.style.opacity = 1;
    } else { S.selPath.style.opacity = 0; }
    if (opts.ripple) ripple(opts.origin);
    // labels and range fill
    const w = S.wrap, last = S.dates.length - 1;
    w.querySelector("#dnFrom").textContent = fmtDay(S.dates[S.lo]);
    w.querySelector("#dnTo").textContent = fmtDay(S.dates[S.hi]);
    const f = w.querySelector("#dnFill"); f.style.left = (last ? S.lo / last * 100 : 0) + "%"; f.style.width = (last ? (S.hi - S.lo) / last * 100 : 100) + "%";
    renderSide(agg);
}

function pct(w, d) { return d ? Math.round(100 * w / d) + "%" : "–"; }
function renderSide(agg) {
    const side = S.wrap.querySelector("#dnSide");
    const range = `${fmtDay(S.dates[S.lo])} – ${fmtDay(S.dates[S.hi])}`;
    const mapsInRange = new Set(); // approximate: pairs/6 per map is exact (6 pairs per team side, 12 per map)
    let totalPairs = 0; agg.forEach(p => { totalPairs += p.g; });
    const mapCount = Math.round(totalPairs / 12);
    if (S.selA !== null && S.selB !== null) {
        const a = Math.min(S.selA, S.selB), b = Math.max(S.selA, S.selB), p = agg.get(a + "-" + b) || { g: 0, w: 0, d: 0, modes: {}, byDay: {} };
        const ranked = [...agg.values()].filter(x => x.g >= 1).sort((x, y) => y.g - x.g);
        const rank = ranked.findIndex(x => x.a === a && x.b === b) + 1;
        const modes = ["Hardpoint", "SND", "Overload"].map(mname => { const m = p.modes[mname]; return `<div class="dn-mode"><span>${MODE_SHORT[mname]}</span><b>${m ? m.g : 0}</b><i>${m ? m.w + "–" + (m.d - m.w) : "–"}</i></div>`; }).join("");
        side.innerHTML = `
<div class="dn-card dn-duo">
  <div class="dn-kicker">DUO &nbsp;·&nbsp; ${range}</div>
  <div class="dn-title">${nm(a)} <span>+</span> ${nm(b)}</div>
  <div class="dn-big"><div><b>${p.g}</b><small>maps together</small></div><div><b>${p.w}–${p.d - p.w}</b><small>record</small></div><div><b>${pct(p.w, p.d)}</b><small>win rate</small></div></div>
  <div class="dn-modes">${modes}</div>
  <div class="dn-note">${p.g ? `#${rank} most-played of ${ranked.length} duos in this window` : "These two did not play together in this window"}</div>
  <button type="button" class="dn-clear">CLEAR</button>
</div>`;
    } else if (S.selA !== null) {
        const me = S.selA;
        const rows = [...agg.values()].filter(p => (p.a === me || p.b === me)).map(p => ({ o: p.a === me ? p.b : p.a, g: p.g, w: p.w, d: p.d })).sort((x, y) => y.g - x.g);
        side.innerHTML = `
<div class="dn-card">
  <div class="dn-kicker">PARTNERS &nbsp;·&nbsp; ${range}</div>
  <div class="dn-title">${nm(me)}</div>
  <div class="dn-hint">Click a second player (or a line) to see that duo.</div>
  <div class="dn-lh"><span>PLAYER</span><span>MAPS</span><span>RECORD</span><span>WIN</span></div>
  <div class="dn-list">${rows.map(r => `<div class="dn-row${r.g < S.min ? " faint" : ""}" data-o="${r.o}"><span class="dn-rn">${nm(r.o)}</span><span class="dn-rg">${r.g}</span><span class="dn-rr">${r.w}–${r.d - r.w}</span><span class="dn-rw" style="color:${winColour(r.d ? r.w / r.d : .5)}">${pct(r.w, r.d)}</span></div>`).join("") || "<div class='dn-hint'>No maps in this window.</div>"}</div>
  <button type="button" class="dn-clear">CLEAR</button>
</div>`;
        side.querySelectorAll(".dn-row").forEach(r => r.addEventListener("click", () => { S.selB = +r.dataset.o; update({ ripple: true, origin: S.selA }); }));
    } else {
        const vis = [...agg.values()].filter(p => p.g >= Math.max(S.min, 8) && p.d >= 8).map(p => ({ ...p, wr: p.w / p.d }));
        const top = [...vis].sort((x, y) => y.wr - x.wr).slice(0, 3), bot = [...vis].sort((x, y) => x.wr - y.wr).slice(0, 3);
        const most = [...agg.values()].sort((x, y) => y.g - x.g).slice(0, 3);
        const li = (p, f) => `<li data-k="${p.a}-${p.b}"><span>${nm(p.a)} + ${nm(p.b)}</span><i>${f(p)}</i></li>`;
        side.innerHTML = `
<div class="dn-card">
  <div class="dn-kicker">${range}</div>
  <div class="dn-title">${mapCount} maps</div>
  <div class="dn-hint">Click a player to see their partners, then a second player for the duo. Drag the sliders to travel through time.</div>
  <div class="dn-kicker" style="margin-top:14px">MOST PLAYED</div><ul class="dn-ul">${most.map(p => li(p, q => q.g + " maps")).join("")}</ul>
  <div class="dn-kicker" style="margin-top:10px">BEST WIN RATE (8+ MAPS)</div><ul class="dn-ul">${top.map(p => li(p, q => Math.round(q.wr * 100) + "% · " + q.g)).join("") || "<li><span>not enough maps yet</span></li>"}</ul>
  <div class="dn-kicker" style="margin-top:10px">WORST WIN RATE (8+ MAPS)</div><ul class="dn-ul">${bot.map(p => li(p, q => Math.round(q.wr * 100) + "% · " + q.g)).join("") || "<li><span>not enough maps yet</span></li>"}</ul>
</div>`;
        side.querySelectorAll(".dn-ul li[data-k]").forEach(li => li.addEventListener("click", () => { const [a, b] = li.dataset.k.split("-").map(Number); S.selA = a; S.selB = b; update({ ripple: true, origin: a }); }));
    }
    const clr = side.querySelector(".dn-clear");
    if (clr) clr.addEventListener("click", () => { S.selA = S.selB = null; update({ ripple: true }); });
}

/* ---------- mount ---------- */
function mount() {
    const page = document.getElementById("historyPage");
    if (!page || document.getElementById("duoNet")) return;
    const box = h(`<div id="duoNet" class="dn-box"><button type="button" class="dn-toggle"><span>&#9672; DUO NETWORK</span><b>&#9662;</b></button><div class="dn-body"></div></div>`);
    page.insertBefore(box, page.firstChild);
    const body = box.querySelector(".dn-body"), toggle = box.querySelector(".dn-toggle");
    let started = false;
    toggle.addEventListener("click", async () => {
        const open = box.classList.toggle("open");
        if (!open || started) return;
        started = true;
        body.innerHTML = "<div class='dn-loading'>Loading match history…</div>";
        try { await loadData(); body.innerHTML = ""; build(body); update({ ripple: true }); }
        catch (err) { console.error(err); body.innerHTML = "<div class='dn-loading'>Could not load the history.</div>"; started = false; }
    });
    const listEl = document.getElementById("historyList");
    if (listEl) new MutationObserver(() => { box.style.display = listEl.style.display === "none" ? "none" : ""; }).observe(listEl, { attributes: true, attributeFilter: ["style"] });
}
export const setupDuoNetwork = mount;
