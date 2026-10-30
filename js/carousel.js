/* ======================================================
   CARDS TAB: ROTATING CAROUSEL
   JS is the single owner of the ring's rotation. Drag to spin, tap a card
   to spin to it and open it.
====================================================== */
import { CARD_PLAYER_IDS, cardAssets } from "./config.js";
import { cardHandsEl, openPlayerModal, warmPlayerMedia } from "./playerCard.js";
import { playClickSound, reduceMotion } from "./ui.js";

const AUTO_SPEED = -360 / 18000;  // degrees per millisecond
const DRAG_SENSITIVITY = 0.6;
const DRAG_THRESHOLD = 5;
const FOLLOW_EASE = 0.38;         // follow the finger/mouse tightly
const TARGET_EASE = 0.13;
const TAP_EASE = 0.28;            // faster spin when you tap a card
const OPEN_WITHIN_DEG = 7;        // open the card when nearly there, not exactly there
const OPEN_MAX_MS = 380;          // ...and never wait longer than this
const RESUME_DELAY = 900;
const IMAGE_WAIT_MS = 1500;       // longest the first deal waits for the card pictures

let slider = null;
let items = [];
let images = [];
let playersReady = () => false;
let imagesReady = null;

// Builds the ring. The small thumbnails (about 25 KB each) are used here; the
// full card art is only loaded when a card is opened.
function buildItems() {
    slider.style.setProperty("--quantity", CARD_PLAYER_IDS.length);
    items = CARD_PLAYER_IDS.map((id, i) => {
        const item = document.createElement("div");
        item.className = "item";
        item.style.setProperty("--position", i + 1);
        item.dataset.playerId = id;
        item.innerHTML = `
            <div class="card-face carousel-front"><img src="${cardAssets.thumb(id)}" decoding="async" alt="" draggable="false"></div>
            <div class="card-face carousel-back"><img src="${cardAssets.wingsThumb}" decoding="async" alt="" draggable="false"></div>`;
        return item;
    });
    slider.replaceChildren(...items);
    images = [...slider.querySelectorAll("img")];
    images.forEach(img => {
        img.style.pointerEvents = "none";
        img.style.userSelect = "none";
        img.style.webkitUserDrag = "none";
        img.addEventListener("error", () => { img.src = cardAssets.wingsThumb; }, { once: true });
    });
}

// Resolves when every carousel picture is downloaded AND decoded, so the deal
// never has a card pop in or stutter mid-flight (the old first-deal glitch:
// lazy, full-size pictures were still decoding while the cards flew).
function whenImagesReady() {
    if (!imagesReady) {
        const all = Promise.all(images.map(img =>
            (img.complete ? Promise.resolve() : new Promise(r => { img.addEventListener("load", r, { once: true }); img.addEventListener("error", r, { once: true }); }))
                .then(() => img.decode ? img.decode().catch(() => {}) : null)));
        imagesReady = Promise.race([all, new Promise(r => setTimeout(r, IMAGE_WAIT_MS))]);
    }
    return imagesReady;
}

