// ===============================
// SHARED PAGE HELPERS
// ===============================
// Formatting, colours, the click sound and the generic popup.

export const reduceMotion = () =>
    !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

export function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

export function formatElo(value, digits = 2) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits) : "—";
}

export function formatSignedElo(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}`;
}

export function formatHistoryDate(dateText) {
    if (!dateText) return "Unknown date";
    const date = new Date(`${dateText}T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(dateText);
    return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export function ordinal(position) {
    const value = Number(position);
    if (!Number.isFinite(value)) return "—";
    const mod100 = value % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
    if (value % 10 === 1) return `${value}st`;
    if (value % 10 === 2) return `${value}nd`;
    if (value % 10 === 3) return `${value}rd`;
    return `${value}th`;
}

export function monthLabel(monthKey) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ""));
    if (!match) return String(monthKey || "Unknown month");
    const d = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export const monthKeyOf = date =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

/* ---------------------------
   COLOR HELPERS
---------------------------- */
const PURPLE_OUTLINE = [
    "0 -1.5px 0", "0.6px -1.4px 0", "1.1px -1.1px 0", "1.4px -0.6px 0",
    "1.5px 0 0", "1.4px 0.6px 0", "1.1px 1.1px 0", "0.6px 1.4px 0",
    "0 1.5px 0", "-0.6px 1.4px 0", "-1.1px 1.1px 0", "-1.4px 0.6px 0",
    "-1.5px 0 0", "-1.4px -0.6px 0", "-1.1px -1.1px 0", "-0.6px -1.4px 0"
].map(offset => `${offset} #160022`).concat("0 0 4px #A855F7").join(", ");

export function setRatingColor(el, rating) {
    el.style.color = "";
    el.style.textShadow = "";

    if (rating === 99) {
        el.style.color = "#A855F7";
        el.style.textShadow = PURPLE_OUTLINE;
        return;
    }
    if (rating < 60) el.style.color = "#FF3B3B";
    else if (rating <= 66) el.style.color = "white";
    else if (rating <= 79) el.style.color = "#FFE066";
    else if (rating <= 98) el.style.color = "#7CFF4E";
}

export const kdColor = kd => kd < 1.0 ? "#FF4444" : "#00FF66";

/* ======================================================
   POPUP CARD
   One popup is shared by error messages, Monthly Rankings and the team
   line-ups. onOpen runs after the HTML is in place; onClose once it closes.
====================================================== */
const popupEl = () => document.getElementById("popupCard");
let popupCloseHook = null;

export function showPopup(html, { className = "", onOpen = null, onClose = null } = {}) {
    const card = popupEl();
    closePopupQuietly();
    card.className = "popup-card" + (className ? " " + className : "");
    document.getElementById("popupContent").innerHTML = html;
    document.getElementById("popupOverlay").style.display = "block";
    card.style.display = "block";
    popupCloseHook = onClose;
    if (onOpen) {
        try { onOpen(card); } catch (error) { console.error(error); }
    }
}

// Clears whatever the last popup left behind, without hiding it.
function closePopupQuietly() {
    const card = popupEl();
    card.getAnimations().forEach(a => a.cancel());
    card.querySelectorAll(".fx-close, .fx-backdrop, .fx-grain, .fx-bar").forEach(n => n.remove());
    if (popupCloseHook) {
        const hook = popupCloseHook;
        popupCloseHook = null;
        try { hook(); } catch (_) {}
    }
}

export function closePopup() {
    closePopupQuietly();
    const card = popupEl();
    document.getElementById("popupOverlay").style.display = "none";
    card.style.display = "none";
    card.className = "popup-card";
}

export function isPopupOpen() {
    return popupEl().style.display === "block";
}

export function setupPopup() {
    document.getElementById("popupClose").addEventListener("click", closePopup);
    // Plain popups close from the dark backdrop or Escape. A line-up adds its own
    // corner card (see teams.js) and closes from the backdrop only once that is up.
    document.getElementById("popupOverlay").addEventListener("click", () => {
        const card = popupEl();
        if (!card.querySelector(".lineup-wrap") || card.querySelector(".fx-close")) closePopup();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && isPopupOpen()) closePopup();
    });
}

// Closes every open dropdown that the click did not land in.
// One listener for the whole page, instead of one per table row.
export function setupDropdowns() {
    document.addEventListener("click", event => {
        const toggle = event.target.closest && event.target.closest("[data-dropdown-toggle]");
        document.querySelectorAll(".dropdown-open").forEach(box => {
            if (!toggle || !box.contains(toggle)) box.classList.remove("dropdown-open");
        });
        if (toggle) {
            event.stopPropagation();
            toggle.closest("[data-dropdown]").classList.toggle("dropdown-open");
        }
    });
}
