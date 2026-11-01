/* ======================================================
   KNOCKOUT TAB (Captain's Cup)
   Each month's tiers come from the previous month's final Monthly Rankings
   (js/monthly.js), and each tier is drawn as a two-sided knockout poster with
   the final in the middle. Results come from knockout/YYYY-MM.json.
   The rules and bracket maths live in js/knockoutRules.js.
====================================================== */
import { getPlayerName } from "./config.js";
import { loadAllHistory, loadHistoryIndex } from "./data.js";
import { loadKnockoutMonth } from "./knockoutData.js";
import { buildMonthlyRankings } from "./monthly.js";
import { KNOCKOUT_RULES, buildBracket, buildTiers, previousMonthKey, tierKey, tierName } from "./knockoutRules.js";
import { escapeHtml, monthKeyOf, monthLabel, ordinal } from "./ui.js";
import { openKnockoutCards, setupKnockoutCardsButton } from "./knockoutCardsView.js";
import { setupKnockoutRulesButton } from "./knockoutRulesView.js";

const TIER_COLOURS = ["#f2c14e", "#d9dee3", "#d08a4a", "#9fd27a", "#c98bff"];   // Premier gold, Swing silver, Challenger bronze
const tierColour = index => TIER_COLOURS[index] || TIER_COLOURS[TIER_COLOURS.length - 1];
const shortMonth = monthKey => {
    const [y, m] = monthKey.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
};
const lastDay = monthKey => {
    const [y, m] = monthKey.split("-").map(Number);
    return new Date(y, m, 0).getDate();
};

let started = false;

export function showKnockout() {
    if (started) return;
    started = true;
    init().catch(error => {
        console.error("Could not build the knockout:", error);
        const body = document.getElementById("koTiers");
        if (body) body.innerHTML = `<div class="ko-empty">The knockout could not be loaded: ${escapeHtml(error.message || error)}</div>`;
    });
}

async function init() {
    const days = await loadHistoryIndex();
    const currentMonth = monthKeyOf(new Date());
    const historyMonths = [...new Set(days.map(day => day.date.slice(0, 7)))].sort();
    // A knockout month needs a finished month before it with history.
    const months = [...new Set(historyMonths.map(m => {
        const [y, mo] = m.split("-").map(Number);
        const d = new Date(y, mo, 1);
        return monthKeyOf(d);
    }))].filter(m => m <= currentMonth).sort().reverse();
    const selected = months.includes(currentMonth) ? currentMonth : (months[0] || currentMonth);

    const select = document.getElementById("koMonthSelect");
    select.innerHTML = (months.length ? months : [selected]).map(m =>
        `<option value="${m}" ${m === selected ? "selected" : ""}>${monthLabel(m)}</option>`).join("");
    select.addEventListener("change", () => renderMonth(select.value));
    // The Knock-out Cards button, and any captain's name, open the Knock-out Cards.
    setupKnockoutCardsButton();
    setupKnockoutRulesButton();
    const poster = document.querySelector(".ko-poster");
    const open = el => openKnockoutCards(Number(el.dataset.koPlayer));
    poster.addEventListener("click", e => { const el = e.target.closest("[data-ko-player]"); if (el) open(el); });
    poster.addEventListener("keydown", e => {
        const el = e.target.closest("[data-ko-player]");
        if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(el); }
    });
    await renderMonth(selected);
}

