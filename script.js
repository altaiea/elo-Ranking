// ===============================
// LOAD PREVIOUS + CURRENT STATS
// ===============================
Promise.all([
    fetch("previous_stats.json").then(r => r.json()),
    fetch("current_stats.json").then(r => r.json())
]).then(([prevData, currData]) => {
    mergeStats(prevData.players, currData.players);
});


// ===============================
// GLOBALS
// ===============================
let allPlayers = [];
let showInactive = false;


// ===============================
// MERGE PREVIOUS + CURRENT
// ===============================
function mergeStats(prevPlayersObj, currPlayersObj) {

    const prevPlayers = Object.entries(prevPlayersObj).map(([id, p]) => ({
        id: Number(id),
        name: getPlayerName(Number(id)),
        ...p
    }));

    const currPlayers = Object.entries(currPlayersObj).map(([id, p]) => ({
        id: Number(id),
        name: getPlayerName(Number(id)),
        ...p
    }));

    prevPlayers.sort((a, b) => b.elo - a.elo);
    prevPlayers.forEach((p, i) => p.previousRank = i + 1);

    currPlayers.sort((a, b) => b.elo - a.elo);
    currPlayers.forEach((p, i) => p.currentRank = i + 1);

    allPlayers = currPlayers.map(p => {
        const old = prevPlayers.find(x => x.id === p.id);

        return {
            ...p,
            eloChange: old ? p.elo - old.elo : 0,
            rankChange: old ? old.previousRank - p.currentRank : 0
        };
    });

    renderTable();
    setupToggle();
    populateTeamDropdowns();

    populateAutoDropdowns();
    populateManualDropdowns();

}


// ===============================
// TOGGLE INACTIVE
// ===============================
function setupToggle() {
    const toggle = document.getElementById("toggleInactive");
    toggle.addEventListener("change", () => {
        showInactive = toggle.checked;
        renderTable();
    });
}


// ===============================
// RENDER TABLE
// ===============================
function renderTable() {
    const tbody = document.getElementById("table-body");
    tbody.innerHTML = "";

    const filtered = allPlayers.filter(p => {
        const wins = p.hpWins + p.sndWins + p.overloadWins;
        const losses = p.hpLosses + p.sndLosses + p.overloadLosses;
        const kills = p.lifetimeKills;
        const deaths = p.lifetimeDeaths;
        return showInactive ? true : (wins + losses + kills + deaths) > 0;
    });

    filtered.sort((a, b) => b.elo - a.elo);

    filtered.forEach(p => {
        const tr = document.createElement("tr");

        // ===============================
        // RANK ARROWS
        // ===============================
        const thickRankArrow = p.rankChange > 0 ? "▲" :
            p.rankChange < 0 ? "▼" : "—";

        const rankArrowClass = p.rankChange > 0 ? "arrow-up" :
            p.rankChange < 0 ? "arrow-down" : "arrow-none";

        const thinRankArrow = p.rankChange > 0 ? `↑ ${p.rankChange}` :
            p.rankChange < 0 ? `↓ ${Math.abs(p.rankChange)}` :
                "– 0";

        // ===============================
        // UPDATED RANK CELL (MEDALS ONLY FOR 1–3)
        // ===============================
        tr.innerHTML += `
<td class="rank">
    <div class="rank-container">

        ${
            p.currentRank <= 3
                ? ""
                : `<span class="rank-number" style="margin-right:6px;">${p.currentRank}</span>`
        }


        <span class="rank-arrow ${rankArrowClass} rank-arrow-btn" style="margin-left:6px;">
            ${thickRankArrow}
        </span>

        <div class="rank-dropdown">
            <div class="${rankArrowClass}">${thinRankArrow}</div>
        </div>

    </div>
</td>
`;

        // ===============================
        // PLAYER NAME
        // ===============================
        tr.innerHTML += `<td class="player-name" data-id="${p.id}">${p.name}</td>`;

        // ===============================
        // ELO CELL
        // ===============================
        const thickEloArrow = p.eloChange > 0 ? "▲" :
            p.eloChange < 0 ? "▼" : "—";

        const eloArrowClass = p.eloChange > 0 ? "arrow-up" :
            p.eloChange < 0 ? "arrow-down" : "arrow-none";

        const thinEloArrow = p.eloChange > 0 ? `↑ ${p.eloChange.toFixed(2)}` :
            p.eloChange < 0 ? `↓ ${Math.abs(p.eloChange).toFixed(2)}` :
                "– 0.00";

        tr.innerHTML += `
<td class="elo-gold">
    <div class="elo-container">
        <span class="elo-number">${p.elo.toFixed(2)}</span>
        <span class="elo-arrow ${eloArrowClass} elo-arrow-btn">${thickEloArrow}</span>

        <div class="elo-dropdown">
            <div class="${eloArrowClass}">${thinEloArrow}</div>
        </div>
    </div>
</td>
`;

        // ===============================
        // W/L CELL
        // ===============================
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

        // ===============================
        // KD CELL
        // ===============================
        const kd = p.lifetimeDeaths === 0 ? p.lifetimeKills :
            (p.lifetimeKills / p.lifetimeDeaths).toFixed(2);

        tr.innerHTML += `<td><span class="kd-val">${kd}</span></td>`;

        tbody.appendChild(tr);

        setKDColor(tr.querySelector(".kd-val"), parseFloat(kd));
    });

    enableRankDrops();
    enableEloDrops();
    enableWLDrops();
    enableModal(filtered);
}


