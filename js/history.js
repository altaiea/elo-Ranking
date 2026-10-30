/* ======================================================
   HISTORY TAB
   Days grouped by week; open a day to see every map, each player's Elo
   change and the full calculation the Java engine recorded.
====================================================== */
import { getPlayerName } from "./config.js";
import { loadHistoryDay, loadHistoryIndex } from "./data.js";
import { formatElo, formatHistoryDate, formatSignedElo } from "./ui.js";

function formatTraceValue(value) {
    if (value === null || value === undefined) return "—";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
    if (typeof value === "boolean") return value ? "true" : "false";
    return String(value);
}

function createHistoryMessage(text, className = "history-entry") {
    const el = document.createElement("div");
    el.className = className;
    el.textContent = text;
    return el;
}

function getMapScore(map) {
    const score = map?.game?.result?.score || {};
    return { teamA: score?.teamA ?? "—", teamB: score?.teamB ?? "—" };
}

// Monday of the week a date falls in, as a UTC timestamp.
function weekStart(dateText) {
    const [y, m, d] = String(dateText).split("-").map(Number);
    const t = Date.UTC(y, m - 1, d);
    return t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000;
}

const shortDay = (t, withMonth) =>
    `${new Date(t).getUTCDate()}${withMonth ? " " + new Date(t).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }) : ""}`;

let openWeeks = null;   // which weeks are expanded; the newest starts open

export async function renderHistoryList() {
    const listEl = document.getElementById("historyList");
    const viewerEl = document.getElementById("historyViewer");

    listEl.style.display = "";
    viewerEl.style.display = "none";
    viewerEl.innerHTML = "";
    listEl.replaceChildren(createHistoryMessage("Loading match history..."));

    let entries;
    try {
        entries = (await loadHistoryIndex()).slice().reverse();   // newest first
    } catch (error) {
        console.error("Could not load map history:", error);
        listEl.replaceChildren(createHistoryMessage("No match history found"));
        return;
    }
    listEl.innerHTML = "";
    if (!entries.length) {
        listEl.appendChild(createHistoryMessage("No match history found"));
        return;
    }

    const weeks = new Map();
    entries.forEach(entry => {
        const k = weekStart(entry.date);
        if (!weeks.has(k)) weeks.set(k, []);
        weeks.get(k).push(entry);
    });
    const weekList = [...weeks.entries()].sort((a, b) => b[0] - a[0]);
    if (!openWeeks) openWeeks = new Set([weekList[0][0]]);

    weekList.forEach(([start, days]) => {
        const end = start + 6 * 86400000;
        const sameMonth = new Date(start).getUTCMonth() === new Date(end).getUTCMonth();
        const mapTotal = days.reduce((n, e) => n + (e.mapCount || 0), 0);

        const week = document.createElement("div");
        week.className = "history-week" + (openWeeks.has(start) ? " open" : "");

        const head = document.createElement("button");
        head.type = "button";
        head.className = "history-week-head";
        head.setAttribute("aria-expanded", String(openWeeks.has(start)));
        head.innerHTML = `<span class="history-week-chev">&#9656;</span><span class="history-week-title">Week of ${shortDay(start, !sameMonth)} – ${shortDay(end, true)}</span><span class="history-week-meta">${days.length} day${days.length === 1 ? "" : "s"}${mapTotal ? ` · ${mapTotal} maps` : ""}</span>`;
        head.addEventListener("click", () => {
            const open = week.classList.toggle("open");
            head.setAttribute("aria-expanded", String(open));
            if (open) openWeeks.add(start); else openWeeks.delete(start);
        });

        const dayBox = document.createElement("div");
        dayBox.className = "history-week-days";
        week.append(head, dayBox);
        listEl.appendChild(week);

        days.forEach(entry => {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "history-entry";

            const date = document.createElement("span");
            date.className = "history-entry-date";
            date.textContent = formatHistoryDate(entry.date);

            const count = document.createElement("span");
            count.className = "history-entry-count";
            count.textContent = entry.mapCount === null ? "View maps" : `${entry.mapCount} map${entry.mapCount === 1 ? "" : "s"}`;

            row.append(date, count);
            row.addEventListener("click", async () => {
                count.textContent = "Loading…";
                try {
                    renderHistoryDay(await loadHistoryDay(entry), entry);
                } catch (error) {
                    console.error("Error loading history day:", error);
                    count.textContent = "Could not load";
                }
            });
            dayBox.appendChild(row);
        });
    });
}

