// ======================================================
// TABS
// ======================================================
// The address bar remembers the open tab (…/#cards), so a refresh or a shared
// link (or the game) lands on the same page.

const TABS = {
    leaderboardPage: { title: "LEADERBOARD", hash: "leaderboard" },
    teamsPage: { title: "TEAMS & MAPS", hash: "teams" },
    historyPage: { title: "HISTORY", hash: "history" },
    comparisonsPage: { title: "HEAD-TO-HEAD", hash: "head-to-head" },
    carouselPage: { title: "CARDS", hash: "cards" },
    knockoutPage: { title: "KNOCKOUT", hash: "knockout" }   // has its own gold header, so the page header hides here
};
const OLD_HASHES = { maps: "teamsPage" };   // the Maps tab is now part of Teams & Maps

// onShow(tabId, firstTimeShownNow) runs whenever a tab is opened.
export function setupTabs(onShow) {
    const buttons = [...document.querySelectorAll(".nav-tab")];
    const title = document.getElementById("pageTitle");
    const head = document.getElementById("pageHead");
    let current = null;

    function show(target, { updateHash = true } = {}) {
        if (!TABS[target] || target === current) return;
        current = target;
        document.querySelectorAll(".tab-page").forEach(page => {
            page.style.display = page.id === target ? "block" : "none";
        });
        buttons.forEach(btn => {
            const active = btn.dataset.tab === target;
            btn.classList.toggle("active", active);
            btn.setAttribute("aria-selected", String(active));
        });
        title.textContent = TABS[target].title;
        if (head) head.dataset.tab = target;
        if (updateHash) {
            try { history.replaceState(null, "", `#${TABS[target].hash}`); } catch (_) {}
        }
        onShow(target);
    }

    buttons.forEach(btn => btn.addEventListener("click", () => show(btn.dataset.tab)));

    const fromHash = () => {
        const h = location.hash.slice(1);
        return OLD_HASHES[h] || Object.keys(TABS).find(id => TABS[id].hash === h);
    };
    window.addEventListener("hashchange", () => { const id = fromHash(); if (id) show(id, { updateHash: false }); });
    show(fromHash() || "leaderboardPage", { updateHash: false });
}
