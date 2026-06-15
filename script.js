let allPlayers = [];
let showInactive = false;

// Fetch stats
fetch("stats.json")
    .then(res => res.json())
    .then(data => {
        allPlayers = Object.entries(data.players).map(([id, stats]) => ({
            id: Number(id),
            name: getPlayerName(id),
            ...stats
        }));

        renderTable();
        setupToggle();
        populateTeamDropdowns();
    });

function setupToggle() {
    const toggle = document.getElementById("toggleInactive");
    toggle.addEventListener("change", () => {
        showInactive = toggle.checked;
        renderTable();
    });
}

function renderTable() {
    const tbody = document.getElementById("table-body");
    tbody.innerHTML = "";

    const filtered = allPlayers.filter(p => {
        const wins = p.hpWins + p.sndWins + p.overloadWins;
        const losses = p.hpLosses + p.sndLosses + p.overloadLosses;
        const kills = p.lifetimeKills;
        const deaths = p.lifetimeDeaths;

        const hasPlayed = (wins + losses + kills + deaths) > 0;
        return showInactive ? true : hasPlayed;
    });

    filtered.sort((a, b) => b.elo - a.elo);

    filtered.forEach((p, index) => {
        const tr = document.createElement("tr");

        tr.innerHTML += `<td class="rank">${index + 1}</td>`;
        tr.innerHTML += `<td class="player-name" data-id="${p.id}">${p.name}</td>`;
        tr.innerHTML += `<td class="elo-gold">${p.elo.toFixed(2)}</td>`;

        const wins = p.hpWins + p.sndWins + p.overloadWins;
        const losses = p.hpLosses + p.sndLosses + p.overloadLosses;
        const wl = losses === 0 ? wins : (wins / losses).toFixed(2);

        tr.innerHTML += `
            <td>
                <div class="wl-container">
                    <span class="wl-main" style="color:${wl >= 1 ? '#00ff00' : '#ff3c3c'}">${wl}</span>
                    <span class="wl-arrow">▼</span>
                    <div class="wl-dropdown">
                        <div class="wl-win">W ${wins}</div>
                        <div class="wl-loss">L ${losses}</div>
                    </div>
                </div>
            </td>
        `;

        const kd = p.lifetimeDeaths === 0 ? p.lifetimeKills : (p.lifetimeKills / p.lifetimeDeaths).toFixed(2);
        tr.innerHTML += `<td><span class="kd-val">${kd}</span></td>`;

        tbody.appendChild(tr);

        setKDColor(tr.querySelector(".kd-val"), parseFloat(kd));
    });

    enableWLDrops();
    enableModal(filtered);
}

function enableWLDrops() {
    document.querySelectorAll(".wl-container").forEach(container => {
        const dropdown = container.querySelector(".wl-dropdown");

        container.addEventListener("click", () => {
            dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
        });

        document.addEventListener("click", e => {
            if (!container.contains(e.target)) dropdown.style.display = "none";
        });
    });
}

function populateTeamDropdowns() {
    const selects = document.querySelectorAll(".team-player");

    selects.forEach(sel => {
        sel.innerHTML = `<option value="">-- Select Player --</option>`;
        allPlayers.forEach(p => {
            sel.innerHTML += `<option value="${p.id}">${p.name} (${p.elo})</option>`;
        });
    });
}

function getPlayerName(id) {
    const names = {
        1: "OBEY",
        2: "KAZZI",
        3: "SYMBRR",
        4: "EES",
        5: "NAGI",
        6: "AKEEB",
        7: "USMAAN",
        8: "SUBŽER0",
        9: "PARVEZ",
        10: "HAZZA",
        11: "TOJI",
        12: "NABEEL",
        13: "SAFY",
        14: "Unknown_14"
    };
    return names[id] || "Player " + id;
}

/* ---------------------------
   FIXED PERCENTILE ENGINE
---------------------------- */

function percentile(value, array) {
    const sorted = [...array].sort((a, b) => a - b);

    if (sorted.length <= 1) return 0;

    const below = sorted.filter(v => v < value).length;

    return below / (sorted.length - 1);
}

