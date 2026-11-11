/* ======================================================
   DUO NETWORK: THE 3D DRAWING  (three.js)
   A neon globe: every player is a glowing dot, every duo a glowing tube.
   js/duoNetwork.js owns the data, the buttons and the side panel, and tells
   this file what to show through S.edges and S.nodes.

   createGlobe3D(stage, S, on) returns { sync, open, close, reset } or null (no WebGL).
     stage : the .duo-stage box; the canvas fills it
     S     : duoNetwork.js's state
     on    : { pickNode(id), pickEdge("a-b"), hoverEdge("a-b" or null, x, y) }

   How the neon look is made: nothing here is lit by lamps. Every tube is drawn
   three times: a thin bright core, a wider see-through one, and a much wider
   faint one. The outer two are "added" to whatever is behind them, so where
   glows cross they get brighter, the way real neon does.

   Turning: the globe's angle is kept as a quaternion (one rotation that can
   point any way), not as left/right and up/down angles. That is what lets it
   turn about all three axes with no pole to get stuck on.
====================================================== */
import * as T from "../vendor/three-duo.min.js";
import { COLOURS, band } from "./duoNetwork.js";

const FIELD_OF_VIEW = 36;
const GLOBE_FILL = 0.72;           // the globe's radius as a share of half the stage's shorter side (the rest is room for names)
const ZOOM_MIN = 0.55, ZOOM_MAX = 2.6;
const AUTO_SPIN = 0.0028;          // radians a frame, until you touch it
const WHITE = new T.Color(0xffffff);

