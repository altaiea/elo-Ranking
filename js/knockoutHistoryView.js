/* ======================================================
   KNOCKOUT HISTORY (History button on the Knockout tab)
   Every Captain's Cup series of the selected month, newest first, with each
   of its maps: mode, score, both line-ups and every player's carry on that
   map. A Series total row adds each player's carries up, and the highest
   total is the series MVP (js/knockoutMvp.js). Maps are found by the series'
   mapIds in history/ (the same maps the Knock-out Cards count).
====================================================== */
import { getPlayerName } from "./config.js";
import { escapeHtml, formatHistoryDate, showPopup } from "./ui.js";
import { tierName } from "./knockoutRules.js";
import { mapMatchRatings, seriesRatings } from "./knockoutMvp.js";

const MODE_SHORT = { Hardpoint: "HP", SND: "SND", Overload: "OVL" };

let seriesNow = [];
let mapsByIdNow = new Map();

// A rating out of 10: gold for 8+, white for a good game, muted below 5.
const ratingBand = r => r >= 8 ? "koh-r-top" : r >= 6.5 ? "koh-r-good" : r >= 5 ? "" : "koh-r-low";
const ratingTag = (value, outOf = false) => `<b class="koh-r10 ${ratingBand(value)}">${value.toFixed(1)}${outOf ? "<i>/10</i>" : ""}</b>`;

function roundName(series) {
    if (series.final) return "Final";
    const size = Array.isArray(series.tierPlayers) ? series.tierPlayers.length : 0;
    let total = 0;
    while ((1 << total) < size) total += 1;
    const round = Number(series.round) || 0;
    if (total && round === total - 1) return "Final";
    if (total && round === total - 2) return "Semi-final";
    return `Round ${round + 1}`;
}

// Which side (A or B) a captain played on in one map.
function sideOf(map, playerId) {
    const teams = map?.game?.teams || {};
    if ((teams.A || []).some(p => Number(p.playerId) === playerId)) return "A";
    if ((teams.B || []).some(p => Number(p.playerId) === playerId)) return "B";
    return null;
}

function lineup(players, captainId, carries) {
    return (players || []).map(p => {
        const id = Number(p.playerId);
        const kd = `${Number(p.kills) || 0}/${Number(p.deaths) || 0}`;
        const c = carries.get(id);
        return `<span class="koh-p${id === captainId ? " koh-cap" : ""}">${escapeHtml(getPlayerName(id))}<small>${kd}</small>${c === undefined ? "" : ratingTag(c)}</span>`;
    }).join("");
}

function mapRow(map, index, captains) {
    if (!map) return `<li class="koh-map koh-missing"><span class="koh-n">${index + 1}</span><span>Map not found in history</span></li>`;
    const [c1, c2] = captains;
    const teams = map.game?.teams || {};
    const result = map.game?.result || {};
    const score = result.score || {};
    // Show each map from the first captain's side, so the columns never swap.
    const s1 = sideOf(map, c1) || "A";
    const s2 = s1 === "A" ? "B" : "A";
    const points = side => side === "A" ? score.teamA : score.teamB;
    const winSide = Number(result.winningTeam) === 1 ? "A" : Number(result.winningTeam) === 2 ? "B" : null;
    const won = side => winSide === side ? " koh-win" : "";
    const mode = map.gameMode || map.game?.gameMode || "Map";
    const carries = mapMatchRatings(map);
    return `<li class="koh-map">
        <span class="koh-n" data-mode="${escapeHtml(mode)}">${index + 1}</span>
        <span class="koh-mode" title="${escapeHtml(mode)}">${escapeHtml(MODE_SHORT[mode] || mode)}</span>
        <span class="koh-team koh-left${won(s1)}">${lineup(teams[s1], c1, carries)}</span>
        <span class="koh-score"><b class="${won(s1).trim()}">${points(s1) ?? "–"}</b><i>–</i><b class="${won(s2).trim()}">${points(s2) ?? "–"}</b></span>
        <span class="koh-team koh-right${won(s2)}">${lineup(teams[s2], c2, carries)}</span>
    </li>`;
}

