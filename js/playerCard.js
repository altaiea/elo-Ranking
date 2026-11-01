// ===============================
// PLAYER CARD POPUP
// ===============================
// The card opens hovering on a corner, wings side up, above two open hands
// (hands.webp) that rise out of the dark. Tapping the card straightens it and
// turns it over to the player; the hands stay until the popup is closed.

import {
    CARDS_WITH_WINGS_UNDERLAY, CARD_PLAYER_IDS, DATE_BOX_RIGHT_SIDE, INTRO_VIDEO_CLASSES, cardAssets
} from "./config.js";
import { cardRatings, ratingTierClass } from "./ratings.js";
import { reduceMotion, setRatingColor } from "./ui.js";
import { openModeModal } from "./modeModal.js";

const ADJUST_CLASSES = CARD_PLAYER_IDS.map(id => `player${id}-adjust`);
const TIER_CLASSES = ["rating-80", "rating-90", "rating-98"];
const VIDEO_CLASSES = Object.values(INTRO_VIDEO_CLASSES);
const VIDEO_WAIT_MS = 6000;     // never hold the flip longer than this for a slow video

let getPlayers = () => [];
let loadToken = 0;

export function backgroundFor(id) {
    return CARDS_WITH_WINGS_UNDERLAY.has(id)
        ? `url('${cardAssets.art(id)}'), url('${cardAssets.wings}')`
        : `url('${cardAssets.art(id)}')`;
}

/* ---------------------------
   MEDIA WARMING
   A player's art and intro are fetched ahead of the click: when the pointer
   hovers or a finger touches their card, and slowly in the background on fast
   connections, so videos start without buffering.
---------------------------- */
const warmed = new Set();

export function warmPlayerMedia(id) {
    id = Number(id);
    if (!id || warmed.has(id)) return;
    warmed.add(id);
    const img = new Image();
    img.decoding = "async";
    img.src = cardAssets.art(id);
    const intro = cardAssets.intro(id);
    if (intro) {
        const video = document.createElement("video");
        video.preload = "auto";
        video.muted = true;
        video.src = intro;
        video.load();
    }
}

export function warmAllInBackground() {
    const c = navigator.connection || {};
    if (c.saveData || (c.effectiveType && c.effectiveType !== "4g")) return;
    CARD_PLAYER_IDS.forEach((id, i) => setTimeout(() => warmPlayerMedia(id), 2500 * (i + 1)));
}

function waitForImage(src) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(resolve);
        img.onerror = resolve;
        img.src = src;
    });
}

// Ready once the browser expects to play to the end without stalling. The
// videos are encoded to start while they download, so this no longer waits for
// the whole file.
function waitForVideo(video, src) {
    return new Promise(resolve => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            ["canplaythrough", "error", "abort"].forEach(e => video.removeEventListener(e, finish));
            resolve();
        };
        const timer = setTimeout(finish, VIDEO_WAIT_MS);
        ["canplaythrough", "error", "abort"].forEach(e => video.addEventListener(e, finish));
        video.preload = "auto";
        video.src = src;
        video.load();
        if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) finish();
    });
}

/* ---------------------------
   FLOATING CARD
---------------------------- */
let cardEnterAnim = null, cardFloatAnim = null, cardTapHandler = null, cardTapBox = null, handsAnim = null, cardPulseAnim = null;