export function setupCarousel(isPlayersReady) {
    slider = document.querySelector("#carouselPage .slider");
    if (!slider) return;
    playersReady = isPlayersReady;
    buildItems();

    const quantity = items.length;
    const step = 360 / quantity;

    let rotation = 0;
    let targetRotation = 0;
    let lastTime = null;
    let autoRunning = true;
    let isPointerDown = false;
    let isDragging = false;
    let activePointerId = null;
    let pointerStartX = 0;
    let pointerStartRotation = 0;
    let resumeTimer = null;
    let modalOpening = false;
    let lastTickIndex = null;      // which card slot the carousel last passed
    let lastTickTime = 0;
    let introRunning = false;
    let loopRunning = false;

    slider.style.animation = "none";
    slider.style.transition = "none";
    slider.style.touchAction = "none";
    slider.style.cursor = "grab";
    slider.style.willChange = "transform";
    items.forEach(item => { item.style.cursor = "grab"; });

    function applyRotation() {
        slider.style.transform = `perspective(2000px) rotateX(-16deg) rotateY(${rotation}deg)`;
    }

    function stopAuto() {
        autoRunning = false;
        lastTime = null;
        if (resumeTimer) {
            clearTimeout(resumeTimer);
            resumeTimer = null;
        }
    }

    function resumeAuto(delay = RESUME_DELAY) {
        if (resumeTimer) clearTimeout(resumeTimer);
        resumeTimer = setTimeout(() => {
            if (!isPointerDown && !modalOpening) {
                autoRunning = true;
                lastTime = null;
            }
        }, delay);
    }

    function shortestTargetFor(index) {
        const desired = -index * step;
        const turns = Math.round((targetRotation - desired) / 360);
        return desired + turns * 360;
    }

    function animateToItem(item) {
        const index = items.indexOf(item);
        if (index < 0) return;
        const playerId = Number(item.dataset.playerId);

        stopAuto();
        modalOpening = true;
        targetRotation = shortestTargetFor(index);
        playClickSound();
        warmPlayerMedia(playerId);

        // The render loop handles the easing. Open the card once the ring has
        // (nearly) reached it.
        const startedAt = performance.now();
        const waitForArrival = () => {
            if (!modalOpening) return;
            const closeEnough = Math.abs(targetRotation - rotation) < OPEN_WITHIN_DEG;
            if (closeEnough || performance.now() - startedAt > OPEN_MAX_MS) {
                if (playersReady()) {
                    openPlayerModal(playerId);
                    modalOpening = false;
                    resumeAuto();
                } else {
                    setTimeout(waitForArrival, 50);   // player data is still loading
                }
                return;
            }
            requestAnimationFrame(waitForArrival);
        };
        requestAnimationFrame(waitForArrival);
    }

    function onPointerDown(event) {
        if (modalOpening || introRunning) return;
        isPointerDown = true;
        isDragging = false;
        activePointerId = event.pointerId;
        pointerStartX = event.clientX;
        pointerStartRotation = targetRotation;

        const pressed = event.target.closest && event.target.closest(".item");
        if (pressed) warmPlayerMedia(pressed.dataset.playerId);

        stopAuto();
        slider.style.cursor = "grabbing";
        try { slider.setPointerCapture(event.pointerId); } catch (_) {}
        event.preventDefault();
    }

    function onPointerMove(event) {
        if (!isPointerDown || event.pointerId !== activePointerId || modalOpening) return;
        const deltaX = event.clientX - pointerStartX;
        if (!isDragging && Math.abs(deltaX) >= DRAG_THRESHOLD) {
            isDragging = true;
            lastTickIndex = Math.round(rotation / step);
            lastTickTime = performance.now();
            playClickSound();
        }
        if (!isDragging) return;
        event.preventDefault();
        targetRotation = pointerStartRotation + deltaX * DRAG_SENSITIVITY;
    }

    function releasePointer(event) {
        isPointerDown = false;
        activePointerId = null;
        slider.style.cursor = "grab";
        try { slider.releasePointerCapture(event.pointerId); } catch (_) {}
    }

    // A tap is handled here, from pointerup: the browser's own click event is
    // unreliable with pointer capture, especially on touch screens.
    function finishPointer(event) {
        if (!isPointerDown || event.pointerId !== activePointerId) return;
        const wasDragging = isDragging;
        isDragging = false;
        releasePointer(event);
        if (wasDragging) {
            targetRotation = rotation;    // freeze exactly where it was released, no momentum
        } else {
            const tapped = document.elementFromPoint(event.clientX, event.clientY);
            const item = tapped ? tapped.closest(".item") : null;
            if (item && slider.contains(item)) animateToItem(item);
        }
        resumeAuto();
    }

    function cancelPointer(event) {
        if (!isPointerDown || (event.pointerId !== undefined && event.pointerId !== activePointerId)) return;
        isDragging = false;
        releasePointer(event);
        targetRotation = rotation;
        resumeAuto();
    }

    slider.addEventListener("pointerdown", onPointerDown, { passive: false });
    slider.addEventListener("pointermove", onPointerMove, { passive: false });
    slider.addEventListener("pointerup", finishPointer);
    slider.addEventListener("pointercancel", cancelPointer);
    slider.addEventListener("lostpointercapture", cancelPointer);
    slider.addEventListener("dragstart", e => e.preventDefault());
    // Hovering a card starts fetching its art and intro.
    slider.addEventListener("pointerover", e => {
        const item = e.target.closest && e.target.closest(".item");
        if (item && e.pointerType === "mouse") warmPlayerMedia(item.dataset.playerId);
    });

    function render(timestamp) {
        // Only runs while the Cards tab is on screen (see showCarousel).
        if (document.hidden || slider.offsetParent === null) {
            loopRunning = false;
            lastTime = null;
            return;
        }

        if (lastTime === null) lastTime = timestamp;
        const delta = Math.min(timestamp - lastTime, 40);
        lastTime = timestamp;

        if (autoRunning && !isPointerDown && !modalOpening) targetRotation += AUTO_SPEED * delta;

        // Smoothly follow the target. During a drag the target itself follows the pointer.
        const ease = isDragging ? FOLLOW_EASE : (modalOpening ? TAP_EASE : TARGET_EASE);
        const difference = targetRotation - rotation;
        rotation += difference * (1 - Math.pow(1 - ease, delta / 16.67));
        if (Math.abs(difference) < 0.001) rotation = targetRotation;

        // Ratchet: one metallic clink each time a card slot passes the front
        // while dragging (or while spinning to a tapped card).
        if (isDragging || modalOpening) {
            const slot = Math.round(rotation / step);
            if (lastTickIndex === null) lastTickIndex = slot;
            if (slot !== lastTickIndex) {
                lastTickIndex = slot;
                const nowMs = performance.now();
                if (nowMs - lastTickTime > 45) {      // never faster than ~22 per second
                    lastTickTime = nowMs;
                    playClickSound();
                }
            }
        } else {
            lastTickIndex = null;
        }
        if (!introRunning) applyRotation();
        requestAnimationFrame(render);
    }

    function startLoop() {
        if (loopRunning) return;
        loopRunning = true;
        lastTime = null;
        requestAnimationFrame(render);
    }
    document.addEventListener("visibilitychange", () => { if (!document.hidden) startLoop(); });

    // Shrink the whole ring on narrow screens so every card is on screen, whatever the device.
    // It uses the separate `scale` property, so it never interferes with the spin or the intro.
    function fitRing() {
        const s = Math.max(0.36, Math.min(1, window.innerWidth / 960));
        slider.style.scale = s < 1 ? String(s) : "";
        slider.style.top = s < 0.7 ? "6%" : "";       // phones: sit the ring higher so there is no big empty gap
    }
    fitRing();
    window.addEventListener("resize", fitRing);
    applyRotation();

    // ---- Cards tab intro ----
    // A deck at the left spreads into a fan. The cards then leave the fan one at a time and drop into
    // their slots while the ring spins, which eases down to its normal auto-rotation as the last card lands.
    // Cards that land showing the other side turn over early in their flight, never when they land.
    function playIntro() {
        if (introRunning) return;
        introRunning = true;
        stopAuto();
        const startRotation = rotation;   // the ring may already be turned, so everything below uses its absolute angle
        const FAN_RY = 0;                 // the deck and fan start face-up

        const RADIUS = 400, TILT = -16, CAM = 2000;
        const rad = d => d * Math.PI / 180;
        const T = (x, y, z, ry, rz) =>
            `translate3d(${x}px, ${y}px, ${z}px) rotateY(${ry}deg) rotateZ(${rz}deg)`;
        const facing = (x, y, z, ry) => {
            const c = Math.cos(rad(TILT)), s = Math.sin(rad(TILT));
            const px = x, py = y * c - z * s, pz = y * s + z * c;
            const nx = Math.sin(rad(ry)), nz = Math.cos(rad(ry));
            const wy = -nz * s, wz = nz * c;
            const dot = nx * (0 - px) + wy * (0 - py) + wz * (CAM - pz);
            return dot / Math.hypot(nx, wy, wz) / Math.hypot(px, py, CAM - pz);
        };
        const MARGIN = Math.sin(rad(7));
        const easeOut = u => 1 - Math.pow(1 - u, 3);
        const easeOutBack = u => { const c1 = 0.7, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
        const smooth = x => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
        const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;

        // Timing (ms)
        const DECK_HOLD = 120, FAN_STAGGER = 13, FAN_TIME = 460, FAN_HOLD = 30, GAP = 48, FLIGHT = 780, DT = 30;
        // Fan geometry
        const SPREAD = 6.4, FAN_R = 105, PIVOT_X = -300, PIVOT_Y = -5, DECK_X = -300, DECK_Y = -60;

        const n = items.length, mid = (n - 1) / 2;
        const firstLeave = DECK_HOLD + (n - 1) * FAN_STAGGER + FAN_TIME + FAN_HOLD;
        const total = firstLeave + (n - 1) * GAP + FLIGHT;

        // Human-style timing: the fan opens like a thumb riffle and cards are dealt with a slightly
        // uneven rhythm. The first and last card keep exact timing, so the total length never changes.
        const easeSine = x => 0.5 - 0.5 * Math.cos(Math.PI * x);
        const noise = i => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };   // 0..1, the same every time
        const edge = x => Math.sin(Math.PI * x);                                                               // 0 at both ends
        const fanDelay = p => (n - 1) * FAN_STAGGER * easeSine(p / (n - 1));
        const dealDelay = k => {
            const x = k / (n - 1);
            const eased = 0.6 * x + 0.4 * easeSine(x);
            return (n - 1) * GAP * eased + (noise(k + 40) - 0.5) * 12 * edge(x);
        };

        // The ring spins up while the cards are dealt in, then eases down to its normal
        // auto-rotation speed exactly as the last card lands.
        const W_END = AUTO_SPEED, W_START = -0.14;
        const rotAt = t => {
            const c = Math.max(0, Math.min(t, total)), s = c / total;
            return startRotation + W_END * c + (W_START - W_END) * (total / 3) * (1 - Math.pow(1 - s, 3));
        };

        const anims = items.map((item, k) => {
            const a = (k * step) % 360;
            const p = n - 1 - k;                               // card 1 is on top of the fan and leaves first
            const leave = firstLeave + dealDelay(k), land = leave + FLIGHT;

            // Which face shows once the card lands depends on where the spinning ring has got to.
            const aLand = a + rotAt(land);
            const back = facing(RADIUS * Math.sin(rad(aLand)), 0, RADIUS * Math.cos(rad(aLand)), aLand) < 0;
            const want = back ? -1 : 1;
            const stays = !back;                               // cards that land face-up never turn over
            const m = Math.round((FAN_RY - (a + rotAt(leave))) / 360);   // keeps the turn short

            const deck = { x: DECK_X + p * 0.7, y: DECK_Y - p * 1.1, z: 190 + p * 1.2, ry: FAN_RY, rz: 0 };
            const th = (p - mid) * SPREAD;
            const fan = { x: PIVOT_X + FAN_R * Math.sin(rad(th)), y: PIVOT_Y - FAN_R * Math.cos(rad(th)), z: 190 + p * 3, ry: FAN_RY, rz: th };
            const sweepStart = DECK_HOLD + fanDelay(p);
            const sweepTime = FAN_TIME * (0.97 + 0.06 * noise(p + 7));      // each card swings out a touch differently
            const spinTurns = -(1 + (k % 3 === 0 ? 1 : 0));                 // skimmed onto a turntable: spins about its own vertical axis

            // The card's pose in the frame the ring spins in front of (before the ring's own spin).
            const poseAt = t => {
                if (t <= sweepStart) return deck;
                if (t < sweepStart + sweepTime) {
                    const u = easeOutBack((t - sweepStart) / sweepTime);
                    return { x: deck.x + (fan.x - deck.x) * u, y: deck.y + (fan.y - deck.y) * u, z: deck.z + (fan.z - deck.z) * u, ry: FAN_RY, rz: th * u };
                }
                if (t <= leave) return fan;
                const raw = Math.min(1, (t - leave) / FLIGHT), u = easeOut(raw);
                const r = rotAt(t);
                const tx = RADIUS * Math.sin(rad(a + r)), tz = RADIUS * Math.cos(rad(a + r));
                const ryT = a + r + 360 * m;
                const o = {
                    x: fan.x + (tx - fan.x) * u,
                    z: fan.z + (tz - fan.z) * u,
                    y: fan.y * (1 - u) - 28 * Math.sin(Math.PI * raw),
                    rz: fan.rz * (1 - u) * (1 - u),
                    ry: stays ? FAN_RY + (ryT - FAN_RY) * u : FAN_RY + (ryT - FAN_RY) * smooth((raw - 0.05) / 0.33)
                };
                if (raw >= (stays ? 0 : 0.4) && raw < 1 && want * facing(o.x, o.y, o.z, o.ry) < MARGIN) {
                    const base = back ? 180 : 0, q = back ? o.ry - 180 : wrap(o.ry);
                    let lo = 0, hi = 1;
                    for (let i = 0; i < 12; i++) {
                        const mm = (lo + hi) / 2;
                        if (want * facing(o.x, o.y, o.z, base + q * mm) >= MARGIN) lo = mm; else hi = mm;
                    }
                    o.ry += q * lo - q;
                }
                o.ry += 360 * spinTurns * Math.pow(1 - u, 2);   // thrown spin, fades to exactly 0 on landing
                return o;
            };

            const frames = [];
            for (let t = 0; ; t += DT) {
                const tt = Math.min(t, total);
                const r0 = rotAt(tt);
                const o = tt >= land
                    ? { x: RADIUS * Math.sin(rad(a + r0)), y: 0, z: RADIUS * Math.cos(rad(a + r0)), ry: a + r0 + 360 * m, rz: 0 }
                    : poseAt(tt);
                const r = rad(r0), cs = Math.cos(r), sn = Math.sin(r);
                // Back into the ring's own (spinning) coordinates.
                frames.push({ transform: T(o.x * cs - o.z * sn, o.y, o.x * sn + o.z * cs, o.ry - r0, o.rz), offset: tt / total });
                if (tt >= total) break;
            }
            return item.animate(frames, { duration: total, easing: "linear", fill: "both" });
        });

        // The ring's spin is a Web Animation too, built from the same numbers and started in the same
        // moment as the cards, so the browser moves the ring and the cards together on every frame.
        const ringFrames = [];
        for (let t = 0; ; t += DT) {
            const tt = Math.min(t, total);
            ringFrames.push({ transform: `perspective(2000px) rotateX(-16deg) rotateY(${rotAt(tt)}deg)`, offset: tt / total });
            if (tt >= total) break;
        }
        const ringAnim = slider.animate(ringFrames, { duration: total, easing: "linear", fill: "both" });

        const finish = () => {
            rotation = targetRotation = rotAt(total);
            applyRotation();
            anims.forEach(an => an.cancel());
            ringAnim.cancel();
            introRunning = false;
            // Carry straight on at the speed the intro ended on: no pause on landing.
            autoRunning = true;
            lastTime = null;
        };
        Promise.all(anims.map(an => an.finished).concat(ringAnim.finished)).then(finish).catch(finish);
    }

    let dealtOnce = false;

    // Called every time the Cards tab is opened.
    return function showCarousel({ deal }) {
        startLoop();
        try { cardHandsEl(); } catch (_) {}   // start loading the hands picture for the card popup
        if (!deal || reduceMotion()) return;
        if (dealtOnce) { playIntro(); return; }
        // First deal: keep the ring out of sight until every picture is decoded,
        // then start the deal on a clean frame.
        dealtOnce = true;
        slider.style.visibility = "hidden";
        whenImagesReady().then(() => requestAnimationFrame(() => {
            playIntro();
            slider.style.visibility = "";
        }));
    };
}

// Fetch the carousel thumbnails early (they are small), so the Cards tab is ready.
export function preloadCarouselImages() {
    CARD_PLAYER_IDS.forEach(id => { const img = new Image(); img.decoding = "async"; img.src = cardAssets.thumb(id); });
    const wings = new Image();
    wings.src = cardAssets.wingsThumb;
}
