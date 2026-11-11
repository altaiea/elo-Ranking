// ======================================================
// HAND OF CARDS (Ranks page and Cards page)
// ======================================================
// The players' cards held as a fanned hand. A drag moves the cards 1:1 with
// the finger, a flick carries on, and a spring settles on the nearest card.
// Up/down swipes are left to the page, so a phone can still scroll.

import { CARD_PLAYER_IDS, cardAssets } from "./config.js";
import { totalLosses, totalWins } from "./data.js";

const SPRING = 170, DAMPING = 22;      // a touch of overshoot when it settles
const FAN_DEGREES = 8.5;               // angle between neighbouring cards
const FINGER_PX_PER_CARD = 0.55;       // as a share of the card's width
const CARD_WIDTH = 180, CARD_WIDTH_PHONE = 260;

const ratio = (a, b) => b ? a / b : a;
export const kdOf = (p, mode) => mode
    ? ratio(p[mode + "Kills"] || 0, p[mode + "Deaths"] || 0)
    : ratio(p.lifetimeKills || 0, p.lifetimeDeaths || 0);

// root is an empty element; the hand is built inside it.
//   onSelect(id)  the card in the middle changed
//   onOpen(id)    the middle card was tapped (or, with openOnArrive, any card once it gets there)
export function createCardHand(root, { onSelect = () => {}, onOpen = () => {}, openOnArrive = false } = {}) {
    const ids = CARD_PLAYER_IDS, n = ids.length;
    root.classList.add("hand");
    root.tabIndex = 0;
    root.setAttribute("aria-label", "Player cards");
    root.innerHTML = `<div class="hand-floor"></div><div class="hand-track"></div>`;
    const track = root.querySelector(".hand-track");
    const cards = ids.map((id, i) => {
        const card = document.createElement("div");
        card.className = "hand-card";
        card.dataset.i = i;
        card.dataset.id = id;
        card.innerHTML = `<img src="${cardAssets.thumb(id)}" alt="" draggable="false" decoding="async">`;
        track.append(card);
        return card;
    });

    let pos = 0, vel = 0, target = 0;          // in cards: 2.5 is half-way between card 2 and card 3
    let drag = null, frame = 0, last = 0, selected = -1, wheelTimer = 0, pendingOpen = null;

    const isPhone = () => document.documentElement.classList.contains("is-phone");
    const cardWidth = () => isPhone() ? CARD_WIDTH_PHONE : Math.min(CARD_WIDTH, Math.max(90, root.clientWidth / 4.6));
    const wrap = d => { d = ((d % n) + n) % n; return d > n / 2 ? d - n : d; };   // shortest way round
    const pxPerCard = () => cardWidth() * FINGER_PX_PER_CARD;

    function draw() {
        const w = cardWidth();
        root.style.setProperty("--card-w", w + "px");
        cards.forEach((card, i) => {
            const d = wrap(i - pos), away = Math.abs(d);
            const opacity = Math.max(0, Math.min(1, 7 - away));
            card.style.transform = `translateZ(${-away * 2}px) rotate(${d * FAN_DEGREES}deg) translateY(${-(1 - Math.min(away, 1)) * w * .18}px)`;
            card.style.opacity = opacity;
            card.style.visibility = opacity ? "" : "hidden";
            card.classList.toggle("on", away < .5);
        });
        const index = ((Math.round(pos) % n) + n) % n;
        if (index !== selected) { selected = index; onSelect(ids[index]); }
    }

    function tick(now) {
        frame = 0;
        if (drag && drag.moved) return;
        const dt = Math.min(32, now - last) / 1000;
        last = now;
        vel += (-SPRING * (pos - target) - DAMPING * vel) * dt;
        pos += vel * dt;
        if (pendingOpen !== null && Math.abs(pos - target) < .12) { const id = pendingOpen; pendingOpen = null; onOpen(id); }
        if (Math.abs(pos - target) < .002 && Math.abs(vel) < .02) { pos = target; vel = 0; draw(); return; }
        draw();
        frame = requestAnimationFrame(tick);
    }
    const run = () => { if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick); } };

    root.addEventListener("pointerdown", e => {
        pendingOpen = null;
        drag = { id: e.pointerId, x: e.clientX, startPos: pos, moved: false, samples: [[e.timeStamp, pos]] };
    });
    root.addEventListener("pointermove", e => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.x;
        if (!drag.moved && Math.abs(dx) > 6) {
            drag.moved = true;
            root.classList.add("grabbing");
            try { root.setPointerCapture(e.pointerId); } catch (_) {}
        }
        if (!drag.moved) return;
        pos = drag.startPos - dx / pxPerCard();
        drag.samples.push([e.timeStamp, pos]);
        if (drag.samples.length > 8) drag.samples.shift();
        draw();
    });
    const release = e => {
        if (!drag || e.pointerId !== drag.id) return;
        const d = drag;
        drag = null;
        root.classList.remove("grabbing");
        if (d.moved) {
            // Speed over the last 90 ms of the drag decides how far the flick carries.
            const first = d.samples.find(s => e.timeStamp - s[0] < 90) || d.samples[d.samples.length - 1];
            const dt = (e.timeStamp - first[0]) / 1000;
            vel = dt > .008 ? Math.max(-40, Math.min(40, (pos - first[1]) / dt)) : 0;
            target = Math.round(pos + vel * .2);
        } else if (e.type === "pointerup") {
            const card = e.target.closest && e.target.closest(".hand-card");
            if (card) {
                const i = Number(card.dataset.i), offset = wrap(i - pos);
                target = Math.round(pos + offset);
                if (Math.abs(offset) < .5) onOpen(ids[i]);
                else if (openOnArrive) pendingOpen = ids[i];
            }
        } else {
            target = Math.round(pos);
        }
        run();
    };
    root.addEventListener("pointerup", release);
    root.addEventListener("pointercancel", release);
    root.addEventListener("dragstart", e => e.preventDefault());
    // Sideways trackpad swipes (or shift + wheel) turn the hand.
    root.addEventListener("wheel", e => {
        const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
        if (!dx) return;
        e.preventDefault();
        cancelAnimationFrame(frame); frame = 0; vel = 0;
        pos += dx / pxPerCard();
        draw();
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => { target = Math.round(pos); run(); }, 90);
    }, { passive: false });
    root.addEventListener("keydown", e => {
        if (e.key === "ArrowRight") target = Math.round(target) + 1;
        else if (e.key === "ArrowLeft") target = Math.round(target) - 1;
        else if (e.key === "Enter") { onOpen(ids[selected]); return; }
        else return;
        e.preventDefault();
        run();
    });
    window.addEventListener("resize", draw);
    draw();

    return {
        draw,                                   // call when the hand becomes visible
        selected: () => ids[selected],
        goTo(id) {
            const i = ids.indexOf(Number(id));
            if (i < 0) return;
            target = Math.round(pos + wrap(i - pos));
            run();
        }
    };
}

// The strip under a hand: who is in the middle, their numbers, and two buttons.
export function showPlayerReadout(el, p) {
    if (!p) { el.innerHTML = ""; return; }
    const stat = (value, label) => `<div class="readout-stat"><b>${value}</b><span>${label}</span></div>`;
    el.innerHTML = `
        <div><div class="readout-rank">Rank ${p.currentRank}</div><div class="readout-name">${p.name}</div></div>
        <div class="readout-stats">
            ${stat(Math.round(p.elo), "Elo")}
            ${stat(`${totalWins(p)}-${totalLosses(p)}`, "W/L")}
            ${stat(kdOf(p).toFixed(2), "K/D")}
            ${stat(kdOf(p, "hp").toFixed(2), "HP K/D")}
            ${stat(kdOf(p, "snd").toFixed(2), "S&amp;D K/D")}
            ${stat(kdOf(p, "overload").toFixed(2), "OVL K/D")}
        </div>
        <div class="readout-buttons">
            <button class="gold-btn" type="button" data-player-action="open" data-id="${p.id}">Open card</button>
            <button class="gold-btn ghost" type="button" data-player-action="compare" data-id="${p.id}">Compare</button>
        </div>`;
}
