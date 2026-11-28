/* ======================================================
   MATCH-DAY CUTSCENE: the intro video, then the deal on its table (Three.js)
   lineup_intro.mp4 (played by js/lineup.js) ends on a wide shot of the deck on the range table.
   This scene starts on exactly that frame: a 3D camera matched to the video's camera (solved
   from the deck's corners in the last frame), the frame itself projected onto the table plane,
   and 3D cards dealt off the top of the filmed deck the same way the CSS line-up deals them:
   a straight slide to their place (no spin), then the side-to-side turn with its little pop.
   Then the camera climbs until it looks straight down, the table dissolves into the page's own
   board and the cards sit exactly over the page's cards, which take over.
====================================================== */
import * as T from "../vendor/three-lineup.min.js";

/* ---------------------------
   TEXTURES
---------------------------- */
const texCache = new Map(), texReady = new Map();   // texReady: the ones already loaded, to use without waiting
const tex = src => texReady.get(src) || null;
function loadTexture(src) {
    if (!texCache.has(src)) {
        texCache.set(src, new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = "async";
            img.onload = () => {
                const t = src === PLATE || src === PLATE_CLEAN ? new T.Texture(img) : crispTexture(img);
                t.colorSpace = T.SRGBColorSpace; t.anisotropy = 16; t.needsUpdate = true;   // 16: sharp at the low camera angle
                texReady.set(src, t); resolve(t);
            };
            img.onerror = reject;
            img.src = src;
        }));
    }
    return texCache.get(src);
}
// A card face seen small and at a low angle: the GPU's own mip levels are box-filtered and go soft,
// so build them here, each halving smoothed properly and given a light sharpen, the way a photo is
// sharpened for the size it is shown at.
function sharpen(c, a) {
    const w = c.width, h = c.height; if (w < 3 || h < 3) return;
    const g = c.getContext("2d", { willReadFrequently: true }), im = g.getImageData(0, 0, w, h), s = im.data, d = new Uint8ClampedArray(s);
    const k = 1 + 4 * a;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
            const j = i + ch;
            d[j] = k * s[j] - a * (s[j - 4] + s[j + 4] + s[j - w * 4] + s[j + w * 4]);
        }
    }
    im.data.set(d); g.putImageData(im, 0, 0);
}
function crispTexture(img) {
    const levels = []; let prev = img, w = img.naturalWidth, h = img.naturalHeight;
    for (let i = 0; ; i++) {
        const c = document.createElement("canvas"); c.width = Math.max(1, w >> i); c.height = Math.max(1, h >> i);
        const g = c.getContext("2d"); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
        g.drawImage(prev, 0, 0, c.width, c.height);
        levels.push(c); prev = c;
        if (c.width === 1 && c.height === 1) break;
    }
    levels.forEach((c, i) => sharpen(c, i === 0 ? .1 : .25));
    const t = new T.Texture(levels[0]);
    t.mipmaps = levels; t.generateMipmaps = false;
    return t;
}
// everything the scene needs before it can start: the card faces and the two copies of the video's last frame
export function prepareGame(srcs) { return Promise.all(srcs.concat(PLATE, PLATE_CLEAN).map(loadTexture)); }


