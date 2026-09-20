
function playCarouselClick() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = window.__carouselAudioContext || (window.__carouselAudioContext = new AudioCtx());
        if (ctx.state === "suspended") ctx.resume();

        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.04, now + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.06);
    } catch (_) {}
}

// ===============================
// LOAD CURRENT STATS + TODAY'S OPENING STATS
// ===============================
// Daily arrows compare the latest approved ratings with the fixed opening
// ratings saved before the first map of that history day. Neither yesterday's
// daily snapshot nor previous_stats.json is needed.
async function loadDailyLeaderboard() {
    const currentResponse = await fetch("current_stats.json", { cache: "no-store" });
    if (!currentResponse.ok) throw new Error(`Could not load current_stats.json (HTTP ${currentResponse.status})`);
    const current = await currentResponse.json();
    let openingStats = null;

    try {
        const indexResponse = await fetch("history/index.json", { cache: "no-store" });
        if (!indexResponse.ok) throw new Error(`Could not load history/index.json (HTTP ${indexResponse.status})`);
        const index = await indexResponse.json();
        const days = Array.isArray(index) ? index :
            Array.isArray(index?.days) ? index.days :
            Array.isArray(index?.dates) ? index.dates : [];
        const latest = days.map(day => typeof day === "string"
            ? { date: day, file: `${day}.json` }
            : day
        ).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(String(day?.date || "")))
         .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];

        if (latest) {
            const dayFile = String(latest.file || `${latest.date}.json`);
            // Only accept a plain filename, never a path supplied by the index.
            if (!/^[\w.-]+\.json$/.test(dayFile)) throw new Error("Invalid history filename");
            const dayResponse = await fetch(`history/${dayFile}`, { cache: "no-store" });
            if (!dayResponse.ok) throw new Error(`Could not load history/${dayFile} (HTTP ${dayResponse.status})`);
            const day = await dayResponse.json();
            if (day.date && day.date !== latest.date) throw new Error("History date does not match index");
            if (day.openingStats && typeof day.openingStats === "object") openingStats = day.openingStats;
        }
    } catch (error) {
        // The leaderboard must still load if a history file is missing.
        // Missing opening values produce no comparison arrow, not false zero change.
        console.warn("Daily opening Elo unavailable; hiding daily comparison arrows:", error);
    }

    mergeStats(openingStats, current.players);
}

loadDailyLeaderboard().catch(error => console.error("Could not load leaderboard:", error));


// ===============================
// GLOBALS
// ===============================
let allPlayers = [];
let showInactive = false;

// Players listed here remain fully viewable, but are excluded from percentile pools.
const INACTIVE_PLAYER_IDS = new Set([14]); // MASEEH


// ===============================
// NEW PLAYER FALLBACK STATS
// ===============================
// IDs 15 and 16 are available immediately even before the stats JSON files
// have been updated to include them. Real JSON values automatically take over
// as soon as those IDs exist in current_stats.json.
function createEmptyPlayerStats() {
    return {
        elo: 0,
        lifetimeKills: 0, lifetimeDeaths: 0,
        mapKills: 0, mapDeaths: 0,
        hpKills: 0, hpDeaths: 0,
        sndKills: 0, sndDeaths: 0,
        overloadKills: 0, overloadDeaths: 0,
        hpWins: 0, hpLosses: 0,
        sndWins: 0, sndLosses: 0,
        overloadWins: 0, overloadLosses: 0,
        seriesWins: 0, seriesLosses: 0,
        hpMarginTotal: 0, hpMarginCount: 0,
        sndMarginTotal: 0, sndMarginCount: 0,
        overloadMarginTotal: 0, overloadMarginCount: 0,
        hpDamage: 0, hpDamageShare: 0,
        sndDamage: 0, sndDamageShare: 0,
        overloadDamage: 0, overloadDamageShare: 0,
        hpLifetimeDamage: 0, hpLifetimeTeamDamage: 0,
        sndLifetimeDamage: 0, sndLifetimeTeamDamage: 0,
        overloadLifetimeDamage: 0, overloadLifetimeTeamDamage: 0
    };
}

// ===============================
// MERGE OPENING + CURRENT (DISPLAY ONLY)
// ===============================
function mergeStats(openingPlayersObj, currPlayersObj) {
    // Never modify either JSON source. Opening Elo remains the daily baseline.
    const openingSource = openingPlayersObj && typeof openingPlayersObj === "object"
        ? openingPlayersObj : {};
    const currSource = { ...currPlayersObj };
    [15, 16].forEach(id => {
        if (!currSource[id]) currSource[id] = createEmptyPlayerStats();
    });

    const openingPlayers = Object.entries(openingSource).map(([id, p]) => ({
        id: Number(id), elo: Number(p?.elo)
    })).filter(p => Number.isFinite(p.elo));

    const currPlayers = Object.entries(currSource).map(([id, p]) => ({
        id: Number(id),
        name: getPlayerName(Number(id)),
        ...p
    }));

    openingPlayers.sort((a, b) => b.elo - a.elo);
    openingPlayers.forEach((p, i) => p.openingRank = i + 1);

    currPlayers.sort((a, b) => b.elo - a.elo);
    currPlayers.forEach((p, i) => p.currentRank = i + 1);

    allPlayers = currPlayers.map(p => {
        const opening = openingPlayers.find(x => x.id === p.id);
        const hasOpening = !!opening && Number.isFinite(Number(p.elo));
        return {
            ...p,
            hasDailyComparison: hasOpening,
            eloChange: hasOpening ? Number(p.elo) - opening.elo : 0,
            rankChange: hasOpening ? opening.openingRank - p.currentRank : 0
        };
    });

    renderTable();
    setupToggle();
    populateTeamDropdowns();

    populateAutoDropdowns();
    populateManualDropdowns();
    setupComparisons();

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
        const hasActivity = (wins + losses + kills + deaths) > 0;
        const isInactive = INACTIVE_PLAYER_IDS.has(p.id);

        // Explicitly inactive players (currently MASEEH / ID 14) appear only
        // when "Show Inactive Players" is enabled. Their stored stats remain intact.
        return showInactive ? true : (hasActivity && !isInactive);
    });

    filtered.sort((a, b) => b.elo - a.elo);

    filtered.forEach(p => {
        const tr = document.createElement("tr");

        // ===============================
        // RANK ARROWS
        // ===============================
        const thickRankArrow = !p.hasDailyComparison ? "—" : p.rankChange > 0 ? "▲" :
            p.rankChange < 0 ? "▼" : "—";

        const rankArrowClass = !p.hasDailyComparison ? "arrow-none" : p.rankChange > 0 ? "arrow-up" :
            p.rankChange < 0 ? "arrow-down" : "arrow-none";

        const thinRankArrow = !p.hasDailyComparison ? "No opening stats" : p.rankChange > 0 ? `↑ ${p.rankChange}` :
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
        const thickEloArrow = !p.hasDailyComparison ? "—" : p.eloChange > 0 ? "▲" :
            p.eloChange < 0 ? "▼" : "—";

        const eloArrowClass = !p.hasDailyComparison ? "arrow-none" : p.eloChange > 0 ? "arrow-up" :
            p.eloChange < 0 ? "arrow-down" : "arrow-none";

        const thinEloArrow = !p.hasDailyComparison ? "No opening stats" : p.eloChange > 0 ? `↑ ${p.eloChange.toFixed(2)}` :
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
        14: "MASEEH",
        15: "ZU",
        16: "SION"
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
    // Inactive players keep their own stored card stats, but do not contribute
    // values to anybody's percentile comparison pool.
    const activePercentilePlayers = players.filter(x => !INACTIVE_PLAYER_IDS.has(x.id));
    const percentilePlayers = INACTIVE_PLAYER_IDS.has(p.id)
        ? [...activePercentilePlayers, p]
        : activePercentilePlayers;

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

    const kdArr = percentilePlayers
        .filter(x => x[prefix + "Deaths"] + x[prefix + "Kills"] > 0)
        .map(x => x[prefix + "Kills"] / x[prefix + "Deaths"]);
    const kdPct = percentile(kd, kdArr);

    const wrArr = percentilePlayers
        .filter(x => x[prefix + "Wins"] + x[prefix + "Losses"] > 0)
        .map(x => x[prefix + "Wins"] / (x[prefix + "Wins"] + x[prefix + "Losses"]));
    const wrPct = percentile(wr, wrArr);

    const marginArr = percentilePlayers
        .filter(x => x[prefix + "MarginCount"] > 0)
        .map(x => x[prefix + "MarginTotal"] / x[prefix + "MarginCount"]);
    const marginPct = percentile(margin, marginArr);

    // NEW — percentile array for lifetime damage share
    const dmgArr = percentilePlayers
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
    1: "cards/1_back.webp",
    2: "cards/2_back.webp",
    3: "cards/3_back.webp",
    4: "cards/4_back.webp",
    5: "cards/5_back.webp",
    6: "cards/6_back.webp",
    7: "cards/7_back.webp",
    8: "cards/8_back.webp",
    9: "cards/9_back.webp",
    10: "cards/10_back.webp",
    11: "cards/11_back.webp",
    12: "cards/12_back.webp",
    13: "cards/13_back.webp",
    14: "cards/14_back.webp",
    15: "cards/15_back.webp",
    16: "cards/16_back.webp"
};

let playerModalLoadToken = 0;

function waitForCardImage(src) {
    return new Promise(resolve => {
        const img = new Image();
        let done = false;

        const finish = () => {
            if (done) return;
            done = true;
            if (img.decode) {
                img.decode().catch(() => {}).finally(resolve);
            } else {
                resolve();
            }
        };

        img.onload = finish;
        img.onerror = resolve;
        img.src = src;

        if (img.complete && img.naturalWidth > 0) finish();
    });
}

function waitForCardVideo(video, src) {
    return new Promise(resolve => {
        if (!video || !src) {
            resolve();
            return;
        }

        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            cleanup();
            resolve();
        };

        const cleanup = () => {
            video.removeEventListener("loadedmetadata", checkReady);
            video.removeEventListener("canplaythrough", finish);
            video.removeEventListener("progress", checkReady);
            video.removeEventListener("loadeddata", checkReady);
            video.removeEventListener("error", finish);
            video.removeEventListener("abort", finish);
        };

        const checkReady = () => {
            if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
                // If duration is known, prefer to wait until the entire file is buffered.
                if (Number.isFinite(video.duration) && video.duration > 0) {
                    try {
                        const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
                        if (end + 0.05 >= video.duration) finish();
                    } catch (_) {
                        finish();
                    }
                } else {
                    finish();
                }
            }
        };

        video.addEventListener("loadedmetadata", checkReady);
        video.addEventListener("loadeddata", checkReady);
        video.addEventListener("progress", checkReady);
        video.addEventListener("canplaythrough", finish);
        video.addEventListener("error", finish);
        video.addEventListener("abort", finish);

        video.preload = "auto";
        video.src = src;
        video.load();
        checkReady();
    });
}