// The last row of a series: each player's total carry, on the side they
// played most of the series' maps on, then the series MVP.
function totalsRow(maps, captains, seriesIndex) {
    const [c1] = captains;
    const totals = seriesRatings(maps);
    if (!totals.length) return "";
    const sideCount = new Map();
    maps.filter(Boolean).forEach(m => {
        const mine = sideOf(m, c1) || "A";
        Object.entries(m.game?.teams || {}).forEach(([side, team]) => (team || []).forEach(p => {
            const id = Number(p.playerId);
            const c = sideCount.get(id) || { with: 0, against: 0 };
            c[side === mine ? "with" : "against"] += 1;
            sideCount.set(id, c);
        }));
    });
    const onLeft = id => { const c = sideCount.get(id) || { with: 0, against: 0 }; return c.with >= c.against; };
    const cell = e => `<span class="koh-p${captains.includes(e.playerId) ? " koh-cap" : ""}">${escapeHtml(getPlayerName(e.playerId))}<small>${e.maps} map${e.maps === 1 ? "" : "s"}</small>${ratingTag(e.rating, true)}</span>`;
    const left = totals.filter(e => onLeft(e.playerId));
    const right = totals.filter(e => !onLeft(e.playerId));
    const mvp = totals[0];
    return `<li class="koh-map koh-total">
            <span class="koh-n" data-mode="Series rating">Σ</span>
            <span class="koh-mode">AVG</span>
            <span class="koh-team koh-left">${left.map(cell).join("")}</span>
            <span class="koh-score koh-total-label">Series<br>rating</span>
            <span class="koh-team koh-right">${right.map(cell).join("")}</span>
        </li>
        <li class="koh-mvprow">
            <button type="button" class="koh-mvpcell" data-koh-mvp="${seriesIndex}" title="How the series MVP works">
                <em>Series MVP</em><span class="koh-mvpname">${escapeHtml(getPlayerName(mvp.playerId))}</span>${ratingTag(mvp.rating, true)}</button>
        </li>`;
}

function seriesBlock(series, mapsById, seriesIndex) {
    const captains = (series.captains || []).map(Number);
    const [c1, c2] = captains;
    const score = Array.isArray(series.score) ? series.score : [];
    const winner = Number(series.winner);
    const name = id => `<span class="koh-captain${winner === id ? " koh-win" : winner ? " koh-out" : ""}">${escapeHtml(getPlayerName(id))}</span>`;
    const dates = (series.dates || []).map(formatHistoryDate).join(", ");
    const maps = (series.mapIds || []).map(id => mapsById.get(id));
    const meta = [tierName(Number(series.tier) || 0), roundName(series), series.format, series.wager ? "2x wager" : ""].filter(Boolean);
    const mapCount = maps.filter(Boolean).length;
    // Folded by default, like the History tab's weeks: the title is just the two captains.
    return `<details class="koh-series">
        <summary class="koh-head">
            <span class="koh-chev" aria-hidden="true">▸</span>
            <span class="koh-versus">${name(c1)}<span class="koh-vs">vs</span>${name(c2)}</span>
            <span class="koh-sscore">${score[0] ?? "–"} – ${score[1] ?? "–"}</span>
            <span class="koh-meta">${meta.map(escapeHtml).join(" · ")}${mapCount ? ` · ${mapCount} map${mapCount === 1 ? "" : "s"}` : ""}</span>
        </summary>
        <div class="koh-body">
            ${dates ? `<div class="koh-dates">Played ${escapeHtml(dates)}</div>` : ""}
            ${maps.length ? `<ol class="koh-maps">${maps.map((m, i) => mapRow(m, i, captains)).join("")}${totalsRow(maps, captains, seriesIndex)}</ol>` : `<div class="ko-small">No maps recorded for this series yet.</div>`}
        </div>
    </details>`;
}

