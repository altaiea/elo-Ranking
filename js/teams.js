/* ======================================================
   TEAMS TAB
   Auto builder (best 4 v 4 from 8 players), manual builder, and the team
   line-up popup: mini cards joined by lines coloured by chemistry.
====================================================== */
import { cardAssets } from "./config.js";
import { loadAllHistory } from "./data.js";
import { bestSplit, buildChemistry, chemBand, chemKey, teamStats } from "./ratings.js";
import { closePopup, reduceMotion, showPopup } from "./ui.js";

let players = [];

const EASE_OUT = "cubic-bezier(.2,.8,.2,1)";

/* ---------------------------
   CHEMISTRY DATA
---------------------------- */
let chemData = null, chemPromise = null;

export function chemEnsure() {
    if (chemData) return Promise.resolve(chemData);
    if (!chemPromise) {
        chemPromise = loadAllHistory()
            .then(days => (chemData = buildChemistry(days)))
            .catch(err => { chemPromise = null; throw err; });
    }
    return chemPromise;
}

/* ---------------------------
   DROPDOWNS
---------------------------- */
const optionsHtml = placeholder => `<option value="">${placeholder}</option>` +
    players.map(p => `<option value="${p.id}">${p.name}</option>`).join("");

function fillSelects(selects, placeholder) {
    selects.forEach(sel => {
        const keep = sel.value;
        sel.innerHTML = optionsHtml(placeholder);
        if (players.some(p => String(p.id) === keep)) sel.value = keep;
    });
}

// A player chosen in one box is greyed out in the others of the same builder.
function lockDuplicates(selects) {
    const chosen = selects.map(s => s.value).filter(Boolean);
    selects.forEach(s => {
        [...s.options].forEach(opt => {
            if (opt.value) opt.disabled = chosen.includes(opt.value) && opt.value !== s.value;
        });
    });
}

const autoSelects = () => [...document.querySelectorAll(".team-player")];
const manualSelects = () => [...document.querySelectorAll(".manual-select")];

/* ---------------------------
   STRENGTH BARS
---------------------------- */
function setStrength(barId, textId, value) {
    const bar = document.getElementById(barId);
    bar.classList.remove("strength-high", "strength-medium", "strength-low");
    bar.classList.add(value >= 47 ? "strength-high" : value >= 35 ? "strength-medium" : "strength-low");
    bar.style.width = value + "%";
    document.getElementById(textId).textContent = value.toFixed(1) + "%";
}

/* ======================================================
   TEAM LINEUP VIEW (mini cards joined by lines)
====================================================== */
// Where the four cards sit inside a team's box, as % of its width / height.
const LINEUP_SPOTS = [[50, 19], [16, 47], [84, 47], [50, 75]];
const LINEUP_LINES = [[0, 1], [0, 2], [1, 3], [2, 3], [0, 3], [1, 2]];   // every card is joined to every other

function teamLineupBlock(label, team, avg, prob, cls) {
    const line = (cls2, a, b, attrs) =>
        `<line class="${cls2}" data-i="${a}" data-j="${b}" ${attrs} x1="${LINEUP_SPOTS[a][0]}" y1="${LINEUP_SPOTS[a][1]}" x2="${LINEUP_SPOTS[b][0]}" y2="${LINEUP_SPOTS[b][1]}"></line>`;
    const lines = LINEUP_LINES.map(([a, b]) => line("chem-loading", a, b, `data-a="${team[a].id}" data-b="${team[b].id}"`)).join("");
    const hits = LINEUP_LINES.map(([a, b]) => line("chem-hit", a, b, `data-pa="${team[a].id}" data-pb="${team[b].id}"`)).join("");
    const badges = LINEUP_LINES.map(([a, b]) => {
        const t = (a === 0 && b === 3) ? 0.3 : 0.5;   // the two long diagonals cross in the middle, so one badge moves up
        const x = LINEUP_SPOTS[a][0] + (LINEUP_SPOTS[b][0] - LINEUP_SPOTS[a][0]) * t, y = LINEUP_SPOTS[a][1] + (LINEUP_SPOTS[b][1] - LINEUP_SPOTS[a][1]) * t;
        return `<span class="chem-badge" data-i="${a}" data-j="${b}" data-a="${team[a].id}" data-b="${team[b].id}" style="left:${x}%; top:${y}%;"></span>`;
    }).join("");
    const cards = team.map((p, i) => `
        <div class="lineup-card" style="left:${LINEUP_SPOTS[i][0]}%; top:${LINEUP_SPOTS[i][1]}%;">
            <img src="${cardAssets.thumb(p.id)}" alt="${p.name}" title="${p.name}" decoding="async">
            <img class="lineup-wings" src="${cardAssets.wingsThumb}" alt="">
            <span class="lineup-name">${p.name}</span>
        </div>`).join("");
    return `
        <div class="lineup-team ${cls}">
            <div class="lineup-title">${label}</div>
            <div class="lineup-board">
                <svg class="lineup-lines" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}${hits}</svg>
                ${badges}
                ${cards}
            </div>
            <div class="lineup-stats">
                <div><span class="lineup-num">${avg.toFixed(1)}</span><span class="lineup-cap">Avg Elo</span></div>
                <div><span class="lineup-num">${(prob * 100).toFixed(1)}%</span><span class="lineup-cap">Win</span></div>
                <div><span class="lineup-num chem-team">&ndash;</span><span class="lineup-cap">Chem</span></div>
            </div>
        </div>`;
}