function openPlayerModal(playerId, playerList = allPlayers) {
    const modal = document.getElementById("playerModal");
    const p = playerList.find(x => x.id === Number(playerId)) || allPlayers.find(x => x.id === Number(playerId));

    if (!modal || !p) return;

    modal.style.display = "block";

            const card = modal.querySelector(".card");
            const cardBackVideo = document.getElementById("cardBackVideo");

            // ===============================
            // RESET TRANSIENT MODAL STATE
            // ===============================
            // The same modal is reused for every player, so always clear any
            // state/callbacks left behind by the previously opened card first.
            card.classList.remove("flipped");
            cardBackVideo.pause();
            cardBackVideo.onended = null;
            try { cardBackVideo.currentTime = 0; } catch (_) {}
            cardBackVideo.style.display = "none";
            cardBackVideo.classList.remove("video-3", "video-5", "video-2");

            // Scope these shared class names to the real player modal. Head-to-Head
            // contains cloned card markup with the same classes.
            const ratingEl = modal.querySelector(".rating");
            const dateBox = modal.querySelector(".date-box");
            const hpEl = modal.querySelector(".col1.row1");
            const ovlEl = modal.querySelector(".col2.row1");
            const sndEl = modal.querySelector(".col3.row1");
            const backEl = modal.querySelector(".back");

            // Never inherit hidden stats from a previous intro/card. If the new
            // player has an intro, they are hidden again below for that player only.
            [ratingEl, hpEl, ovlEl, sndEl].forEach(el => {
                if (el) el.style.visibility = "visible";
            });

            // ===============================
            // MODE RATINGS
            // ===============================
            const hp = computeMode("hp", p, playerList);
            const snd = computeMode("snd", p, playerList);
            const ovl = computeMode("overload", p, playerList);

            const avg = Math.round((hp.rating + snd.rating + ovl.rating) / 3);

            // Rating tier drives the premium visual treatment without changing the artwork.
            card.classList.remove("rating-80", "rating-90", "rating-98");
            if (avg >= 98) card.classList.add("rating-98");
            else if (avg >= 90) card.classList.add("rating-90");
            else if (avg >= 80) card.classList.add("rating-80");

            // OVERALL RATING
            ratingEl.textContent = avg;
            setRatingColor(ratingEl, avg);

            // DATE BOX POSITION
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
            setRatingColor(hpEl, hp.rating);
            hpEl.textContent = hp.rating;

            setRatingColor(ovlEl, ovl.rating);
            ovlEl.textContent = ovl.rating;

            setRatingColor(sndEl, snd.rating);
            sndEl.textContent = snd.rating;

            // Keep all stat numbers off the intro video. They are revealed only
            // once the intro has finished and the player's x_back image is visible.
            const statNumberElements = [ratingEl, hpEl, ovlEl, sndEl];
            const hideStatNumbers = () => {
                statNumberElements.forEach(el => {
                    if (el) el.style.visibility = "hidden";
                });
            };
            const showStatNumbers = () => {
                statNumberElements.forEach(el => {
                    if (el) el.style.visibility = "visible";
                });
            };

            hpEl.onclick = () => openModeModal("Hardpoint", hp);
            ovlEl.onclick = () => openModeModal("Overload", ovl);
            sndEl.onclick = () => openModeModal("Search & Destroy", snd);

            // SPECIAL POSITION OVERRIDES
            card.classList.remove(
                ...Array.from({ length: 16 }, (_, index) => `player${index + 1}-adjust`)
            );

            // Every player has an independent coordinate override class.
            // The same class naming scheme is also used by Head-to-Head cards.
            if (p.id >= 1 && p.id <= 16) card.classList.add(`player${p.id}-adjust`);

            // SET BACK CARD PNG
            if (customBackCards[p.id]) {
                backEl.style.backgroundImage = [15, 16].includes(p.id)
                    ? `url('${customBackCards[p.id]}'), url('wings.png')`
                    : `url('${customBackCards[p.id]}')`;
            }

            // ===============================
            // PRELOAD EVERYTHING BEHIND THE CARD BEFORE FLIPPING
            // ===============================
            // The Wings/front remains visible while these assets load.
            // Every modal opening gets a fresh load check; cached assets resolve immediately.
            const loadToken = ++playerModalLoadToken;
            card.classList.remove("flipped");
            cardBackVideo.pause();
            cardBackVideo.currentTime = 0;
            cardBackVideo.style.display = "none";

            const backSrc = customBackCards[p.id];
            const introVideos = {
    1: "cards/1_intro.mp4",
    2: "cards/2_intro.mp4",
    3: "cards/3_intro.mp4",
    4: "cards/4_intro.mp4",
    5: "cards/5_intro.mp4",
    6: "cards/6_intro.mp4",
    7: "cards/7_intro.mp4",
    8: "cards/8_intro.mp4",
    9: "cards/9_intro.mp4",
    10: "cards/10_intro.mp4",
    11: "cards/11_intro.mp4",
    12: "cards/12_intro.mp4",
    15: "cards/15_intro.mp4",
    16: "cards/16_intro.mp4"
};
            const introClasses = {
                2: "video-2",
                3: "video-3",
                5: "video-5"
            };
            const introSrc = introVideos[p.id] || null;

            // Intro cards must not show their stat numbers over the video.
            // Cards with no intro can display stats as soon as their back is shown.
            if (introSrc) hideStatNumbers();
            else showStatNumbers();

            cardBackVideo.onended = null;
            cardBackVideo.classList.remove("video-3", "video-5", "video-2");
            if (introSrc && introClasses[p.id]) {
                cardBackVideo.classList.add(introClasses[p.id]);
            }

            // Load the actual Wings/back artwork first. The visible front is never flipped
            // until this promise and the video promise (when applicable) are complete.
            const imageReady = waitForCardImage(backSrc);
            const videoReady = introSrc
                ? waitForCardVideo(cardBackVideo, introSrc)
                : Promise.resolve();

            Promise.all([imageReady, videoReady]).then(() => {
                // User may have opened a different player while this one was loading.
                if (loadToken !== playerModalLoadToken) return;
                if (modal.style.display === "none") return;

                // Keep the existing 1000ms CSS flip animation exactly as it is.
                card.classList.add("flipped");

                const introAvailable = introSrc && !cardBackVideo.error && cardBackVideo.readyState >= 1;

                if (introAvailable) {
                    cardBackVideo.style.display = "block";
                    const playPromise = cardBackVideo.play();
                    if (playPromise && typeof playPromise.catch === "function") {
                        playPromise.catch(() => {});
                    }
                    cardBackVideo.onended = () => {
                        // Remove the intro first, exposing x_back, then reveal stats.
                        cardBackVideo.style.display = "none";
                        showStatNumbers();
                    };
                } else if (introSrc) {
                    // Allows new players to exist before their intro file is added.
                    // Once x_intro.mp4 exists, the same path automatically plays it.
                    cardBackVideo.style.display = "none";
                    showStatNumbers();
                }
            });

    }