/* ---------------------------
   THE VIDEO'S CAMERA (solved from the deck in the last frame: f in pixels of the 1280 x 720 frame,
   position and pitch in metres from the centre of the deck's top face; the table is y = 0)
---------------------------- */
const VIDEO = { w: 1280, h: 720, f: 1128 };
const DECK = { w: .064, top: .018 };               // the filmed deck: card width, stack height
const CAM0 = { x: 0, y: .275 + DECK.top, z: .3704, pitch: -27.245 * Math.PI / 180 };
// the still the video was made from (its exact last frame, at full quality), and a copy with the deck painted out
const PLATE = "lineup_plate.webp", PLATE_CLEAN = "lineup_plate_clean.webp";
// VP9 WebM where the browser plays it (smaller), H.264 MP4 everywhere else
// H.264 plays everywhere; the AV1 copy is half the size, used only where the device decodes it smoothly and
// power-efficiently (in hardware), so slower phones never fall back to decoding it in software
export const VIDEO_SRC = "lineup_intro.mp4";
const VIDEO_AV1 = "lineup_intro_av1.mp4", AV1_TYPE = 'video/mp4; codecs="av01.0.09M.08"';
export async function pickVideoSrc() {
    try {
        const v = document.createElement("video");
        if (!v.canPlayType(AV1_TYPE)) return VIDEO_SRC;
        if (!v.canPlayType('video/mp4; codecs="avc1.64002A"')) return VIDEO_AV1;   // a browser without H.264
        if (!navigator.mediaCapabilities) return VIDEO_SRC;
        const r = await navigator.mediaCapabilities.decodingInfo({ type: "file", video: { contentType: AV1_TYPE, width: 1920, height: 1080, bitrate: 2300000, framerate: 60 } });
        return r.supported && r.smooth && r.powerEfficient ? VIDEO_AV1 : VIDEO_SRC;
    } catch (e) { return VIDEO_SRC; }
}
export const VIDEO_MS = 6083;

// The last frame, laid on the table plane through the video's own camera: from that camera it is the frame,
// pixel for pixel, and when the camera moves the table moves with it like real geometry.
function platePlane(cam, map) {
    const NX = 48, NY = 40, pos = [], uv = [], idx = [];
    const d = new T.Vector3(), o = cam.position;
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
        const u = -.4 + 1.8 * i / NX, v = -.12 + 1.9 * j / NY;
        d.set((u * VIDEO.w - VIDEO.w / 2) / VIDEO.f, -(v * VIDEO.h - VIDEO.h / 2) / VIDEO.f, -1).applyQuaternion(cam.quaternion);
        const t = -o.y / Math.min(d.y, -1e-4);
        pos.push(o.x + d.x * t, 0, o.z + d.z * t); uv.push(u, 1 - v);
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, e = c + 1;
        idx.push(a, c, b, b, c, e);
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    return new T.Mesh(g, new T.MeshBasicMaterial({ map, toneMapped: false }));
}

const deckSideTex = () => {
    const c = document.createElement("canvas"); c.width = 256; c.height = 32;
    const x = c.getContext("2d");
    x.fillStyle = "#f1ece2"; x.fillRect(0, 0, 256, 32);
    for (let y = 0; y < 32; y += 2) { x.fillStyle = `rgba(90,84,74,${.16 + (y % 4 ? .1 : 0)})`; x.fillRect(0, y, 256, 1); }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
};

/* ---------------------------
   CARD GEOMETRY: rounded face and the strip round its edge
---------------------------- */
function roundedOutline(w, h, r, seg = 5) {
    const pts = [];
    for (const [cx, cy, a0] of [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]])
        for (let s = 0; s <= seg; s++) { const a = (a0 + 90 * s / seg) * Math.PI / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return pts;
}
function faceGeometry(w, h, r) {
    const pts = roundedOutline(w, h, r), pos = [0, 0, 0], uv = [.5, .5], nrm = [0, 0, 1], idx = [];
    pts.forEach(([x, y]) => { pos.push(x, y, 0); uv.push(x / w + .5, y / h + .5); nrm.push(0, 0, 1); });
    for (let i = 1; i <= pts.length; i++) idx.push(0, i, i % pts.length + 1);
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new T.Float32BufferAttribute(nrm, 3)); g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    return g;
}
function edgeGeometry(w, h, r, t) {
    const pts = roundedOutline(w, h, r), pos = [], nrm = [], idx = [];
    pts.forEach(([x, y]) => {
        const cx = Math.max(-w / 2 + r, Math.min(w / 2 - r, x)), cy = Math.max(-h / 2 + r, Math.min(h / 2 - r, y));
        let nx = x - cx, ny = y - cy; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        pos.push(x, y, -t / 2, x, y, t / 2); nrm.push(nx, ny, 0, nx, ny, 0);
    });
    for (let i = 0, n = pts.length; i < n; i++) { const a = i * 2, b = ((i + 1) % n) * 2; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new T.Float32BufferAttribute(nrm, 3)); g.setIndex(idx);
    return g;
}