// ===============================
// RANK DROPDOWN
// ===============================
function enableRankDrops() {
    document.querySelectorAll(".rank-container").forEach(container => {
        const btn = container.querySelector(".rank-arrow-btn");
        const dropdown = container.querySelector(".rank-dropdown");

        btn.addEventListener("click", e => {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
        });

        document.addEventListener("click", e => {
            if (!container.contains(e.target)) dropdown.style.display = "none";
        });
    });
}


// ===============================
// ELO DROPDOWN
// ===============================
function enableEloDrops() {
    document.querySelectorAll(".elo-container").forEach(container => {
        const btn = container.querySelector(".elo-arrow-btn");
        const dropdown = container.querySelector(".elo-dropdown");

        btn.addEventListener("click", e => {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
        });

        document.addEventListener("click", e => {
            if (!container.contains(e.target)) dropdown.style.display = "none";
        });
    });
}


// ===============================
// WL DROPDOWNS
// ===============================
function enableWLDrops() {
    document.querySelectorAll(".wl-container").forEach(container => {
        const btn = container.querySelector(".wl-arrow");
        const dropdown = container.querySelector(".wl-dropdown");

        btn.addEventListener("click", e => {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
        });

        document.addEventListener("click", e => {
            if (!container.contains(e.target)) dropdown.style.display = "none";
        });
    });
}


// ===============================
// TEAM DROPDOWNS (UPDATED)
// ===============================
function populateTeamDropdowns() {
    const selects = document.querySelectorAll(".team-player");

    selects.forEach(sel => {
        sel.innerHTML = `<option value="">-- Select Player --</option>`;
        allPlayers.forEach(p => {
            sel.innerHTML += `<option value="${p.id}">${p.name}</option>`;
        });
    });

    lockTeamSelections();
}


// ===============================
// PREVENT DUPLICATE SELECTIONS
// ===============================
function lockTeamSelections() {
    const selects = document.querySelectorAll(".team-player");

    selects.forEach(sel => {
        sel.addEventListener("change", () => {

            const chosen = Array.from(selects)
                .map(s => s.value)
                .filter(v => v !== "");

            selects.forEach(s => {
                const currentValue = s.value;

                Array.from(s.options).forEach(opt => {
                    if (opt.value === "") return;

                    if (chosen.includes(opt.value) && opt.value !== currentValue) {
                        opt.disabled = true;
                    } else {
                        opt.disabled = false;
                    }
                });
            });
        });
    });
}