async function renderMonth(monthKey) {
    const tiersBox = document.getElementById("koTiers");
    const standingsBox = document.getElementById("koStandings");
    const seedMonth = previousMonthKey(monthKey);
    document.getElementById("koMonthName").textContent = monthLabel(monthKey);
    document.getElementById("koSeededFrom").textContent =
        `Tiers and seeds are based on the ${monthLabel(seedMonth)} final Monthly Rankings.`;
    tiersBox.innerHTML = `<div class="ko-empty">Loading…</div>`;
    standingsBox.innerHTML = "";

    const [history, cup] = await Promise.all([loadAllHistory(), loadKnockoutMonth(monthKey)]);
    const monthly = buildMonthlyRankings(history, seedMonth);
    const ranked = monthly.records.filter(r => r.qualified);
    if (!ranked.length) {
        tiersBox.innerHTML = `<div class="ko-empty">There are no final rankings for ${monthLabel(seedMonth)}, so ${monthLabel(monthKey)} has no knockout.</div>`;
        return;
    }

    const tiers = Array.isArray(cup.tiers) && cup.tiers.length
        ? cup.tiers.map((ids, index) => ({ index, key: tierKey(index), name: tierName(index), playerIds: ids.map(Number) }))
        : buildTiers(ranked.map(r => r.playerId));
    const tierOf = new Map();
    tiers.forEach(t => t.playerIds.forEach(id => tierOf.set(id, t)));

    standingsBox.innerHTML = standingsTable(monthly, seedMonth, tierOf);
    let rank = 1;
    tiersBox.innerHTML = tiers.map(t => {
        const from = rank; rank += t.playerIds.length;
        return tierPoster(t, from, rank - 1, buildBracket(t.playerIds, cup.series), monthKey);
    }).join("");
}

// The highest leaderboard position a player reached in the month, e.g. "2nd x17".
function topFinish(record, maxPosition) {
    for (let p = 1; p <= maxPosition; p += 1) {
        const count = Number(record.positionCounts[p] || 0);
        if (count) return `${ordinal(p)} <small>×${count}</small>`;
    }
    return "–";
}

function standingsTable(monthly, seedMonth, tierOf) {
    const rows = monthly.records.map(r => {
        const t = tierOf.get(r.playerId);
        const chip = t ? `<span class="ko-chip" style="--c:${tierColour(t.index)}">${escapeHtml(t.name)}</span>` : `<span class="ko-chip ko-chip-off">Not qualified</span>`;
        return `<tr${t ? ` style="--c:${tierColour(t.index)}"` : ` class="ko-off"`}>
            <td class="ko-rank">${r.qualified ? r.monthlyRank : "–"}</td>
            <td class="ko-name"><span data-ko-player="${r.playerId}" role="button" tabindex="0">${escapeHtml(r.name)}</span></td>
            <td class="ko-num">${topFinish(r, monthly.maxPosition)}</td>
            <td>${chip}</td></tr>`;
    }).join("");
    return `<div class="ko-standings-head"><b>${monthLabel(seedMonth)}</b><span>Final Monthly Rankings</span></div>
        <table class="ko-table"><thead><tr><th>#</th><th>Player</th><th title="Highest overall Elo position reached after a map, and how many maps there">Top finish</th><th>Tier</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <p class="ko-small">Ranked by maps in 1st, then 2nd, then 3rd. Minimum 10 maps to qualify.</p>`;
}

function slotRow(slot, match, placeholder) {
    if (!slot) return `<div class="ko-row ko-tbd"><span class="ko-seed">·</span><span class="ko-pname">${placeholder}</span><span class="ko-score"></span></div>`;
    const s = match?.series;
    let score = "";
    if (s && Array.isArray(s.score) && Array.isArray(s.captains)) {
        const i = s.captains.map(Number).indexOf(slot.playerId);
        if (i >= 0 && s.score[i] !== undefined) score = String(s.score[i]);
    }
    const won = match?.winner && !match.bye && match.winner.playerId === slot.playerId;
    const lost = match?.winner && !match.bye && match.winner.playerId !== slot.playerId;
    return `<div class="ko-row${won ? " ko-won" : ""}${lost ? " ko-lost" : ""}">
        <span class="ko-seed">${slot.seed}</span><span class="ko-pname" data-ko-player="${slot.playerId}" role="button" tabindex="0">${escapeHtml(getPlayerName(slot.playerId))}</span><span class="ko-score">${score}</span></div>`;
}

// The two players of a match: either known, or "Winner of ..." from the round before.
function matchSlots(bracket, match) {
    if (match.round === 0) return match.slots;
    const prev = bracket.rounds[match.round - 1];
    return [prev[match.index * 2], prev[match.index * 2 + 1]].map(m => m.winner);
}