function renderHistoryDay(day, entry) {
    const listEl = document.getElementById("historyList");
    const viewerEl = document.getElementById("historyViewer");

    listEl.style.display = "none";
    viewerEl.style.display = "block";
    viewerEl.innerHTML = "";

    const backBtn = document.createElement("button");
    backBtn.className = "history-back-btn";
    backBtn.type = "button";
    backBtn.textContent = "← Back to History";
    backBtn.addEventListener("click", renderHistoryList);
    viewerEl.appendChild(backBtn);

    const title = document.createElement("h2");
    title.className = "history-day-title";
    title.textContent = formatHistoryDate(day?.date || entry?.date);
    viewerEl.appendChild(title);

    const maps = Array.isArray(day?.maps) ? day.maps : [];
    if (!maps.length) {
        viewerEl.appendChild(createHistoryMessage("No maps recorded for this date."));
        return;
    }
    maps.forEach((map, index) => viewerEl.appendChild(buildMapHistoryCard(map, index)));
}

function buildMapHistoryCard(map, index) {
    const card = document.createElement("section");
    card.className = "history-map-card";

    const score = getMapScore(map);
    const header = document.createElement("div");
    header.className = "history-map-header";

    const info = document.createElement("div");
    const mode = document.createElement("div");
    mode.className = "history-map-mode";
    mode.textContent = `${map?.gameMode || map?.game?.gameMode || "Map"} · Map ${index + 1}`;

    const source = document.createElement("div");
    source.className = "history-map-source";
    source.textContent = map?.source || map?.game?.source || "";
    info.append(mode, source);

    const scoreBox = document.createElement("div");
    scoreBox.className = "history-map-score";
    scoreBox.textContent = `${score.teamA} – ${score.teamB}`;

    header.append(info, scoreBox);
    card.appendChild(header);

    const teams = map?.game?.teams || {};
    const eloByPlayer = new Map((Array.isArray(map?.elo) ? map.elo : []).map(item => [Number(item.playerId), item]));

    card.appendChild(buildHistoryTeam("TEAM A", teams.A || [], eloByPlayer, Number(map?.game?.result?.winningTeam) === 1));
    card.appendChild(buildHistoryTeam("TEAM B", teams.B || [], eloByPlayer, Number(map?.game?.result?.winningTeam) === 2));

    return card;
}

