/* ---------------------------
   MODE STATS PANEL (wheel design)
   Opens when a mode circle (Hardpoint / Overload / S&D) is clicked.
   Shows final numbers only. They come from computeMode(), the same
   maths the card uses.
---------------------------- */
import { MODES } from "./config.js";
import { scaleRating } from "./ratings.js";
import { escapeHtml } from "./ui.js";

// Stars follow the mode rating: 57 = 1 star ... 99 = 5 stars.
function starsFromRating(rating) {
    const w = (rating - 57) / 42;
    return Math.max(1, Math.min(5, Math.round(1 + w * 4)));
}

function scoreColor(score) {
    if (score < 40) return "#FF4444";
    if (score < 60) return "#FFFFFF";
    if (score < 80) return "#FFE066";
    if (score <= 98) return "#00FF66";
    return "#A855F7";
}

function polar(cx, cy, r, deg) {
    const a = deg * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function sectorPath(cx, cy, r0, r1, a0, a1) {
    const [x0, y0] = polar(cx, cy, r1, a0);
    const [x1, y1] = polar(cx, cy, r1, a1);
    const [x2, y2] = polar(cx, cy, r0, a1);
    const [x3, y3] = polar(cx, cy, r0, a0);
    const large = (a1 - a0) > 180 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r1} ${r1} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
           `L${x2.toFixed(2)} ${y2.toFixed(2)} A${r0} ${r0} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
}

function arcPath(cx, cy, r, a0, a1) {
    const [x0, y0] = polar(cx, cy, r, a0);
    const [x1, y1] = polar(cx, cy, r, a1);
    const large = (a1 - a0) > 180 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function starsSvg(count) {
    const star = "M12 2.2l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17l-6 3.3 1.3-6.6L2.4 9.1l6.7-.8z";
    let out = "";
    for (let i = 1; i <= 5; i++) {
        out += `<svg class="mp-star ${i <= count ? "on" : "off"}" viewBox="0 0 24 24" aria-hidden="true"><path d="${star}"/></svg>`;
    }
    return `<span class="mp-stars-row" role="img" aria-label="${count} out of 5 stars">${out}</span>`;
}

// The five wheel segments: name on the wheel, wheel score, and the final number shown in the list.
function buildModeStats(s, convertedMargin) {
    const dec = n => n.toFixed(2);
    return [
        { label: "K/D", short: "K/D", name: "K/D",
          score: scaleRating(s.kdPct), value: dec(s.kd), tone: s.kd < 1 ? "bad" : "good" },
        { label: "AVG MARGIN", short: "MARGIN", name: "Avg margin",
          score: scaleRating(s.marginPct), value: (convertedMargin > 0 ? "+" : "") + dec(convertedMargin),
          tone: convertedMargin < 0 ? "bad" : "good" },
        { label: "WIN RATE", short: "WIN RATE", name: "Win rate",
          score: scaleRating(s.wrPct), value: (s.wr * 100).toFixed(1) + "%", tone: "" },
        { label: "DAMAGE SHARE", short: "DAMAGE", name: "Damage share",
          score: scaleRating(s.dmgPct), value: (s.dmgShare * 100).toFixed(1) + "%", tone: "" },
        { label: "SLAYING POWER", short: "SLAYING", name: "Slaying power",
          score: s.slayerRating, value: String(s.slayerRating), tone: "" }
    ];
}

export function closeModeModal() {
    const modal = document.getElementById("modeModal");
    if (!modal || modal.style.display !== "block") return false;
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    return true;
}

export function openModeModal(modeName, s, player) {
    const modal = document.getElementById("modeModal");
    const panel = document.getElementById("modePanel");
    if (!modal || !panel) return;

    const mode = MODES.find(m => m.name === modeName);
    const convertedMargin = s.margin * (mode ? mode.marginScale : 1);
    const stats = buildModeStats(s, convertedMargin);
    const playerName = player && player.name ? player.name : "";

    const narrow = window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
    const viewBox = narrow ? "-8 0 476 420" : "-70 0 600 420";

    // Wheel geometry
    const cx = 230, cy = 210, rIn = 62, rOut = 140, labelR = 162;
    const span = 360 / stats.length, gap = 3;
    let sectors = "", labels = "";

    stats.forEach((stat, i) => {
        const a0 = -90 + i * span + gap / 2;
        const a1 = -90 + (i + 1) * span - gap / 2;
        const mid = (a0 + a1) / 2;
        const rFill = rIn + (rOut - rIn) * (stat.score / 99);
        const [lx, ly] = polar(cx, cy, labelR, mid);
        const cos = Math.cos(mid * Math.PI / 180);
        const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";

        sectors += `
            <g class="mw-seg" data-i="${i}" tabindex="0" role="button" aria-label="${escapeHtml(stat.label)} ${stat.score}">
                <path class="mw-track" d="${sectorPath(cx, cy, rIn, rOut, a0, a1)}"/>
                <path class="mw-fill" d="${sectorPath(cx, cy, rIn, rFill, a0, a1)}"/>
                <path class="mw-edge" d="${arcPath(cx, cy, rFill, a0, a1)}"/>
            </g>`;
        labels += `
            <text class="mw-label" data-i="${i}" x="${lx.toFixed(1)}" y="${(ly + 5).toFixed(1)}" text-anchor="${anchor}">
                <tspan class="mw-name">${escapeHtml(narrow ? stat.short : stat.label)}</tspan>
                <tspan class="mw-val" dx="6" fill="${scoreColor(stat.score)}">${stat.score}</tspan>
            </text>`;
    });

    const wheel = `
        <svg class="mp-wheel-svg" viewBox="${viewBox}" role="img" aria-label="${escapeHtml(modeName)} rating wheel">
            ${sectors}
            <circle class="mw-core" cx="${cx}" cy="${cy}" r="${rIn - 3}"/>
            <circle class="mw-ring" cx="${cx}" cy="${cy}" r="${rIn - 13}"/>
            <text class="mw-ovr" x="${cx}" y="${cy + 8}" text-anchor="middle" fill="${scoreColor(s.rating)}">${s.rating}</text>
            <text class="mw-ovr-label" x="${cx}" y="${cy + 28}" text-anchor="middle">OVR</text>
            ${labels}
        </svg>`;

    const rows = stats.map((stat, i) => `
        <div class="mp-row" data-i="${i}">
            <span>${escapeHtml(stat.name)}</span>
            <b class="${stat.tone}">${escapeHtml(stat.value)}</b>
        </div>`).join("");

    panel.innerHTML = `
        <div class="mp-top">
            <div class="mp-who">
                ${playerName ? `<span class="mp-player">${escapeHtml(playerName)}</span>` : ""}
                <span class="mp-mode">${escapeHtml(modeName)}</span>
            </div>
            <button type="button" class="mp-close" aria-label="Close">×</button>
        </div>
        <div class="mp-body">
            <div class="mp-wheel">${wheel}</div>
            <div class="mp-detail">
                <div class="mp-rows">${rows}</div>
                <div class="mp-stars"><span>Stars</span>${starsSvg(starsFromRating(s.rating))}</div>
            </div>
        </div>`;

    // Hovering or tapping a wheel segment lights up its row in the list.
    const segs = [...panel.querySelectorAll(".mw-seg")];
    const texts = [...panel.querySelectorAll(".mw-label")];
    const listRows = [...panel.querySelectorAll(".mp-row")];
    const select = i => {
        segs.forEach((g, n) => g.classList.toggle("sel", n === i));
        texts.forEach((t, n) => t.classList.toggle("sel", n === i));
        listRows.forEach((r, n) => r.classList.toggle("sel", n === i));
    };
    segs.forEach(g => {
        const i = Number(g.dataset.i);
        g.addEventListener("mouseenter", () => select(i));
        g.addEventListener("focus", () => select(i));
        g.addEventListener("click", () => select(i));
        g.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(i); }
        });
    });
    texts.forEach(t => t.addEventListener("click", () => select(Number(t.dataset.i))));
    listRows.forEach(r => r.addEventListener("mouseenter", () => select(Number(r.dataset.i))));
    panel.querySelector(".mp-close").addEventListener("click", closeModeModal);

    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
}

export function setupModeModal() {
    const modal = document.getElementById("modeModal");
    modal.addEventListener("click", e => { if (e.target === modal) closeModeModal(); });
}
