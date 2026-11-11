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

const CAMERA_DISTANCE = 4.2, FIELD_OF_VIEW = 36;
const GLOBE_SIZE = 0.84;                           // the globe is shrunk to this, so the names stay inside the dial
const NODE_SIZE = 0.062;                           // sphere radius; the globe's radius is 1
const SPIN = 0.0022;                               // how fast it turns before you touch it
const NAME_LIMIT = 0.395;                          // names stay within this share of the picture's width from the centre (the dial's inner edge)

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

    const globe = new T.Group(); globe.scale.setScalar(GLOBE_SIZE); scene.add(globe);
    const colours = { node: new T.Color(0xe9dfc8), pick: new T.Color(0xf2c14e), metal: new T.Color(0xc9a557) };

    /* ---------- the dial round the outside: a solid metal bezel with tick marks ---------- */
    // Sizes are in globe radiuses; 1.365 is the top edge of the picture.
    const dial = new T.Group(); dial.scale.setScalar(0.965); scene.add(dial);
    const metal = new T.MeshPhysicalMaterial({ color: colours.metal, metalness: 1, roughness: 0.2, envMapIntensity: 1.9 });
    const tickMetal = new T.MeshPhysicalMaterial({ color: colours.metal, metalness: 1, roughness: 0.45, envMapIntensity: 1.1 });
    const dark = new T.MeshBasicMaterial({ color: 0x120e08, side: T.DoubleSide });   // the band behind the ticks: flat and dark, so it never flashes as the dial leans
    {
        // two rounded rims with a dark band between them for the ticks
        const rim = (radius, thickness, z) => { const m = new T.Mesh(new T.TorusGeometry(radius, thickness, 20, 200), metal); m.position.z = z; dial.add(m); };
        rim(1.166, 0.013, 0.012);
        rim(1.288, 0.022, 0.02);
        const band = new T.Mesh(new T.RingGeometry(1.172, 1.27, 180), dark); dial.add(band);
        // 120 tick marks: long on the twelve "hours", medium on the fives
        const ticks = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), tickMetal, 120), o = new T.Object3D();
        for (let i = 0; i < 120; i++) {
            const a = i / 120 * Math.PI * 2, len = i % 10 === 0 ? 0.058 : i % 5 === 0 ? 0.036 : 0.02, r = 1.25 - len / 2;
            o.position.set(Math.sin(a) * r, Math.cos(a) * r, 0.008); o.rotation.set(0, 0, -a); o.scale.set(i % 10 === 0 ? 0.011 : 0.005, len, 0.012); o.updateMatrix();
            ticks.setMatrixAt(i, o.matrix);
        }
        dial.add(ticks);
        // a cut stone at north, east, south and west
        const stone = new T.OctahedronGeometry(1);
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2, m = new T.Mesh(stone, metal);
            m.position.set(Math.sin(a) * 1.288, Math.cos(a) * 1.288, 0.05); m.rotation.z = -a; m.scale.set(0.03, 0.058, 0.022); dial.add(m);
        }
    }

    /* ---------- players: pearl spheres ---------- */
    const sphere = new T.SphereGeometry(NODE_SIZE, 32, 24), hitSphere = new T.SphereGeometry(NODE_SIZE * 2.4, 12, 8);
    const hitMaterial = new T.MeshBasicMaterial({ visible: false });
    const glowTexture = (() => {
        const c = document.createElement("canvas"); c.width = c.height = 128;
        const g = c.getContext("2d"), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, "rgba(255,255,255,.9)"); grad.addColorStop(0.35, "rgba(255,255,255,.35)"); grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
        return new T.CanvasTexture(c);
    })();
    const nodes = {};
    S.ids.forEach(id => {
        const p = S.pos[id].p;
        const material = new T.MeshPhysicalMaterial({ color: 0xe9dfc8, roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.15, envMapIntensity: 0.75, transparent: true });
        const mesh = new T.Mesh(sphere, material); mesh.position.set(p[0], p[1], p[2]);
        const hit = new T.Mesh(hitSphere, hitMaterial); hit.position.copy(mesh.position); hit.userData.id = id;
        const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTexture, color: colours.pick, blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
        glow.position.copy(mesh.position); glow.scale.setScalar(NODE_SIZE * 9);
        globe.add(mesh, hit, glow);
        const label = document.createElement("span"); label.textContent = S.nodes[id].t.textContent; labels.appendChild(label);
        nodes[id] = { mesh, hit, glow, label, material, width: 0, scale: 1, toScale: 1, toOpacity: 1, toGlow: 0, pulse: 0 };
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
        // colours come from seamless.css through duoNetwork.js (S.colours), so a colour scheme is one CSS block
        if (S.colours) { colours.node.set(S.colours.node); colours.pick.set(S.colours.pick); colours.metal.set(S.colours.metal); metal.color.copy(colours.metal); tickMetal.color.copy(colours.metal); dark.color.copy(colours.metal).multiplyScalar(0.08); }
        const selKey = S.selA !== null && S.selB !== null ? Math.min(S.selA, S.selB) + "-" + Math.max(S.selA, S.selB) : null;
        Object.keys(edges).forEach(k => {
            const g = edges[k], e = S.edges[k], st = e.style;
            if (!e.show || !st) { g.toOpacity = 0; return; }
            const radius = Math.max(0.005, st.sw / 2 / 235 * 1.4);          // same thickness rule as the flat drawing
            if (Math.abs(radius - g.radius) > 0.0004) {
                if (g.mesh.geometry) g.mesh.geometry.dispose();
                g.mesh.geometry = new T.TubeGeometry(g.curve, 28, radius, 8, false);
                g.radius = radius;
            }
            const picked = k === selKey;
            g.toColour.set(picked ? colours.pick : st.col);
            g.toEmissive.set(picked ? colours.pick : 0x000000); if (picked) g.toEmissive.multiplyScalar(0.3);
            g.toOpacity = picked ? 1 : e.dim ? 0.05 : 0.35 + 0.65 * Math.min(1, st.op * 1.15);
            g.mesh.visible = true;
        });
        S.ids.forEach(id => {
            const n = nodes[id], picked = id == S.selA || id == S.selB;
            n.material.color.copy(picked ? colours.pick : colours.node); n.glow.material.color.copy(colours.pick);
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
    let down = false;                      // a finger or mouse button is held on the globe
    function resize() {
        const cw = stage.clientWidth, ch = Math.round(cw * 660 / 680);
        if (!cw || (cw === w && ch === h)) return;
        w = cw; h = ch; renderer.setSize(w, h, false);
        S.ids.forEach(id => { nodes[id].width = nodes[id].label.offsetWidth; });
    }
    function frame() {
        raf = null;
        if (stage.offsetParent === null) return;                              // closed or on another page: stop until woken
        resize();
        if (!down) { S.yaw += S.vel; S.vel *= 0.94; if (Math.abs(S.vel) < 0.0004) S.vel = 0; if (S.spin) S.yaw += SPIN; }
        globe.rotation.set(S.pitch, S.yaw, 0);
        globe.updateMatrixWorld();
        // the dial leans a little with the globe, so light runs round the metal as it turns
        dial.rotation.set(-0.06 - S.pitch * 0.08, Math.sin(S.yaw) * 0.09, 0);
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
            const s = n.label.style, side = Math.abs(dx) < 0.3 ? 0 : dx > 0 ? 1 : -1;
            // where the name starts, as a share of the picture's width from the centre
            let lx = v.x / 2 + dx * 0.034, ly = -v.y / 2 * (h / w) + dy * 0.036;
            // pull it back in if its far end would reach the dial
            const half = n.width / w / 2, far = Math.hypot(Math.abs(lx + side * half) + half, Math.abs(ly) + 0.012);
            if (far > NAME_LIMIT) { const k = (NAME_LIMIT - far); lx += k * dx; ly += k * dy; }
            s.left = ((0.5 + lx) * 100).toFixed(2) + "%"; s.top = ((0.5 * h / w + ly) / (h / w) * 100).toFixed(2) + "%";
            s.opacity = ((0.35 + 0.65 * depth) * (n.toOpacity < 1 ? 0.4 : 1)).toFixed(2);
            s.transform = `translate(${side === 0 ? -50 : side > 0 ? 0 : -100}%, -50%)`;
        });
        renderer.render(scene, camera);
        if (moving) settling = 30; else if (settling) settling--;
        if (S.spin || down || S.vel || settling) raf = requestAnimationFrame(frame);
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
    canvas.addEventListener("pointerdown", e => { down = true; S.vel = 0; moved = 0; lastX = e.clientX; lastY = e.clientY; touch = e.pointerType === "touch"; });
    window.addEventListener("pointermove", e => {
        if (!down) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved < 6) return;
        S.spin = false; canvas.classList.add("grabbing");
        S.yaw += dx * 0.008; S.vel = dx * 0.008;
        if (!touch) S.pitch = Math.max(-1.3, Math.min(1.3, S.pitch + dy * 0.008));   // a finger only turns it sideways, so swiping up and down still scrolls
        wake();
    });
    const up = e => {
        if (!down) return;
        down = false; canvas.classList.remove("grabbing"); wake();
        if (moved >= 6 || e.type !== "pointerup" || e.target !== canvas) return;
        const node = under(e, nodeHits);
        if (node) { on.pickNode(node.userData.id); return; }
        const tube = under(e, shownTubes());
        if (tube) on.pickEdge(tube.userData.k);
    };
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    let hoverQueued = null;
    canvas.addEventListener("mousemove", e => {
        if (down) return;
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
