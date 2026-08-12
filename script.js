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

    // NEW — lifetime damage share
    const lifetimeDamage = p[prefix + "LifetimeDamage"] || 0;
    const lifetimeTeamDamage = p[prefix + "LifetimeTeamDamage"] || 0;

    const dmgShare = lifetimeTeamDamage === 0
        ? 0
        : lifetimeDamage / lifetimeTeamDamage;

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

    // NEW — percentile array for lifetime damage share
    const dmgArr = players
        .filter(x => (x[prefix + "LifetimeTeamDamage"] || 0) > 0)
        .map(x => {
            const ld = x[prefix + "LifetimeDamage"] || 0;
            const ltd = x[prefix + "LifetimeTeamDamage"] || 0;
            return ltd === 0 ? 0 : ld / ltd;
        });

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
        console.log("LifetimeDamage:", lifetimeDamage);
        console.log("LifetimeTeamDamage:", lifetimeTeamDamage);
        console.log("dmgShare:", dmgShare);
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
    const closeModal = document.getElementById("closeModal");

    document.querySelectorAll(".player-name").forEach(el => {
        el.addEventListener("click", () => {

            const id = Number(el.dataset.id);
            const p = players.find(x => x.id === id);

            modal.style.display = "block";

            const card = modal.querySelector(".card");
            const cardBackVideo = document.getElementById("cardBackVideo");

            // reset video
            cardBackVideo.pause();
            cardBackVideo.currentTime = 0;
            cardBackVideo.style.display = "none";

            // ===============================
            // MODE RATINGS
            // ===============================
            const hp = computeMode("hp", p, players);
            const snd = computeMode("snd", p, players);
            const ovl = computeMode("overload", p, players);

            const avg = Math.round((hp.rating + snd.rating + ovl.rating) / 3);

            // OVERALL RATING
            const ratingEl = document.querySelector(".rating");
            ratingEl.textContent = avg;
            setRatingColor(ratingEl, avg);

            // DATE BOX POSITION
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

            // 3 CIRCLES
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


            // SPECIAL POSITION OVERRIDES (ALL PLAYERS, SAME CARD)
            card.classList.remove(
                "player4-adjust",
                "player11-adjust",
                "player13-adjust",
                "player3-adjust"
            );

            if (p.id === 4) card.classList.add("player4-adjust");
            if (p.id === 11) card.classList.add("player11-adjust");
            if (p.id === 13) card.classList.add("player13-adjust");
            if (p.id === 3) card.classList.add("player3-adjust");

            // SET BACK CARD PNG
            const backEl = document.querySelector(".back");

            if (customBackCards[p.id]) {
                backEl.style.backgroundImage = `url('${customBackCards[p.id]}')`;
            } else {
                backEl.style.backgroundImage = "url('CDLcardUse.png')";
            }

            // ===============================
            // CARD FLIP (YOUR ORIGINAL)
            // ===============================
            card.classList.remove("flipped");
            setTimeout(() => card.classList.add("flipped"), 1000);

            // ===============================
            // VIDEO ONLY FOR PLAYER 3
            // ===============================
            if (p.id === 3) {
                setTimeout(() => {
                    cardBackVideo.style.display = "block";
                    cardBackVideo.play();
                }, 1000);

                cardBackVideo.onended = () => {
                    cardBackVideo.style.display = "none";
                };
            }

        });
    });

    // CLOSE MODAL
    closeModal.addEventListener("click", () => {
        modal.style.display = "none";
        const cardBackVideo = document.getElementById("cardBackVideo");
        cardBackVideo.pause();
        cardBackVideo.style.display = "none";
    });

    // CLICK OUTSIDE MODAL
    document.addEventListener("click", e => {
        if (e.target === modal) {
            modal.style.display = "none";
            const cardBackVideo = document.getElementById("cardBackVideo");
            cardBackVideo.pause();
            cardBackVideo.style.display = "none";
        }
    });
}

/* ---------------------------
   MODE STATS MODAL (PNG VERSION)
---------------------------- */