// Fills the History panel for one month. Called each time the month changes.
export function renderKnockoutHistory(monthKey, cup, history) {
    const panel = document.getElementById("koHistory");
    if (!panel) return;
    const mapsById = new Map();
    (history || []).forEach(day => (day.maps || []).forEach(m => mapsById.set(m.mapId, m)));
    const series = [...(cup.series || [])]
        .filter(s => Array.isArray(s.captains) && s.captains.length === 2)
        .sort((a, b) => String((b.dates || []).at(-1) || "").localeCompare(String((a.dates || []).at(-1) || "")));
    seriesNow = series;
    mapsByIdNow = mapsById;
    panel.innerHTML = series.length
        ? `<p class="ko-small">Every Captain's Cup series this month, newest first. Tap a series to open it. Captains are in gold. Under each name: kills/deaths and a match rating out of 10, half against their own teammates and half against the whole lobby (6 is an average game). The Σ row is each player's average for the series. Not Elo.</p>${series.map((s, i) => seriesBlock(s, mapsById, i)).join("")}`
        : `<div class="ko-empty">No Captain's Cup series have been played this month yet.</div>`;
}

// The popup behind the Series MVP button: how the rating works and the board.
function openMvpExplainer(seriesIndex) {
    const series = seriesNow[seriesIndex];
    if (!series) return;
    const maps = (series.mapIds || []).map(id => mapsByIdNow.get(id)).filter(Boolean);
    const list = seriesRatings(maps).map((e, i) => `<li${i === 0 ? ` class="koh-top"` : ""}><span>${i + 1}</span><b>${escapeHtml(getPlayerName(e.playerId))}</b><small>${e.maps} map${e.maps === 1 ? "" : "s"}</small>${ratingTag(e.rating)}</li>`).join("");
    showPopup(`<div class="koh-explain">
        <h2>Series MVP</h2>
        <p class="koh-lead">A match rating out of 10, like a football player rating. Half of it is how you did against your <b>own teammates</b>, half against the <b>whole lobby</b>. It is <b>not Elo</b> and doesn't change anyone's Elo or card.</p>
        <div class="koh-scale"><span><b>8+</b> carried</span><span><b>7</b> good game</span><span><b>6</b> average</span><span><b>under 5</b> rough night</span></div>
        <div class="koh-steps">
            <div><b>1 · KD</b><span>Your KD on the map minus the average KD, once for your team and once for the whole lobby (SND KD counts up to 4).</span></div>
            <div><b>2 · Kills</b><span>Your share of the kills minus an even share: ¼ of your team's, ⅛ of the lobby's in a 4v4.</span></div>
            <div><b>3 · Map rating</b><span>Starts at 6.0 and moves with those two, using the same weights the Elo engine uses for its performance part: 6 + 5 × (KD × 0.5 + kills × 1.5), done for team and lobby and split 50/50, kept between 1 and 10.</span></div>
            <div><b>4 · Series rating</b><span>The average of your map ratings, so steady games beat one big map. The best average is the Series MVP and adds one to the trophy count on their card.</span></div>
        </div>
        <p class="koh-note">Winning, losing and the score margin don't change it, so the best player on the losing team can still be MVP. Only Captain's Cup series count.</p>
        <section><h3>Series rating</h3><ol class="koh-plist">${list}</ol></section>
    </div>`, { className: "koh-popup" });
}

export function setupKnockoutHistoryButton() {
    const button = document.getElementById("koHistoryButton");
    const panel = document.getElementById("koHistory");
    panel.addEventListener("click", e => {
        const el = e.target.closest("[data-koh-mvp]");
        if (el) openMvpExplainer(Number(el.dataset.kohMvp));
    });
    button.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        button.classList.toggle("active", !panel.hidden);
        button.setAttribute("aria-expanded", String(!panel.hidden));
    });
}