function enableModal(players) {
    document.querySelectorAll(".player-name").forEach(el => {
        // Prevent duplicate handlers when the leaderboard is re-rendered.
        if (el.dataset.modalBound === "true") return;
        el.dataset.modalBound = "true";
        el.addEventListener("click", () => openPlayerModal(Number(el.dataset.id), players));
    });
}

/* ======================================================
   PLAYER COMPARISONS
====================================================== */
function setupComparisons() {
    const a = document.getElementById("comparePlayerA");
    const b = document.getElementById("comparePlayerB");
    if (!a || !b) return;

    const buildOptions = (select, selected) => {
        select.innerHTML = `<option value="">Select player</option>`;
        allPlayers
            .slice()
            .sort((x, y) => x.name.localeCompare(y.name))
            .forEach(p => {
                const option = document.createElement("option");
                option.value = p.id;
                option.textContent = p.name;
                if (String(p.id) === String(selected)) option.selected = true;
                select.appendChild(option);
            });
    };

    const currentA = a.value;
    const currentB = b.value;
    buildOptions(a, currentA);
    buildOptions(b, currentB);

    // Avoid duplicate listeners when stats are reloaded.
    if (a.dataset.bound !== "true") {
        a.addEventListener("change", () => renderComparison());
        a.dataset.bound = "true";
    }
    if (b.dataset.bound !== "true") {
        b.addEventListener("change", () => renderComparison());
        b.dataset.bound = "true";
    }
}

function comparisonNumber(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return n.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals
    });
}