/* ---------------------------
   THE PAGE'S BOARD, PAINTED (the same layers as .lineup-wrap.scene and .lineup-team in style.css)
---------------------------- */
function boardTexture(W, H, board, cards) {
    const S = 2, c = document.createElement("canvas"); c.width = W * S; c.height = H * S;
    const g = c.getContext("2d"); g.scale(S, S);
    const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
    g.fillStyle = "rgb(13,11,8)"; g.fillRect(0, 0, W, H);          // the pop-up
    if (board) {
        const [x, y, w, h] = board.wrap;
        g.save(); rr(x, y, w, h, 10); g.clip();
        let lg = g.createLinearGradient(0, y, 0, y + h); lg.addColorStop(0, "rgb(43,27,17)"); lg.addColorStop(1, "rgb(20,11,6)");
        g.fillStyle = lg; g.fillRect(x, y, w, h);
        // the grain: 91deg stripes, a 23px repeat
        g.save(); g.translate(x + w / 2, y + h / 2); g.rotate(Math.PI / 180);
        for (let sx = -w; sx < w; sx += 23) {
            g.fillStyle = "rgba(0,0,0,.3)"; g.fillRect(sx, -h, 2, h * 2);
            g.fillStyle = "rgba(255,255,255,.035)"; g.fillRect(sx + 9, -h, 1, h * 2);
        }
        g.restore();
        // the warm pool of light (ellipse at 50% 30%, out to 62% of the farthest corner)
        const cx = x + w / 2, cy = y + h * .3, rx = Math.SQRT2 * w / 2, ry = Math.SQRT2 * Math.max(cy - y, y + h - cy);
        g.save(); g.translate(cx, cy); g.scale(1, ry / rx);
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, rx); rg.addColorStop(0, "rgba(255,205,140,.2)"); rg.addColorStop(.62, "rgba(255,205,140,0)");
        g.fillStyle = rg; g.fillRect(-rx, -rx, rx * 2, rx * 2); g.restore();
        board.teams.forEach(([tx, ty, tw, th]) => {
            rr(tx, ty, tw, th, 10); g.fillStyle = "rgba(0,0,0,.22)"; g.fill();
            rr(tx + .5, ty + .5, tw - 1, th - 1, 10); g.strokeStyle = "rgba(242,193,78,.18)"; g.lineWidth = 1; g.stroke();
        });
        g.restore();
        // the cards' own drop shadows, under where the 3D cards land
        g.save(); g.shadowColor = "rgba(0,0,0,.75)"; g.shadowBlur = 12; g.shadowOffsetY = 3; g.fillStyle = "rgba(0,0,0,1)";
        cards.forEach(({ flat: [fx, fy, fw, fh] }) => { rr(fx - fw / 2 + 1, fy - fh / 2 + 1, fw - 2, fh - 2, 6); g.fill(); });
        g.restore();
    }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    return t;
}