function openModeModal(modeName, modeStats) {
    const modal = document.getElementById("modeModal");

    let convertedMargin = modeStats.margin;
    if (modeName === "Hardpoint") convertedMargin *= 250;
    if (modeName === "Overload") convertedMargin *= 8;
    if (modeName === "Search & Destroy") convertedMargin *= 6;

    const kd = modeStats.kd;
    const slayerScore = modeStats.slayerRating;

    // Title stays the same
    document.getElementById("modeTitleBox").innerHTML = `
        <div class="mode-title-box">${modeName}</div>
    `;

    //  KD — box removed
    document.getElementById("modeKDBox").innerHTML = `
        <span class="stat-value" id="modeKD">${kd.toFixed(2)}</span>
    `;

    //  AvgM — box removed
    document.getElementById("modeMarginBox").innerHTML = `
        <span class="stat-value" id="modeMargin">${convertedMargin.toFixed(2)}</span>
    `;

    //  Slayer — box removed, circle kept
    document.getElementById("modeSlayerBox").innerHTML = `
        <div class="stat-circle" id="modeSlayer">${slayerScore}</div>
    `;

    // Colors
    setKDColor(document.getElementById("modeKD"), kd);
    setMarginColor(document.getElementById("modeMargin"), convertedMargin);

    const slayerEl = document.getElementById("modeSlayer");
    if (slayerScore < 40) slayerEl.style.color = slayerEl.style.borderColor = "#FF4444";
    else if (slayerScore < 60) slayerEl.style.color = slayerEl.style.borderColor = "white";
    else if (slayerScore < 80) slayerEl.style.color = slayerEl.style.borderColor = "#FFE066";
    else if (slayerScore <= 98) slayerEl.style.color = slayerEl.style.borderColor = "#00FF66";
    else if (slayerScore === 99) slayerEl.style.color = slayerEl.style.borderColor = "#7A00C8";

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


/* ======================================================
   POPUP CARD SYSTEM
====================================================== */

function showPopup(html) {
    document.getElementById("popupContent").innerHTML = html;
    document.getElementById("popupOverlay").style.display = "block";
    document.getElementById("popupCard").style.display = "block";
}

document.getElementById("popupClose").addEventListener("click", () => {
    document.getElementById("popupOverlay").style.display = "none";
    document.getElementById("popupCard").style.display = "none";
});


/* ======================================================
   TEAM BUILDER — COLLAPSIBLE PANELS
====================================================== */

function setupTeamCollapsibles() {
    const toggles = document.querySelectorAll(".team-toggle");

    toggles.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetId = btn.dataset.target;
            const panel = document.getElementById(targetId);

            const isOpen = panel.classList.contains("open");

            if (isOpen) {
                panel.classList.remove("open");
                btn.textContent = btn.textContent.replace("▲", "▼");
            } else {
                panel.classList.add("open");
                btn.textContent = btn.textContent.replace("▼", "▲");
            }
        });
    });
}


/* ======================================================
   TEAM BUILDER — AUTO BUILDER
====================================================== */

function populateAutoDropdowns() {
    const selects = document.querySelectorAll(".team-player");
    selects.forEach(sel => {
        sel.innerHTML = `<option value="">Select Player</option>`;
        allPlayers.forEach(p => {
            sel.innerHTML += `<option value="${p.id}">${p.name}</option>`;
        });
    });
}