function comparisonPercent(value) {
    return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function comparisonRatio(kills, deaths) {
    kills = Number(kills || 0);
    deaths = Number(deaths || 0);
    return deaths === 0 ? comparisonNumber(kills) : comparisonNumber(kills / deaths);
}

function comparisonWinRate(wins, losses) {
    const total = Number(wins || 0) + Number(losses || 0);
    return total === 0 ? "0.0%" : comparisonPercent(Number(wins || 0) / total);
}

function getComparisonMode(p, prefix) {
    const kills = Number(p[prefix + "Kills"] || 0);
    const deaths = Number(p[prefix + "Deaths"] || 0);
    const wins = Number(p[prefix + "Wins"] || 0);
    const losses = Number(p[prefix + "Losses"] || 0);
    const marginTotal = Number(p[prefix + "MarginTotal"] || 0);
    const marginCount = Number(p[prefix + "MarginCount"] || 0);
    const damage = Number(p[prefix + "LifetimeDamage"] || 0);
    const teamDamage = Number(p[prefix + "LifetimeTeamDamage"] || 0);
    const maps = wins + losses;
    const avgM = marginCount ? marginTotal / marginCount : 0;
    const damageShare = teamDamage ? damage / teamDamage : 0;

    // Match the main player modal's AvgM conversion exactly.
    const multiplier = prefix === "hp" ? 250 : prefix === "snd" ? 6 : 8;

    return {
        killsPerMap: maps ? kills / maps : 0,
        deathsPerMap: maps ? deaths / maps : 0,
        mapWinRate: maps ? wins / maps : 0,
        damageShare,
        avgModeUnit: avgM * multiplier
    };
}

function comparisonModeUnitLabel(prefix) {
    if (prefix === "hp") return "AVG POINTS / MAP";
    if (prefix === "snd") return "AVG ROUNDS / MAP";
    return "AVG GOALS / MAP";
}

function comparisonPlayerCard(p, slot) {
    return `
        <div class="comparison-card-wrap">
            <div class="comparison-card-name">${p.name}</div>
            <div class="comparison-card-stage" data-player-id="${p.id}" data-slot="${slot}"></div>
        </div>`;
}

function buildComparisonMainCard(p) {
    const template = document.querySelector("#playerModal .container");
    if (!template) return null;

    const container = template.cloneNode(true);
    container.removeAttribute("id");

    const card = container.querySelector(".card");
    if (!card) return container;

    card.classList.remove(
        "flipped",
        "rating-80", "rating-90", "rating-98",
        ...Array.from({ length: 16 }, (_, index) => `player${index + 1}-adjust`)
    );
    if (p.id >= 1 && p.id <= 16) card.classList.add(`player${p.id}-adjust`);

    const video = card.querySelector(".card-back-video");
    if (video) video.remove();

    const hp = computeMode("hp", p, allPlayers);
    const snd = computeMode("snd", p, allPlayers);
    const ovl = computeMode("overload", p, allPlayers);
    const avg = Math.round((hp.rating + snd.rating + ovl.rating) / 3);

    // Match the main player modal's rating-tier styling as well as its layout.
    if (avg >= 98) card.classList.add("rating-98");
    else if (avg >= 90) card.classList.add("rating-90");
    else if (avg >= 80) card.classList.add("rating-80");

    const ratingEl = card.querySelector(".rating");
    if (ratingEl) {
        ratingEl.textContent = avg;
        ratingEl.style.visibility = "visible";
        setRatingColor(ratingEl, avg);
    }

    const hpEl = card.querySelector(".col1.row1");
    const ovlEl = card.querySelector(".col2.row1");
    const sndEl = card.querySelector(".col3.row1");

    [[hpEl, hp.rating], [ovlEl, ovl.rating], [sndEl, snd.rating]].forEach(([el, value]) => {
        if (!el) return;
        el.textContent = value;
        // A clone can inherit visibility:hidden from an intro currently playing
        // in the live modal. Head-to-Head never uses intros, so always show stats.
        el.style.visibility = "visible";
        setRatingColor(el, value);
        el.onclick = null;
    });

    const dateBox = card.querySelector(".date-box");
    if (dateBox) {
        if ([1, 11].includes(p.id)) {
            dateBox.style.left = "auto";
            dateBox.style.right = "40px";
            dateBox.style.top = "28px";
        } else {
            dateBox.style.right = "auto";
            dateBox.style.left = "36px";
            dateBox.style.top = "28px";
        }
    }

    const back = card.querySelector(".back");
    if (back) {
        if (customBackCards[p.id]) {
            back.style.backgroundImage = [15, 16].includes(p.id)
                ? `url('${customBackCards[p.id]}'), url('wings.png')`
                : `url('${customBackCards[p.id]}')`;
        }
        back.style.opacity = "1";
    }

    card.classList.add("flipped");
    return container;
}

function hydrateComparisonCards() {
    document.querySelectorAll(".comparison-card-stage").forEach(stage => {
        const id = Number(stage.dataset.playerId);
        const p = allPlayers.find(x => x.id === id);
        if (!p) return;
        const card = buildComparisonMainCard(p);
        if (card) stage.replaceChildren(card);
    });
}

function compareMetric(a, b, better = "higher") {
    const av = Number(a || 0);
    const bv = Number(b || 0);
    if (av === bv) return 0.5;
    return better === "higher" ? (av > bv ? 1 : 0) : (av < bv ? 1 : 0);
}

function getModeHeadToHead(a, b, prefix) {
    const x = getComparisonMode(a, prefix);
    const y = getComparisonMode(b, prefix);

    const metrics = [
        [x.killsPerMap, y.killsPerMap, "higher"],
        [x.deathsPerMap, y.deathsPerMap, "lower"],
        [x.mapWinRate, y.mapWinRate, "higher"],
        [x.damageShare, y.damageShare, "higher"],
        [x.avgModeUnit, y.avgModeUnit, "higher"]
    ];

    const scoreA = metrics.reduce((sum, [av, bv, better]) => sum + compareMetric(av, bv, better), 0);
    return { x, y, scoreA, scoreB: 5 - scoreA };
}

function renderModeComparison(name, prefix, a, b) {
    const { x, y, scoreA, scoreB } = getModeHeadToHead(a, b, prefix);

    return {
        scoreA,
        scoreB,
        html: `<div class="comparison-section">
            <div class="comparison-section-title">${name.toUpperCase()} <span class="mode-score">${a.name} ${comparisonNumber(scoreA, 1)} — ${comparisonNumber(scoreB, 1)} ${b.name}</span></div>
            ${comparisonRow("KILLS / MAP", x.killsPerMap, y.killsPerMap, "number", "higher")}
            ${comparisonRow("DEATHS / MAP", x.deathsPerMap, y.deathsPerMap, "number", "lower")}
            ${comparisonRow("MAP WIN %", x.mapWinRate, y.mapWinRate, "percent", "higher")}
            ${comparisonRow("DAMAGE SHARE", x.damageShare, y.damageShare, "percent", "higher")}
            ${comparisonRow(comparisonModeUnitLabel(prefix), x.avgModeUnit, y.avgModeUnit, "number", "higher")}
        </div>`
    };
}

function renderComparison() {
    const aId = Number(document.getElementById("comparePlayerA")?.value);
    const bId = Number(document.getElementById("comparePlayerB")?.value);
    const empty = document.getElementById("comparisonEmpty");
    const content = document.getElementById("comparisonContent");

    if (!aId || !bId || aId === bId) {
        if (empty) {
            empty.textContent = aId && bId && aId === bId
                ? "Select two different players to compare."
                : "Select two players to begin.";
            empty.style.display = "block";
        }
        if (content) content.style.display = "none";
        return;
    }

    const a = allPlayers.find(p => p.id === aId);
    const b = allPlayers.find(p => p.id === bId);
    if (!a || !b) return;

    empty.style.display = "none";
    content.style.display = "grid";

    const modes = [
        ["Hardpoint", "hp"],
        ["Search & Destroy", "snd"],
        ["Overload", "overload"]
    ];

    const overallA = Math.round((computeMode("hp", a, allPlayers).rating + computeMode("snd", a, allPlayers).rating + computeMode("overload", a, allPlayers).rating) / 3);
    const overallB = Math.round((computeMode("hp", b, allPlayers).rating + computeMode("snd", b, allPlayers).rating + computeMode("overload", b, allPlayers).rating) / 3);

    const modeResults = modes.map(([name, prefix]) => renderModeComparison(name, prefix, a, b));
    const headToHeadA = modeResults.reduce((sum, result) => sum + result.scoreA, 0);
    const headToHeadB = modeResults.reduce((sum, result) => sum + result.scoreB, 0);

    content.innerHTML = `
        <div class="comparison-card-pair">
            ${comparisonPlayerCard(a, "a")}
            <div class="comparison-vs-card">VS</div>
            ${comparisonPlayerCard(b, "b")}
        </div>

        <div class="comparison-score final-head-to-head ${headToHeadA > headToHeadB ? "a-winner" : headToHeadB > headToHeadA ? "b-winner" : "tie"}">
            <strong>${a.name} ${comparisonNumber(headToHeadA, 1)} — ${comparisonNumber(headToHeadB, 1)} ${b.name}</strong>
            <span>HEAD-TO-HEAD</span>
            <small>15 points across 3 modes · 5 metrics per mode</small>
        </div>

        <div class="comparison-section">
            <div class="comparison-section-title">OVERALL</div>
            ${comparisonRow("ELO", a.elo, b.elo, "number", "higher")}
            ${comparisonRow("CURRENT RANK", a.currentRank, b.currentRank, "number", "lower")}
            ${comparisonRow("OVERALL RATING", overallA, overallB, "number", "higher")}
            ${comparisonRow("ELO CHANGE", a.eloChange, b.eloChange, "number", "higher")}
        </div>

        <div class="comparison-section">
            <div class="comparison-section-title">LIFETIME</div>
            ${comparisonRow("KILLS", a.lifetimeKills, b.lifetimeKills, "number", "higher")}
            ${comparisonRow("DEATHS", a.lifetimeDeaths, b.lifetimeDeaths, "number", "lower")}
            ${comparisonRow("K/D", comparisonRatio(a.lifetimeKills, a.lifetimeDeaths), comparisonRatio(b.lifetimeKills, b.lifetimeDeaths), "text", "higher")}
            ${comparisonRow("WINS", a.hpWins + a.sndWins + a.overloadWins, b.hpWins + b.sndWins + b.overloadWins, "number", "higher")}
            ${comparisonRow("LOSSES", a.hpLosses + a.sndLosses + a.overloadLosses, b.hpLosses + b.sndLosses + b.overloadLosses, "number", "lower")}
            ${comparisonRow("WIN RATE", (a.hpWins + a.sndWins + a.overloadWins) / ((a.hpWins + a.sndWins + a.overloadWins) + (a.hpLosses + a.sndLosses + a.overloadLosses) || 1), (b.hpWins + b.sndWins + b.overloadWins) / ((b.hpWins + b.sndWins + b.overloadWins) + (b.hpLosses + b.sndLosses + b.overloadLosses) || 1), "percent", "higher")}
        </div>

        ${modeResults.map(result => result.html).join("")}

    `;

    hydrateComparisonCards();
}

function comparisonRow(label, a, b, type = "number", better = "higher") {
    const numeric = type === "number" || type === "percent";
    const av = numeric ? Number(a || 0) : String(a);
    const bv = numeric ? Number(b || 0) : String(b);
    let aBetter = false, bBetter = false;

    if (numeric && av !== bv) {
        aBetter = better === "higher" ? av > bv : av < bv;
        bBetter = better === "higher" ? bv > av : bv < av;
    }

    const format = v => type === "percent" ? comparisonPercent(v) : type === "number" ? comparisonNumber(v) : v;
    return `<div class="comparison-row">
        <div class="comparison-value left ${aBetter ? "better" : ""}">${format(av)}</div>
        <div class="comparison-label">${label}</div>
        <div class="comparison-value right ${bBetter ? "better" : ""}">${format(bv)}</div>
    </div>`;
}

function closePlayerModal() {
    const modal = document.getElementById("playerModal");
    const cardBackVideo = document.getElementById("cardBackVideo");
    if (!modal) return;
    // Invalidate any image/video readiness callback from the card being closed.
    playerModalLoadToken++;
    modal.style.display = "none";
    if (cardBackVideo) {
        cardBackVideo.pause();
        cardBackVideo.onended = null;
        try { cardBackVideo.currentTime = 0; } catch (_) {}
        cardBackVideo.style.display = "none";
    }

    const card = modal.querySelector(".card");
    if (card) card.classList.remove("flipped");

    modal.querySelectorAll(".rating, .col1.row1, .col2.row1, .col3.row1").forEach(el => {
        el.style.visibility = "visible";
    });
}

// ===============================
// BACKGROUND CARD ASSET CACHE WARMING
// ===============================
// Runs only after the normal page load. It does not replace or bypass the
// existing modal readiness checks; it simply gives the browser a chance to
// cache assets before the user opens a card.
function warmPlayerCardCache() {
    const backSources = Object.values(customBackCards);
    const introSources = [
        "cards/1_intro.mp4", "cards/2_intro.mp4", "cards/3_intro.mp4",
        "cards/4_intro.mp4", "cards/5_intro.mp4", "cards/6_intro.mp4",
        "cards/7_intro.mp4", "cards/8_intro.mp4", "cards/9_intro.mp4",
        "cards/10_intro.mp4", "cards/11_intro.mp4", "cards/12_intro.mp4",
        "cards/15_intro.mp4"
    ];

    backSources.forEach(src => {
        const img = new Image();
        img.decoding = "async";
        img.src = src;
    });

    // Stagger full-quality video cache warming so it does not compete with
    // the initial page render or request every large video simultaneously.
    introSources.forEach((src, index) => {
        setTimeout(() => {
            const video = document.createElement("video");
            video.preload = "auto";
            video.muted = true;
            video.src = src;
            video.load();
        }, index * 250);
    });
}

window.addEventListener("load", () => {
    const startCacheWarm = () => warmPlayerCardCache();
    if ("requestIdleCallback" in window) {
        requestIdleCallback(startCacheWarm, { timeout: 2000 });
    } else {
        setTimeout(startCacheWarm, 500);
    }
}, { once: true });

function setupCarousel() {
    const slider = document.querySelector("#carouselPage .slider");
    if (!slider) return;

    const items = [...slider.querySelectorAll(".item")];
    const quantity = items.length || 14;
    const step = 360 / quantity;

    // JS is the single owner of the carousel's overall rotation.
    const AUTO_SPEED = -360 / 18000; // degrees per millisecond
    const DRAG_SENSITIVITY = 0.55;
    const DRAG_THRESHOLD = 8;
    const FOLLOW_EASE = 0.22;
    const TARGET_EASE = 0.13;
    const RESUME_DELAY = 900;

    let rotation = 0;
    let targetRotation = 0;
    let lastTime = null;
    let autoRunning = true;
    let isPointerDown = false;
    let isDragging = false;
    let activePointerId = null;
    let pointerStartX = 0;
    let pointerStartRotation = 0;
    let suppressClick = false;
    let resumeTimer = null;
    let modalOpening = false;

    // Completely remove the old CSS animation so it cannot fight JS.
    slider.style.animation = "none";
    slider.style.transition = "none";
    slider.style.touchAction = "none";
    slider.style.cursor = "grab";
    slider.style.willChange = "transform";

    items.forEach(item => {
        item.dataset.playerId = item.dataset.playerId || item.style.getPropertyValue("--position").trim();
        item.style.cursor = "grab";
        item.querySelectorAll("img").forEach(img => {
            img.draggable = false;
            img.style.userSelect = "none";
            img.style.webkitUserDrag = "none";
            img.style.pointerEvents = "none";
        });
    });

    // Short UI click sound. Web Audio is created only after user interaction.
    let audioContext = null;
    function playClickSound() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            if (!audioContext) audioContext = new AudioCtx();
            if (audioContext.state === "suspended") audioContext.resume();

            const now = audioContext.currentTime;
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(520, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.04, now + 0.003);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
            osc.connect(gain);
            gain.connect(audioContext.destination);
            osc.start(now);
            osc.stop(now + 0.06);
        } catch (_) {}
    }

    function applyRotation() {
        slider.style.transform = `perspective(2000px) rotateX(-16deg) rotateY(${rotation}deg)`;
    }

    function stopAuto() {
        autoRunning = false;
        lastTime = null;
        if (resumeTimer) {
            clearTimeout(resumeTimer);
            resumeTimer = null;
        }
    }

    function resumeAuto(delay = RESUME_DELAY) {
        if (resumeTimer) clearTimeout(resumeTimer);
        resumeTimer = setTimeout(() => {
            if (!isPointerDown && !modalOpening) {
                autoRunning = true;
                lastTime = null;
            }
        }, delay);
    }

    function shortestTargetForPlayer(playerId) {
        const desired = -(Number(playerId) - 1) * step;
        const turns = Math.round((targetRotation - desired) / 360);
        return desired + turns * 360;
    }

    function animateToPlayer(playerId) {
        const id = Number(playerId);
        if (!id || id < 1 || id > quantity) return;

        stopAuto();
        modalOpening = true;
        suppressClick = false;
        targetRotation = shortestTargetForPlayer(id);
        playClickSound();

        // The render loop handles the easing. Open the modal only once the
        // visual rotation has actually reached the requested card.
        const waitForArrival = () => {
            if (!modalOpening) return;
            if (Math.abs(targetRotation - rotation) < 0.35) {
                rotation = targetRotation;
                applyRotation();

                if (typeof allPlayers !== "undefined" && allPlayers && allPlayers.length) {
                    openPlayerModal(id, allPlayers);
                    modalOpening = false;
                    resumeAuto();
                } else {
                    // Player data may still be loading.
                    setTimeout(waitForArrival, 50);
                }
                return;
            }
            requestAnimationFrame(waitForArrival);
        };
        requestAnimationFrame(waitForArrival);
    }

    function onPointerDown(event) {
        if (modalOpening) return;

        isPointerDown = true;
        isDragging = false;
        suppressClick = false;
        activePointerId = event.pointerId;
        pointerStartX = event.clientX;
        pointerStartRotation = targetRotation;

        stopAuto();
        slider.style.cursor = "grabbing";

        try { slider.setPointerCapture(event.pointerId); } catch (_) {}
        event.preventDefault();
    }

    function onPointerMove(event) {
        if (!isPointerDown || event.pointerId !== activePointerId || modalOpening) return;

        const deltaX = event.clientX - pointerStartX;

        if (!isDragging && Math.abs(deltaX) >= DRAG_THRESHOLD) {
            isDragging = true;
            suppressClick = true;
            playClickSound();
        }

        if (!isDragging) return;

        event.preventDefault();
        targetRotation = pointerStartRotation + deltaX * DRAG_SENSITIVITY;
    }

    function finishPointer(event) {
        if (!isPointerDown || event.pointerId !== activePointerId) return;

        isPointerDown = false;
        try { slider.releasePointerCapture(event.pointerId); } catch (_) {}
        activePointerId = null;
        slider.style.cursor = "grab";

        if (isDragging) {
            // Freeze exactly where the user released. No momentum.
            targetRotation = rotation;
            isDragging = false;
            suppressClick = true;
            resumeAuto();
        } else {
            // Handle a true tap directly from pointerup. Relying on the
            // browser's synthetic click event can be unreliable when
            // pointer capture is used, especially on touch devices.
            const tapped = document.elementFromPoint(event.clientX, event.clientY);
            const item = tapped ? tapped.closest('#carouselPage .item') : null;
            if (item && slider.contains(item)) {
                const playerId = Number(item.dataset.playerId);
                if (playerId) animateToPlayer(playerId);
            }
            resumeAuto();
        }
    }

    function cancelPointer(event) {
        if (!isPointerDown || event.pointerId !== activePointerId) return;
        isPointerDown = false;
        isDragging = false;
        activePointerId = null;
        targetRotation = rotation;
        slider.style.cursor = "grab";
        try { slider.releasePointerCapture(event.pointerId); } catch (_) {}
        resumeAuto();
    }

    slider.addEventListener("pointerdown", onPointerDown, { passive: false });
    slider.addEventListener("pointermove", onPointerMove, { passive: false });
    slider.addEventListener("pointerup", finishPointer);
    slider.addEventListener("pointercancel", cancelPointer);
    slider.addEventListener("lostpointercapture", () => {
        if (isPointerDown) {
            isPointerDown = false;
            isDragging = false;
            activePointerId = null;
            targetRotation = rotation;
            slider.style.cursor = "grab";
            resumeAuto();
        }
    });
    slider.addEventListener("dragstart", e => e.preventDefault());

    // A tap is a click; a drag is never a click.
    items.forEach(item => {
        const playerId = Number(item.dataset.playerId);
        item.addEventListener("click", event => {
            if (suppressClick) {
                suppressClick = false;
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            animateToPlayer(playerId);
        });
    });

    function render(timestamp) {
        const carouselVisible = !document.hidden && slider.offsetParent !== null;
        if (!carouselVisible) {
            // Do not spend transform/compositing work on a hidden tab/page.
            // Reset timing so returning to Cards never causes a large jump.
            lastTime = null;
            requestAnimationFrame(render);
            return;
        }

        if (lastTime === null) lastTime = timestamp;
        const delta = Math.min(timestamp - lastTime, 40);
        lastTime = timestamp;

        if (autoRunning && !isPointerDown && !modalOpening) {
            targetRotation += AUTO_SPEED * delta;
        }

        // Smoothly follow the target. During a drag the target itself follows
        // the pointer, giving a fluid, direct-feeling rotation.
        const ease = isDragging ? FOLLOW_EASE : TARGET_EASE;
        const difference = targetRotation - rotation;
        rotation += difference * (1 - Math.pow(1 - ease, delta / 16.67));

        if (Math.abs(difference) < 0.001) rotation = targetRotation;
        applyRotation();
        requestAnimationFrame(render);
    }

    applyRotation();
    requestAnimationFrame(render);

    // Modal controls are shared with the leaderboard.
    const modal = document.getElementById("playerModal");
    const closeModal = document.getElementById("closeModal");
    if (closeModal && closeModal.dataset.modalBound !== "true") {
        closeModal.dataset.modalBound = "true";
        closeModal.addEventListener("click", closePlayerModal);
    }
    if (modal && modal.dataset.modalBound !== "true") {
        modal.dataset.modalBound = "true";
        modal.addEventListener("click", e => {
            if (e.target === modal) closePlayerModal();
        });
    }
}

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
    el.style.filter = "";
    el.style.textShadow = "";

    if (rating === 99) {
        el.style.color = "#A855F7";

        el.style.textShadow =
            "0 -1.5px 0 #160022, " +
            "0.6px -1.4px 0 #160022, " +
            "1.1px -1.1px 0 #160022, " +
            "1.4px -0.6px 0 #160022, " +
            "1.5px 0 0 #160022, " +
            "1.4px 0.6px 0 #160022, " +
            "1.1px 1.1px 0 #160022, " +
            "0.6px 1.4px 0 #160022, " +
            "0 1.5px 0 #160022, " +
            "-0.6px 1.4px 0 #160022, " +
            "-1.1px 1.1px 0 #160022, " +
            "-1.4px 0.6px 0 #160022, " +
            "-1.5px 0 0 #160022, " +
            "-1.4px -0.6px 0 #160022, " +
            "-1.1px -1.1px 0 #160022, " +
            "-0.6px -1.4px 0 #160022, " +
            "0 0 4px #A855F7";

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
    const popupCard = document.getElementById("popupCard");
    popupCard.style.display = "none";
    popupCard.classList.remove("monthly-popup-card");
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
    const monthlyButton = document.getElementById("monthlyRankingsButton");
    if (monthlyButton && monthlyButton.dataset.bound !== "true") {
        monthlyButton.addEventListener("click", openMonthlyRankings);
        monthlyButton.dataset.bound = "true";
    }
});