/* ---------------------------
   RUN
   opts.popup   the pop-up (the canvas covers it)
   opts.cards   [{ front, back, x, y, w, h, flat: [cx, cy, w, h], delay, slide, side, flipAt, flipDur }]
                 x, y: where it lands, in the flat line-up's pixels from the board origin (y towards you)
                 flat: its page card's centre and size in pop-up pixels
   opts.board   { wrap: [x, y, w, h], teams: [[x, y, w, h], ...] } the page's board in pop-up pixels
   opts.deckY   the deck's place in the same pixels; opts.px: metres per pixel on the table
   opts.shots   { video, rise, done } times in ms from the start of the video
   Builds everything and compiles it straight away (call it before the video plays), then
   start() runs it from the video's first frame. Returns { canvas, start, stop }.
---------------------------- */
export function runGame(opts) {
    const { popup, cards, board, deckY, px, shots } = opts;
    const W = popup.clientWidth, H = popup.clientHeight;
    const fit = popup.getBoundingClientRect().width / (popup.offsetWidth || 1) || 1;
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" })   // opaque: nothing behind the canvas may show through;
    renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1) * fit));
    renderer.setSize(W, H, false);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = 0;                       // NoToneMapping: the frame and the card faces keep their own colours
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    const canvas = renderer.domElement;
    canvas.className = "fx-cutscene";
    canvas.style.opacity = ".001";
    popup.appendChild(canvas);

    const disposables = [];
    const scene = new T.Scene();
    scene.background = new T.Color(0x0d0b08);

    // the camera: the video's, with its frame cropped to the pop-up the way the video is (object-fit: cover)
    const s = Math.max(W / VIDEO.w, H / VIDEO.h), F = VIDEO.f * s;     // focal length in pop-up pixels
    const VF = (H / 2) / F;                                          // tan of half the vertical field of view
    const camera = new T.PerspectiveCamera(2 * Math.atan(VF) * 180 / Math.PI, W / H, .01, 20);
    camera.position.set(CAM0.x, CAM0.y, CAM0.z); camera.rotation.set(CAM0.pitch, 0, 0);
    camera.updateMatrixWorld(true);
    camera.layers.enable(1);

    // the table: the last frame, projected; a clean copy (deck painted out) for when the camera moves
    const plateTex = tex(PLATE), cleanTex = tex(PLATE_CLEAN);
    const plate = platePlane(camera, plateTex);
    plate.renderOrder = -2;
    scene.add(plate);
    disposables.push(plate.geometry, plate.material);
    const catcher = new T.Mesh(new T.PlaneGeometry(3, 3), new T.ShadowMaterial({ opacity: .62 }));
    catcher.rotation.x = -Math.PI / 2; catcher.position.y = .0004; catcher.receiveShadow = true;
    scene.add(catcher); disposables.push(catcher.geometry, catcher.material);

    // light to match the frame: the wall lamp's warm light from back left, cool fill from the range
    const hemi = new T.HemisphereLight(0xc9d2dc, 0x3a2a1e, .9);
    const key = new T.SpotLight(0xffc896, 2.4, 0, .7, .9, 0);
    key.position.set(-.6, .85, -.7); key.target.position.set(0, 0, -.12);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -.0004; key.shadow.normalBias = .004; key.shadow.radius = 5;
    key.shadow.camera.near = .3; key.shadow.camera.far = 3;
    const fill = new T.DirectionalLight(0x9fb4d0, .35); fill.position.set(.8, .6, .4);
    const lights = [hemi, key, fill], base = lights.map(l => l.intensity);
    lights.forEach(l => { l.layers.enable(1); scene.add(l); if (l.target) scene.add(l.target); });

    // the veil: a painting of the page's own board, so the table dissolves into exactly what the page shows next
    const veilScene = new T.Scene(), veilCam = new T.PerspectiveCamera(90, 1, .1, 10);
    const veil = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ map: boardTexture(W, H, board, cards), transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
    veil.position.z = -1; veilScene.add(veil);
    disposables.push(veil.geometry, veil.material, veil.material.map);

    // the deck (3D stand-in for the filmed one, shown once the camera moves)
    const CW = DECK.w, CH = CW * (cards[0].h / cards[0].w), THICK = .0013;     // a real card's thickness reads at this size
    const sideMat = new T.MeshStandardMaterial({ map: deckSideTex(), roughness: .8 });
    // the top card as filmed: the wings on black inside a thin white rim, a touch self-lit so it reads like the video's
    const deckTopTex = (() => {
        const img = tex(cards[0].back)?.image, c = document.createElement("canvas"); c.width = 300; c.height = Math.round(300 * CH / CW);
        const g = c.getContext("2d");
        g.fillStyle = "#f1ece2"; g.fillRect(0, 0, c.width, c.height);
        g.save(); g.beginPath(); g.roundRect(5, 5, c.width - 10, c.height - 10, 14); g.clip();
        g.fillStyle = "#050608"; g.fillRect(0, 0, c.width, c.height);
        if (img) g.drawImage(img, 5, 5, c.width - 10, c.height - 10);
        g.restore();
        const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return t;
    })();
    const topMat = new T.MeshStandardMaterial({ roughness: .4, map: deckTopTex, emissive: 0xffffff, emissiveMap: deckTopTex, emissiveIntensity: .35 });
    // Its top and front wear the filmed deck itself: each corner of a finely divided box is looked up in the
    // final frame through the video's own camera, so at the swap the stand-in is the same pixels as the
    // filmed deck, and they stay on it as the camera climbs. The sides and back, never in the frame, keep the drawn look.
    const deckGeo = new T.BoxGeometry(CW, DECK.top, CH, 16, 4, 16);
    {
        const P = deckGeo.attributes.position, UV = deckGeo.attributes.uv, q = camera.quaternion.clone().invert(), v = new T.Vector3();
        const ids = new Set(), I = deckGeo.index;
        deckGeo.groups.filter(g => g.materialIndex === 2 || g.materialIndex === 4)        // top and front only
            .forEach(g => { for (let k = g.start; k < g.start + g.count; k++) ids.add(I.getX(k)); });
        ids.forEach(i => {
            v.set(P.getX(i), P.getY(i) + DECK.top / 2, P.getZ(i)).sub(camera.position).applyQuaternion(q);
            const u = (VIDEO.w / 2 + VIDEO.f * v.x / -v.z) / VIDEO.w, w = (VIDEO.h / 2 - VIDEO.f * v.y / -v.z) / VIDEO.h;
            UV.setXY(i, u, 1 - w);
        });
    }
    const filmedMat = new T.MeshBasicMaterial({ map: plateTex, toneMapped: false });
    const deck = new T.Mesh(deckGeo, [sideMat, sideMat, filmedMat, sideMat, filmedMat, sideMat]);
    deck.position.set(0, DECK.top / 2, 0); deck.visible = false;     // no cast shadow: the filmed one is already on the table
    scene.add(deck);
    disposables.push(deck.geometry, sideMat, sideMat.map, topMat, deckTopTex, filmedMat);
    const holdout = new T.Mesh(new T.BoxGeometry(CW * .98, DECK.top, CH * .98), new T.MeshBasicMaterial({ colorWrite: false }));
    holdout.position.copy(deck.position); holdout.renderOrder = -1;
    // and the cards' shadows can fall on the filmed deck's top
    const deckShade = new T.Mesh(new T.PlaneGeometry(CW * .96, CH * .96), new T.ShadowMaterial({ opacity: .55 }));
    deckShade.rotation.x = -Math.PI / 2; deckShade.position.y = DECK.top + .0003; deckShade.receiveShadow = true;
    holdout.add(deckShade); deckShade.position.set(0, DECK.top / 2 + .0003, 0);
    scene.add(holdout); disposables.push(holdout.geometry, holdout.material, deckShade.geometry, deckShade.material);

    // the cards
    const fg = faceGeometry(CW, CH, .004), eg = edgeGeometry(CW, CH, .004, THICK);
    const edgeMat = new T.MeshStandardMaterial({ color: 0xe2dccf, roughness: .6 });
    disposables.push(fg, eg, edgeMat);
    // the board origin on the table: the deck sits at the deck's place, and the whole line-up is pushed back
    // up the table until even the outer cards are well inside the frame
    const camCos = Math.cos(-CAM0.pitch), camSin = Math.sin(-CAM0.pitch);
    const depthAt = z => (CAM0.z - z) * camCos + CAM0.y * camSin;          // distance along the camera's view to a point on the table
    const halfW = d => d * (W / 2) / F * .82;                                 // 82 % of the visible half-width at that distance
    let z0 = -deckY * px;
    const push = Math.max(0, ...cards.map(c => ((Math.abs(c.x * px) + CW * .6) / halfW(1) - depthAt(z0 + c.y * px)) / camCos));
    z0 -= push;
    const faceMats = [], FACE_GLOW = .25;                          // the printed faces carry a little of their own light, so they stay crisp in the dim room
    // a soft dark contact patch under each card, so it sits on the wood instead of floating over it
    const aoTex = (() => {
        const c = document.createElement("canvas"); c.width = 128; c.height = 176;
        const g = c.getContext("2d"); g.filter = "blur(9px)"; g.fillStyle = "#000";
        g.beginPath(); g.roundRect(20, 20, 88, 136, 8); g.fill();
        const t = new T.CanvasTexture(c); return t;
    })();
    const aoGeo = new T.PlaneGeometry(CW * 1.45, CH * 1.3), aoMat = new T.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, opacity: .6, toneMapped: false, color: 0x000000 });
    aoMat.alphaMap = aoTex; aoMat.map = null;
    disposables.push(aoTex, aoGeo, aoMat);
    // the same thin white rim the backs have, over the face, so the card keeps its border when it turns;
    // it fades as the faces flatten into the page's own cards, which have none
    const rimTex = (() => {
        const c = document.createElement("canvas"); c.width = 300; c.height = Math.round(300 * CH / CW);
        const g = c.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = "#000"; g.beginPath(); g.roundRect(5, 5, c.width - 10, c.height - 10, 14); g.fill();
        return new T.CanvasTexture(c);
    })();
    const rimMat = new T.MeshStandardMaterial({ color: 0xf1ece2, roughness: .5, emissive: 0xf1ece2, emissiveIntensity: .35, alphaMap: rimTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    disposables.push(rimTex, rimMat);
    const built = cards.map(c => {
        // a faint gloss (a fifth of a full sheen), and sampled a touch sharper than the GPU's default
        const fm = new T.MeshStandardMaterial({ roughness: .66, map: tex(c.front), emissive: 0xffffff, emissiveMap: tex(c.front), emissiveIntensity: 0 });
        fm.onBeforeCompile = sh => {
            sh.fragmentShader = sh.fragmentShader
                .replace("#include <map_fragment>", "#ifdef USE_MAP\n diffuseColor *= texture2D( map, vMapUv, -0.45 );\n#endif")
                .replace("#include <emissivemap_fragment>", "#ifdef USE_EMISSIVEMAP\n totalEmissiveRadiance *= texture2D( emissiveMap, vEmissiveMapUv, -0.45 ).rgb;\n#endif")
                .replace("vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;", "vec3 totalSpecular = .2 * ( reflectedLight.directSpecular + reflectedLight.indirectSpecular );");   // 20 % gloss
        };
        const bm = new T.MeshStandardMaterial({ roughness: .5, map: deckTopTex, emissive: 0xffffff, emissiveMap: deckTopTex, emissiveIntensity: .35 });   // the same back as the filmed deck's top card
        disposables.push(fm, bm); faceMats.push(fm);
        const front = new T.Mesh(fg, fm); front.position.z = THICK / 2;
        const backF = new T.Mesh(fg, bm); backF.rotation.y = Math.PI; backF.position.z = -THICK / 2;
        const edge = new T.Mesh(eg, edgeMat);
        const rim = new T.Mesh(fg, rimMat); rim.position.z = THICK / 2 + .00002; rim.layers.enable(1);
        [front, backF, edge].forEach(m => { m.castShadow = true; m.layers.enable(1); });
        const flipper = new T.Group(); flipper.add(front, backF, edge, rim); flipper.rotation.y = Math.PI;
        const flat = new T.Group(); flat.rotation.x = -Math.PI / 2; flat.add(flipper);
        const root = new T.Group(); root.add(flat); root.visible = false;
        scene.add(root);
        const ao = new T.Mesh(aoGeo, aoMat.clone()); ao.visible = false; ao.renderOrder = -1;
        scene.add(ao); disposables.push(ao.material);
        return { s: c, root, flipper, ao, end: new T.Vector3(c.x * px, THICK / 2, z0 + c.y * px) };
    });

    // ---- the shots
    const V = (x, y, z) => new T.Vector3(x, y, z);
    const lerpV = (a, b, t) => a.clone().lerp(b, t);
    const clamp01 = v => Math.max(0, Math.min(1, v));
    const ease = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
    const easeIO3 = v => v < .5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
    const fwd0 = new T.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const D0 = camera.position.y / -fwd0.y;                          // camera to the point it looks at on the table
    const F0 = camera.position.clone().addScaledVector(fwd0, D0);
    const O = { x: cards[0].flat[0] - cards[0].x, y: cards[0].flat[1] - cards[0].y };   // the board origin, in pop-up pixels
    const TOPV = { c: V((W / 2 - O.x) * px, 0, z0 + (H / 2 - O.y) * px), d: F * px };   // straight down, the page's line-up pixel for pixel
    let fx = F0.clone(), gz = 0, last = 0;

    function cameraAt(t) {
        const dt = Math.max(1, t - last);
        let k = -1;
        for (let i = 0; i < built.length; i++) { const c = built[i].s; if (t >= c.delay - 250 && t < c.flipAt + c.flipDur + 40) k = i; }
        let goal = F0, zt = 0;
        if (k >= 0 && t < shots.rise) {
            const c = built[k].s;
            const pair = built.filter(b => Math.abs(b.s.delay - c.delay) < 5);
            const m = pair.reduce((a, b) => a.add(b.end), new T.Vector3()).multiplyScalar(1 / pair.length);
            const p = 1 - Math.pow(1 - clamp01((t - c.delay) / c.slide), 3.3);
            goal = t < c.delay ? V(0, 0, 0) : lerpV(V(0, 0, 0), m, p);
            zt = pair.length > 1 ? .5 : 1;
        }
        fx.lerp(goal, 1 - Math.exp(-dt / 380));          // slow drift, no jolt when a deal starts
        gz += (zt - gz) * (1 - Math.exp(-dt / 520));
        let g = gz;
        if (t >= shots.rise) g *= Math.max(0, 1 - (t - shots.rise) / 450);
        // a gentle lean towards each card, the way the site's camera follows it
        const focus = lerpV(F0, fx, .2 * g);
        let dist = D0 * (1 - .05 * g), pitch = CAM0.pitch;
        if (t >= shots.rise) {
            const u = easeIO3(clamp01((t - shots.rise) / (shots.done - shots.rise)));
            focus.lerp(TOPV.c, u);
            dist += (TOPV.d - dist) * u;
            pitch += (-Math.PI / 2 - pitch) * u;
        }
        camera.rotation.set(pitch, 0, 0);
        camera.position.set(focus.x, focus.y - Math.sin(pitch) * dist, focus.z + Math.cos(pitch) * dist);
        camera.updateMatrixWorld(true);
    }

    function cardsAt(t) {
        const easeIn = v => Math.pow(v, 1.7), easeOut = v => 1 - Math.pow(1 - v, 1.7);
        for (const B of built) {
            const c = B.s;
            if (t < c.delay) { B.root.visible = B.ao.visible = false; continue; }
            B.root.visible = B.ao.visible = true;
            // the deal: slid straight off the top of the deck to its place, easing to a stop
            const u = clamp01((t - c.delay) / c.slide), p = 1 - Math.pow(1 - u, 3.3);
            const gone = Math.hypot(B.end.x * p / CW, B.end.z * p / CH);       // how far off the deck, in card sizes (1 = clear of it)
            B.root.position.set(B.end.x * p, THICK / 2 + DECK.top * (1 - ease((gone - .85) / .3)) + .004 * Math.sin(Math.PI * clamp01(u / .5)), B.end.z * p);
            // it lands a touch crooked, then squares up as the camera climbs
            const rot = c.side * 2.5 * p * (1 - ease((t - shots.rise - 100) / 900));
            B.root.rotation.set(0, -rot * Math.PI / 180, 0);
            // the turn, as on the site: the back goes side-on, the face comes up, with a little pop off the table
            const half = c.flipDur / 2, v = (t - c.flipAt) / half;
            let ang = Math.PI;
            if (v >= 2) ang = 0;
            else if (v >= 1) ang = Math.acos(clamp01(easeOut(v - 1)));
            else if (v > 0) ang = Math.PI - Math.acos(clamp01(1 - easeIn(v)));
            B.flipper.rotation.y = B.end.x > 0 ? -ang : ang;      // mirrored: each side turns over from its inner edge
            B.flipper.position.z = (CW / 2 + .004) * Math.sin(Math.PI * clamp01((t - c.flipAt) / c.flipDur));
            // the contact patch: dark and tight on the table, gone as the card lifts
            const lift = B.root.position.y - THICK / 2 + B.flipper.position.z;
            B.ao.position.set(B.root.position.x, .0006, B.root.position.z);
            B.ao.rotation.set(-Math.PI / 2, B.root.rotation.y, 0, "YXZ");
            B.ao.material.opacity = .6 * (1 - ease(lift / .006));
        }
    }

    let raf = 0, stopped = false, clock = null;
    function frame() {
        if (stopped) return;
        if (!canvas.isConnected) return stop();
        const t = clock.currentTime || 0;     // the same document clock the page's own line-up runs on
        cameraAt(t);
        cardsAt(t);
        last = t;
        const moving = t >= shots.rise;
        if (moving && !deck.visible) { deck.visible = true; holdout.visible = false; if (cleanTex) plate.material.map = cleanTex; }
        // near the top the cards lose the room's light and show their printed colours, like the page's cards
        const flat = ease((t - shots.rise - (shots.done - shots.rise) * .5) / ((shots.done - shots.rise) * .5));
        lights.forEach((l, i) => (l.intensity = base[i] * (1 - flat)));
        faceMats.forEach(m => (m.emissiveIntensity = FACE_GLOW + (1 - FACE_GLOW) * flat));
        rimMat.opacity = 1 - flat;
        const span = shots.done - shots.rise;
        const fade = clamp01((t - shots.rise - span * .45) / (span * .45));
        if (fade <= 0) {
            renderer.render(scene, camera);
        } else {
            renderer.autoClear = false;
            renderer.clear();
            camera.layers.set(0); camera.layers.enable(1);
            renderer.render(scene, camera);
            veil.material.opacity = fade;
            renderer.render(veilScene, veilCam);
            renderer.clearDepth();
            camera.layers.set(1);
            const bg = scene.background; scene.background = null;      // a colour background would clear the veil away
            renderer.render(scene, camera);
            scene.background = bg;
            camera.layers.set(0); camera.layers.enable(1);
            renderer.autoClear = true;
        }
        if (clock.playState !== "finished") raf = requestAnimationFrame(frame); else stop();
    }

    // compile every shader and upload every texture now, so the hand-off from the video does not stutter
    built.forEach(B => { B.root.visible = true; });
    deck.visible = true;
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    built.forEach(B => { B.root.visible = false; });
    deck.visible = false;

    function start() {
        if (clock || stopped) return;
        // this animation is the scene's clock (so the 3D and the page never drift apart) and its visibility:
        // hidden while the video plays, on at the video's last frame, faded out once the page's cards are under it
        const END = shots.done + 1000;
        clock = canvas.animate([
            // (.001, not 0, while hidden: the canvas stays composited, so showing it costs nothing)
            // and it dissolves in over the video's last moments, so the sharp still takes over without a jump
            { opacity: .001 }, { opacity: .001, offset: (shots.video - 650) / END }, { opacity: 1, offset: shots.video / END },
            { opacity: 1, offset: (shots.done + 250) / END }, { opacity: 0, offset: (shots.done + 650) / END }, { opacity: 0 }
        ], { duration: END, fill: "forwards" });
        canvas.style.opacity = "";
        raf = requestAnimationFrame(frame);
    }

    function stop() {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(raf);
        scene.traverse(o => { if (o.isMesh) { o.geometry?.dispose(); [].concat(o.material).forEach(m => m?.dispose()); } });
        disposables.forEach(d => d.dispose?.());
        renderer.dispose();
        renderer.forceContextLoss?.();
        canvas.remove();
    }
    return { canvas, start, stop };
}
