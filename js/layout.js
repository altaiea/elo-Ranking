// ======================================================
// LAYOUT: side menu, and the bottom bar on phones
// ======================================================
// Phones show the exact desktop site: the page is laid out 1400px wide (meta
// viewport in index.html) and the phone shrinks it to fit its screen, the same
// as a desktop window. PHONE_LAYOUT = true brings back the separate phone layout
// (bottom menu bar, pages zoomed up and fitted to the screen's width).
const PHONE_LAYOUT = false;

// What gets zoomed to fit on a phone.
//   max:    zoom it up to the phone zoom, but no further than it still fits
//   design: draw it at this many px wide (the desktop look) and zoom it to fill the width
const PHONE_FIT = [
    { sel: "#monthlyRoot", max: true },
    { sel: "#historyList", max: true },
    { sel: "#historyViewer", max: true },
    { sel: ".ko-poster", max: true },
    { sel: ".h2h-sections", max: true },
    { sel: ".lb-podium", design: 620 }
];
// Parts that are wider than their box when something does not fit.
const WIDE_PARTS = "table, .ko-bracket, .ko-tier, .ko-top, .ko-standings, .history-table-wrap, .lb-tiles";

let uiZoom = 1;
const isPhone = () => document.documentElement.classList.contains("is-phone");

// How much wider than its box the element's content is (1 = fits).
function overflowRatio(el) {
    const box = el.getBoundingClientRect();
    if (!box.width) return 1;
    let right = box.left + Math.max(el.scrollWidth * (box.width / el.clientWidth || 1), box.width);
    el.querySelectorAll(WIDE_PARTS).forEach(part => {
        const r = part.getBoundingClientRect();
        if (r.width) right = Math.max(right, r.right, r.left + part.scrollWidth * (r.width / (part.clientWidth || r.width)));
    });
    return (right - box.left) / box.width;
}

function fitOne(item) {
    document.querySelectorAll(item.sel).forEach(el => {
        if (!isPhone()) { el.style.zoom = ""; if (item.design) el.style.width = ""; return; }
        if (!el.offsetParent) return;                     // on a page that is not open
        if (item.design) {
            el.style.width = item.design + "px";
            el.style.zoom = "";
            const room = el.parentElement.clientWidth;
            if (room) el.style.zoom = String(Math.min(1.6, room / item.design));
            return;
        }
        let zoom = uiZoom;
        el.style.zoom = String(zoom);
        for (let i = 0; i < 6; i++) {
            const ratio = overflowRatio(el);
            if (ratio <= 1.005 || zoom <= 0.5) break;
            zoom = Math.max(0.5, zoom / ratio - 0.01);
            el.style.zoom = String(zoom);
        }
    });
}

export function fitPhonePages() {
    PHONE_FIT.forEach(fitOne);
}

export function setupLayout() {
    const html = document.documentElement;
    const rail = document.getElementById("rail");
    const head = document.getElementById("pageHead");
    if (!rail) return;
    const fit = () => {
        const sw = screen.width, phone = PHONE_LAYOUT && sw <= 700 && innerWidth > sw * 1.2;
        uiZoom = phone ? Math.min(2.2, innerWidth / sw) : 1;
        html.classList.toggle("is-phone", phone);
        rail.style.width = phone ? sw + "px" : "";
        rail.style.zoom = phone ? String(innerWidth / sw) : "";
        if (head) head.style.zoom = phone ? String(uiZoom) : "";
        html.style.setProperty("--ui-zoom", String(uiZoom));   // for locker.css
        fitPhonePages();
    };
    fit();
    addEventListener("resize", fit);

    // Refit when a page draws new content (a month picked, a day opened, the podium redrawn).
    let queued = 0;
    const shell = document.getElementById("shell");
    if (shell) new MutationObserver(() => {
        if (!isPhone() || queued) return;
        queued = requestAnimationFrame(() => { queued = 0; fitPhonePages(); });
    }).observe(shell, { childList: true, subtree: true });
}