function teamLineupHtml(teamA, teamB, t) {
    return `
        <div class="lineup-wrap">
            ${teamLineupBlock("Team A", teamA, t.avgA, t.probA, t.probA >= t.probB ? "lineup-fav" : "")}
            ${teamLineupBlock("Team B", teamB, t.avgB, t.probB, t.probB > t.probA ? "lineup-fav" : "")}
        </div>`;
}

// each link runs between the middles of the two card edges that face each other
function lineupEdges() {
    document.querySelectorAll("#popupContent .lineup-board").forEach(board => {
        const card = board.querySelector(".lineup-card");
        if (!card || !board.offsetHeight) return;
        const hw = card.offsetWidth / 2 / board.offsetWidth * 100, hh = card.offsetHeight / 2 / board.offsetHeight * 100;
        // which edge of card i faces card j: T/B/L/R
        const EDGE = { "0-1": "LT", "0-2": "RT", "1-3": "BL", "2-3": "BR", "0-3": "BT", "1-2": "RL" };
        const pt = (i, e) => [LINEUP_SPOTS[i][0] + (e === "L" ? -hw : e === "R" ? hw : 0), LINEUP_SPOTS[i][1] + (e === "T" ? -hh : e === "B" ? hh : 0)];
        board.querySelectorAll(".lineup-lines line[data-i]").forEach(ln => {
            const i = +ln.dataset.i, j = +ln.dataset.j, e = EDGE[i + "-" + j];
            const [x1, y1] = pt(i, e[0]), [x2, y2] = pt(j, e[1]);
            ln.setAttribute("x1", x1); ln.setAttribute("y1", y1); ln.setAttribute("x2", x2); ln.setAttribute("y2", y2);
        });
    });
}

// paints every link, fills each badge (hidden until its link is clicked) and the team Chem figure
function chemApply() {
    document.querySelectorAll("#popupContent .lineup-team").forEach(team => {
        const ratings = [];
        team.querySelectorAll(".lineup-lines line[data-a]").forEach(ln => {
            const info = chemData && chemData.get(chemKey(+ln.dataset.a, +ln.dataset.b));
            ln.classList.remove("chem-loading", "chem-none", "chem-red", "chem-amber", "chem-green", "chem-purple");
            ln.classList.add(info ? "chem-" + info.band : "chem-none");
            if (info) ratings.push(info.rating);
            const badge = team.querySelector(`.chem-badge[data-a="${ln.dataset.a}"][data-b="${ln.dataset.b}"]`);
            if (badge) {
                const shown = badge.classList.contains("show"), opened = badge.classList.contains("open");
                badge.className = "chem-badge" + (info ? " chem-" + info.band : " chem-none") + (shown ? " show" : "") + (opened ? " open" : "");
                badge.innerHTML = info ? `${info.rating}<small>${info.wins}-${info.games - info.wins}</small>` : "–";
            }
        });
        const num = team.querySelector(".chem-team");
        if (num) {
            if (ratings.length >= 3) {
                const avg = Math.round(ratings.reduce((x, y) => x + y, 0) / ratings.length);
                num.textContent = avg;
                num.style.color = { red: "#ff4d4d", amber: "#ffb020", green: "#39ff6a", purple: "#A855F7" }[chemBand(avg)];
            } else { num.innerHTML = "&ndash;"; num.style.color = ""; }
        }
    });
}