document.getElementById("generateTeams").addEventListener("click", () => {

    const selects = document.querySelectorAll(".team-player");
    const chosen = [];

    selects.forEach(sel => {
        if (sel.value) chosen.push(Number(sel.value));
    });

    if (chosen.length !== 8 || new Set(chosen).size !== 8) {
        showPopup("<h2>Error</h2><p>Please select 8 unique players.</p>");
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

    /* ===============================
       WIN PROBABILITY
    =============================== */

    const probA = 1 / (1 + Math.pow(10, (best.eloB - best.eloA) / 400));
    const probB = 1 - probA;

    const strengthA = probA * 100;
    const strengthB = probB * 100;

    const barA = document.getElementById("strengthA");
    const barB = document.getElementById("strengthB");

    const textA = document.getElementById("strengthAText");
    const textB = document.getElementById("strengthBText");

    barA.classList.remove("strength-high", "strength-medium", "strength-low");
    barB.classList.remove("strength-high", "strength-medium", "strength-low");

    barA.style.width = strengthA + "%";
    barB.style.width = strengthB + "%";

    textA.textContent = strengthA.toFixed(1) + "%";
    textB.textContent = strengthB.toFixed(1) + "%";

    function applyColour(bar, value) {
        if (value >= 47) bar.classList.add("strength-high");
        else if (value >= 35) bar.classList.add("strength-medium");
        else bar.classList.add("strength-low");
    }

    applyColour(barA, strengthA);
    applyColour(barB, strengthB);

    /* ===============================
       POPUP CARD OUTPUT
    =============================== */

    const html = `
        <h2>Auto Team Builder</h2>

        <div class="popup-section">
            <h3>Team A</h3>
            <p>${best.teamA.map(p => `• ${p.name}`).join("<br>")}</p>
        </div>

        <div class="popup-section">
            <h3>Team B</h3>
            <p>${best.teamB.map(p => `• ${p.name}`).join("<br>")}</p>
        </div>

        <div class="popup-section">
            <h3>ELO Totals</h3>
            <p>Team A: ${best.eloA.toFixed(2)}<br>
               Team B: ${best.eloB.toFixed(2)}</p>
        </div>

        <div class="popup-section">
            <h3>Win Probability</h3>
            <p>Team A: ${(probA * 100).toFixed(1)}%<br>
               Team B: ${(probB * 100).toFixed(1)}%</p>
        </div>
    `;

    showPopup(html);
});


/* ======================================================
   TEAM BUILDER — MANUAL BUILDER
====================================================== */

function populateManualDropdowns() {
    const selects = document.querySelectorAll(".manual-select");
    selects.forEach(sel => {
        sel.innerHTML = `<option value="">Select Player</option>`;
        allPlayers.forEach(p => {
            sel.innerHTML += `<option value="${p.id}">${p.name}</option>`;
        });
    });
}

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

document.getElementById("simulateMatchBtn").addEventListener("click", () => {

    const teamAIds = [...document.querySelectorAll(".manualA")].map(s => Number(s.value));
    const teamBIds = [...document.querySelectorAll(".manualB")].map(s => Number(s.value));

    const teamA = teamAIds.map(id => allPlayers.find(p => p.id === id));
    const teamB = teamBIds.map(id => allPlayers.find(p => p.id === id));

    const eloA = teamA.reduce((s, p) => s + p.elo, 0);
    const eloB = teamB.reduce((s, p) => s + p.elo, 0);

    const probA = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
    const probB = 1 - probA;

    const strengthA = probA * 100;
    const strengthB = probB * 100;

    const barA = document.getElementById("manualStrengthA");
    const barB = document.getElementById("manualStrengthB");

    const textA = document.getElementById("manualStrengthAText");
    const textB = document.getElementById("manualStrengthBText");

    barA.classList.remove("strength-high", "strength-medium", "strength-low");
    barB.classList.remove("strength-high", "strength-medium", "strength-low");

    barA.style.width = strengthA + "%";
    barB.style.width = strengthB + "%";

    textA.textContent = strengthA.toFixed(1) + "%";
    textB.textContent = strengthB.toFixed(1) + "%";

    function applyColour(bar, value) {
        if (value >= 47) bar.classList.add("strength-high");
        else if (value >= 35) bar.classList.add("strength-medium");
        else bar.classList.add("strength-low");
    }

    applyColour(barA, strengthA);
    applyColour(barB, strengthB);

    /* ===============================
       POPUP CARD OUTPUT
    =============================== */

    const html = `
        <h2>Match Simulation</h2>

        <div class="popup-section">
            <h3>Team A</h3>
            <p>${teamA.map(p => `• ${p.name}`).join("<br>")}</p>
        </div>

        <div class="popup-section">
            <h3>Team B</h3>
            <p>${teamB.map(p => `• ${p.name}`).join("<br>")}</p>
        </div>

        <div class="popup-section">
            <h3>ELO Totals</h3>
            <p>Team A: ${eloA.toFixed(2)}<br>
               Team B: ${eloB.toFixed(2)}</p>
        </div>

        <div class="popup-section">
            <h3>Win Probability</h3>
            <p>Team A: ${(probA * 100).toFixed(1)}%<br>
               Team B: ${(probB * 100).toFixed(1)}%</p>
        </div>
    `;

    showPopup(html);
});


/* ======================================================
   INITIALIZER
====================================================== */

document.addEventListener("DOMContentLoaded", () => {
    setupTeamCollapsibles();
    populateAutoDropdowns();
    populateManualDropdowns();
});




// ======================================================
// TABS + SERIES HISTORY (ADDED BELOW YOUR ORIGINAL CODE)
// ======================================================


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

            // Update title text for ALL tabs
            if (target === "leaderboardPage")      title.textContent = "LEADERBOARD";
            else if (target === "teamsPage")       title.textContent = "TEAMS";
            else if (target === "seriesHistoryPage") title.textContent = "9 MAPS";
            else if (target === "codleticPage")    title.textContent = "CODLETIC";
            else if (target === "mapsPage")        title.textContent = "MAPS";
            else if (target === "carouselPage")    title.textContent = "CARDS";
        });
    });
}