// ===============================
// NAME LOOKUP
// ===============================
function getPlayerName(id) {
    const names = {
        1: "OBEY",
        2: "KAZZI",
        3: "SYMBRR",
        4: "EES",
        5: "NAGI",
        6: "AKEEB",
        7: "USMAAN",
        8: "SUBŽERO",
        9: "PARVEZ",
        10: "HAZZA",
        11: "TOJI",
        12: "NABEEL",
        13: "SAFY",
        14: "MASEEH"
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

function computeModeRating(kdPct, wrPct, marginPct, slayerWeighted, gamesPlayed) {
    const weighted =
        0.6 * slayerWeighted +
        0.25 * marginPct +
        0.15 * wrPct;

    let rating = Math.round(57 + weighted * 42);

    if (gamesPlayed < 5 && rating > 95) {
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
    const dmgShare = p[prefix + "DamageShare"] || 0;

    const kd = deaths === 0 ? kills : kills / deaths;
    const wr = (wins + losses) === 0 ? 0 : wins / (wins + losses);
    const margin = marginCount === 0 ? 0 : marginTotal / marginCount;

    const kdArr = players
        .filter(x => x[prefix + "Deaths"] + x[prefix + "Kills"] > 0)
        .map(x => x[prefix + "Kills"] / x[prefix + "Deaths"]);
    const kdPct = percentile(kd, kdArr);

    const wrArr = players
        .filter(x => x[prefix + "Wins"] + x[prefix + "Losses"] > 0)
        .map(x => x[prefix + "Wins"] / (x[prefix + "Wins"] + x[prefix + "Losses"]));
    const wrPct = percentile(wr, wrArr);

    const marginArr = players
        .filter(x => x[prefix + "MarginCount"] > 0)
        .map(x => x[prefix + "MarginTotal"] / x[prefix + "MarginCount"]);
    const marginPct = percentile(margin, marginArr);

    const dmgArr = players
        .filter(x => x[prefix + "DamageShare"] > 0)
        .map(x => x[prefix + "DamageShare"]);
    const dmgPct = percentile(dmgShare, dmgArr);

    const slayerWeighted = 0.7 * dmgPct + 0.3 * kdPct;

    const slayerRating = Math.round(57 + slayerWeighted * 42);

    const gamesPlayed = wins + losses;
    const rating = computeModeRating(kdPct, wrPct, marginPct, slayerWeighted, gamesPlayed);

    if (p.name === "AKEEB" && prefix === "snd") {
        console.log("=== DEBUG AKEEB SND ===");
        console.log("Kills:", kills, "Deaths:", deaths);
        console.log("KD:", kd);
        console.log("Wins:", wins, "Losses:", losses);
        console.log("WR:", wr);
        console.log("MarginTotal:", marginTotal, "MarginCount:", marginCount, "Margin:", margin);
        console.log("DamageShare:", dmgShare);
        console.log("kdPct:", kdPct);
        console.log("wrPct:", wrPct);
        console.log("marginPct:", marginPct);
        console.log("dmgPct:", dmgPct);
        console.log("slayerWeighted:", slayerWeighted);
        console.log("Rating:", rating);
        console.log("=======================");
    }

    return {
        kd,
        wr,
        margin,
        rating,
        wins,
        losses,
        slayerWeighted,
        kdPct,
        wrPct,
        marginPct,
        dmgPct,
        slayerRating
    };
}
/* ---------------------------
   MAIN PLAYER MODAL
---------------------------- */

// ===============================
// CUSTOM BACK CARDS PER PLAYER
// ===============================
const customBackCards = {
    1: "cards/1_back.png",
    2: "cards/2_back.png",
    3: "cards/3_back.png",
    4: "cards/4_back.png",
    5: "cards/5_back.png",
    6: "cards/6_back.png",
    7: "cards/7_back.png",
    8: "cards/8_back.png",
    9: "cards/9_back.png",
    10: "cards/10_back.png",
    11: "cards/11_back.png",
    12: "cards/12_back.png",
    13: "cards/13_back.png",
    14: "cards/14_back.png"
};

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

            // ===============================
            // OVERALL RATING ONLY
            // ===============================
            const ratingEl = document.querySelector(".rating");
            ratingEl.textContent = avg;
            setRatingColor(ratingEl, avg);

            // ===============================
            // DATE-BOX RIGHT-SIDE EXCEPTIONS
            // ===============================
            const dateBox = document.querySelector(".date-box");
            const dateBoxRightSide = [1, 11];

            if (dateBoxRightSide.includes(p.id)) {
                dateBox.style.left = "auto";
                dateBox.style.right = "40px";
                dateBox.style.top = "28px";
            } else {
                dateBox.style.right = "auto";
                dateBox.style.left = "36px";
                dateBox.style.top = "28px";
            }

            // ===============================
            // 3 RATING CIRCLES ONLY
            // ===============================
            const hpEl = document.querySelector(".col1.row1");
            const ovlEl = document.querySelector(".col2.row1");
            const sndEl = document.querySelector(".col3.row1");

            setRatingColor(hpEl, hp.rating);
            hpEl.textContent = hp.rating;

            setRatingColor(ovlEl, ovl.rating);
            ovlEl.textContent = ovl.rating;

            setRatingColor(sndEl, snd.rating);
            sndEl.textContent = snd.rating;

            hpEl.onclick = () => openModeModal("Hardpoint", hp);
            ovlEl.onclick = () => openModeModal("Overload", ovl);
            sndEl.onclick = () => openModeModal("Search & Destroy", snd);

           // ===============================
            //  SPECIAL POSITION OVERRIDES 
          // ONLY FOR PLAYERS 4, 11 AND 13
            // ===============================

            const card = document.querySelector(".card");

            // Remove previous overrides
            card.classList.remove("player4-adjust", "player11-adjust", "player13-adjust");

            // Apply overrides only for players 4, 11, and 13
            if (p.id === 4) {
                card.classList.add("player4-adjust");
            }

            if (p.id === 11) {
                card.classList.add("player11-adjust");
            }

            if (p.id === 13) {
                card.classList.add("player13-adjust");
            }


            // ===============================
            // SET BACK CARD PNG
            // ===============================
            const backEl = document.querySelector(".back");

            if (customBackCards[p.id]) {
                backEl.style.backgroundImage = `url('${customBackCards[p.id]}')`;
            } else {
                backEl.style.backgroundImage = "url('CDLcardUse.png')";
            }

            // ===============================
            // CARD FLIP
            // ===============================
            card.classList.remove("flipped");
            setTimeout(() => card.classList.add("flipped"), 1000);

            modal.style.display = "block";
        });
    });

    document.addEventListener("click", e => {
        if (e.target === modal) modal.style.display = "none";
    });
}