function feederLabel(bracket, match, side) {
    const prev = bracket.rounds[match.round - 1][match.index * 2 + side];
    const seeds = matchSlots(bracket, prev).filter(Boolean).map(s => s.seed);
    if (seeds.length === 2) return `Winner ${seeds[0]} v ${seeds[1]}`;
    return prev.round === bracket.rounds.length - 2 ? "Semi-final winner" : "To be decided";
}

function matchBox(bracket, match, isFinal = false) {
    const slots = matchSlots(bracket, match);
    if (match.round === 0 && match.bye) {
        const s = slots.find(Boolean);
        return `<div class="ko-match ko-bye"><div class="ko-row"><span class="ko-seed">${s.seed}</span><span class="ko-pname" data-ko-player="${s.playerId}" role="button" tabindex="0">${escapeHtml(getPlayerName(s.playerId))}</span><span class="ko-score"></span></div><div class="ko-byelabel">Bye to the semi-finals</div></div>`;
    }
    const wager = match.series?.wager ? `<div class="ko-wager">2x wager</div>` : "";
    return `<div class="ko-match${isFinal ? " ko-final" : ""}">
        ${slotRow(slots[0], match, match.round ? feederLabel(bracket, match, 0) : "")}
        ${slotRow(slots[1], match, match.round ? feederLabel(bracket, match, 1) : "")}${wager}</div>`;
}

function roundLabel(round, total, monthKey) {
    const deadline = `by ${KNOCKOUT_RULES.earlyRoundsDeadlineDay} ${shortMonth(monthKey)}`;
    if (round === total - 1) return `<b>Final</b><span>Bo9 · ${KNOCKOUT_RULES.earlyRoundsDeadlineDay + 1}–${lastDay(monthKey)} ${shortMonth(monthKey)}</span>`;
    const name = round === total - 2 ? "Semi-finals" : `Round ${round + 1}`;
    return `<b>${name}</b><span>${deadline}</span>`;
}

function tierPoster(tier, fromRank, toRank, bracket, monthKey) {
    const colour = tierColour(tier.index);
    const total = bracket.rounds.length;
    const head = `<div class="ko-tier-head"><h3>${escapeHtml(tier.name)}</h3><span>Ranks ${fromRank}–${toRank} · ${tier.playerIds.length} captains</span></div>`;
    if (!total) {
        const only = bracket.champion;
        return `<section class="ko-tier" style="--c:${colour}">${head}<div class="ko-empty">${only ? escapeHtml(getPlayerName(only.playerId)) + " is the only captain in this tier." : ""}</div></section>`;
    }

    const cols = [];
    // Left half: the top half of the draw, rounds 0 .. total-2, moving inwards.
    for (let r = 0; r < total - 1; r += 1) {
        const matches = bracket.rounds[r];
        cols.push(`<div class="ko-col ko-left"><div class="ko-colhead">${roundLabel(r, total, monthKey)}</div>
            <div class="ko-stack">${matches.slice(0, matches.length / 2).map(m => matchBox(bracket, m)).join("")}</div></div>`);
    }
    const final = bracket.rounds[total - 1][0];
    const champ = bracket.champion && final.winner ? escapeHtml(getPlayerName(bracket.champion.playerId)) : "?";
    cols.push(`<div class="ko-col ko-centre"><div class="ko-colhead">${roundLabel(total - 1, total, monthKey)}</div>
        <div class="ko-stack">${matchBox(bracket, final, true)}
        <div class="ko-champion"><span>${escapeHtml(tier.name)} MVP</span><b>${champ}</b><em>+${KNOCKOUT_RULES.tierWinnerBonus} Elo</em></div></div></div>`);
    // Right half: the bottom half of the draw, mirrored.
    for (let r = total - 2; r >= 0; r -= 1) {
        const matches = bracket.rounds[r];
        cols.push(`<div class="ko-col ko-right"><div class="ko-colhead">${roundLabel(r, total, monthKey)}</div>
            <div class="ko-stack">${matches.slice(matches.length / 2).map(m => matchBox(bracket, m)).join("")}</div></div>`);
    }
    return `<section class="ko-tier" style="--c:${colour}">${head}
        <div class="ko-bracket" style="grid-template-columns:repeat(${cols.length}, minmax(0, 1fr))">${cols.join("")}</div></section>`;
}