// Everything is laid out for a 1100 x 700 window and scaled to fit the real one.
function floatLayout(box) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const s = Math.min(vh / 700, vw / 1100);
    const handsW = 770 * s, handsH = 1.5 * handsW;          // hands.webp is 2:3 (portrait)
    const spare = Math.max(0, vh - 700 * s);                // tall screens (phones): lift the whole scene a little
    const imgTop = vh - 0.69 * handsH - spare * 0.4;         // the hands sit near the bottom edge
    const cardCenter = imgTop + 0.344 * handsH;              // just above the fingertips, between the thumbs
    const boxCenter = box.offsetTop + box.offsetHeight / 2;
    const ty = cardCenter - boxCenter, sc = 0.7 * s;
    const pose = (dy, rz, rx, ry) =>
        `translateY(${ty + dy * s}px) perspective(1100px) scale(${sc}) rotateZ(${rz}deg) rotateX(${rx}deg) rotateY(${ry}deg)`;
    // After the card has turned over it keeps levitating above the hands, upright and a touch larger.
    const tyUp = imgTop + 0.325 * handsH - boxCenter, scUp = 0.82 * s;
    const up = (dy, rz, ry) =>
        `translateY(${tyUp + dy * s}px) perspective(1100px) scale(${scUp}) rotateZ(${rz}deg) rotateX(0deg) rotateY(${ry}deg)`;
    return { handsW, imgTop, a: pose(-9, -1, 19, -3), b: pose(9, 1, 15, 3), ua: up(-10, -1.2, -3), ub: up(10, 1.2, 3) };
}

export function cardHandsEl() {
    let el = document.getElementById("cardHands");
    if (!el) {
        el = document.createElement("img");
        el.id = "cardHands";
        el.src = cardAssets.hands;
        el.alt = "";
        el.draggable = false;
        document.getElementById("playerModal").appendChild(el);
    }
    return el;
}

function showCardHands(layout) {
    const el = cardHandsEl();
    if (handsAnim) handsAnim.cancel();
    el.style.width = layout.handsW + "px";
    el.style.top = layout.imgTop + "px";
    el.style.display = "block";
    handsAnim = el.animate([
        { opacity: 0, transform: "translate(-50%, 7%)" },
        { opacity: 1, transform: "translate(-50%, 0)" }
    ], { duration: 1100, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" });
    // once risen, the hands keep breathing gently until the popup is closed
    const rise = handsAnim;
    rise.finished.then(() => {
        if (handsAnim !== rise) return;
        handsAnim = el.animate([{ transform: "translate(-50%, 0)" }, { transform: "translate(-50%, 7px)" }],
            { duration: 3200, direction: "alternate", iterations: Infinity, easing: "ease-in-out" });
        rise.cancel();
    }).catch(() => {});
}

function hideCardHands() {
    const el = document.getElementById("cardHands");
    if (!el) return;
    if (handsAnim) { handsAnim.cancel(); handsAnim = null; }
    el.style.display = "none";
}

function stopCardFloat() {
    if (cardEnterAnim) { cardEnterAnim.cancel(); cardEnterAnim = null; }
    if (cardFloatAnim) { cardFloatAnim.cancel(); cardFloatAnim = null; }
    if (cardTapBox && cardTapHandler) cardTapBox.removeEventListener("click", cardTapHandler);
    if (cardPulseAnim) { cardPulseAnim.cancel(); cardPulseAnim = null; }
    if (cardTapBox) cardTapBox.classList.remove("floating-card", "awaiting-tap");
    cardTapHandler = cardTapBox = null;
    hideCardHands();
}

// Swing in from the carousel and settle into the floating pose. Resolves when it is hovering.
function startCardFloat(box) {
    stopCardFloat();
    const L = floatLayout(box);
    box.__floatPoses = L;
    cardEnterAnim = box.animate([
        { opacity: 0, transform: "perspective(1100px) rotateY(-180deg) scale(0.6)", offset: 0 },
        { opacity: 1, offset: 0.2 },
        { opacity: 1, transform: L.a, offset: 1 }
    ], { duration: 900, easing: "cubic-bezier(.25,.8,.25,1)", fill: "forwards" });
    const enter = cardEnterAnim;
    showCardHands(L);
    return enter.finished.then(() => {
        if (cardEnterAnim !== enter) return false;
        cardFloatAnim = box.animate([{ transform: L.a }, { transform: L.b }],
            { duration: 2600, direction: "alternate", iterations: Infinity, easing: "ease-in-out" });
        enter.cancel(); cardEnterAnim = null;
        return true;
    }).catch(() => false);
}

// Wait for a tap on the floating card, then straighten it while it turns over.
function armCardReveal(box, onReveal) {
    cardTapBox = box;
    box.classList.add("floating-card", "awaiting-tap");
    // the card breathes (and its glow pulses, see style.css) to say "click me"
    const pulseEl = box.querySelector(".container");
    if (pulseEl) {
        cardPulseAnim = pulseEl.animate(
            [{ transform: "scale(1)" }, { transform: "scale(1.055)" }, { transform: "scale(1)" }],
            { duration: 1500, iterations: Infinity, easing: "ease-in-out" });
    }
    cardTapHandler = () => {
        box.removeEventListener("click", cardTapHandler);
        box.classList.remove("floating-card", "awaiting-tap");
        if (cardPulseAnim) {
            const from = pulseEl ? getComputedStyle(pulseEl).transform : "none";
            cardPulseAnim.cancel(); cardPulseAnim = null;
            if (pulseEl && from !== "none") pulseEl.animate([{ transform: from }, { transform: "none" }], { duration: 160, easing: "ease-out" });
        }
        const current = getComputedStyle(box).transform;
        if (cardFloatAnim) { cardFloatAnim.cancel(); cardFloatAnim = null; }
        // straighten up while turning over, then keep levitating above the hands until the popup is closed
        const L = box.__floatPoses;
        const settle = box.animate([{ transform: current === "none" ? L.a : current }, { transform: L.ua }],
            { duration: 1000, easing: "cubic-bezier(.3,.7,.2,1)", fill: "forwards" });
        cardEnterAnim = settle;
        settle.finished.then(() => {
            if (cardEnterAnim !== settle) return;
            cardFloatAnim = box.animate([{ transform: L.ua }, { transform: L.ub }],
                { duration: 2800, direction: "alternate", iterations: Infinity, easing: "ease-in-out" });
            settle.cancel(); cardEnterAnim = null;
        }).catch(() => {});
        cardTapHandler = cardTapBox = null;
        onReveal();
    };
    box.addEventListener("click", cardTapHandler);
}

// Elastic flip: the card turns over past the finish, springs back and settles, flexing a little as a real card does.
function elasticFlip(card) {
    card.style.transition = "none";
    const dur = 1300, count = 40, frames = [];
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1), sec = t * dur / 1000;
        const p = i === count - 1 ? 1 : 1 - Math.exp(-6.5 * sec) * Math.cos(9 * sec);   // spring: overshoots, then settles at 1
        const bend = Math.sin(Math.PI * p);                                              // strongest at the edge-on moment
        frames.push({
            transform: `rotateY(${180 * p}deg) skewY(${-9 * bend}deg) scale(${1 - 0.07 * Math.abs(bend)})`,
            offset: t
        });
    }
    const anim = card.animate(frames, { duration: dur, easing: "linear" });
    const done = () => { try { anim.cancel(); } catch (_) {} card.style.transition = ""; };
    anim.finished.then(done).catch(done);
}