/* ---------------------------
   MODE STATS MODAL
---------------------------- */

function openModeModal(modeName, modeStats) {
    const modal = document.getElementById("modeModal");

    const shieldContainer = modal.querySelector(".shield-container");
    const modalBox = shieldContainer.querySelector(".mode-stats");

    let convertedMargin = modeStats.margin;
    if (modeName === "Hardpoint") convertedMargin *= 250;
    if (modeName === "Overload") convertedMargin *= 8;
    if (modeName === "Search & Destroy") convertedMargin *= 6;

    const kd = modeStats.kd;
    const slayerScore = modeStats.slayerRating;

    modalBox.innerHTML = `
    <div class="mode-title-box">
        <h2 id="modeTitle">${modeName}</h2>
    </div>

    <div class="stat-box">
        <div class="stat-row">
            <span class="stat-label">K/D</span>
            <span class="stat-value" id="modeKD">${kd.toFixed(2)}</span>
        </div>
    </div>

    <div class="stat-box">
        <div class="stat-row">
            <span class="stat-label">AvgM</span>
            <span class="stat-value" id="modeMargin">${convertedMargin.toFixed(2)}</span>
        </div>
    </div>

    <div class="stat-box">
        <div class="stat-row">
            <span class="stat-label">Slayer</span>
            <div class="stat-circle" id="modeSlayer">${slayerScore}</div>
        </div>
    </div>
    `;

    const kdEl = document.getElementById("modeKD");
    setKDColor(kdEl, kd);

    const marginEl = document.getElementById("modeMargin");
    setMarginColor(marginEl, convertedMargin);

    const slayerEl = document.getElementById("modeSlayer");

    if (slayerScore < 40) {
        slayerEl.style.color = "#FF4444";
        slayerEl.style.borderColor = "#FF4444";
    }
    else if (slayerScore < 60) {
        slayerEl.style.color = "white";
        slayerEl.style.borderColor = "white";
    }
    else if (slayerScore < 80) {
        slayerEl.style.color = "#FFE066";
        slayerEl.style.borderColor = "#FFE066";
    }
    else if (slayerScore <= 98) {
        slayerEl.style.color = "#00FF66";
        slayerEl.style.borderColor = "#00FF66";
    }
    else if (slayerScore === 99) {
        slayerEl.style.color = "#7A00C8";
        slayerEl.style.borderColor = "#7A00C8";
    }

    modal.style.display = "block";

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
   TEAM BUILDER (AUTO)
---------------------------- */

document.getElementById("toggleTeams").addEventListener("click", () => {
    const sec = document.getElementById("teamsSection");
    const btn = document.getElementById("toggleTeams");

    const isOpen = sec.style.display === "block";

    sec.style.display = isOpen ? "none" : "block";
    btn.textContent = isOpen ? "Show Team Builder ▼" : "Hide Team Builder ▲";
});

// Populate AUTO team builder dropdowns
function populateAutoDropdowns() {
    const selects = document.querySelectorAll(".team-player");
    selects.forEach(sel => {
        sel.innerHTML = `<option value="">Select Player</option>`;
        allPlayers.forEach(p => {
            sel.innerHTML += `<option value="${p.id}">${p.name}</option>`;
        });
    });
}
populateAutoDropdowns();

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


/* ---------------------------
   MANUAL TEAM BUILDER
---------------------------- */

// Populate MANUAL team builder dropdowns
function populateManualDropdowns() {
    const selects = document.querySelectorAll(".manual-select");
    selects.forEach(sel => {
        sel.innerHTML = `<option value="">Select Player</option>`;
        allPlayers.forEach(p => {
            sel.innerHTML += `<option value="${p.id}">${p.name}</option>`;
        });
    });
}
populateManualDropdowns();

// Show simulate button when all 8 players selected
function checkManualReady() {
    const teamA = [...document.querySelectorAll(".manualA")].map(s => s.value).filter(v => v);
    const teamB = [...document.querySelectorAll(".manualB")].map(s => s.value).filter(v => v);

    if (teamA.length === 4 && teamB.length === 4) {
        document.getElementById("simulateMatchBtn").style.display = "inline-block";
    }
}
document.querySelectorAll(".manual-select").forEach(sel => {
    sel.addEventListener("change", checkManualReady);
});

// SIMULATE MATCH (FULL OUTPUT FORMAT)
document.getElementById("simulateMatchBtn").addEventListener("click", () => {

    const teamAIds = [...document.querySelectorAll(".manualA")].map(s => Number(s.value));
    const teamBIds = [...document.querySelectorAll(".manualB")].map(s => Number(s.value));

    const teamA = teamAIds.map(id => allPlayers.find(p => p.id === id));
    const teamB = teamBIds.map(id => allPlayers.find(p => p.id === id));

    const eloA = teamA.reduce((s, p) => s + p.elo, 0);
    const eloB = teamB.reduce((s, p) => s + p.elo, 0);

    const probA = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
    const probB = 1 - probA;

    const K = 20;

    const baseA_win = K * (1 - probA);
    const baseA_loss = -baseA_win;

    const baseB_win = K * (1 - probB);
    const baseB_loss = -baseB_win;

    const out =
        `==============================
     MATCH SIMULATION
==============================

------------ TEAM A ------------
${teamA.map(p => " • " + p.name).join("\n")}

------------ TEAM B ------------
${teamB.map(p => " • " + p.name).join("\n")}
==============================

 Team A ELO: ${eloA.toFixed(2)}
 Team B ELO: ${eloB.toFixed(2)}

------ WIN PROBABILITY ------
 Team A: ${(probA * 100).toFixed(1)}%
 Team B: ${(probB * 100).toFixed(1)}%

------ BASE ELO (IF TEAM A WINS) ------
 Team A gain: +${baseA_win.toFixed(2)}
 Team B loss: -${Math.abs(baseA_loss).toFixed(2)}

------ BASE ELO (IF TEAM B WINS) ------
 Team B gain: +${baseB_win.toFixed(2)}
 Team A loss: -${Math.abs(baseB_loss).toFixed(2)}
==============================`;


    document.getElementById("simulationOutput").textContent = out;
});


// ======================================================
// TABS + SERIES HISTORY (ADDED BELOW YOUR ORIGINAL CODE)
// ======================================================


// ---------------------------
// TAB SYSTEM
// ---------------------------
function initTabs() {
    const tabs = document.querySelectorAll(".nav-tab");
    const pages = document.querySelectorAll(".tab-page");
    const title = document.getElementById("pageTitle");

    tabs.forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.tab;

            // Show correct page
            pages.forEach(p => {
                p.style.display = (p.id === target) ? "block" : "none";
            });

            // Update title text
            if (target === "leaderboardPage") title.textContent = "LEADERBOARD";
            if (target === "teamsPage") title.textContent = "TEAMS";
            if (target === "seriesHistoryPage") title.textContent = "9 MAPS";
        });
    });
}