// click a link to show its number; only one is open at a time, click it again or click away to close
function onLineupClick(e) {
    const bd = e.target.closest && e.target.closest("#popupContent .chem-badge");
    if (bd) { if (bd.querySelector("small")) bd.classList.toggle("open"); return; }   // click the number to see the win-loss
    const ln = e.target.closest && e.target.closest("#popupContent .lineup-lines line");
    const board = ln && ln.closest(".lineup-board");
    const a = ln && (ln.dataset.a || ln.dataset.pa), b = ln && (ln.dataset.b || ln.dataset.pb);
    const badge = board && board.parentNode.querySelector(`.chem-badge[data-a="${a}"][data-b="${b}"]`);
    const wasOpen = badge && badge.classList.contains("show");
    document.querySelectorAll("#popupContent .chem-badge.show").forEach(el => el.classList.remove("show", "open"));
    document.querySelectorAll("#popupContent .lineup-lines line.sel").forEach(el => el.classList.remove("sel"));
    if (!badge || wasOpen) return;
    const x = (+ln.getAttribute("x1") + +ln.getAttribute("x2")) / 2, y = (+ln.getAttribute("y1") + +ln.getAttribute("y2")) / 2;
    badge.style.left = x + "%"; badge.style.top = y + "%";
    badge.classList.add("show");
    board.querySelectorAll(`.lineup-lines line[data-a="${a}"][data-b="${b}"]`).forEach(el => el.classList.add("sel"));
}

function countUp(el, to, decimals, suffix, dur, delay) {
    const start = performance.now() + delay;
    el.textContent = (0).toFixed(decimals) + suffix;
    (function tick(now) {
        const t = Math.min(1, Math.max(0, (now - start) / dur));
        const e = 1 - Math.pow(1 - t, 3);
        el.textContent = (to * e).toFixed(decimals) + suffix;
        if (t < 1) requestAnimationFrame(tick);
    })(performance.now());
}

