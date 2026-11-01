/* ======================================================
   KNOCK-OUT CARDS (button on the Knockout tab)
   A card per player built from Captain's Cup maps only, with "KO" in the
   bottom right and the tier and month they fought in at the bottom left.
   It copies the existing card face (the same artwork and rating maths)
   without changing the popup, the carousel or Head-to-Head.
====================================================== */
import { fillCard } from "./playerCard.js";
import { loadKnockoutCardPool } from "./knockoutCards.js";
import { escapeHtml } from "./ui.js";

let rendered = false;

function buildCard(p, pool) {
    const container = document.querySelector("#playerModal .container").cloneNode(true);
    container.removeAttribute("id");
    const card = container.querySelector(".card");
    card.querySelector(".card-back-video")?.remove();
    fillCard(card, p, pool.players).forEach(el => { el.style.visibility = "visible"; });
    card.querySelector(".back").style.opacity = "1";
    card.classList.add("flipped");
    return container;
}

async function render() {
    const box = document.getElementById("koCards");
    box.innerHTML = `<div class="ko-empty">Loading Knock-out Cards…</div>`;
    const pool = await loadKnockoutCardPool();
    if (!pool.players.length) {
        box.innerHTML = `<div class="ko-empty">No Knock-out Cards yet. A player's card appears after their first Captain's Cup series.</div>`;
        rendered = true;
        return;
    }
    box.innerHTML = `<p class="ko-small">Every Knock-out Card starts from zero and only counts Captain's Cup maps (${pool.mapCount} so far). Those maps still count towards the normal cards and Elo as well.</p>
        <div class="ko-card-grid">${pool.players.map(p => {
            const where = p.tier ? escapeHtml(p.tier.name) : "";
            return `<div class="ko-card-wrap" data-ko-card="${p.id}" style="--c:var(--ko-tier-${p.tier ? p.tier.index : "x"})">
                <div class="ko-card-stage"><span class="ko-card-tier">${where}</span><span class="ko-card-ko">KO</span></div>
                <div class="ko-card-meta">${p.mapsPlayed} cup map${p.mapsPlayed === 1 ? "" : "s"}</div></div>`;
        }).join("")}</div>`;
    box.querySelectorAll(".ko-card-wrap").forEach(wrap => {
        const p = pool.byId.get(Number(wrap.dataset.koCard));
        wrap.querySelector(".ko-card-stage").prepend(buildCard(p, pool));
    });
    rendered = true;
}

// Opens the Knock-out Cards panel; with a player id, scrolls to their card.
export async function openKnockoutCards(playerId = null) {
    const box = document.getElementById("koCards");
    const button = document.getElementById("koCardsButton");
    box.hidden = false;
    button.classList.add("active");
    button.setAttribute("aria-expanded", "true");
    try {
        if (!rendered) await render();
    } catch (error) {
        box.innerHTML = `<div class="ko-empty">Knock-out Cards could not be loaded: ${escapeHtml(error.message || error)}</div>`;
        return;
    }
    box.querySelectorAll(".ko-card-wrap.ko-picked").forEach(el => el.classList.remove("ko-picked"));
    const target = playerId === null ? box : box.querySelector(`[data-ko-card="${Number(playerId)}"]`);
    if (target && target !== box) target.classList.add("ko-picked");
    (target || box).scrollIntoView({ behavior: "smooth", block: "center" });
}

export function setupKnockoutCardsButton() {
    const box = document.getElementById("koCards");
    const button = document.getElementById("koCardsButton");
    button.addEventListener("click", () => {
        if (!box.hidden) {
            box.hidden = true;
            button.classList.remove("active");
            button.setAttribute("aria-expanded", "false");
        } else openKnockoutCards();
    });
}