// ======================================================
// TABS + MAP HISTORY
// ======================================================

function initTabs() {
    const tabs = document.querySelectorAll(".nav-tab");
    const pages = document.querySelectorAll(".tab-page");
    const title = document.getElementById("pageTitle");

    tabs.forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.tab;

            pages.forEach(p => {
                p.style.display = (p.id === target) ? "block" : "none";
            });

            if (target === "leaderboardPage")        title.textContent = "LEADERBOARD";
            else if (target === "teamsPage")         title.textContent = "TEAMS";
            else if (target === "seriesHistoryPage") title.textContent = "HISTORY";
            else if (target === "comparisonsPage")   title.textContent = "COMPARISONS";
            else if (target === "mapsPage")          title.textContent = "MAPS";
            else if (target === "carouselPage")      title.textContent = "CARDS";
        });
    });
}

// ---------------------------
// MAP HISTORY DATA
// ---------------------------
const MAP_HISTORY_FOLDER = "history";
const MAP_HISTORY_INDEX = `${MAP_HISTORY_FOLDER}/index.json`;
const historyDayCache = new Map();

function formatHistoryDate(dateText) {
    if (!dateText) return "Unknown date";
    const date = new Date(`${dateText}T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(dateText);
    return date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric"
    });
}

function formatElo(value, digits = 2) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits) : "—";
}


// ---------------------------
// MONTHLY RANKINGS
// ---------------------------
const monthlyRankingsCache = new Map();

function monthlyPlayerName(playerId) {
    const existing = allPlayers.find(player => Number(player.id) === Number(playerId));
    return existing ? existing.name : getPlayerName(Number(playerId));
}

function ordinal(position) {
    const value = Number(position);
    if (!Number.isFinite(value)) return "—";
    const mod100 = value % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
    if (value % 10 === 1) return `${value}st`;
    if (value % 10 === 2) return `${value}nd`;
    if (value % 10 === 3) return `${value}rd`;
    return `${value}th`;
}

function monthLabel(monthKey) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ""));
    if (!match) return String(monthKey || "Unknown month");
    const d = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function normaliseHistoryIndex(indexPayload) {
    // The published index uses "dates"; accept older "days" and array formats too.
    const days = Array.isArray(indexPayload) ? indexPayload
        : (Array.isArray(indexPayload?.dates) ? indexPayload.dates : (indexPayload?.days || []));
    return days
        .map(item => typeof item === "string" ? { date: item, file: `${item}.json` } : item)
        .filter(item => item && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date)))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function loadHistoryIndexForMonthly() {
    const response = await fetch(MAP_HISTORY_INDEX, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load map history (${response.status}).`);
    return normaliseHistoryIndex(await response.json());
}