function buildHistoryTeam(label, players, eloByPlayer, won) {
    const section = document.createElement("div");
    section.className = "history-team-section";

    const heading = document.createElement("div");
    heading.className = `history-team-heading${won ? " history-team-winner" : ""}`;
    heading.textContent = won ? `${label} · WIN` : label;
    section.appendChild(heading);

    const tableWrap = document.createElement("div");
    tableWrap.className = "history-table-wrap";

    const table = document.createElement("table");
    table.className = "history-scoreboard";
    table.innerHTML = `
        <thead>
            <tr>
                <th>Player</th>
                <th>Kills</th>
                <th>Deaths</th>
                <th>K/D</th>
                <th>Elo Before</th>
                <th>Change</th>
                <th>Elo After</th>
                <th>Calculation</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");
    (Array.isArray(players) ? players : []).forEach(player => {
        const playerId = Number(player?.playerId);
        const elo = eloByPlayer.get(playerId) || {};
        const kills = Number(player?.kills || 0);
        const deaths = Number(player?.deaths || 0);
        const kd = deaths === 0 ? kills : kills / deaths;

        const row = document.createElement("tr");
        row.className = "history-player-row";

        const values = [
            getPlayerName(playerId),
            String(kills),
            String(deaths),
            Number(kd).toFixed(2),
            formatElo(elo?.before),
            formatSignedElo(elo?.change),
            formatElo(elo?.after)
        ];

        values.forEach((value, cellIndex) => {
            const td = document.createElement("td");
            td.textContent = value;
            if (cellIndex === 5) {
                const change = Number(elo?.change);
                if (Number.isFinite(change)) td.className = change >= 0 ? "history-elo-positive" : "history-elo-negative";
            }
            row.appendChild(td);
        });

        const actionCell = document.createElement("td");
        const trace = elo?.calculationTrace;
        if (trace && Array.isArray(trace.steps) && trace.steps.length) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "history-calc-btn";
            button.textContent = "View calculation";
            actionCell.appendChild(button);

            const detailsRow = document.createElement("tr");
            detailsRow.className = "history-calculation-row";
            detailsRow.style.display = "none";
            const detailsCell = document.createElement("td");
            detailsCell.colSpan = 8;
            detailsCell.appendChild(buildCalculationTrace(trace));
            detailsRow.appendChild(detailsCell);

            button.addEventListener("click", () => {
                const opening = detailsRow.style.display === "none";
                detailsRow.style.display = opening ? "table-row" : "none";
                button.textContent = opening ? "Hide calculation" : "View calculation";
            });

            row.appendChild(actionCell);
            tbody.appendChild(row);
            tbody.appendChild(detailsRow);
            return;
        } else {
            const unavailable = document.createElement("span");
            unavailable.className = "history-trace-unavailable";
            unavailable.textContent = "Not recorded";
            actionCell.appendChild(unavailable);
        }

        row.appendChild(actionCell);
        tbody.appendChild(row);
    });

    tableWrap.appendChild(table);
    section.appendChild(tableWrap);
    return section;
}

function buildCalculationTrace(trace) {
    // Presentation only: all displayed values come from Java's saved trace.
    const container = document.createElement("div");
    container.className = "history-calculation history-calc-grouped";
    const recordedSteps = Array.isArray(trace?.steps) ? trace.steps : [];
    const findStep = name => recordedSteps.find(step => step?.name === name);
    const recorded = name => findStep(name)?.result;
    const signed = value => {
        if (typeof value !== "number" || !Number.isFinite(value)) return formatTraceValue(value);
        return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
    };
    const valueClass = value => {
        if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "history-calc-neutral";
        return value > 0 ? "history-calc-gain" : "history-calc-loss";
    };
    const addLine = (parent, title, value, options = {}) => {
        if (value === undefined || value === null) return;
        const line = document.createElement("div");
        line.className = `history-calc-line${options.final ? " history-calc-line-final" : ""}`;
        const nameEl = document.createElement("span");
        nameEl.textContent = title;
        const valueEl = document.createElement("strong");
        valueEl.textContent = options.signed ? signed(value) : (options.elo ? formatElo(value) : formatTraceValue(value));
        valueEl.className = options.signed ? valueClass(value) : "history-calc-neutral";
        line.append(nameEl, valueEl);
        parent.appendChild(line);
    };

    const summary = document.createElement("div");
    summary.className = "history-calc-compact";
    addLine(summary, "Starting Elo", trace?.before, { elo: true });
    addLine(summary, "Players Elo vs Enemy Team Average", `${formatElo(trace?.before)} vs ${formatElo(recorded("Opponent average Elo"))}`);
    addLine(summary, "Base Elo", recorded("Base Elo"), { signed: true });
    addLine(summary, "After map margin", recorded("Base after margin"), { signed: true });
    addLine(summary, "KD adjustment", recorded("KD adjustment"), { signed: true });
    addLine(summary, "Damage adjustment", recorded("Damage adjustment"), { signed: true });
    // Recorded from Elo rules version 2 onwards; older maps simply skip these lines.
    addLine(summary, "Winner guard scale", recorded("Winner guard scale"));
    addLine(summary, "Leak share", recorded("Leak share"), { signed: true });
    // The published change is authoritative: display it rather than recomputing from rounded components.
    addLine(summary, "Total Elo change", trace?.change, { signed: true, final: true });
    addLine(summary, "Updated Elo", trace?.after, { elo: true, final: true });
    container.appendChild(summary);

    const note = document.createElement("p");
    note.className = "history-calc-note";
    note.textContent = "Green = Elo gained or a positive adjustment · Red = Elo lost or a negative adjustment. Values are recorded by the Java engine; the summary is rounded for display.";
    container.appendChild(note);

    const details = document.createElement("details");
    details.className = "history-calc-full-details";
    const disclosure = document.createElement("summary");
    disclosure.textContent = `Show all ${recordedSteps.length} recorded calculation steps and formulas`;
    details.appendChild(disclosure);
    const steps = document.createElement("div");
    steps.className = "history-calc-steps";

    recordedSteps.forEach((step, index) => {
        const stepEl = document.createElement("div");
        stepEl.className = "history-calc-step";
        const header = document.createElement("div");
        header.className = "history-calc-step-header";
        const number = document.createElement("span");
        number.className = "history-calc-step-number";
        number.textContent = String(index + 1);
        const name = document.createElement("strong");
        name.textContent = step?.name || `Step ${index + 1}`;
        header.append(number, name);
        stepEl.appendChild(header);

        if (step?.formula) {
            const formula = document.createElement("div");
            formula.className = "history-calc-formula";
            formula.textContent = step.formula;
            stepEl.appendChild(formula);
        }
        const inputs = step?.inputs && typeof step.inputs === "object" ? Object.entries(step.inputs) : [];
        if (inputs.length) {
            const inputsEl = document.createElement("div");
            inputsEl.className = "history-calc-inputs";
            inputs.forEach(([key, value]) => {
                const pair = document.createElement("span");
                const keyEl = document.createElement("b");
                keyEl.textContent = `${key}: `;
                pair.append(keyEl, document.createTextNode(formatTraceValue(value)));
                inputsEl.appendChild(pair);
            });
            stepEl.appendChild(inputsEl);
        }
        const result = document.createElement("div");
        result.className = "history-calc-result";
        const resultLabel = document.createElement("span");
        resultLabel.textContent = "Result";
        const resultValue = document.createElement("strong");
        resultValue.textContent = formatTraceValue(step?.result);
        if (["Base Elo", "Base after margin", "KD adjustment", "Damage adjustment", "Leak share", "Final change"].includes(step?.name)) {
            resultValue.classList.add(valueClass(step?.result));
        }
        result.append(resultLabel, resultValue);
        stepEl.appendChild(result);
        steps.appendChild(stepEl);
    });
    details.appendChild(steps);
    container.appendChild(details);
    return container;
}