/* ---------------------------
   LINE-UP CINEMATIC
   One deck of 8 on a firing-range table; the camera follows each card as it
   is dealt and turned over, then climbs to the flat view. Returns how long it runs.
---------------------------- */
function playLineupFx() {
    const root = document.getElementById("popupContent");
    const popup = document.getElementById("popupCard");
    const wrap = root.querySelector(".lineup-wrap");
    if (!wrap) return;
    const teams = [...wrap.querySelectorAll(".lineup-team")];
    popup.classList.add("lineup-cine");

    // ---- 1. measure everything while the layout is still flat
    const plan = teams.map(team => {
        const board = team.querySelector(".lineup-board");
        const bb = board.getBoundingClientRect();
        const cards = [...team.querySelectorAll(".lineup-card")].map(c => {
            const r = c.getBoundingClientRect();
            return { c, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
        });
        return { team, board, bb, cards };
    });

    // ---- 2. dress the scene
    wrap.classList.add("scene");
    // static firing-range backdrop: flat full-body targets behind the table (not part of the camera move)
    const bdrop = document.createElement("div"); bdrop.className = "fx-backdrop";
    bdrop.innerHTML = "<div class='bd-in'>" + [[17, -1, .3], [50, -3, .33], [83, -1, .3]].map(([x, y, k]) =>
        `<div class="rm-stand bd-t" style="left:${x}%;top:${y}%;transform:translateX(-50%) scale(${k})"><i class='rs-glow'></i><i class='rs-cable'></i><i class='rs-carrier'></i><i class='rs-board'></i><i class='rs-win a'></i><i class='rs-win b'></i><i class='rs-paper'></i><i class='rs-clip a'></i><i class='rs-clip b'></i></div>`).join("") + "</div>";
    popup.insertBefore(bdrop, popup.firstChild);
    // the table carries on past its front edge, so the edge nearest the camera never shows
    const tableExt = document.createElement("div"); tableExt.className = "fx-tableext"; wrap.insertBefore(tableExt, wrap.firstChild);
    { const g = document.createElement("img"); g.src = cardAssets.gun; g.className = "lineup-gun"; g.alt = ""; g.draggable = false; wrap.appendChild(g); }
    const vig = document.createElement("div"); vig.className = "fx-vignette"; wrap.appendChild(vig);
    const grain = document.createElement("div"); grain.className = "fx-grain"; popup.appendChild(grain);
    const barT = document.createElement("div"), barB = document.createElement("div");
    barT.className = "fx-bar top"; barB.className = "fx-bar bottom"; popup.append(barT, barB);

    // one card at a time: deal -> camera follows -> turn it over -> camera zooms out -> next card, left, right, left, right...
    // deal order: left top, right top, left outer, left inner, right inner, right outer, left bottom, right bottom
    // (slots: 0 top, 1 outer-side, 2 inner-side, 3 bottom; for the right team the slot positions mirror, so 1/2 swap)
    // (the two outer cards arrive together, then the two inner cards together)
    const DEAL_ORDER = [[0, 0], [1, 0], [0, 1], [1, 2], [0, 2], [1, 1], [0, 3], [1, 3]];
    const evOf = seq => seq < 2 ? seq : seq < 6 ? 2 + Math.floor((seq - 2) / 2) : seq - 2;   // 6 beats: L-top, R-top, outer pair, inner pair, L-bottom, R-bottom
    const dealIndex = (ti, i) => DEAL_ORDER.findIndex(([a, b]) => a === ti && b === i);
    const SLIDE0 = 580, CYCLE0 = 1200, START = 700, FLIP0 = 180, TURN0 = 60;
    // cards 3-6 (the middle four) are played at double speed; 1, 2, 7 and 8 keep the full-length treatment
    const spd = k => (k === 2 || k === 3) ? 0.5 : 1 / 1.2;   // pairs: double speed; the other four: 20 % faster
    const SLIDE_OF = k => SLIDE0 * spd(k), CYCLE_OF = k => CYCLE0 * spd(k), FLIP_OF = k => FLIP0 * spd(k), TURN_OF = k => TURN0 * spd(k);
    const dealAt = k => { let t = START + 150; for (let j = 0; j < k; j++) t += CYCLE_OF(j); return t; };
    const lastFlip = dealAt(5) + SLIDE_OF(5) + TURN_OF(5) + FLIP_OF(5) * 2;
    const RISE = lastFlip + 120, RISE_DUR = 1700;
    const done = RISE + RISE_DUR;
    bdrop.animate([{ opacity: 1 }, { opacity: 1, offset: 0.97 }, { opacity: 0 }], { duration: done + 500, fill: "forwards" }).onfinish = () => bdrop.remove();

    // ---- 3. camera: wide shot -> follows the dealt card -> stays on it while it turns -> pulls back out -> next card
    wrap.style.transformOrigin = "50% 55%";
    const lerp = (x, y, t) => x + (y - x) * t;
    const wr0 = wrap.getBoundingClientRect();
    const wcx = wr0.left + wr0.width / 2, wcy = wr0.top + wr0.height / 2;
    const HW = wr0.width / 2, HH = wr0.height / 2;
    const cardsByDeal = [], evCards = [];
    plan.forEach((P, ti) => P.cards.forEach((K, i) => {
        (evCards[evOf(dealIndex(ti, i))] = evCards[evOf(dealIndex(ti, i))] || []).push({ nx: (K.cx - wcx) / HW, ny: (K.cy - wcy) / HH });
    }));
    evCards.forEach((list, e) => { cardsByDeal[e] = { nx: list.reduce((a, c) => a + c.nx, 0) / list.length, ny: list.reduce((a, c) => a + c.ny, 0) / list.length, pair: list.length > 1 }; });
    const _ch = plan[0].cards[0].h, _WH = wrap.offsetHeight;
    const DECK = { nx: 0, ny: ((_WH - _ch - 46) + _ch / 2 - _WH / 2) / (_WH / 2) };
    const smooth = u => u * u * (3 - 2 * u);
    const N = 300, dt = done / N, alpha = 1 - Math.exp(-dt / 95);
    let fx = 0, fy = 0, gz = 0;
    const camKeys = [];
    const bdKeys = [], bdIn = bdrop.firstChild;
    // projection helpers: how the table looks (tilt = far edge width / near edge width, and where its far edge sits) for a given camera
    const CW = wrap.offsetWidth, CH = wrap.offsetHeight;
    const project = (ty, tx, rx, sc) => {
        const m = new DOMMatrix(); m.m34 = -1 / 900;
        m.translateSelf(tx, ty, 0); m.rotateAxisAngleSelf(1, 0, 0, rx); m.scaleSelf(sc, sc, 1);
        const P = (x, y) => { const q = m.transformPoint(new DOMPoint(x, y, 0, 1)); return [q.x / q.w, q.y / q.w]; };
        const tl = P(-CW / 2, -CH * .55), tr = P(CW / 2, -CH * .55), bl = P(-CW / 2, CH * .45), br = P(CW / 2, CH * .45);
        return { ratio: (tr[0] - tl[0]) / (br[0] - bl[0]), top: (tl[1] + tr[1]) / 2 };
    };
    const pr0 = popup.getBoundingClientRect();
    const boardBottom = Math.min(...[...bdrop.querySelectorAll(".rs-board")].map(e => e.getBoundingClientRect().bottom)) - pr0.top;
    const bdOy = bdrop.offsetHeight * 0.3;
    const wideTop = project(66, 0, 57, 0.84).top;
    for (let i = 0; i <= N; i++) {
        const ms = done * i / N;
        let tx_ = 0, ty_ = 0, zt = 0;                       // target focus and target zoom (0 = wide, 1 = on the card)
        const rel = ms - dealAt(0);
        if (rel >= -250 && ms < RISE) {
            let k = 0; while (k < 5 && ms >= dealAt(k + 1)) k++;
            const u = ms - dealAt(k);                       // time inside this card's cycle
            const C = cardsByDeal[k];
            if (u < SLIDE_OF(k)) {                                // following the flying card
                const p = 1 - Math.pow(1 - Math.max(0, u) / SLIDE_OF(k), 3.3);
                tx_ = lerp(DECK.nx, C.nx, p); ty_ = lerp(DECK.ny, C.ny, p); zt = C.pair ? .4 : 1;
            } else if (u < SLIDE_OF(k) + TURN_OF(k) + FLIP_OF(k) * 2 + 40 * spd(k)) {  // staying on it while it turns over
                tx_ = C.nx; ty_ = C.ny; zt = C.pair ? .4 : 1;
            } else { tx_ = 0; ty_ = 0; zt = 0; }            // pull back out to the wide shot
            if (u < 0 && k === 0 || (u < 0 && k > 0)) { tx_ = DECK.nx; ty_ = DECK.ny; zt = k === 0 ? 0.0 : 0; }
        }
        fx += (tx_ - fx) * alpha; fy += (ty_ - fy) * alpha;
        gz += (zt - gz) * (1 - Math.exp(-dt / 140));
        const g = ms < RISE ? gz : gz * Math.max(0, 1 - (ms - RISE) / 450);
        let ty, tx, rx, rz, ry, sc, ce = 0;
        if (ms <= RISE) {
            const t = ms / RISE;
            ty = lerp(66, 58, t); tx = 0; rx = lerp(57, 55, t); rz = 0; sc = lerp(0.84, 0.90, t); ry = 0;
        } else {
            const u = (ms - RISE) / RISE_DUR, e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; ce = e;
            ty = lerp(58, 0, e); tx = 0; rx = lerp(55, 0, e); rz = 0; sc = lerp(0.90, 1, e); ry = 0;
        }
        const b0 = { ty, tx, rx, sc };
        sc += .25 * g;
        tx += -fx * HW * .78 * g;
        ty += -fy * HH * .55 * g;
        
        
        
        // hold the table's apparent tilt while following: solve for the pitch that gives the same far/near ratio as the un-followed shot
        const refP = project(b0.ty, b0.tx, b0.rx, b0.sc);
        if (g > 0.0005) {
            let lo = rx - 14, hi = rx + 14;
            for (let it = 0; it < 14; it++) { const mid = (lo + hi) / 2; if (project(ty, tx, mid, sc).ratio > refP.ratio) lo = mid; else hi = mid; }
            rx = (lo + hi) / 2;
        }
        const curP = project(ty, tx, rx, sc);
        { const bs = 1 + (sc - 0.84) * 0.45;
          const bx = tx * 0.32, by = (curP.top - wideTop) - ce * 300 - (bs - 1) * (boardBottom - bdOy);
          bdKeys.push({ transform: i === N ? "translate(0px, -300px) scale(1)" : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${bs.toFixed(4)})`, offset: i / N }); }
        camKeys.push({ transform: i === N ? "none" : `perspective(900px) translateY(${ty.toFixed(2)}px) translateX(${tx.toFixed(2)}px) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg) rotateZ(${rz.toFixed(3)}deg) scale(${sc.toFixed(4)})`, offset: i / N });
    }
    bdIn.animate(bdKeys, { duration: done, easing: "linear", fill: "both" });
    tableExt.animate([{ opacity: 1 }, { opacity: 1, offset: RISE / done }, { opacity: 0, offset: Math.min(1, (RISE + RISE_DUR * 0.55) / done) }, { opacity: 0 }], { duration: done, fill: "forwards" });
    wrap.animate(camKeys, { duration: done, easing: "linear", fill: "backwards" }).onfinish = () => { wrap.style.transformOrigin = ""; };

    vig.animate([{ opacity: 1 }, { opacity: 1, offset: RISE / done }, { opacity: .35 }], { duration: done, fill: "forwards" });
    grain.animate([{ opacity: .22 }, { opacity: .22, offset: .8 }, { opacity: 0 }], { duration: done + 400, fill: "forwards" }).onfinish = () => grain.remove();
    [barT, barB].forEach((b, i) => {
        const dir = i ? 1 : -1;
        b.animate([{ transform: "translateY(0)" }, { transform: "translateY(0)", offset: RISE / (RISE + 900) }, { transform: `translateY(${dir * 100}%)` }],
            { duration: RISE + 900, easing: "ease-in-out", fill: "forwards" }).onfinish = () => b.remove();
    });
    wrap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: "backwards" });

    // ---- 4. one deck of 8 in the middle of the table; every card dealt comes off it
    const wr = wrap.getBoundingClientRect();
    const cw = plan[0].cards[0].w, ch = plan[0].cards[0].h;
    const WW = wrap.offsetWidth, WH = wrap.offsetHeight;
    const deckLeft = (WW - cw) / 2, deckTop = WH - ch - 46;
    const deckX = wr.left + deckLeft + cw / 2, deckY = wr.top + deckTop + ch / 2;
    const deck = document.createElement("div");
    deck.className = "fx-deck";
    deck.style.cssText = `position:absolute;left:${deckLeft}px;top:${deckTop}px;width:${cw}px;height:${ch}px;z-index:0;pointer-events:none;filter:blur(.8px)`;
    const layers = [];
    for (let k = 0; k < 8; k++) {
        const d = document.createElement("div");
        d.style.cssText = `position:absolute;inset:0;border-radius:6px;background:url('${cardAssets.wings}') center/cover,#08141a;box-shadow:0 ${1 + k * .8}px ${3 + k * 1.5}px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.22);transform:translate(${(k % 3 - 1) * .7}px,${-k * 1.8}px) rotate(${(k % 4 - 1.5) * .6}deg)`;
        deck.appendChild(d); layers.push(d);
    }
    wrap.appendChild(deck);
    deck.animate([{ translate: "0 80px", opacity: 0 }, { translate: "0 0", opacity: 1 }], { duration: 650, easing: EASE_OUT, fill: "backwards" });
    deck.animate([{ opacity: 1 }, { opacity: 1 }], { duration: dealAt(5) + 400 }).onfinish = () => deck.remove();   // removed once the last card has left

    plan.forEach((P, ti) => {
        const { team, board, bb, cards } = P;

        team.querySelector(".lineup-stats").animate([{ opacity: 0 }, { opacity: 0, offset: .99 }, { opacity: 1 }], { duration: done + 300, fill: "backwards" });
        team.querySelector(".lineup-title").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, delay: RISE + 200, fill: "both" });

        cards.forEach((K, i) => {
            const { c, cx, cy } = K;
            const img = c.querySelector("img:not(.lineup-wings)"), wings = c.querySelector(".lineup-wings"), name = c.querySelector(".lineup-name");
            wings.style.display = "block";
            const dealt = dealIndex(ti, i), ev = evOf(dealt);
            const dx = deckX - (cx + 14), dy = deckY - (cy + 14);
            const side = (i % 2 ? 1 : -1);
            const delay = dealAt(ev);
            layers[7 - dealt].animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1, delay, fill: "forwards" });   // the top card leaves the deck
            c.style.zIndex = 1 + i;
            // casino flick: the card is spun off the deck, skates flat across the felt and slows to a stop
            const frames = [], FN = 40, spin = side * (540 + dealt * 40);
            for (let f = 0; f <= FN; f++) {
                const t = f / FN;
                const p = f === FN ? 1 : 1 - Math.pow(1 - t, 3.3);
                const q = f === FN ? 1 : 1 - Math.pow(1 - t, 2.4);
                frames.push({
                    translate: `${(dx * (1 - p)).toFixed(2)}px ${(dy * (1 - p)).toFixed(2)}px`,
                    scale: "1",
                    rotate: `${(f === FN ? side * 2.5 : spin * (1 - q) + side * 2.5 * q).toFixed(2)}deg`,
                    filter: f === FN ? "blur(0px)" : `blur(${(2.4 * Math.max(0, 1 - t * 1.8)).toFixed(2)}px)`,
                    opacity: f === 0 ? 0 : 1,
                    offset: t
                });
            }
            frames[1].opacity = 1;
            c.animate(frames, { duration: SLIDE_OF(ev), delay, easing: "linear", fill: "both" });
            // slap: a quick puff on the felt where it stops
            const puff = document.createElement("div");
            puff.style.cssText = `position:absolute;left:${LINEUP_SPOTS[i][0]}%;top:${LINEUP_SPOTS[i][1]}%;width:100px;height:30px;margin:-15px 0 0 -50px;border-radius:50%;background:radial-gradient(ellipse,rgba(255,255,255,.22),transparent 70%);opacity:0;pointer-events:none;z-index:0`;
            board.appendChild(puff);
            puff.animate([{ opacity: 0, scale: ".5" }, { opacity: 1, scale: "1", offset: .3 }, { opacity: 0, scale: "1.7" }], { duration: 600, delay: delay + SLIDE_OF(ev) * .5, easing: "ease-out", fill: "forwards" }).onfinish = () => puff.remove();
            // after it has stopped it lies a touch crooked, then squares up as the camera climbs
            c.animate([{ rotate: `${side * 2.5}deg` }, { rotate: "0deg" }], { duration: 900, delay: RISE + 100, easing: "ease-in-out", fill: "both" });
            // fake flip: wings fade out, player turns up
            const SL = SLIDE_OF(ev), FLIP = FLIP_OF(ev), fAt = delay + SL + TURN_OF(ev);
            c.animate([{ scale: "1", translate: "0 0" }, { scale: "1.17", translate: "0 -12px", offset: .5 }, { scale: "1", translate: "0 0" }], { duration: FLIP * 2, delay: fAt, easing: "ease-in-out" });
            wings.animate([{ scale: "1 1" }, { scale: "0 1" }], { duration: FLIP, delay: fAt, easing: "ease-in", fill: "both" }).onfinish = () => { wings.style.display = "none"; };
            img.animate([{ scale: "0 1" }, { scale: "1 1" }], { duration: FLIP, delay: fAt + FLIP, easing: "ease-out", fill: "backwards" });
            name.animate([{ opacity: 0, translate: "0 -8px", scale: ".8" }, { opacity: 1, translate: "0 0", scale: "1" }], { duration: 450, delay: lastFlip + 60 + dealt * 55, easing: EASE_OUT, fill: "both" });   // names only once all 8 are on the table
            // glint where it turns over
            const glint = document.createElement("div");
            glint.style.cssText = `position:absolute;left:${LINEUP_SPOTS[i][0]}%;top:${LINEUP_SPOTS[i][1]}%;width:80px;height:80px;margin:-40px 0 0 -40px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.9),rgba(0,234,255,.5) 40%,transparent 70%);opacity:0;pointer-events:none;mix-blend-mode:screen;z-index:0`;
            board.appendChild(glint);
            glint.animate([{ opacity: 0, scale: ".4" }, { opacity: 1, scale: "1.3", offset: .35 }, { opacity: 0, scale: "2" }], { duration: 650, delay: fAt + FLIP, easing: "ease-out", fill: "forwards" }).onfinish = () => glint.remove();
        });

        // lines + numbers once the camera has come up
        const base = RISE + RISE_DUR - 450 + ti * 120;
        team.querySelectorAll(".lineup-lines line").forEach((ln, i) => {
            const x1 = +ln.getAttribute("x1"), y1 = +ln.getAttribute("y1");
            const x2 = +ln.getAttribute("x2"), y2 = +ln.getAttribute("y2");
            ln.setAttribute("x2", x1); ln.setAttribute("y2", y1);
            const start = performance.now() + base + i * 150;
            (function tick(now) {
                const t = Math.min(1, Math.max(0, (now - start) / 380));
                const e = 1 - Math.pow(1 - t, 3);
                ln.setAttribute("x2", x1 + (x2 - x1) * e);
                ln.setAttribute("y2", y1 + (y2 - y1) * e);
                if (t < 1) requestAnimationFrame(tick);
            })(performance.now());
        });
        const nums = team.querySelectorAll(".lineup-num");
        if (nums[0]) countUp(nums[0], parseFloat(nums[0].textContent), 1, "", 900, base + 500);
        if (nums[1]) countUp(nums[1], parseFloat(nums[1].textContent), 1, "%", 900, base + 500);
        if (team.classList.contains("lineup-fav")) {
            team.animate([
                { boxShadow: "0 0 0 rgba(57,255,106,0)" },
                { boxShadow: "0 0 30px rgba(57,255,106,.55)" },
                { boxShadow: "0 0 14px rgba(57,255,106,.18)" }
            ], { duration: 900, delay: base + 1300, easing: "ease-out", fill: "backwards" });
        }
    });
    return done;
}