async function loadHistoryDayForMonthly(dayInfo) {
    const dateKey = String(dayInfo.date);
    if (historyDayCache.has(dateKey)) return historyDayCache.get(dateKey);
    const fileName = dayInfo.file || `${dateKey}.json`;
    const response = await fetch(`${MAP_HISTORY_FOLDER}/${fileName}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load ${fileName} (${response.status}).`);
    const payload = await response.json();
    historyDayCache.set(dateKey, payload);
    return payload;
}

function emptyMonthlyPlayer(playerId) {
    return {
        playerId: Number(playerId),
        name: monthlyPlayerName(playerId),
        wins: 0,
        losses: 0,
        mapsPlayed: 0,
        highestElo: null,
        positionCounts: {}
    };
}

function monthlyVector(record, maxPosition) {
    const values = [];
    for (let position = 1; position <= maxPosition; position += 1) {
        values.push(Number(record.positionCounts[position] || 0));
    }
    return values;
}

function compareMonthlyRecords(a, b, maxPosition) {
    const av = monthlyVector(a, maxPosition);
    const bv = monthlyVector(b, maxPosition);
    for (let i = 0; i < maxPosition; i += 1) {
        if (av[i] !== bv[i]) return bv[i] - av[i];
    }
    return String(a.name).localeCompare(String(b.name));
}

