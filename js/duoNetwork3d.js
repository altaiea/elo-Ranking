/* ======================================================
   DUO NETWORK IN REAL 3D  (three.js)
   Draws the same network as js/duoNetwork.js, but as solid tubes and
   spheres with lights and reflections. duoNetwork.js still owns the data,
   the sliders and the side panel; it loads this file only when someone
   opens the network, and keeps its own flat drawing if this fails
   (old device, no WebGL).

   createGlobe3D(stage, S, on) returns { sync() } or null.
     stage : the .dn-stage box; the 3D canvas is laid over the SVG in it
     S     : duoNetwork.js's state (players, lines, what is picked)
     on    : { pickNode(id), pickEdge("a-b"), hoverEdge("a-b" or null, x, y) }
====================================================== */
import * as T from "../vendor/three-duo.min.js";

const CAMERA_DISTANCE = 4.2, FIELD_OF_VIEW = 36;   // sized so the globe sits inside the gold surround
const NODE_SIZE = 0.05;                            // sphere radius; the globe's radius is 1
const SPIN = 0.0022;                               // how fast it turns before you touch it
const GOLD = 0xf2c14e;

export function createGlobe3D(stage, S, on) {
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); }
    catch (_) { return null; }                      // no WebGL: the caller keeps the flat drawing
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;
    renderer.outputColorSpace = T.SRGBColorSpace;
    const canvas = renderer.domElement;
    canvas.className = "dn-gl";
    const labels = document.createElement("div");
    labels.className = "dn-gl-labels";
    stage.append(canvas, labels);

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(FIELD_OF_VIEW, 680 / 660, 0.1, 20);
    camera.position.set(0, 0, CAMERA_DISTANCE);
    // a soft studio room for the shiny surfaces to reflect, plus a warm key light and a cool rim light
    const pmrem = new T.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;
    const key = new T.DirectionalLight(0xfff0d8, 1.5); key.position.set(2.5, 3, 4); scene.add(key);
    const rim = new T.DirectionalLight(0x9db4ff, 1.1); rim.position.set(-3, -1.5, -3); scene.add(rim);
    scene.add(new T.AmbientLight(0xffffff, 0.15));

    const globe = new T.Group(); scene.add(globe);

    /* ---------- players: pearl spheres ---------- */
    const sphere = new T.SphereGeometry(NODE_SIZE, 32, 24), hitSphere = new T.SphereGeometry(NODE_SIZE * 2.4, 12, 8);
    const hitMaterial = new T.MeshBasicMaterial({ visible: false });
    const glowTexture = (() => {
        const c = document.createElement("canvas"); c.width = c.height = 128;
        const g = c.getContext("2d"), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, "rgba(255,225,150,.9)"); grad.addColorStop(0.35, "rgba(242,193,78,.35)"); grad.addColorStop(1, "rgba(242,193,78,0)");
        g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
        return new T.CanvasTexture(c);
    })();
    const nodes = {};
    S.ids.forEach(id => {
        const p = S.pos[id].p;
        const material = new T.MeshPhysicalMaterial({ color: 0xe9dfc8, roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.15, envMapIntensity: 0.75, transparent: true });
        const mesh = new T.Mesh(sphere, material); mesh.position.set(p[0], p[1], p[2]);
        const hit = new T.Mesh(hitSphere, hitMaterial); hit.position.copy(mesh.position); hit.userData.id = id;
        const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTexture, blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
        glow.position.copy(mesh.position); glow.scale.setScalar(NODE_SIZE * 9);
        globe.add(mesh, hit, glow);
        const label = document.createElement("span"); label.textContent = S.nodes[id].t.textContent; labels.appendChild(label);
        nodes[id] = { mesh, hit, glow, label, material, scale: 1, toScale: 1, toOpacity: 1, toGlow: 0, pulse: 0 };
    });

    /* ---------- duos: tubes that curve in towards the middle ---------- */
    const edges = {};
    Object.keys(S.edges).forEach(k => {
        const e = S.edges[k], a = new T.Vector3(...S.pos[e.a].p), b = new T.Vector3(...S.pos[e.b].p);
        const curve = new T.QuadraticBezierCurve3(a, a.clone().add(b).multiplyScalar(0.2), b);
        const material = new T.MeshPhysicalMaterial({ color: 0x888888, roughness: 0.42, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.45, transparent: true, opacity: 0 });
        const mesh = new T.Mesh(undefined, material); mesh.visible = false; mesh.userData.k = k;
        globe.add(mesh);
        edges[k] = { curve, mesh, material, radius: 0, toOpacity: 0, toColour: new T.Color(), toEmissive: new T.Color(0) };
    });

    /* ---------- match what duoNetwork.js worked out ---------- */
    function sync(opts) {
        const selKey = S.selA !== null && S.selB !== null ? Math.min(S.selA, S.selB) + "-" + Math.max(S.selA, S.selB) : null;
        Object.keys(edges).forEach(k => {
            const g = edges[k], e = S.edges[k], st = e.style;
            if (!e.show || !st) { g.toOpacity = 0; return; }
            const radius = Math.max(0.004, st.sw / 2 / 235 * 1.15);          // same thickness rule as the flat drawing
            if (Math.abs(radius - g.radius) > 0.0004) {
                if (g.mesh.geometry) g.mesh.geometry.dispose();
                g.mesh.geometry = new T.TubeGeometry(g.curve, 28, radius, 8, false);
                g.radius = radius;
            }
            const picked = k === selKey;
            g.toColour.set(picked ? GOLD : st.col);
            g.toEmissive.set(picked ? 0x5a4410 : 0x000000);
            g.toOpacity = picked ? 1 : e.dim ? 0.05 : 0.35 + 0.65 * Math.min(1, st.op * 1.15);
            g.mesh.visible = true;
        });
        S.ids.forEach(id => {
            const n = nodes[id], picked = id == S.selA || id == S.selB;
            n.material.color.set(picked ? GOLD : 0xe9dfc8);
            n.material.metalness = picked ? 0.9 : 0.05;
            n.toScale = picked ? 1.45 : 1; n.toGlow = picked ? 0.9 : 0;
            n.toOpacity = S.nodes[id].faded ? 0.28 : 1;
            n.label.classList.toggle("sel", picked);
            if (opts && opts.ripple) n.pulse = 1;
        });
        wake();
    }

    /* ---------- drawing ---------- */
    const v = new T.Vector3();
    let raf = null, w = 0, h = 0, settling = 0;
    function resize() {
        const cw = stage.clientWidth, ch = Math.round(cw * 660 / 680);
        if (!cw || (cw === w && ch === h)) return;
        w = cw; h = ch; renderer.setSize(w, h, false);
    }
    function frame() {
        raf = null;
        if (stage.offsetParent === null) return;                              // closed or on another page: stop until woken
        resize();
        if (!S.down) { S.yaw += S.vel; S.vel *= 0.94; if (Math.abs(S.vel) < 0.0004) S.vel = 0; if (S.spin) S.yaw += SPIN; }
        globe.rotation.set(S.pitch, S.yaw, 0);
        globe.updateMatrixWorld();
        let moving = false;
        Object.values(edges).forEach(g => {
            const m = g.material, d = g.toOpacity - m.opacity;
            if (Math.abs(d) > 0.004) { m.opacity += d * 0.14; moving = true; } else m.opacity = g.toOpacity;
            m.color.lerp(g.toColour, 0.14); m.emissive.lerp(g.toEmissive, 0.14);
            m.depthWrite = m.opacity > 0.5;
            if (m.opacity < 0.01 && g.toOpacity === 0) g.mesh.visible = false;
        });
        S.ids.forEach(id => {
            const n = nodes[id];
            n.pulse *= 0.9; if (n.pulse > 0.02) moving = true;
            n.scale += (n.toScale + n.pulse * 0.5 - n.scale) * 0.2; n.mesh.scale.setScalar(n.scale);
            n.material.opacity += (n.toOpacity - n.material.opacity) * 0.14;
            n.glow.material.opacity += (n.toGlow - n.glow.material.opacity) * 0.14;
            if (Math.abs(n.toScale - n.scale) > 0.01 || Math.abs(n.toOpacity - n.material.opacity) > 0.01) moving = true;
            // the name sits beside the sphere, on the side away from the centre, fainter at the back
            v.copy(n.mesh.position).applyMatrix4(globe.matrixWorld);
            const depth = (v.z + 1) / 2;
            v.project(camera);
            let dx = v.x, dy = -v.y; const len = Math.hypot(dx, dy) || 1;
            if (len < 0.08) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
            const s = n.label.style;
            s.left = ((v.x + 1) * 50 + dx * 4.2).toFixed(2) + "%"; s.top = ((1 - v.y) * 50 + dy * 4.6).toFixed(2) + "%";
            s.opacity = ((0.35 + 0.65 * depth) * (n.toOpacity < 1 ? 0.4 : 1)).toFixed(2);
            s.transform = `translate(${Math.abs(dx) < 0.3 ? -50 : dx > 0 ? 0 : -100}%, -50%)`;
        });
        renderer.render(scene, camera);
        if (moving) settling = 30; else if (settling) settling--;
        if (S.spin || S.down || S.vel || settling) raf = requestAnimationFrame(frame);
    }
    function wake() { settling = 30; if (!raf) raf = requestAnimationFrame(frame); }

    /* ---------- drag to turn, click to pick, hover for the tip ---------- */
    const ray = new T.Raycaster(), mouse = new T.Vector2();
    function under(e, what) {
        const r = canvas.getBoundingClientRect();
        mouse.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(mouse, camera);
        const hit = ray.intersectObjects(what, false)[0];
        return hit ? hit.object : null;
    }
    const nodeHits = S.ids.map(id => nodes[id].hit);
    const shownTubes = () => Object.values(edges).filter(g => g.mesh.visible && g.toOpacity > 0.2).map(g => g.mesh);
    let lastX = 0, lastY = 0, moved = 0, touch = false;
    canvas.addEventListener("pointerdown", e => { S.down = true; S.vel = 0; moved = 0; lastX = e.clientX; lastY = e.clientY; touch = e.pointerType === "touch"; });
    window.addEventListener("pointermove", e => {
        if (!S.down) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved < 6) return;
        S.spin = false; canvas.classList.add("grabbing");
        S.yaw += dx * 0.008; S.vel = dx * 0.008;
        if (!touch) S.pitch = Math.max(-1.3, Math.min(1.3, S.pitch + dy * 0.008));   // a finger only turns it sideways, so swiping up and down still scrolls
        wake();
    });
    const up = e => {
        if (!S.down) return;
        S.down = false; canvas.classList.remove("grabbing"); wake();
        if (moved >= 6 || e.type !== "pointerup" || e.target !== canvas) return;
        const node = under(e, nodeHits);
        if (node) { on.pickNode(node.userData.id); return; }
        const tube = under(e, shownTubes());
        if (tube) on.pickEdge(tube.userData.k);
    };
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    let hoverQueued = null;
    canvas.addEventListener("mousemove", e => {
        if (S.down) return;
        hoverQueued = e;
        requestAnimationFrame(() => {
            if (!hoverQueued) return;
            const ev = hoverQueued; hoverQueued = null;
            const node = under(ev, nodeHits), tube = node ? null : under(ev, shownTubes());
            canvas.style.cursor = node || tube ? "pointer" : "";
            on.hoverEdge(tube ? tube.userData.k : null, ev.clientX, ev.clientY);
        });
    });
    canvas.addEventListener("mouseleave", () => { hoverQueued = null; on.hoverEdge(null); });
    window.addEventListener("resize", wake);

    return { sync, wake };
}