/* ---------------------------
   CARD FACE
   Fills the shared card markup (#playerModal .container) for one player.
   Used by the popup and by the Head-to-Head cards.
---------------------------- */
export function fillCard(card, p, players, { clickableModes = false } = {}) {
    const ratings = cardRatings(p, players);

    card.classList.remove(...TIER_CLASSES, ...ADJUST_CLASSES);
    const tier = ratingTierClass(ratings.overall);
    if (tier) card.classList.add(tier);
    // Every player has an independent coordinate override class (style.css).
    if (CARD_PLAYER_IDS.includes(p.id)) card.classList.add(`player${p.id}-adjust`);

    const ratingEl = card.querySelector(".rating");
    ratingEl.textContent = ratings.overall;
    setRatingColor(ratingEl, ratings.overall);

    const dateBox = card.querySelector(".date-box");
    const right = DATE_BOX_RIGHT_SIDE.has(p.id);
    dateBox.style.left = right ? "auto" : "36px";
    dateBox.style.right = right ? "40px" : "auto";
    dateBox.style.top = "28px";

    const circles = [
        [card.querySelector(".col1.row1"), "Hardpoint", ratings.hp],
        [card.querySelector(".col2.row1"), "Overload", ratings.overload],
        [card.querySelector(".col3.row1"), "Search & Destroy", ratings.snd]
    ];
    circles.forEach(([el, name, mode]) => {
        el.textContent = mode.rating;
        setRatingColor(el, mode.rating);
        el.onclick = clickableModes ? () => openModeModal(name, mode, p) : null;
    });

    card.querySelector(".back").style.backgroundImage = backgroundFor(p.id);
    return [ratingEl, ...circles.map(([el]) => el)];
}

