// ======================================================
// TABS
// ======================================================
// The menu has four groups. Ranks and Players hold more than one page, so a
// gold switch under the title moves between them. The address bar remembers
// the open page (…/#cards), so a refresh or a shared link (or the game) lands
// on the same page.

const TABS = {
    leaderboardPage: { group: "ranks", label: "Leaderboard", hash: "leaderboard" },
    monthlyPage: { group: "ranks", label: "Monthly", hash: "monthly" },
    historyPage: { group: "ranks", label: "History", hash: "history" },
    cardsPage: { group: "players", label: "Cards", hash: "cards" },
    comparisonsPage: { group: "players", label: "Head-to-Head", hash: "head-to-head" },
    teamsPage: { group: "match", hash: "teams" },
    knockoutPage: { group: "knockout", hash: "knockout" }   // has its own gold header, so the page header hides here
};
const GROUP_TITLES = { ranks: "RANKS", players: "PLAYERS", match: "MATCH DAY", knockout: "KNOCKOUT" };
const OLD_HASHES = { maps: "teamsPage" };   // the Maps tab is now part of Match Day

// onShow(tabId) runs whenever a page is opened. Returns show(tabId), for buttons that jump to a page.
export function setupTabs(onShow) {
    const buttons = [...document.querySelectorAll(".nav-tab")];   // one per group; data-tab is the group's first page
    const title = document.getElementById("pageTitle");
    const head = document.getElementById("pageHead");
    const subTabs = document.getElementById("subTabs");
    let current = null;

    function show(target, { updateHash = true } = {}) {
        if (!TABS[target] || target === current) return;
        current = target;
        const group = TABS[target].group;
        document.querySelectorAll(".tab-page").forEach(page => {
            page.style.display = page.id === target ? "block" : "none";
        });
        buttons.forEach(btn => {
            const active = TABS[btn.dataset.tab].group === group;
            btn.classList.toggle("active", active);
            btn.setAttribute("aria-selected", String(active));
        });
        const pages = Object.keys(TABS).filter(id => TABS[id].group === group);
        subTabs.hidden = pages.length < 2;
        subTabs.innerHTML = pages.length < 2 ? "" : pages.map(id =>
            `<button type="button" data-tab="${id}" class="${id === target ? "on" : ""}">${TABS[id].label}</button>`).join("");
        title.textContent = GROUP_TITLES[group];
        if (head) head.dataset.tab = target;
        if (updateHash) {
            try { history.replaceState(null, "", `#${TABS[target].hash}`); } catch (_) {}
        }
        onShow(target);
    }

    buttons.forEach(btn => btn.addEventListener("click", () => show(btn.dataset.tab)));
    subTabs.addEventListener("click", e => {
        const btn = e.target.closest("button");
        if (btn) show(btn.dataset.tab);
    });

    const fromHash = () => {
        const h = location.hash.slice(1);
        return OLD_HASHES[h] || Object.keys(TABS).find(id => TABS[id].hash === h);
    };
    window.addEventListener("hashchange", () => { const id = fromHash(); if (id) show(id, { updateHash: false }); });
    show(fromHash() || "leaderboardPage", { updateHash: false });
    return show;
}