/* ---------------------------
   LINE-UP CLOSE BUTTON: a little wings card in the corner.
   Tapping it pulls all 8 cards into it, then the popup closes.
---------------------------- */
const CLOSE_ORDER = [[0, 0], [1, 0], [0, 1], [0, 2], [1, 1], [1, 2], [0, 3], [1, 3]];

function addCloseCard(pop, arriveAt) {
    let busy = false;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fx-close fx-cardback";
    b.setAttribute("aria-label", "Close");
    b.innerHTML = "<span class='fx-mini'></span>";
    b.style.pointerEvents = "none";
    pop.appendChild(b);
    // arrives once the camera has finished its climb
    b.animate([{ opacity: 0, scale: ".3", rotate: "-90deg", easing: "linear" }, { opacity: 0, scale: ".3", rotate: "-90deg", offset: arriveAt / (arriveAt + 500), easing: "cubic-bezier(.3,1.4,.5,1)" }, { opacity: 1, scale: "1", rotate: "0deg" }],
        { duration: arriveAt + 500, easing: "linear", fill: "both" }).onfinish = () => { b.style.pointerEvents = ""; };

    b.addEventListener("click", () => {
        if (busy) return;
        busy = true;
        const wrap = pop.querySelector(".lineup-wrap");
        const teams = [...wrap.querySelectorAll(".lineup-team")];
        const cards = CLOSE_ORDER.map(([ti, i]) => teams[ti].querySelectorAll(".lineup-card")[i]);
        const bb = b.getBoundingClientRect(), target = { x: bb.left + bb.width / 2, y: bb.top + bb.height / 2 };
        wrap.querySelectorAll(".lineup-name, .lineup-stats, .lineup-lines, .lineup-title, .chem-badge").forEach(el =>
            el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" }));
        const dur = 600, stag = 80, t0 = 200, shrink = .12;
        cards.slice().reverse().forEach((c, n) => {
            const r = c.getBoundingClientRect();
            const dx = target.x - (r.left + r.width / 2), dy = target.y - (r.top + r.height / 2), side = n % 2 ? 1 : -1;
            c.animate([
                { translate: "0 0", scale: "1", rotate: "0deg", opacity: 1 },
                { translate: `${dx * .55}px ${dy * .55 - 30}px`, scale: String((1 + shrink) / 2 + .1), rotate: `${side * 14}deg`, opacity: 1, offset: .5 },
                { translate: `${dx}px ${dy}px`, scale: String(shrink), rotate: `${side * 24}deg`, opacity: 1 }
            ], { duration: dur, delay: t0 + n * stag, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" });
            c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, delay: t0 + n * stag + dur - 80, fill: "forwards" });
        });
        const T = t0 + 7 * stag + dur;
        b.animate([{ scale: "1" }, { scale: "1.3", offset: .85 }, { scale: "0.2", opacity: 0 }], { duration: T + 200, easing: "ease-in-out", fill: "forwards" });
        pop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: T + 120, fill: "forwards" }).onfinish = closePopup;
    });
}