function sameMonthlyStanding(a, b, maxPosition) {
    if (!a || !b) return false;
    for (let position = 1; position <= maxPosition; position += 1) {
        if (Number(a.positionCounts[position] || 0) !== Number(b.positionCounts[position] || 0)) return false;
    }
    return true;
}

function teamForPlayer(game, playerId) {
    const teams = game?.teams || {};
    for (const key of ["A", "B"]) {
        const found = (teams[key] || []).some(player => Number(player.playerId) === Number(playerId));
        if (found) return key;
    }
    return null;
}

function teamWonMap(game, teamKey) {
    const winningTeam = Number(game?.result?.winningTeam);
    if (teamKey === "A") return winningTeam === 1;
    if (teamKey === "B") return winningTeam === 2;
    return false;
}

async function buildMonthlyRankings(monthKey) {
    // Rebuild on open so a newly published static history is visible on refresh.
    if (monthlyRankingsCache.has(monthKey)) return monthlyRankingsCache.get(monthKey);
    const index = await loadHistoryIndexForMonthly();
    const matchingDays = index.filter(day => String(day.date).startsWith(`${monthKey}-`));
    if (!matchingDays.length) {
        const empty = { monthKey, records: [], maxPosition: 0, mapCount: 0 };
        monthlyRankingsCache.set(monthKey, empty);
        return empty;
    }

    const dayPayloads = [];
    for (const info of matchingDays) {
        const payload = await loadHistoryDayForMonthly(info);
        dayPayloads.push({ date: info.date, payload });
    }
    const records = new Map();
    const currentElo = new Map();
    let mapCount = 0;
    const seenMaps = new Set();
    let maxPosition = 0;

    for (const { date, payload } of dayPayloads) {
        // Each day records the complete leaderboard at its opening. This also
        // handles days without matches between publication dates. Never use
        // today's current_stats.json as the baseline for an older month.
        const opening = payload?.openingStats;
        if (!opening || !Object.keys(opening).length) {
            throw new Error(`No opening leaderboard for ${date}; its monthly positions cannot be reconstructed reliably.`);
        }
        currentElo.clear();
        Object.entries(opening).forEach(([id, player]) => {
            const rating = Number(player?.elo);
            if (Number.isFinite(rating)) currentElo.set(String(id), rating);
        });
        if (!currentElo.size) throw new Error(`No valid opening ratings for ${date}.`);
        const maps = Array.isArray(payload?.maps) ? payload.maps : [];
        // The published per-day array retains Java import order. Do not sort by
        // source filename or timestamp, which could change the Elo sequence.
        for (const map of maps) {
            const mapKey = String(map?.mapId || map?.fingerprint || "");
            if (mapKey && seenMaps.has(mapKey)) continue;
            if (mapKey) seenMaps.add(mapKey);
            const eloRows = Array.isArray(map?.elo) ? map.elo : [];
            if (!eloRows.length) continue;
            const playedOn = String(map?.date || date);
            if (!playedOn.startsWith(`${monthKey}-`)) continue;
            const participants = new Set();
            for (const row of eloRows) {
                const playerId = Number(row?.playerId);
                const after = Number(row?.after);
                if (!Number.isInteger(playerId) || !Number.isFinite(after)) continue;
                participants.add(playerId);
                currentElo.set(String(playerId), after);
            }
            if (!participants.size) continue;
            mapCount += 1;

            // Same overall rating order as the original main leaderboard:
            // all player ratings, descending, with stable ties. We preserve the
            // openingStats insertion order rather than invent a new tie-breaker.
            const rankedIds = [...currentElo.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([id]) => Number(id));
            const rankById = new Map(rankedIds.map((id, index) => [id, index + 1]));
            maxPosition = Math.max(maxPosition, rankedIds.length);

            for (const row of eloRows) {
                const playerId = Number(row?.playerId);
                if (!participants.has(playerId)) continue;
                const teamKey = teamForPlayer(map?.game, playerId);
                if (!teamKey) continue; // Only actual participants earn map counts.
                if (!records.has(playerId)) records.set(playerId, emptyMonthlyPlayer(playerId));
                const record = records.get(playerId);
                const position = rankById.get(playerId);
                if (position) record.positionCounts[position] = (record.positionCounts[position] || 0) + 1;
                record.mapsPlayed += 1;
                for (const value of [Number(row.before), Number(row.after)]) {
                    if (Number.isFinite(value) && (record.highestElo === null || value > record.highestElo)) {
                        record.highestElo = value;
                    }
                }
                if (teamWonMap(map.game, teamKey)) record.wins += 1;
                else record.losses += 1;
            }
        }
    }

    // Eligibility changes monthly placement only, never Elo or position counts.
    const minMapsForRanking = 10;
    const sorted = [...records.values()].sort((a, b) => {
        const aQualified = a.mapsPlayed >= minMapsForRanking;
        const bQualified = b.mapsPlayed >= minMapsForRanking;
        if (aQualified !== bQualified) return aQualified ? -1 : 1;
        return compareMonthlyRecords(a, b, maxPosition);
    });
    let previous = null;
    let displayedRank = 0;
    let qualifiedIndex = 0;
    sorted.forEach(record => {
        record.qualified = record.mapsPlayed >= minMapsForRanking;
        if (!record.qualified) {
            record.monthlyRank = null;
            return;
        }
        qualifiedIndex += 1;
        if (!sameMonthlyStanding(record, previous, maxPosition)) displayedRank = qualifiedIndex;
        record.monthlyRank = displayedRank;
        previous = record;
    });
    const result = { monthKey, records: sorted, maxPosition, mapCount };
    monthlyRankingsCache.set(monthKey, result);
    return result;
}

function mostHeldPosition(record) {
    const entries = Object.entries(record.positionCounts || {})
        .map(([position, count]) => [Number(position), Number(count)])
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    return entries.length ? { position: entries[0][0], count: entries[0][1] } : null;
}

function monthlyPositionBreakdown(record, maxPosition) {
    const largest = Math.max(1, ...Object.values(record.positionCounts || {}).map(Number));
    const lines = [];
    for (let position = 1; position <= maxPosition; position += 1) {
        const count = Number(record.positionCounts[position] || 0);
        if (!count) continue;
        const width = (count / largest) * 100;
        lines.push(`<div class="monthly-position-line">
            <span>${ordinal(position)}</span>
            <div class="monthly-position-track"><div class="monthly-position-fill${position === 1 ? " monthly-position-first" : ""}" style="width:${width}%"></div></div>
            <strong>${count}</strong>
        </div>`);
    }
    return lines.join("") || "No counted positions.";
}