function computeModeRating(kd, kdArr, wr, wrArr, margin, marginArr, gamesPlayed) {
    const kdPct = percentile(kd, kdArr);
    const wrPct = percentile(wr, wrArr);
    const marginPct = percentile(margin, marginArr);

    const weighted =
        kdPct * 0.50 +
        wrPct * 0.25 +
        marginPct * 0.25;

    let rating = Math.round(57 + weighted * 42);

    const MIN_GAMES = 5;

    if (gamesPlayed < MIN_GAMES && rating > 95) {
        rating = 95;
    }

    return rating;
}

/* ---------------------------
   MODE COMPUTATION
---------------------------- */

function computeMode(prefix, p, players) {
    const kills = p[prefix + "Kills"];
    const deaths = p[prefix + "Deaths"];
    const wins = p[prefix + "Wins"];
    const losses = p[prefix + "Losses"];
    const marginTotal = p[prefix + "MarginTotal"];
    const marginCount = p[prefix + "MarginCount"];

    const kd = deaths === 0 ? kills : kills / deaths;
    const wr = (wins + losses) === 0 ? 0 : wins / (wins + losses);
    const margin = marginCount === 0 ? 0 : marginTotal / marginCount;

    const kdArr = players
        .filter(x => x[prefix + "Deaths"] + x[prefix + "Kills"] > 0)
        .map(x => x[prefix + "Kills"] / x[prefix + "Deaths"]);

    const wrArr = players
        .filter(x => x[prefix + "Wins"] + x[prefix + "Losses"] > 0)
        .map(x => x[prefix + "Wins"] / (x[prefix + "Wins"] + x[prefix + "Losses"]));

    const marginArr = players
        .filter(x => x[prefix + "MarginCount"] > 0)
        .map(x => x[prefix + "MarginTotal"] / x[prefix + "MarginCount"]);

    const gamesPlayed = wins + losses;

    const rating = computeModeRating(kd, kdArr, wr, wrArr, margin, marginArr, gamesPlayed);

    return { kd, wr, margin, rating, wins, losses };
}

/* ---------------------------
   MAIN PLAYER MODAL
---------------------------- */

function enableModal(players) {
    const modal = document.getElementById("playerModal");

    document.querySelectorAll(".player-name").forEach(el => {
        el.addEventListener("click", () => {

            const id = Number(el.dataset.id);
            const p = players.find(x => x.id === id);

            const hp = computeMode("hp", p, players);
            const snd = computeMode("snd", p, players);
            const ovl = computeMode("overload", p, players);

            const avg = Math.round((hp.rating + snd.rating + ovl.rating) / 3);

            const ratingEl = document.querySelector(".rating");
            ratingEl.textContent = avg;
            setRatingColor(ratingEl, avg);

            document.querySelector(".name").textContent = p.name;

            const hpEl = document.querySelector(".col1.row1");
            const ovlEl = document.querySelector(".col2.row1");
            const sndEl = document.querySelector(".col3.row1");

            setRatingColor(hpEl, hp.rating);
            hpEl.textContent = hp.rating;

            setRatingColor(ovlEl, ovl.rating);
            ovlEl.textContent = ovl.rating;

            setRatingColor(sndEl, snd.rating);
            sndEl.textContent = snd.rating;

            // Mode stats modal triggers
            hpEl.onclick = () => openModeModal("Hardpoint", hp);
            ovlEl.onclick = () => openModeModal("Overload", ovl);
            sndEl.onclick = () => openModeModal("Search & Destroy", snd);

            const card = document.querySelector(".card");
            card.classList.remove("flipped");
            setTimeout(() => card.classList.add("flipped"), 1000);

            modal.style.display = "block";
        });
    });

    // FIXED: independent close handler
    document.addEventListener("click", e => {
        if (e.target === modal) modal.style.display = "none";
    });
}

/* ---------------------------
   MODE STATS MODAL
---------------------------- */