export function createGlobe3D(stage, S, on) {
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); }
    catch (_) { return null; }
    const canvas = renderer.domElement;
    canvas.className = "duo-gl";
    const labels = document.createElement("div");
    labels.className = "duo-labels";
    stage.prepend(canvas, labels);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 40);
    const world = new T.Group();                    // everything that turns with the globe
    scene.add(world);
    const HOME = world.quaternion.clone().setFromAxisAngle(new T.Vector3(1, 0, 0), 0.32);
    world.quaternion.copy(HOME);

    const glowTexture = (() => {
        const c = document.createElement("canvas"); c.width = c.height = 128;
        const g = c.getContext("2d"), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.22, "rgba(255,255,255,.55)"); grad.addColorStop(0.55, "rgba(255,255,255,.12)"); grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
        return new T.CanvasTexture(c);
    })();
    const glowMaterial = (colour, opacity) => new T.SpriteMaterial({ map: glowTexture, color: colour, blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity });
    const additive = (colour, opacity) => new T.MeshBasicMaterial({ color: colour, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false });

    /* ---------- scenery: three hoops (one per axis), a soft glow in the middle, and drifting dust ---------- */
    {
        const hoop = new T.TorusGeometry(1, 0.0022, 6, 160);
        [[0x19e6ff, 0, 0], [0xff2e7e, Math.PI / 2, 0], [0x8a5cff, 0, Math.PI / 2]].forEach(([c, rx, ry]) => {
            const m = new T.Mesh(hoop, additive(c, 0.3)); m.rotation.set(rx, ry, 0); world.add(m);
        });
        const heart = new T.Sprite(glowMaterial(0x5a3dff, 0.22)); heart.scale.setScalar(3.4); world.add(heart);
        const dust = new T.InstancedMesh(new T.SphereGeometry(1, 6, 4), additive(0x9fb4ff, 0.55), 260), o = new T.Object3D();
        let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;   // the same dust every time
        for (let i = 0; i < 260; i++) {
            const r = 1.35 + rnd() * 2.4, y = rnd() * 2 - 1, a = rnd() * Math.PI * 2, q = Math.sqrt(1 - y * y);
            o.position.set(r * q * Math.cos(a), r * y, r * q * Math.sin(a)); o.scale.setScalar(0.004 + rnd() * 0.008); o.updateMatrix();
            dust.setMatrixAt(i, o.matrix);
        }
        world.add(dust);
    }

    /* ---------- players ---------- */
    const ball = new T.SphereGeometry(1, 24, 16), hitBall = new T.SphereGeometry(1, 10, 8);
    const unseen = new T.MeshBasicMaterial({ visible: false });
    const nodes = {};
    S.ids.forEach(id => {
        const colour = new T.Color(S.colour[id]), p = new T.Vector3(...S.pos[id]);
        const core = new T.Mesh(ball, new T.MeshBasicMaterial({ color: colour.clone().lerp(WHITE, 0.55), transparent: true })); core.position.copy(p);
        const glow = new T.Sprite(glowMaterial(colour, 0.9)); glow.position.copy(p);
        const hit = new T.Mesh(hitBall, unseen); hit.position.copy(p); hit.scale.setScalar(0.13); hit.userData.id = id;
        world.add(core, glow, hit);
        const label = document.createElement("span");
        label.textContent = S.names[id]; label.dataset.id = id; label.style.setProperty("--c", S.colour[id]);
        label.setAttribute("role", "button"); label.tabIndex = 0;
        label.setAttribute("aria-label", `Select ${S.names[id]}`);
        labels.appendChild(label);
        nodes[id] = { id, p, colour, core, glow, hit, label, w: 0, h: 0, r: 0.05, toR: 0.05, fade: 1, toFade: 1, lift: 0, toLift: 0, pulse: 0, depth: 0, sx: 0, sy: 0 };
    });

    /* ---------- duos ---------- */
    // Tubes are only built for duos that are actually shown, and kept for next time.
    const edges = {};
    function makeEdge(k) {
        const [a, b] = k.split("-").map(Number), A = nodes[a].p, B = nodes[b].p;
        const curve = new T.QuadraticBezierCurve3(A, A.clone().add(B).multiplyScalar(0.2), B);   // bends in towards the middle
        const layer = (material, order) => { const m = new T.Mesh(undefined, material); m.visible = false; m.userData.k = k; m.renderOrder = order; world.add(m); return m; };
        const core = layer(new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 }), 2);
        const halo = layer(new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }), 1);
        const wide = layer(new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }), 1);
        const spark = new T.Sprite(glowMaterial(0xffffff, 0)); spark.visible = false; world.add(spark);
        return edges[k] = { k, curve, core, halo, wide, spark, radius: 0, level: 0, toLevel: 0, cA: new T.Color(0), cB: new T.Color(0), tA: new T.Color(), tB: new T.Color(), white: 0.35, toWhite: 0.35, dirty: true, phase: (a * 0.37 + b * 0.61) % 1, lit: false };
    }
    // Colour a tube along its length from one end's colour to the other's. white: how much the colour is washed towards white.
    const tmp = new T.Color();
    function paint(mesh, cA, cB, white) {
        const geo = mesh.geometry, uv = geo.attributes.uv;
        if (!geo.attributes.color) geo.setAttribute("color", geo.attributes.position.clone());
        const col = geo.attributes.color;
        for (let i = 0; i < uv.count; i++) { tmp.copy(cA).lerp(cB, uv.getX(i)).lerp(WHITE, white); col.setXYZ(i, tmp.r, tmp.g, tmp.b); }
        col.needsUpdate = true;
    }

    /* ---------- match what duoNetwork.js worked out ---------- */
    function sync(opts) {
        Object.keys(S.edges).forEach(k => {
            const e = S.edges[k], g = edges[k] || makeEdge(k);
            const duo = e.state === "duo";
            const radius = (0.0035 + 0.013 * e.weight) * (duo ? 1.5 : 1);
            if (Math.abs(radius - g.radius) > 0.0003) {
                [[g.core, radius, 8], [g.halo, radius * 2.4 + 0.004, 6], [g.wide, radius * 5 + 0.012, 6]].forEach(([m, r, sides]) => {
                    if (m.geometry) m.geometry.dispose();
                    m.geometry = new T.TubeGeometry(g.curve, 26, r, sides, false);
                });
                g.radius = radius; g.dirty = true;
            }
            if (e.byWinRate) { g.tA.set(COLOURS[band(e.wr)]); g.tB.copy(g.tA); }
            else { g.tA.copy(nodes[e.a].colour); g.tB.copy(nodes[e.b].colour); }
            g.toWhite = duo ? 0.75 : 0.35;
            g.toLevel = duo ? 2.2 : e.state === "lit" ? 1.35 : e.state === "dim" ? 0.05 : 0.32 + 0.5 * e.weight;
            g.lit = duo || e.state === "lit";
            g.core.visible = g.halo.visible = g.wide.visible = true;
        });
        Object.keys(edges).forEach(k => { if (!S.edges[k]) { edges[k].toLevel = 0; edges[k].lit = false; } });
        S.ids.forEach(id => {
            const n = nodes[id], v = S.nodes[id];
            n.toR = (0.03 + 0.028 * v.size) * (v.picked ? 1.45 : 1);
            n.toFade = v.faded ? 0.2 : 1; n.toLift = v.picked ? 1 : 0;
            n.label.classList.toggle("sel", v.picked); n.label.classList.toggle("faded", v.faded);
            if (opts && opts.pulse) n.pulse = 1;
        });
        if (!running) draw();           // hidden: still bring the picture up to date, so opening is instant
    }

    /* ---------- drawing ---------- */
    const v = new T.Vector3(), axis = new T.Vector3(), dq = world.quaternion.clone();
    let raf = null, running = false, w = 0, h = 0, ratio = 0, globePx = 100, tick = 0;
    let zoom = 1, toZoom = 1, intro = 1, homing = false;
    let autoSpin = !calm, spinAxis = new T.Vector3(0.22, 1, 0.1).normalize();
    const coast = { axis: new T.Vector3(0, 1, 0), speed: 0 };     // carries on turning after a flick
    const pointers = new Map();
    const turn = (ax, angle) => { dq.setFromAxisAngle(ax, angle); world.quaternion.premultiply(dq); };

    function resize() {
        const cw = stage.clientWidth, ch = stage.clientHeight;
        // phones show the page shrunk, so there is no point drawing more pixels than the screen has
        const shrink = innerWidth > screen.width * 1.2 ? screen.width / innerWidth : 1;
        const pr = Math.max(1, Math.min(2, (window.devicePixelRatio || 1) * shrink));
        if (!cw || !ch || (cw === w && ch === h && pr === ratio)) return;
        w = cw; h = ch; ratio = pr;
        renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
        camera.aspect = w / h;
        S.ids.forEach(id => { const n = nodes[id]; n.w = n.label.offsetWidth; n.h = n.label.offsetHeight; });
    }

    function draw() {
        resize();
        if (!w) return;
        tick++;
        // camera: far enough back that the globe fills GLOBE_FILL of the shorter side, then the zoom
        zoom += (toZoom - zoom) * 0.18;
        const half = Math.tan(FIELD_OF_VIEW * Math.PI / 360), fit = 1 / (GLOBE_FILL * half * Math.min(1, camera.aspect));
        camera.position.set(0, 0, fit / zoom); camera.updateProjectionMatrix();
        globePx = h / 2 / (half * camera.position.z);
        // turning
        if (homing) { world.quaternion.slerp(HOME, 0.14); if (world.quaternion.angleTo(HOME) < 0.004) { world.quaternion.copy(HOME); homing = false; autoSpin = !calm; } }
        else if (!pointers.size) {
            if (coast.speed) { turn(coast.axis, coast.speed); coast.speed *= 0.95; if (Math.abs(coast.speed) < 0.0003) coast.speed = 0; }
            else if (autoSpin) turn(spinAxis, AUTO_SPIN);
        }
        intro += (1 - intro) * 0.12; world.scale.setScalar(intro);
        world.updateMatrixWorld();

        Object.values(edges).forEach(g => {
            const d = g.toLevel - g.level;
            g.level = Math.abs(d) > 0.003 ? g.level + d * 0.14 : g.toLevel;
            if (g.level < 0.004 && g.toLevel === 0) { g.core.visible = g.halo.visible = g.wide.visible = g.spark.visible = false; return; }
            g.core.material.opacity = Math.min(1, g.level * 1.1);
            g.core.material.depthWrite = g.level > 0.4;
            g.halo.material.opacity = Math.min(0.6, g.level * 0.3);
            g.wide.material.opacity = Math.min(0.3, g.level * g.level * 0.09);      // the widest glow is saved for the lines that are lit up
            // colours glide to their new values
            const off = Math.abs(g.cA.r - g.tA.r) + Math.abs(g.cA.g - g.tA.g) + Math.abs(g.cA.b - g.tA.b) + Math.abs(g.cB.r - g.tB.r) + Math.abs(g.cB.g - g.tB.g) + Math.abs(g.cB.b - g.tB.b) + Math.abs(g.white - g.toWhite);
            if (off > 0.004) { g.cA.lerp(g.tA, 0.2); g.cB.lerp(g.tB, 0.2); g.white += (g.toWhite - g.white) * 0.2; g.dirty = true; }
            if (g.dirty && g.core.geometry) { paint(g.core, g.cA, g.cB, g.white); paint(g.halo, g.cA, g.cB, 0); paint(g.wide, g.cA, g.cB, 0); g.dirty = false; }
            // a spark runs along the lit lines
            const spark = g.lit && !calm;
            g.spark.visible = spark;
            if (spark) {
                const t = (tick * 0.006 + g.phase) % 1;
                g.curve.getPoint(t, g.spark.position);
                g.spark.material.opacity = Math.sin(t * Math.PI) * 0.95;
                g.spark.scale.setScalar(0.07 + g.radius * 6);
            }
        });

        const order = [];
        S.ids.forEach(id => {
            const n = nodes[id];
            n.pulse *= 0.9;
            n.r += (n.toR * (1 + n.pulse * 0.6) - n.r) * 0.2;
            n.fade += (n.toFade - n.fade) * 0.14; n.lift += (n.toLift - n.lift) * 0.14;
            n.core.scale.setScalar(n.r); n.core.material.opacity = n.fade;
            n.glow.scale.setScalar(n.r * (7 + 5 * n.lift + (calm ? 0 : 0.6 * Math.sin(tick * 0.05 + id))));
            n.glow.material.opacity = n.fade * (0.75 + 0.25 * n.lift);
            v.copy(n.p).applyMatrix4(world.matrixWorld);
            n.depth = v.z;
            v.project(camera);
            n.sx = (v.x * 0.5 + 0.5) * w; n.sy = (-v.y * 0.5 + 0.5) * h;
            order.push(n);
        });
        placeLabels(order);
        renderer.render(scene, camera);
    }

    // Names sit just outside their dot, on the side away from the centre. Nearest players are placed
    // first; a name that would land on one already placed tries above and below, and failing that goes faint.
    function placeLabels(order) {
        order.sort((a, b) => b.depth - a.depth);
        const placed = [];
        const clash = (x, y, bw, bh) => placed.some(b => x < b.x + b.w + 4 && x + bw + 4 > b.x && y < b.y + b.h + 1 && y + bh + 1 > b.y);
        order.forEach(n => {
            let dx = n.sx - w / 2, dy = n.sy - h / 2; const len = Math.hypot(dx, dy);
            if (len < globePx * 0.12) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
            const gap = n.r * globePx + 9;
            const at = (ux, uy) => [n.sx + ux * gap + (Math.abs(ux) < 0.3 ? -n.w / 2 : ux > 0 ? 0 : -n.w), n.sy + uy * gap - n.h / 2];
            const tries = [at(dx, dy), at(0, -1.25), at(0, 1.25)];
            let spot = tries.find(([x, y]) => !clash(x, y, n.w, n.h)), hidden = false;
            if (!spot) { spot = tries[0]; hidden = true; }
            else placed.push({ x: spot[0], y: spot[1], w: n.w, h: n.h });
            const near = Math.max(0, Math.min(1, (n.depth + 1) / 2)), s = n.label.style;
            s.transform = `translate(${spot[0].toFixed(1)}px, ${spot[1].toFixed(1)}px)`;
            s.opacity = (hidden ? 0.12 : (0.4 + 0.6 * near) * (n.toFade < 1 ? 0.35 : 1)).toFixed(2);
            s.zIndex = Math.round(near * 100);
        });
    }

    function frame() { raf = null; if (!running) return; draw(); raf = requestAnimationFrame(frame); }
    function open() {
        running = true;
        intro = calm ? 1 : 0.7;
        if (!calm) Object.values(edges).forEach(g => { g.level = 0; });      // the lines fade up as the globe grows in
        if (raf) cancelAnimationFrame(raf);
        frame();                                                             // first picture straight away, not a frame later
    }
    function close() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; pointers.clear(); }
    function reset() { homing = true; toZoom = 1; coast.speed = 0; }

    /* ---------- turning, zooming, picking ---------- */
    const ray = new T.Raycaster(), mouse = new T.Vector2();
    function under(e, what) {
        const r = canvas.getBoundingClientRect();
        mouse.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(mouse, camera);
        const hit = ray.intersectObjects(what, false)[0];
        return hit ? hit.object : null;
    }
    const nodeHits = S.ids.map(id => nodes[id].hit);
    const shownTubes = () => Object.values(edges).filter(g => g.halo.visible && g.toLevel > 0.2).map(g => g.halo);
    const local = e => { const r = canvas.getBoundingClientRect(), k = w / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };
    const angleAt = p => Math.atan2(p.y - h / 2, p.x - w / 2);
    let mode = "", moved = 0, pinch = null;

    canvas.addEventListener("pointerdown", e => {
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        const p = local(e);
        pointers.set(e.pointerId, p);
        coast.speed = 0; homing = false;
        if (pointers.size === 1) {
            moved = 0;
            // inside the globe: spin it like a ball. Outside it (or holding Shift): roll it like a steering wheel.
            mode = e.shiftKey || Math.hypot(p.x - w / 2, p.y - h / 2) > globePx * 1.1 ? "roll" : "spin";
        } else if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            mode = "pinch"; moved = 99; autoSpin = false;
            pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, angle: Math.atan2(b.y - a.y, b.x - a.x) };
        }
    });
    canvas.addEventListener("pointermove", e => {
        const last = pointers.get(e.pointerId);
        if (!last) return;
        const p = local(e);
        pointers.set(e.pointerId, p);
        if (mode === "pinch" && pointers.size === 2) {
            // two fingers: spread to zoom, twist to roll
            const [a, b] = [...pointers.values()], dist = Math.hypot(a.x - b.x, a.y - b.y) || 1, angle = Math.atan2(b.y - a.y, b.x - a.x);
            toZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, toZoom * dist / pinch.dist));
            let d = angle - pinch.angle; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
            turn(axis.set(0, 0, 1), -d);
            pinch = { dist, angle };
            return;
        }
        if (pointers.size !== 1 || mode === "pinch") return;
        const dx = p.x - last.x, dy = p.y - last.y;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved < 6) return;
        autoSpin = false; canvas.classList.add("grabbing");
        if (mode === "roll") {
            let d = angleAt(p) - angleAt(last); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
            coast.axis.set(0, 0, 1); coast.speed = -d;
        } else {
            const len = Math.hypot(dx, dy); if (!len) return;
            coast.axis.set(dy / len, dx / len, 0); coast.speed = len / globePx;      // dragging the globe's own radius turns it one radian
        }
        turn(coast.axis, coast.speed);
    });
    const up = e => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        canvas.classList.remove("grabbing");
        if (pointers.size) { mode = "pinch"; return; }       // one finger of a pinch lifted: wait for the other
        const wasClick = moved < 6 && e.type === "pointerup" && mode !== "pinch";
        if (moved >= 6 && Math.abs(coast.speed) < 0.004) coast.speed = 0;      // let go while still: stay put
        mode = "";
        if (!wasClick) return;
        coast.speed = 0;
        const node = under(e, nodeHits);
        if (node) { on.pickNode(node.userData.id); return; }
        const tube = under(e, shownTubes());
        if (tube) on.pickEdge(tube.userData.k);
    };
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", e => {
        e.preventDefault();
        toZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, toZoom * Math.exp(-e.deltaY * 0.0012)));
    }, { passive: false });
    canvas.addEventListener("dblclick", reset);

    let hoverQueued = null;
    canvas.addEventListener("mousemove", e => {
        if (pointers.size) return;
        hoverQueued = e;
        requestAnimationFrame(() => {
            if (!hoverQueued) return;
            const ev = hoverQueued; hoverQueued = null;
            const node = under(ev, nodeHits), tube = node ? null : under(ev, shownTubes());
            const p = local(ev), outside = Math.hypot(p.x - w / 2, p.y - h / 2) > globePx * 1.1;
            canvas.style.cursor = node || tube ? "pointer" : outside ? "alias" : "";
            on.hoverEdge(tube ? tube.userData.k : null, ev.clientX, ev.clientY);
        });
    });
    canvas.addEventListener("mouseleave", () => { hoverQueued = null; on.hoverEdge(null); });

    labels.addEventListener("click", e => { const l = e.target.closest("[data-id]"); if (l) on.pickNode(Number(l.dataset.id)); });
    labels.addEventListener("keydown", e => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const l = e.target.closest("[data-id]");
        if (l) { e.preventDefault(); on.pickNode(Number(l.dataset.id)); }
    });

    try { renderer.compile(scene, camera); } catch (_) {}     // get the graphics card ready now, not on the first click
    return { sync, open, close, reset };
}