function showLineup(teamA, teamB) {
    const stats = teamStats(teamA, teamB);
    showPopup(teamLineupHtml(teamA, teamB, stats), {
        onOpen: pop => {
            lineupEdges();
            if (!reduceMotion()) {
                const done = playLineupFx();
                addCloseCard(pop, done || 8000);
            }
            chemEnsure().then(chemApply).catch(() => chemApply());
        }
    });
    return stats;
}

const errorPopup = text => showPopup(`<h2>Error</h2><p>${text}</p>`);

/* ---------------------------
   SETUP
---------------------------- */
export function setupTeams() {
    // Collapsible panels
    document.querySelectorAll(".team-toggle").forEach(btn => {
        btn.addEventListener("click", () => {
            const open = document.getElementById(btn.dataset.target).classList.toggle("open");
            btn.textContent = open ? btn.textContent.replace("▼", "▲") : btn.textContent.replace("▲", "▼");
            btn.setAttribute("aria-expanded", String(open));
        });
    });

    autoSelects().forEach(sel => sel.addEventListener("change", () => lockDuplicates(autoSelects())));
    manualSelects().forEach(sel => sel.addEventListener("change", () => {
        lockDuplicates(manualSelects());
        const ready = manualSelects().every(s => s.value);
        document.getElementById("simulateMatchBtn").style.display = ready ? "inline-block" : "none";
    }));

    document.getElementById("generateTeams").addEventListener("click", () => {
        const chosen = autoSelects().map(s => Number(s.value)).filter(Boolean);
        if (chosen.length !== 8 || new Set(chosen).size !== 8) {
            errorPopup("Please select 8 unique players.");
            return;
        }
        const best = bestSplit(chosen.map(id => players.find(p => p.id === id)));
        const stats = showLineup(best.teamA, best.teamB);
        setStrength("strengthA", "strengthAText", stats.probA * 100);
        setStrength("strengthB", "strengthBText", stats.probB * 100);
    });

    document.getElementById("simulateMatchBtn").addEventListener("click", () => {
        const idsOf = cls => [...document.querySelectorAll(cls)].map(s => Number(s.value));
        const teamAIds = idsOf(".manualA"), teamBIds = idsOf(".manualB");
        const all = [...teamAIds, ...teamBIds];
        if (all.some(id => !id) || new Set(all).size !== 8) {
            errorPopup("Please select 8 different players.");
            return;
        }
        const find = id => players.find(p => p.id === id);
        const stats = showLineup(teamAIds.map(find), teamBIds.map(find));
        setStrength("manualStrengthA", "manualStrengthAText", stats.probA * 100);
        setStrength("manualStrengthB", "manualStrengthBText", stats.probB * 100);
    });

    document.addEventListener("click", onLineupClick);
}

export function showTeams(list) {
    players = list;
    fillSelects(autoSelects(), "Select Player");
    fillSelects(manualSelects(), "Select Player");
    lockDuplicates(autoSelects());
    lockDuplicates(manualSelects());
}
