
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
                "player2-adjust",
                "player5-adjust",
                "player4-adjust",
                "player11-adjust",
                "player13-adjust",
                "player3-adjust",
                "player10-adjust"
            );

            if (p.id === 5) card.classList.add("player5-adjust");
            if (p.id === 4) card.classList.add("player4-adjust");
            if (p.id === 11) card.classList.add("player11-adjust");
            if (p.id === 13) card.classList.add("player13-adjust");
            if (p.id === 3) card.classList.add("player3-adjust");
            if (p.id === 2) card.classList.add("player2-adjust");
            if (p.id === 10)card.classList.add("player10-adjust");

            // SET BACK CARD PNG
            if (customBackCards[p.id]) {
                backEl.style.backgroundImage = `url('${customBackCards[p.id]}')`;
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
                9: "cards/9_intro.mp4",
                10: "cards/10_intro.mp4",
                11: "cards/11_intro.mp4",
                12: "cards/12_intro.mp4"
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

                if (introSrc) {
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
        "player2-adjust", "player5-adjust", "player4-adjust",
        "player11-adjust", "player13-adjust", "player3-adjust", "player10-adjust"
    );
    [2, 3, 4, 5, 10, 11, 13].forEach(id => {
        if (p.id === id) card.classList.add(`player${id}-adjust`);
    });

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
        if (customBackCards[p.id]) back.style.backgroundImage = `url('${customBackCards[p.id]}')`;
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
            else if (target === "comparisonsPage") title.textContent = "COMPARISONS";
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






