// ---------------------------
// SERIES CONFIG
// ---------------------------
const seriesIndex = [
    {
        id: 1,
        file: "series_1.json"
    }
];


// ---------------------------
// SERIES LIST RENDER
// ---------------------------
function renderSeriesList() {
    const listEl = document.getElementById("seriesList");
    const viewerEl = document.getElementById("seriesViewer");

    listEl.innerHTML = "";
    viewerEl.style.display = "none";

    seriesIndex.forEach(s => {
        fetch(s.file)
            .then(r => r.json())
            .then(data => {
                const series = data.seriesList.find(x => x.seriesId === s.id);

                const div = document.createElement("div");
                div.className = "series-entry";

                // Show team names instead of "Series 1"
                div.textContent = `${series.teamAName} vs ${series.teamBName}`;

                div.addEventListener("click", () => loadSeries(s));
                listEl.appendChild(div);
            });
    });
}


// ---------------------------
// LOAD ONE SERIES
// ---------------------------
function loadSeries(seriesMeta) {
    fetch(seriesMeta.file)
        .then(r => r.json())
        .then(data => {
            const series = data.seriesList.find(x => x.seriesId === seriesMeta.id);
            renderSeriesViewer(series);
        })
        .catch(err => console.error("Error loading series:", err));
}


// ---------------------------
// RENDER SERIES VIEWER
// ---------------------------
function renderSeriesViewer(series) {
    const viewerEl = document.getElementById("seriesViewer");
    viewerEl.style.display = "block";
    viewerEl.innerHTML = "";

    // Back button
    const backBtn = document.createElement("button");
    backBtn.className = "series-back-btn";
    backBtn.textContent = "← Back to Series List";
    backBtn.addEventListener("click", renderSeriesList);
    viewerEl.appendChild(backBtn);

    // Title with final score
    const title = document.createElement("h2");
    title.textContent = `${series.teamAName} vs ${series.teamBName} — ${series.finalScore}`;
    viewerEl.appendChild(title);

    // MVP badge
    const mvp = document.createElement("p");
    mvp.style.fontSize = "18px";
    mvp.style.fontWeight = "700";
    mvp.style.color = "#00eaff";
    mvp.innerHTML = `MVP: <span style="color:#FFD700;">⭐ ${series.mvpPlayerName}</span>`;
    viewerEl.appendChild(mvp);

    // Remove players who did not play
    const played = series.leaderboard.filter(p => !(p.kills === 0 && p.deaths === 0));

    // Split into Team A and Team B using JSON field
    const teamAPlayers = played.filter(p => p.team === "A");
    const teamBPlayers = played.filter(p => p.team === "B");

    // ---------------------------
    // TEAM A TABLE
    // ---------------------------
    const tableA = document.createElement("table");
    tableA.className = "series-scoreboard";
    tableA.innerHTML = `
        <thead>
            <tr><th colspan="6" style="color:#00eaff;">${series.teamAName}</th></tr>
            <tr>
                <th>Player</th>
                <th>Kills</th>
                <th>Deaths</th>
                <th>K/D</th>
                <th>Damage</th>
                <th>MVP Score</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbodyA = tableA.querySelector("tbody");

    teamAPlayers.forEach(p => {
        const kd = p.deaths === 0 ? p.kills : (p.kills / p.deaths).toFixed(2);
        const isMVP = p.playerId === series.mvpPlayerId;

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${isMVP ? "⭐ " : ""}${p.playerName}</td>
            <td>${p.kills}</td>
            <td>${p.deaths}</td>
            <td>${kd}</td>
            <td>${p.damage.toLocaleString()}</td>
            <td>${p.mvpScore.toFixed(2)}</td>
        `;
        tbodyA.appendChild(tr);
    });

    viewerEl.appendChild(tableA);

    // ---------------------------
    // TEAM B TABLE
    // ---------------------------
    const tableB = document.createElement("table");
    tableB.className = "series-scoreboard";
    tableB.innerHTML = `
        <thead>
            <tr><th colspan="6" style="color:#00eaff;">${series.teamBName}</th></tr>
            <tr>
                <th>Player</th>
                <th>Kills</th>
                <th>Deaths</th>
                <th>K/D</th>
                <th>Damage</th>
                <th>MVP Score</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbodyB = tableB.querySelector("tbody");

    teamBPlayers.forEach(p => {
        const kd = p.deaths === 0 ? p.kills : (p.kills / p.deaths).toFixed(2);
        const isMVP = p.playerId === series.mvpPlayerId;

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${isMVP ? "⭐ " : ""}${p.playerName}</td>
            <td>${p.kills}</td>
            <td>${p.deaths}</td>
            <td>${kd}</td>
            <td>${p.damage.toLocaleString()}</td>
            <td>${p.mvpScore.toFixed(2)}</td>
        `;
        tbodyB.appendChild(tr);
    });

    viewerEl.appendChild(tableB);
}


// ---------------------------
// INITIALISE TABS + SERIES
// ---------------------------
document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    renderSeriesList();
});