// ---------------------------
// SERIES CONFIG
// ---------------------------
const seriesIndex = [
    { id: 1, file: "series_1.json" },
    { id: 2, file: "series_2.json" },
    { id: 3, file: "series_3.json" }
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
    setupMapBuilder();
});

// ===============================
// MAP POOL (BY MODE)
// ===============================
const mapPool = {
    hardpoint: ["SAKE", "COLOSSUS", "DEN", "SCAR", "GRIDLOCK", "HACIENDA","FREQUENCY"],
    snd: ["DEN", "GRIDLOCK", "RAID", "FRINGE", "SAKE", "HACIENDA"],
    overload: ["DEN", "EXPOSURE", "SCAR", "GRIDLOCK"]
};

// ===============================
// SERIES MODE PATTERNS
// ===============================
function getSeriesPattern(count) {
    if (count === 5) {
        return ["hardpoint", "snd", "overload", "hardpoint", "snd"];
    }
    if (count === 7) {
        return ["hardpoint", "snd", "overload", "hardpoint", "snd", "overload", "snd"];
    }
    if (count === 9) {
        return ["hardpoint", "snd", "overload", "hardpoint", "snd", "overload", "snd", "hardpoint", "snd"];
    }
    return [];
}

// ===============================
// GENERATE SERIES
// 5 maps → no repeats globally
// 7/9 maps → no repeats per mode (original behaviour)
// ===============================
function generateSeries(count) {
    const pattern = getSeriesPattern(count);

    const usedByMode = {
        hardpoint: new Set(),
        snd: new Set(),
        overload: new Set()
    };

    // NEW: global uniqueness for 5‑map series
    const usedGlobal = new Set();

    const result = [];

    pattern.forEach(modeKey => {
        const pool = mapPool[modeKey];
        if (!pool || pool.length === 0) {
            result.push({ mode: modeKey, map: "NO MAPS IN POOL" });
            return;
        }

        let available;

        if (count === 5) {
            // GLOBAL uniqueness
            available = pool.filter(m => !usedGlobal.has(m));
        } else {
            // ORIGINAL behaviour
            available = pool.filter(m => !usedByMode[modeKey].has(m));
        }

        if (available.length === 0) {
            result.push({ mode: modeKey, map: "POOL EXHAUSTED" });
            return;
        }

        const idx = Math.floor(Math.random() * available.length);
        const chosen = available[idx];

        usedByMode[modeKey].add(chosen);
        if (count === 5) usedGlobal.add(chosen);

        result.push({ mode: modeKey, map: chosen });
    });

    return result;
}

// ===============================
// RENDER SERIES TO UI
// ===============================
function renderSeries(count) {
    const series = generateSeries(count);
    const output = document.getElementById(`mapSeries${count}`);
    if (!output) return;

    output.innerHTML = series
        .map((entry, i) => `
            <div class="map-card">
                <span>MAP ${i + 1} — ${entry.mode.toUpperCase()}</span>
                ${entry.map}
            </div>
        `)
        .join("");
}

// ===============================
// MAP BUILDER EVENT WIRING
// + loading spinner + delay
// ===============================
function setupMapBuilder() {
    const buttons = document.querySelectorAll(".map-series-btn");

    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            const count = parseInt(btn.dataset.count, 10);

            const loader = document.getElementById("mapLoading");
            loader.style.display = "block";

            const output = document.getElementById(`mapSeries${count}`);
            if (output) output.innerHTML = "";

            setTimeout(() => {
                loader.style.display = "none";
                renderSeries(count);
            }, 600); // smooth delay
        });
    });
}
window.addEventListener("DOMContentLoaded", () => {
    const video = document.getElementById("cardBackVideo");
    video.load();   //  forces preload of 3_intro.mp4
});
































