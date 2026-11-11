/* ======================================================
   DUO NETWORK  (History tab)
   Every pairing of players, for any window of time.
   The players sit on a globe you can drag round. It is drawn as plain SVG:
   layout() works out where each player lands on screen for the current
   angle and moves the dots, names and lines there.
====================================================== */
import { getPlayerName } from "./config.js";
import { loadAllHistory } from "./data.js";

const SVGNS = "http://www.w3.org/2000/svg";
const CX = 340, CY = 330, R = 235;      // centre and size of the globe inside the 680 x 660 drawing
const CAMERA = 3.4;                      // how far away the viewer is, in globe radiuses (smaller = stronger 3D)
const SPIN = 0.0022;                     // how fast it turns on its own before you touch it
const MODE_SHORT = { Hardpoint: "HP", SND: "SND", Overload: "OVL" };
// Line colours come from seamless.css (--dn-win and --dn-loss), so they can be changed there without touching this file.
// Winning (or even) duos use --dn-win, brighter the better they do; duos that lose more than they win use --dn-loss.
const BG = [11, 9, 6];
const hex = v => { const m = /^#?([0-9a-f]{6})$/i.exec(String(v).trim()); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null; };
let WIN = [239, 230, 210], LOSS = [163, 49, 47];
function readColours() {
    const css = getComputedStyle(document.documentElement);
    WIN = hex(css.getPropertyValue("--dn-win")) || WIN;
    LOSS = hex(css.getPropertyValue("--dn-loss")) || LOSS;
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const clamp01 = x => Math.max(0, Math.min(1, x));
const winColour = wr => wr >= 0.5
    ? `rgb(${mix(mix(BG, WIN, 0.3), WIN, 0.35 + 0.65 * clamp01((wr - 0.5) / 0.22))})`
    : `rgb(${mix(mix(BG, LOSS, 0.3), LOSS, 0.35 + 0.65 * clamp01((0.5 - wr) / 0.22))})`;
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
<button type="button" class="dn-play">&#9654; REPLAY</button>
<div class="dn-range">
  <div class="dn-range-labels"><span id="dnFrom"></span><span id="dnTo"></span></div>
  <div class="dn-track"><div class="dn-fill" id="dnFill"></div>
    <input type="range" id="dnLo" min="0" step="1"><input type="range" id="dnHi" min="0" step="1"></div>
</div>
<label class="dn-min">min maps <select id="dnMin"><option>1</option><option>3</option><option selected>5</option><option>10</option><option>20</option></select></label>
<button type="button" class="dn-all">ALL TIME</button>
  </div>
  <div class="dn-main">
<div class="dn-stage"><svg viewBox="0 0 680 660" class="dn-svg"></svg><div class="dn-tip"></div></div>
<div class="dn-side" id="dnSide"></div>
  </div>
</div>`);
    root.appendChild(wrap);
    const svg = wrap.querySelector(".dn-svg");
    // Share the globe's viewBox so the decorative surround stays centred at every size.
    el("image", { href: "assets/duo-gold-surround.svg", x: 0, y: 0, width: 680, height: 660, "aria-hidden": "true", "pointer-events": "none", class: "dn-surround" }, svg);
    el("g", { id: "dnRipples" }, svg);
    const gE = el("g", { id: "dnEdges" }, svg), gHit = el("g", { id: "dnHits" }, svg), gSel = el("g", { id: "dnSel" }, svg), gN = el("g", { id: "dnNodes" }, svg);
    // spread the players evenly over the globe (a spiral from top to bottom)
    const pos = {}, n = S.ids.length;
    S.ids.forEach((id, i) => {
        const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * 2.39996;
        pos[id] = { p: [r * Math.cos(a), y, r * Math.sin(a)], x: CX, y: CY, i };
    });
    S.pos = pos; S.edges = {}; S.nodes = {};
    S.yaw = 0.4; S.pitch = 0.3; S.spin = !window.matchMedia("(prefers-reduced-motion: reduce)").matches; S.vel = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = Math.min(S.ids[i], S.ids[j]), b = Math.max(S.ids[i], S.ids[j]);   // keys are always low-high, same as the data
        const path = el("path", { d: "M0,0", class: "dn-edge", fill: "none", "stroke-linecap": "round" }, gE);
        const hit = el("path", { d: "M0,0", class: "dn-hit", fill: "none", "data-k": a + "-" + b }, gHit);
        S.edges[a + "-" + b] = { path, hit, d: "M0,0", a, b, show: false };
    }
    S.selPath = el("path", { class: "dn-selpath", fill: "none", d: "M0,0" }, gSel);
    S.ids.forEach(id => {
        const g = el("g", { class: "dn-node", "data-id": id }, gN);
        el("circle", { r: 20, class: "dn-nhit" }, g);
        const dot = el("circle", { r: 9, class: "dn-dot" }, g);
        const t = el("text", { class: "dn-name" }, g); t.textContent = nm(id);
        S.nodes[id] = { g, dot, t };
    });
    setupDrag(svg);
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
    gN.addEventListener("click", e => { const g = e.target.closest(".dn-node"); if (g && !S.dragged) pickNode(+g.dataset.id); });
    gHit.addEventListener("click", e => { if (S.dragged) return; const k = e.target.getAttribute("data-k"); if (!k) return; const [a, b] = k.split("-").map(Number); S.selA = a; S.selB = b; update({ ripple: true, origin: a }); });
    const tip = wrap.querySelector(".dn-tip"), stage = wrap.querySelector(".dn-stage");
    // the small box that follows the mouse over a line; k is "lowId-highId", or null to hide it
    S.showTip = (k, x, y) => {
        const p = k && S.agg.get(k);
        if (!p || p.g < S.min) { tip.style.display = "none"; return; }
        const [a, b] = k.split("-").map(Number), r = stage.getBoundingClientRect();
        tip.innerHTML = `<b>${nm(a)} + ${nm(b)}</b><br>${p.g} maps &nbsp;·&nbsp; ${p.w}–${p.d - p.w} (${p.d ? Math.round(100 * p.w / p.d) : 0}%)`;
        tip.style.display = "block"; tip.style.left = (x - r.left + 14) + "px"; tip.style.top = (y - r.top + 14) + "px";
    };
    gHit.addEventListener("mousemove", e => S.showTip(e.target.getAttribute("data-k"), e.clientX, e.clientY));
    gHit.addEventListener("mouseleave", () => S.showTip(null));
    S.wrap = wrap;
    start3D(stage, svg);
}

// Swap the flat drawing for the real 3D one (js/duoNetwork3d.js). If the file or WebGL
// is not available, nothing happens and the flat drawing carries on.
function start3D(stage, svg) {
    import("./duoNetwork3d.js").then(m => {
        const gl = m.createGlobe3D(stage, S, {
            pickNode,
            pickEdge: k => { const [a, b] = k.split("-").map(Number); S.selA = a; S.selB = b; update({ ripple: true, origin: a }); },
            hoverEdge: (k, x, y) => S.showTip(k, x, y)
        });
        if (!gl) return;
        S.gl = gl;
        svg.classList.add("dn-behind");      // the SVG now only shows the gold surround
        gl.sync();
    }).catch(err => console.warn("Duo network: using the flat drawing.", err));
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

/* ---------- the globe ---------- */
// Turn a point on the globe by the current angle, then flatten it to the screen.
// Returns { x, y } on the drawing and z: 1 = nearest the viewer, -1 = the far side.
function project([x, y, z]) {
    const cy = Math.cos(S.yaw), sy = Math.sin(S.yaw), cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
    const x1 = x * cy + z * sy, z1 = z * cy - x * sy;          // turn left/right
    const y2 = y * cp - z1 * sp, z2 = z1 * cp + y * sp;        // tilt up/down
    const k = CAMERA / (CAMERA - z2);                          // nearer things are drawn bigger
    return { x: CX + R * x1 * k, y: CY - R * y2 * k, z: z2 };
}
const pt = q => q.x.toFixed(1) + "," + q.y.toFixed(1);

function layout() {
    if (S.gl) return;                                          // the 3D drawing has taken over
    S.ids.forEach(id => {
        const o = S.pos[id], q = project(o.p), nd = S.nodes[id];
        o.x = q.x; o.y = q.y; o.z = q.z;
        const near = (q.z + 1) / 2;                            // 0 at the back, 1 at the front
        nd.g.setAttribute("transform", `translate(${pt(q)})`);
        nd.g.style.opacity = (0.4 + 0.6 * near) * (nd.faded ? 0.35 : 1);
        nd.dot.setAttribute("r", (6 + 5 * near).toFixed(1));
        // the name sits just outside the dot, on the side away from the centre
        let dx = q.x - CX, dy = q.y - CY; const len = Math.hypot(dx, dy) || 1;
        if (len < 24) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
        nd.t.setAttribute("x", (dx * 20).toFixed(1)); nd.t.setAttribute("y", (dy * 22 + 5).toFixed(1));
        nd.t.setAttribute("text-anchor", Math.abs(dx) < 0.3 ? "middle" : dx > 0 ? "start" : "end");
    });
    Object.values(S.edges).forEach(e => {
        if (!e.show) return;
        const A = S.pos[e.a], B = S.pos[e.b];
        const bend = project([0, 1, 2].map(i => (A.p[i] + B.p[i]) * 0.2));    // lines curve in towards the middle of the globe
        e.d = `M${pt(A)} Q${pt(bend)} ${pt(B)}`;
        e.path.setAttribute("d", e.d); e.hit.setAttribute("d", e.d);
        e.path.style.strokeOpacity = 0.45 + 0.55 * (A.z + B.z + 2) / 4;       // lines at the back are fainter
    });
    if (S.selA !== null && S.selB !== null) {
        const e = S.edges[Math.min(S.selA, S.selB) + "-" + Math.max(S.selA, S.selB)];
        const A = S.pos[e.a], B = S.pos[e.b], bend = project([0, 1, 2].map(i => (A.p[i] + B.p[i]) * 0.2));
        S.selPath.setAttribute("d", `M${pt(A)} Q${pt(bend)} ${pt(B)}`);
    }
}

// Keeps redrawing while the globe is moving (turning on its own, being dragged, or coasting after a flick).
function animate() {
    if (S.raf || S.gl) return;
    const step = () => {
        S.raf = null;
        if (S.gl) return;
        const visible = S.wrap && S.wrap.offsetParent !== null;
        if (!S.down) { S.yaw += S.vel; S.vel *= 0.94; if (Math.abs(S.vel) < 0.0004) S.vel = 0; }
        if (S.spin && !S.down) S.yaw += SPIN;
        if (visible) layout();
        if (S.spin || S.down || S.vel) S.raf = requestAnimationFrame(step);
    };
    S.raf = requestAnimationFrame(step);
}

// Drag to turn. A mouse turns it both ways; a finger turns it sideways only, so swiping up and down still scrolls the page.
function setupDrag(svg) {
    let lastX = 0, lastY = 0, moved = 0, touch = false;
    svg.addEventListener("pointerdown", e => { S.down = true; S.dragged = false; S.vel = 0; moved = 0; lastX = e.clientX; lastY = e.clientY; touch = e.pointerType === "touch"; });
    window.addEventListener("pointermove", e => {
        if (!S.down) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved < 6) return;
        if (!S.dragged) { S.dragged = true; S.spin = false; svg.classList.add("grabbing"); }
        S.yaw += dx * 0.008; S.vel = dx * 0.008;
        if (!touch) S.pitch = Math.max(-1.3, Math.min(1.3, S.pitch + dy * 0.008));
        animate();
    });
    const up = () => { if (!S.down) return; S.down = false; svg.classList.remove("grabbing"); animate(); };
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
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
    readColours();
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
        e.show = !!show; e.style = style; e.dim = dim;
        const apply = () => { e.path.style.strokeWidth = style.sw + "px"; e.path.style.stroke = style.col; e.path.style.opacity = style.op; e.hit.style.pointerEvents = show ? "stroke" : "none"; };
        clearTimeout(e.t); delay ? (e.t = setTimeout(apply, delay)) : apply();
    });
    Object.keys(S.nodes).forEach(id => {
        const nd = S.nodes[id], sel = id == S.selA || id == S.selB;
        nd.g.classList.toggle("sel", sel);
        nd.faded = focus !== null && !sel && !(S.edges[Math.min(+id, focus) + "-" + Math.max(+id, focus)] && agg.get(Math.min(+id, focus) + "-" + Math.max(+id, focus)) && agg.get(Math.min(+id, focus) + "-" + Math.max(+id, focus)).g >= S.min);
        if (opts.ripple) {
            const d = originI === null ? S.pos[id].i * 30 : Math.min(Math.abs(S.pos[id].i - originI), n - Math.abs(S.pos[id].i - originI)) * 70;
            nd.dot.animate([{ r: 9 }, { r: 15 }, { r: 9 }], { duration: 600, delay: d, easing: "ease-out" });
        }
    });
    S.selPath.style.opacity = S.selA !== null && S.selB !== null ? 1 : 0;    // the dotted line on the chosen duo
    layout(); animate();
    if (S.gl) S.gl.sync(opts);
    if (opts.ripple && !S.gl) ripple(opts.origin);
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
  <div class="dn-note">${p.g ? `#${rank} most played of ${ranked.length} duos` : "No maps together"}</div>
  <button type="button" class="dn-clear">CLEAR</button>
</div>`;
    } else if (S.selA !== null) {
        const me = S.selA;
        const rows = [...agg.values()].filter(p => (p.a === me || p.b === me)).map(p => ({ o: p.a === me ? p.b : p.a, g: p.g, w: p.w, d: p.d })).sort((x, y) => y.g - x.g);
        side.innerHTML = `
<div class="dn-card">
  <div class="dn-kicker">PARTNERS &nbsp;·&nbsp; ${range}</div>
  <div class="dn-title">${nm(me)}</div>
  <div class="dn-lh"><span>PLAYER</span><span>MAPS</span><span>RECORD</span><span>WIN</span></div>
  <div class="dn-list">${rows.map(r => `<div class="dn-row${r.g < S.min ? " faint" : ""}" data-o="${r.o}"><span class="dn-rn">${nm(r.o)}</span><span class="dn-rg">${r.g}</span><span class="dn-rr">${r.w}–${r.d - r.w}</span><span class="dn-rw" style="color:${winColour(r.d ? r.w / r.d : .5)}">${pct(r.w, r.d)}</span></div>`).join("") || "<div class='dn-hint'>No maps.</div>"}</div>
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
  <div class="dn-hint">Click a player, then a second for the duo. Drag to turn.</div>
  <div class="dn-kicker" style="margin-top:14px">MOST PLAYED</div><ul class="dn-ul">${most.map(p => li(p, q => q.g + " maps")).join("")}</ul>
  <div class="dn-kicker" style="margin-top:10px">BEST WIN RATE</div><ul class="dn-ul">${top.map(p => li(p, q => Math.round(q.wr * 100) + "% · " + q.g)).join("") || "<li><span>–</span></li>"}</ul>
  <div class="dn-kicker" style="margin-top:10px">WORST WIN RATE</div><ul class="dn-ul">${bot.map(p => li(p, q => Math.round(q.wr * 100) + "% · " + q.g)).join("") || "<li><span>–</span></li>"}</ul>
</div>`;
        side.querySelectorAll(".dn-ul li[data-k]").forEach(li => li.addEventListener("click", () => { const [a, b] = li.dataset.k.split("-").map(Number); S.selA = a; S.selB = b; update({ ripple: true, origin: a }); }));
    }
    const clr = side.querySelector(".dn-clear");
    if (clr) clr.addEventListener("click", () => { S.selA = S.selB = null; update({ ripple: true }); });
}

/* ---------- mount ---------- */
// A small icon beside the Ranks title opens the network in a full-screen panel.
function mount() {
    const head = document.getElementById("pageHead");
    if (!head || document.getElementById("duoNet")) return;
    const icon = h(`<button type="button" class="dn-icon" id="duoIcon" aria-label="Open the duo network" title="Duo network">
<svg viewBox="0 0 48 48" aria-hidden="true"><g class="dn-icon-spin"><path d="M24 7 L9 33 M24 7 L39 33 M9 33 L39 33 M24 7 Q24 26 31 20 M9 33 Q24 24 31 20 M39 33 L31 20"/><circle cx="24" cy="7" r="3.4"/><circle cx="9" cy="33" r="3.4"/><circle cx="39" cy="33" r="3.4"/><circle cx="31" cy="20" r="2.6"/></g></svg>
<span>DUOS</span></button>`);
    head.appendChild(icon);
    const box = h(`<div id="duoNet" class="dn-box dn-pop" role="dialog" aria-modal="true" aria-label="Duo network" hidden>
<div class="dn-pop-inner"><div class="dn-pop-head"><h2>DUO NETWORK</h2><button type="button" class="dn-close" aria-label="Close">&#10005;</button></div><div class="dn-body"></div></div></div>`);
    document.body.appendChild(box);
    const body = box.querySelector(".dn-body");
    let started = false;
    const close = () => { box.hidden = true; box.classList.remove("open"); document.documentElement.classList.remove("dn-open"); if (S) stopPlay(); icon.focus(); };
    icon.addEventListener("click", async () => {
        box.hidden = false; box.classList.add("open"); document.documentElement.classList.add("dn-open");
        box.querySelector(".dn-close").focus();
        if (started) { if (S && S.gl) S.gl.wake(); else if (S) animate(); return; }
        started = true;
        body.innerHTML = "<div class='dn-loading'>Loading…</div>";
        try { await loadData(); body.innerHTML = ""; build(body); update({ ripple: true }); }
        catch (err) { console.error(err); body.innerHTML = "<div class='dn-loading'>Could not load the history.</div>"; started = false; }
    });
    box.querySelector(".dn-close").addEventListener("click", close);
    box.addEventListener("click", e => { if (e.target === box) close(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !box.hidden) close(); });
}
export const setupDuoNetwork = mount;