function openModeModal(modeName, modeStats) {
    const modal = document.getElementById("modeModal");

    document.getElementById("modeTitle").textContent = modeName;

    const kdEl = document.getElementById("modeKD");
    kdEl.textContent = "K/D: " + modeStats.kd.toFixed(2);
    setKDColor(kdEl, modeStats.kd);

    let convertedMargin = modeStats.margin;

    if (modeName === "Hardpoint") convertedMargin *= 250;
    if (modeName === "Overload") convertedMargin *= 8;
    if (modeName === "Search & Destroy") convertedMargin *= 6;

    const marginEl = document.getElementById("modeMargin");
    marginEl.textContent = "AvgM: " + convertedMargin.toFixed(2);
    setMarginColor(marginEl, convertedMargin);

    modal.style.display = "block";

    // FIXED: independent close handler
    document.addEventListener("click", e => {
        if (e.target === modal) modal.style.display = "none";
    });
}

/* ---------------------------
   COLOR HELPERS
---------------------------- */

function setRatingColor(el, rating) {
    el.style.color = "";
    el.style.background = "";
    el.style.webkitBackgroundClip = "";
    el.style.webkitTextFillColor = "";

    if (rating === 99) {
        el.style.background = "linear-gradient(to bottom, #FF3CFF, #D020FF, #7A00C8)";
        el.style.webkitBackgroundClip = "text";
        el.style.webkitTextFillColor = "transparent";
        return;
    }

    if (rating < 60) {
        el.style.color = "#FF3B3B";
    } else if (rating <= 66) {
        el.style.color = "white";
    } else if (rating <= 79) {
        el.style.color = "#FFE066";
    } else if (rating <= 98) {
        el.style.color = "#7CFF4E";
    }
}

function setKDColor(el, kd) {
    el.style.color = kd < 1.0 ? "#FF4444" : "#00FF66";
}

function setMarginColor(el, margin) {
    el.style.color = margin < 0 ? "#FF4444" : "#00FF66";
}

/* ---------------------------
   TEAM BUILDER
---------------------------- */

document.getElementById("toggleTeams").addEventListener("click", () => {
    const sec = document.getElementById("teamsSection");
    const btn = document.getElementById("toggleTeams");

    const isOpen = sec.style.display === "block";

    sec.style.display = isOpen ? "none" : "block";
    btn.textContent = isOpen ? "Show Team Builder ▼" : "Hide Team Builder ▲";
});

document.getElementById("generateTeams").addEventListener("click", () => {
    const selects = document.querySelectorAll(".team-player");
    const chosen = [];

    selects.forEach(sel => {
        if (sel.value) chosen.push(Number(sel.value));
    });

    if (chosen.length !== 8 || new Set(chosen).size !== 8) {
        document.getElementById("teamOutput").textContent =
            "Please select 8 unique players.";
        return;
    }

    const players = chosen.map(id => allPlayers.find(p => p.id === id));

    function combos(arr, k) {
        const result = [];
        function helper(start, combo) {
            if (combo.length === k) {
                result.push(combo);
                return;
            }
            for (let i = start; i < arr.length; i++) {
                helper(i + 1, combo.concat(arr[i]));
            }
        }
        helper(0, []);
        return result;
    }

    const allCombos = combos(players, 4);

    let best = null;
    let bestDiff = Infinity;

    allCombos.forEach(teamA => {
        const teamAIds = new Set(teamA.map(p => p.id));
        const teamB = players.filter(p => !teamAIds.has(p.id));

        const eloA = teamA.reduce((s, p) => s + p.elo, 0);
        const eloB = teamB.reduce((s, p) => s + p.elo, 0);

        const diff = Math.abs(eloA - eloB);

        if (diff < bestDiff) {
            bestDiff = diff;
            best = { teamA, teamB, eloA, eloB };
        }
    });

    if (!best) {
        document.getElementById("teamOutput").textContent =
            "Could not generate teams. Check selections.";
        return;
    }

    const out =
        "==============================\n" +
        "   CLOSEST MATCH-UP FOUND\n" +
        "==============================\n\n" +
        " Elo: " + best.eloA.toFixed(2) + "  vs  " + best.eloB.toFixed(2) + "\n\n" +
        "------------ TEAM A ------------\n" +
        best.teamA.map(p => " • " + p.name).join("\n") +
        "\n\n" +
        "------------ TEAM B ------------\n" +
        best.teamB.map(p => " • " + p.name).join("\n") +
        "\n" +
        "==============================";

    alert(out);
});