/* ---------------------------
   OPEN / CLOSE
---------------------------- */
export function openPlayerModal(playerId) {
    const modal = document.getElementById("playerModal");
    const players = getPlayers();
    const p = players.find(x => x.id === Number(playerId));
    if (!modal || !p) return;

    modal.style.display = "block";

    // Entrance: the card swings in from the carousel and settles in front.
    const modalBox = modal.querySelector(".modal-content");
    const motion = !reduceMotion();
    modalBox.classList.remove("modal-enter");
    void modalBox.offsetWidth;                 // restart the backdrop fade
    modalBox.classList.add("modal-enter");
    const floatReady = motion ? startCardFloat(modalBox) : (stopCardFloat(), Promise.resolve(false));

    const card = modal.querySelector(".card");
    const video = document.getElementById("cardBackVideo");

    // The same modal is reused for every player, so clear what the last one left behind.
    card.classList.remove("flipped");
    video.pause();
    video.onended = null;
    video.style.display = "none";
    video.classList.remove(...VIDEO_CLASSES);

    const statEls = fillCard(card, p, players, { clickableModes: true });
    const setStatsVisible = visible => statEls.forEach(el => { el.style.visibility = visible ? "visible" : "hidden"; });

    // Intro cards keep their numbers off the video until it has finished.
    const introSrc = cardAssets.intro(p.id);
    setStatsVisible(!introSrc);
    if (introSrc && INTRO_VIDEO_CLASSES[p.id]) video.classList.add(INTRO_VIDEO_CLASSES[p.id]);

    // The wings side stays up while the art and video load; the card is never
    // turned over before both are ready.
    const token = ++loadToken;
    const imageReady = waitForImage(cardAssets.art(p.id));
    const videoReady = introSrc ? waitForVideo(video, introSrc) : Promise.resolve();

    const revealCard = () => {
        card.classList.add("flipped");
        if (motion) elasticFlip(card);
        if (!introSrc) return;
        if (!video.error && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            try { video.currentTime = 0; } catch (_) {}
            video.style.display = "block";
            const playing = video.play();
            if (playing && playing.catch) playing.catch(() => {});
            video.onended = () => {
                // Remove the intro first, exposing the card art, then reveal stats.
                video.style.display = "none";
                setStatsVisible(true);
            };
        } else {
            // The intro failed to load: show the card without it.
            setStatsVisible(true);
        }
    };

    Promise.all([imageReady, videoReady, floatReady]).then(([, , hovering]) => {
        // The visitor may have opened a different player, or closed the card, meanwhile.
        if (token !== loadToken || modal.style.display === "none") return;
        // The card hovers on its wings side until it is tapped, then it turns over.
        if (hovering) armCardReveal(modalBox, () => { if (token === loadToken) revealCard(); });
        else revealCard();
    });
}

export function closePlayerModal() {
    const modal = document.getElementById("playerModal");
    const video = document.getElementById("cardBackVideo");
    if (!modal || modal.style.display === "none") return;
    loadToken++;       // cancels any readiness callback from the card being closed
    stopCardFloat();
    modal.style.display = "none";
    video.pause();
    video.onended = null;
    video.style.display = "none";
    modal.querySelector(".card").classList.remove("flipped");
    modal.querySelectorAll(".rating, .col1.row1, .col2.row1, .col3.row1").forEach(el => {
        el.style.visibility = "visible";
    });
}

export function isPlayerModalOpen() {
    const modal = document.getElementById("playerModal");
    return !!modal && modal.style.display === "block";
}

export function setupPlayerModal(playersGetter) {
    getPlayers = playersGetter;
    const modal = document.getElementById("playerModal");
    modal.addEventListener("click", e => { if (e.target === modal) closePlayerModal(); });
}