async function renderMonthlyRankings(monthKey) {
    const content = document.getElementById("monthlyRankingsBody");
    if (!content) return;
    content.innerHTML = `<div class="monthly-loading">Loading ${monthLabel(monthKey)}…</div>`;
    try {
        const monthly = await buildMonthlyRankings(monthKey);
        if (!monthly.records.length) {
            content.innerHTML = `<div class="monthly-empty">No approved map history is available for ${monthLabel(monthKey)}.</div>`;
            return;
        }
        const now = new Date();
        const liveMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const status = monthKey === liveMonth ? "In progress" : "Final report";
        const table = document.createElement("div");
        table.innerHTML = `
            <div class="monthly-summary"><span class="monthly-report-status">${status} · ${monthLabel(monthKey)}</span> · ${monthly.mapCount} approved map${monthly.mapCount === 1 ? "" : "s"} recorded · Minimum 10 personally played maps to qualify</div>
            <div class="monthly-table-wrap">
                <table class="monthly-table">
                    <thead><tr><th>Rank</th><th>Player</th><th>Maps in 1st</th><th>W/L</th><th>Peak Elo</th></tr></thead>
                    <tbody>
                        ${monthly.records.map(record => `<tr class="monthly-player-row" data-monthly-player="${record.playerId}" tabindex="0" role="button" aria-expanded="false">
                                <td class="monthly-rank">${record.qualified ? record.monthlyRank : '<span class="monthly-provisional">Provisional</span>'}</td>
                                <td class="monthly-player-name"></td>
                                <td class="monthly-first-count">${Number(record.positionCounts[1] || 0)}</td>
                                <td>${record.wins}–${record.losses}</td>
                                <td>${formatElo(record.highestElo)}</td>
                            </tr>
                            <tr class="monthly-breakdown-row" data-monthly-breakdown="${record.playerId}" hidden>
                                <td colspan="5">
                                    <div class="monthly-player-summary">${record.mapsPlayed} maps played · ${record.wins}–${record.losses} W/L · Peak Elo ${formatElo(record.highestElo)}${record.qualified ? "" : ` · ${10 - record.mapsPlayed} more map${10 - record.mapsPlayed === 1 ? "" : "s"} to qualify`}</div>
                                    <div class="monthly-position-breakdown">${monthlyPositionBreakdown(record, monthly.maxPosition)}</div>
                                </td>
                            </tr>`).join("")}
                    </tbody>
                </table>
            </div>`;
        content.replaceChildren(...table.childNodes);
        monthly.records.forEach(record => {
            const row = content.querySelector(`[data-monthly-player="${record.playerId}"]`);
            if (!row) return;
            row.querySelector(".monthly-player-name").textContent = record.name;
            const toggle = () => {
                const detail = content.querySelector(`[data-monthly-breakdown="${record.playerId}"]`);
                if (!detail) return;
                detail.hidden = !detail.hidden;
                row.setAttribute("aria-expanded", String(!detail.hidden));
            };
            row.addEventListener("click", toggle);
            row.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
            });
        });
    } catch (error) {
        content.textContent = `Monthly rankings could not be loaded: ${String(error.message || error)}`;
        content.classList.add("monthly-empty");
    }
}

async function openMonthlyRankings() {
    try {
        // Clear cached reports when opening the modal so new GitHub history can
        // be shown after a normal website refresh, without persisted counters.
        monthlyRankingsCache.clear();
        const index = await loadHistoryIndexForMonthly();
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const months = [...new Set(index.map(day => String(day.date).slice(0, 7)).filter(month => /^\d{4}-\d{2}$/.test(month) && month <= currentMonth))].sort().reverse();
        const completedMonths = months.filter(month => month < currentMonth);
        // On the first of every month the last completed month becomes the
        // default final report. An ongoing month remains selectable separately.
        const selected = completedMonths[0] || months[0] || currentMonth;
        const selectableMonths = months.length ? months : [currentMonth];
        showPopup(`
            <div class="monthly-rankings-popup">
                <div class="monthly-popup-header">
                    <div>
                        <h2>Monthly Rankings</h2>
                        <p>Maps personally played at each overall Elo position after the map. Rankings compare maps in 1st, then 2nd, then 3rd.</p>
                    </div>
                    <label class="monthly-month-label">Month
                        <select id="monthlyMonthSelect">${selectableMonths.map(month => `<option value="${month}" ${month === selected ? "selected" : ""}>${monthLabel(month)}${month === currentMonth ? " · In progress" : " · Final"}</option>`).join("")}</select>
                    </label>
                </div>
                <div id="monthlyRankingsBody"></div>
            </div>`);
        const card = document.getElementById("popupCard");
        if (card) card.classList.add("monthly-popup-card");
        const select = document.getElementById("monthlyMonthSelect");
        if (select) select.addEventListener("change", () => renderMonthlyRankings(select.value));
        renderMonthlyRankings(selected);
    } catch (error) {
        showPopup(`<div class="monthly-rankings-popup"><h2>Monthly Rankings</h2><div class="monthly-empty">Monthly rankings could not be loaded.</div></div>`);
        console.error("Could not open monthly rankings:", error);
    }
}

function formatSignedElo(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}`;
}

function formatTraceValue(value) {
    if (value === null || value === undefined) return "—";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
    if (typeof value === "boolean") return value ? "true" : "false";
    return String(value);
}

async function loadHistoryIndex() {
    const response = await fetch(MAP_HISTORY_INDEX, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load ${MAP_HISTORY_INDEX} (HTTP ${response.status})`);
    const data = await response.json();

    let entries = [];
    if (Array.isArray(data)) entries = data;
    else if (Array.isArray(data?.dates)) entries = data.dates;
    else if (Array.isArray(data?.days)) entries = data.days;

    return entries.map(item => {
        if (typeof item === "string") {
            return { date: item, file: `${item}.json`, maps: null };
        }
        const date = String(item?.date || "");
        return {
            date,
            file: item?.file || `${date}.json`,
            maps: Number.isFinite(Number(item?.maps)) ? Number(item.maps) : null
        };
    }).filter(item => item.date);
}

async function loadHistoryDay(entry) {
    const key = entry.date;
    if (historyDayCache.has(key)) return historyDayCache.get(key);

    const file = `${MAP_HISTORY_FOLDER}/${entry.file || `${entry.date}.json`}`;
    const response = await fetch(file, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load ${file} (HTTP ${response.status})`);
    const day = await response.json();
    historyDayCache.set(key, day);
    return day;
}

function createHistoryMessage(text, className = "history-entry") {
    const el = document.createElement("div");
    el.className = className;
    el.textContent = text;
    return el;
}

async function renderHistoryList() {
    const listEl = document.getElementById("historyList");
    const viewerEl = document.getElementById("historyViewer");
    if (!listEl || !viewerEl) return;

    listEl.style.display = "";
    viewerEl.style.display = "none";
    viewerEl.innerHTML = "";
    listEl.innerHTML = "";
    listEl.appendChild(createHistoryMessage("Loading match history..."));
    historyDayCache.clear();

    let entries;
    try {
        entries = await loadHistoryIndex();
    } catch (error) {
        console.error("Could not load map history:", error);
        listEl.innerHTML = "";
        listEl.appendChild(createHistoryMessage("No match history found"));
        return;
    }

    entries.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    listEl.innerHTML = "";

    if (!entries.length) {
        listEl.appendChild(createHistoryMessage("No match history found"));
        return;
    }

    entries.forEach(entry => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "history-entry";

        const date = document.createElement("span");
        date.className = "history-entry-date";
        date.textContent = formatHistoryDate(entry.date);

        const count = document.createElement("span");
        count.className = "history-entry-count";
        count.textContent = entry.maps === null ? "View maps" : `${entry.maps} map${entry.maps === 1 ? "" : "s"}`;

        row.append(date, count);
        row.addEventListener("click", async () => {
            try {
                const day = await loadHistoryDay(entry);
                renderHistoryDay(day, entry);
            } catch (error) {
                console.error("Error loading history day:", error);
            }
        });
        listEl.appendChild(row);
    });
}

function getMapScore(map) {
    const score = map?.game?.result?.score || {};
    return {
        teamA: score?.teamA ?? "—",
        teamB: score?.teamB ?? "—"
    };
}

function renderHistoryDay(day, entry) {
    const listEl = document.getElementById("historyList");
    const viewerEl = document.getElementById("historyViewer");
    if (!viewerEl) return;

    if (listEl) listEl.style.display = "none";
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
        if (["Base Elo", "Base after margin", "KD adjustment", "Damage adjustment", "Final change"].includes(step?.name)) {
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

// ---------------------------
// INITIALISE TABS + HISTORY
// ---------------------------
document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    renderHistoryList();
    setupMapBuilder();
    setupCarousel();
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





























