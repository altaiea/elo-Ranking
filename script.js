
// Metallic "clink": a few non-harmonic sine partials (like struck metal)
// with a very fast attack and a short ring-out, plus a tiny noise tick.
function playMetalClink(ctx) {
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.07;
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 450;
    master.connect(highpass);
    highpass.connect(ctx.destination);

    const base = 880 + Math.random() * 60;            // tiny pitch variation
    const partials = [                                 // ratio, level, ring time (s)
        [1.00, 1.00, 0.22],
        [2.76, 0.65, 0.17],
        [5.40, 0.42, 0.12],
        [8.93, 0.26, 0.08]
    ];
    partials.forEach(([ratio, level, ring]) => {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = base * ratio;
        env.gain.setValueAtTime(0.0001, now);
        env.gain.exponentialRampToValueAtTime(level, now + 0.002);
        env.gain.exponentialRampToValueAtTime(0.0001, now + ring);
        osc.connect(env);
        env.connect(master);
        osc.start(now);
        osc.stop(now + ring + 0.02);
    });

    // 12 ms of filtered noise for the "tick" of metal on metal
    const length = Math.floor(ctx.sampleRate * 0.012);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = 3500;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.5;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(now);
}

function playCarouselClick() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = window.__carouselAudioContext || (window.__carouselAudioContext = new AudioCtx());
        if (ctx.state === "suspended") ctx.resume();
        playMetalClink(ctx);
    } catch (_) {}
}

// ===============================
// LOAD CURRENT STATS + TODAY'S OPENING STATS
// ===============================
// Daily arrows compare the latest approved ratings with the fixed opening
// ratings saved before the first map of that history day. Neither yesterday's
// daily snapshot nor previous_stats.json is needed.
async function loadDailyLeaderboard() {
    const currentResponse = await fetch("current_stats.json", { cache: "no-cache" });
    if (!currentResponse.ok) throw new Error(`Could not load current_stats.json (HTTP ${currentResponse.status})`);
    const current = await currentResponse.json();
    let openingStats = null;

    try {
        const indexResponse = await fetch("history/index.json", { cache: "no-cache" });
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
            const dayResponse = await fetch(`history/${dayFile}`, { cache: "no-cache" });
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
function playerHasActivity(p) {
    const wins = (p.hpWins || 0) + (p.sndWins || 0) + (p.overloadWins || 0);
    const losses = (p.hpLosses || 0) + (p.sndLosses || 0) + (p.overloadLosses || 0);
    return (wins + losses + (p.lifetimeKills || 0) + (p.lifetimeDeaths || 0)) > 0;
}

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

    // Ranking pool = players who are active AND not flagged inactive. Inactive
    // players and empty placeholders never take a rank number from, or push
    // arrows onto, the current pool. They are numbered after the pool.
    const inPool = p => !INACTIVE_PLAYER_IDS.has(p.id) && playerHasActivity(p);
    const poolIds = new Set(currPlayers.filter(inPool).map(p => p.id));

    const openingPool = openingPlayers.filter(p => poolIds.has(p.id));
    openingPool.sort((a, b) => b.elo - a.elo);
    openingPool.forEach((p, i) => p.openingRank = i + 1);

    const currPool = currPlayers.filter(inPool).sort((a, b) => b.elo - a.elo);
    const currRest = currPlayers.filter(p => !inPool(p)).sort((a, b) => b.elo - a.elo);
    currPool.forEach((p, i) => { p.currentRank = i + 1; p.inRankPool = true; });
    currRest.forEach((p, i) => { p.currentRank = currPool.length + i + 1; p.inRankPool = false; });
    currPlayers.length = 0;
    currPlayers.push(...currPool, ...currRest);

    allPlayers = currPlayers.map(p => {
        const opening = openingPlayers.find(x => x.id === p.id);
        const hasOpening = !!opening && Number.isFinite(Number(p.elo));
        const rankComparable = hasOpening && p.inRankPool && Number.isFinite(opening.openingRank);
        return {
            ...p,
            hasDailyComparison: hasOpening,
            eloChange: hasOpening ? Number(p.elo) - opening.elo : 0,
            rankChange: rankComparable ? opening.openingRank - p.currentRank : 0
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

    filtered.sort((a, b) => a.currentRank - b.currentRank);

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
    // Player names on the leaderboard are plain text now. The cards open from the
    // Cards tab only. (enableModal is kept below in case you want this back.)
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
        dmgShare,
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

/* ---------------------------
   FLOATING CARD (player modal)
   The card opens hovering on a corner, wings side up, above two open hands (hands.webp) that rise out of the dark.
   Tapping the card straightens it and turns it over to the player; the hands stay until the popup is closed.
---------------------------- */
let cardEnterAnim = null, cardFloatAnim = null, cardTapHandler = null, cardTapBox = null, handsAnim = null, cardPulseAnim = null;

// Everything is laid out for a 1100 x 700 window and scaled to fit the real one.
function floatLayout(box) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const s = Math.min(vh / 700, vw / 1100);
    const handsW = 770 * s, handsH = 1.5 * handsW;          // hands.webp is 2:3 (portrait)
    const spare = Math.max(0, vh - 700 * s);                // tall screens (phones): lift the whole scene a little
    const imgTop = vh - 0.69 * handsH - spare * 0.4;         // the hands sit near the bottom edge
    const cardCenter = imgTop + 0.344 * handsH;              // just above the fingertips, between the thumbs
    const boxCenter = box.offsetTop + box.offsetHeight / 2;
    const ty = cardCenter - boxCenter, sc = 0.7 * s;
    const pose = (dy, rz, rx, ry) =>
        `translateY(${ty + dy * s}px) perspective(1100px) scale(${sc}) rotateZ(${rz}deg) rotateX(${rx}deg) rotateY(${ry}deg)`;
    // After the card has turned over it keeps levitating above the hands, upright and a touch larger.
    const tyUp = imgTop + 0.325 * handsH - boxCenter, scUp = 0.82 * s;
    const up = (dy, rz, ry) =>
        `translateY(${tyUp + dy * s}px) perspective(1100px) scale(${scUp}) rotateZ(${rz}deg) rotateX(0deg) rotateY(${ry}deg)`;
    return { handsW, imgTop, a: pose(-9, -1, 19, -3), b: pose(9, 1, 15, 3), ua: up(-10, -1.2, -3), ub: up(10, 1.2, 3) };
}

function cardHandsEl() {
    let el = document.getElementById("cardHands");
    if (!el) {
        el = document.createElement("img");
        el.id = "cardHands";
        el.src = "hands.webp";
        el.alt = "";
        el.draggable = false;
        document.getElementById("playerModal").appendChild(el);
    }
    return el;
}
function showCardHands(layout) {
    const el = cardHandsEl();
    if (handsAnim) handsAnim.cancel();
    el.style.width = layout.handsW + "px";
    el.style.top = layout.imgTop + "px";
    el.style.display = "block";
    handsAnim = el.animate([
        { opacity: 0, transform: "translate(-50%, 7%)" },
        { opacity: 1, transform: "translate(-50%, 0)" }
    ], { duration: 1100, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" });
    // once risen, the hands keep breathing gently until the popup is closed
    const rise = handsAnim;
    rise.finished.then(() => {
        if (handsAnim !== rise) return;
        handsAnim = el.animate([{ transform: "translate(-50%, 0)" }, { transform: "translate(-50%, 7px)" }],
            { duration: 3200, direction: "alternate", iterations: Infinity, easing: "ease-in-out" });
        rise.cancel();
    }).catch(() => {});
}
function hideCardHands() {
    const el = document.getElementById("cardHands");
    if (!el) return;
    if (handsAnim) { handsAnim.cancel(); handsAnim = null; }
    el.style.display = "none";
}

function stopCardFloat() {
    if (cardEnterAnim) { cardEnterAnim.cancel(); cardEnterAnim = null; }
    if (cardFloatAnim) { cardFloatAnim.cancel(); cardFloatAnim = null; }
    if (cardTapBox && cardTapHandler) cardTapBox.removeEventListener("click", cardTapHandler);
    if (cardPulseAnim) { cardPulseAnim.cancel(); cardPulseAnim = null; }
    if (cardTapBox) cardTapBox.classList.remove("floating-card", "awaiting-tap");
    cardTapHandler = cardTapBox = null;
    hideCardHands();
}

// Swing in from the carousel and settle into the floating pose. Resolves when it is hovering.
function startCardFloat(box) {
    stopCardFloat();
    const L = floatLayout(box);
    box.__floatPoses = L;
    cardEnterAnim = box.animate([
        { opacity: 0, transform: "perspective(1100px) rotateY(-180deg) scale(0.6)", offset: 0 },
        { opacity: 1, offset: 0.2 },
        { opacity: 1, transform: L.a, offset: 1 }
    ], { duration: 900, easing: "cubic-bezier(.25,.8,.25,1)", fill: "forwards" });
    const enter = cardEnterAnim;
    showCardHands(L);
    return enter.finished.then(() => {
        if (cardEnterAnim !== enter) return false;
        cardFloatAnim = box.animate([{ transform: L.a }, { transform: L.b }],
            { duration: 2600, direction: "alternate", iterations: Infinity, easing: "ease-in-out" });
        enter.cancel(); cardEnterAnim = null;
        return true;
    }).catch(() => false);
}

// Wait for a tap on the floating card, then straighten it while it turns over.
function armCardReveal(box, onReveal) {
    cardTapBox = box;
    box.classList.add("floating-card", "awaiting-tap");
    // the card breathes (and its glow pulses, see style.css) to say "click me"
    const pulseEl = box.querySelector(".container");
    if (pulseEl) {
        cardPulseAnim = pulseEl.animate(
            [{ transform: "scale(1)" }, { transform: "scale(1.055)" }, { transform: "scale(1)" }],
            { duration: 1500, iterations: Infinity, easing: "ease-in-out" });
    }
    cardTapHandler = () => {
        box.removeEventListener("click", cardTapHandler);
        box.classList.remove("floating-card", "awaiting-tap");
        if (cardPulseAnim) {
            const from = pulseEl ? getComputedStyle(pulseEl).transform : "none";
            cardPulseAnim.cancel(); cardPulseAnim = null;
            if (pulseEl && from !== "none") pulseEl.animate([{ transform: from }, { transform: "none" }], { duration: 160, easing: "ease-out" });
        }
        const current = getComputedStyle(box).transform;
        if (cardFloatAnim) { cardFloatAnim.cancel(); cardFloatAnim = null; }
        // straighten up while turning over, then keep levitating above the hands until the popup is closed
        const L = box.__floatPoses;
        const settle = box.animate([{ transform: current === "none" ? L.a : current }, { transform: L.ua }],
            { duration: 1000, easing: "cubic-bezier(.3,.7,.2,1)", fill: "forwards" });
        cardEnterAnim = settle;
        settle.finished.then(() => {
            if (cardEnterAnim !== settle) return;
            cardFloatAnim = box.animate([{ transform: L.ua }, { transform: L.ub }],
                { duration: 2800, direction: "alternate", iterations: Infinity, easing: "ease-in-out" });
            settle.cancel(); cardEnterAnim = null;
        }).catch(() => {});
        cardTapHandler = cardTapBox = null;
        onReveal();           // the hands stay until the popup is closed

    };
    box.addEventListener("click", cardTapHandler);
}

// Elastic flip: the card turns over past the finish, springs back and settles, flexing a little as a real card does.
function elasticFlip(card) {
    card.style.transition = "none";
    const dur = 1300, count = 40, frames = [];
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1), sec = t * dur / 1000;
        const p = i === count - 1 ? 1 : 1 - Math.exp(-6.5 * sec) * Math.cos(9 * sec);   // spring: overshoots, then settles at 1
        const bend = Math.sin(Math.PI * p);                                              // strongest at the edge-on moment
        frames.push({
            transform: `rotateY(${180 * p}deg) skewY(${-9 * bend}deg) scale(${1 - 0.07 * Math.abs(bend)})`,
            offset: t
        });
    }
    const anim = card.animate(frames, { duration: dur, easing: "linear" });
    const done = () => { try { anim.cancel(); } catch (_) {} card.style.transition = ""; };
    anim.finished.then(done).catch(done);
}

function openPlayerModal(playerId, playerList = allPlayers) {
    const modal = document.getElementById("playerModal");
    const p = playerList.find(x => x.id === Number(playerId)) || allPlayers.find(x => x.id === Number(playerId));

    if (!modal || !p) return;

    modal.style.display = "block";

    // Entrance: the card swings in from the carousel and settles in front.
    const modalBox = modal.querySelector(".modal-content");
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let floatReady = Promise.resolve(false);
    if (modalBox) {
        modalBox.classList.remove("modal-enter");
        void modalBox.offsetWidth;                 // restart the backdrop fade
        modalBox.classList.add("modal-enter");
        if (!reduceMotion) floatReady = startCardFloat(modalBox);
        else stopCardFloat();
    }

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

            hpEl.onclick = () => openModeModal("Hardpoint", hp, p);
            ovlEl.onclick = () => openModeModal("Overload", ovl, p);
            sndEl.onclick = () => openModeModal("Search & Destroy", snd, p);

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

            Promise.all([imageReady, videoReady, floatReady]).then(([, , hovering]) => {
                // User may have opened a different player while this one was loading.
                if (loadToken !== playerModalLoadToken) return;
                if (modal.style.display === "none") return;

                // The card hovers on its wings side until it is tapped, then it turns over.
                if (hovering) armCardReveal(modalBox, () => { if (loadToken === playerModalLoadToken) revealCard(); });
                else revealCard();
            });

            const revealCard = () => {
                card.classList.add("flipped");
                if (!reduceMotion) elasticFlip(card);

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
            };

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
    stopCardFloat();
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
// Card art and intro videos are NOT downloaded for everyone on page load
// (that used to be ~130 MB). Instead a player's media is fetched ahead of the
// click: when the pointer hovers / a finger touches their name, and then slowly
// in the background on fast connections, so videos start without buffering.
const WARM_INTRO_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15];
const warmedPlayers = new Set();

function warmPlayerMedia(id) {
    id = Number(id);
    if (!id || warmedPlayers.has(id)) return;
    warmedPlayers.add(id);
    const backSrc = typeof customBackCards !== "undefined" ? customBackCards[id] : null;
    if (backSrc) {
        const img = new Image();
        img.decoding = "async";
        img.src = backSrc;
    }
    if (WARM_INTRO_IDS.includes(id)) {
        const video = document.createElement("video");
        video.preload = "auto";
        video.muted = true;
        video.src = `cards/${id}_intro.mp4`;
        video.load();
    }
}

// Background warm-up, one player every 3 s, only on a fast connection
// without data-saver. Starts after the page has fully loaded and gone idle.
window.addEventListener("load", () => {
    const c = navigator.connection || {};
    if (c.saveData || (c.effectiveType && c.effectiveType !== "4g")) return;
    const start = () => {
        WARM_INTRO_IDS.forEach((id, i) => setTimeout(() => warmPlayerMedia(id), 3000 * (i + 1)));
    };
    if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 5000 });
    else setTimeout(start, 3000);
}, { once: true });

function setupCarousel() {
    const slider = document.querySelector("#carouselPage .slider");
    if (!slider) return;

    const items = [...slider.querySelectorAll(".item")];
    const quantity = items.length || 14;
    const step = 360 / quantity;

    // JS is the single owner of the carousel's overall rotation.
    const AUTO_SPEED = -360 / 18000; // degrees per millisecond
    const DRAG_SENSITIVITY = 0.6;
    const DRAG_THRESHOLD = 5;
    const FOLLOW_EASE = 0.38;   // follow the finger/mouse more tightly
    const TARGET_EASE = 0.13;
    const TAP_EASE = 0.28;       // faster spin when you tap a card
    const OPEN_WITHIN_DEG = 7;   // open the card when nearly there, not exactly there
    const OPEN_MAX_MS = 380;     // ...and never wait longer than this
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
    let lastTickIndex = null;      // which card slot the carousel last passed
    let lastTickTime = 0;
    let introRot = null;           // while the Cards intro plays, it owns the ring's rotation

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
            playMetalClink(audioContext);
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
        const startedAt = performance.now();
        const waitForArrival = () => {
            if (!modalOpening) return;
            const closeEnough = Math.abs(targetRotation - rotation) < OPEN_WITHIN_DEG;
            if (closeEnough || performance.now() - startedAt > OPEN_MAX_MS) {
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
        if (modalOpening || introRunning) return;

        isPointerDown = true;
        isDragging = false;
        suppressClick = false;
        activePointerId = event.pointerId;
        pointerStartX = event.clientX;
        pointerStartRotation = targetRotation;

        const pressed = event.target.closest && event.target.closest("#carouselPage .item");
        if (pressed && typeof warmPlayerMedia === "function") warmPlayerMedia(pressed.dataset.playerId);

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
            lastTickIndex = Math.round(rotation / step);
            lastTickTime = performance.now();
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
        const ease = isDragging ? FOLLOW_EASE : (modalOpening ? TAP_EASE : TARGET_EASE);
        const difference = targetRotation - rotation;
        rotation += difference * (1 - Math.pow(1 - ease, delta / 16.67));

        if (Math.abs(difference) < 0.001) rotation = targetRotation;

        // Ratchet: one metallic clink each time a card slot passes the front
        // while dragging (or while spinning to a tapped card).
        if (isDragging || modalOpening) {
            const slot = Math.round(rotation / step);
            if (lastTickIndex === null) lastTickIndex = slot;
            if (slot !== lastTickIndex) {
                lastTickIndex = slot;
                const nowMs = performance.now();
                if (nowMs - lastTickTime > 45) {      // never faster than ~22 per second
                    lastTickTime = nowMs;
                    playClickSound();
                }
            }
        } else {
            lastTickIndex = null;
        }
        if (introRot) rotation = targetRotation = introRot();
        applyRotation();
        requestAnimationFrame(render);
    }

    // Shrink the whole ring on narrow screens so every card is on screen, whatever the device.
    // It uses the separate `scale` property, so it never interferes with the spin or the intro.
    function fitRing() {
        const s = Math.max(0.36, Math.min(1, window.innerWidth / 960));
        slider.style.scale = s < 1 ? String(s) : "";
        slider.style.top = s < 0.7 ? "6%" : "";            // phones: sit the ring higher so there is no big empty gap
    }
    fitRing();
    window.addEventListener("resize", fitRing);

    applyRotation();
    requestAnimationFrame(render);

    // ---- Cards tab intro ----
    // A deck at the left spreads into a fan. The cards then leave the fan one at a time and drop into
    // their slots while the ring spins, which eases down to its normal auto-rotation as the last card lands.
    // Cards that land showing the other side turn over early in their flight, never when they land.
    // Skipped when the visitor prefers reduced motion.
    let introRunning = false;
    function playIntro() {
        try { cardHandsEl(); } catch (_) {}   // start loading the hands picture for the card popup
        if (introRunning) return;
        if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        introRunning = true;
        stopAuto();
        const startRotation = rotation;   // the ring may already be turned, so everything below uses its absolute angle
        const START_BACK = false;   // false: the deck and fan start face-up. true would start them wings-side up.
        const FAN_RY = START_BACK ? 180 : 0;

        const RADIUS = 400, TILT = -16, CAM = 2000;
        const rad = d => d * Math.PI / 180;
        const T = (x, y, z, ry, rz) =>
            `translate3d(${x}px, ${y}px, ${z}px) rotateY(${ry}deg) rotateZ(${rz}deg)`;
        const facing = (x, y, z, ry) => {
            const c = Math.cos(rad(TILT)), s = Math.sin(rad(TILT));
            const px = x, py = y * c - z * s, pz = y * s + z * c;
            const nx = Math.sin(rad(ry)), nz = Math.cos(rad(ry));
            const wy = -nz * s, wz = nz * c;
            const dot = nx * (0 - px) + wy * (0 - py) + wz * (CAM - pz);
            return dot / Math.hypot(nx, wy, wz) / Math.hypot(px, py, CAM - pz);
        };
        const MARGIN = Math.sin(rad(7));
        const easeOut = u => 1 - Math.pow(1 - u, 3);
        const easeOutBack = u => { const c1 = 0.7, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
        const smooth = x => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
        const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;

        // Timing (ms)
        const DECK_HOLD = 120, FAN_STAGGER = 13, FAN_TIME = 460, FAN_HOLD = 30, GAP = 48, FLIGHT = 780, DT = 30;
        // Fan geometry
        const SPREAD = 6.4, FAN_R = 105, PIVOT_X = -300, PIVOT_Y = -5, DECK_X = -300, DECK_Y = -60;

        const n = items.length, mid = (n - 1) / 2;
        const firstLeave = DECK_HOLD + (n - 1) * FAN_STAGGER + FAN_TIME + FAN_HOLD;
        const total = firstLeave + (n - 1) * GAP + FLIGHT;

        // Human-style timing. The fan opens gently, speeds up through the middle and eases off at the
        // end, like a thumb riffle. Cards are dealt with a slightly uneven rhythm. The first and last
        // card keep exactly the same timing as before, so the total length does not change.
        const easeSine = x => 0.5 - 0.5 * Math.cos(Math.PI * x);
        const noise = i => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };   // 0..1, the same every time
        const edge = x => Math.sin(Math.PI * x);                                                               // 0 at both ends, so the first and last card never move
        const fanDelay = p => {
            const x = p / (n - 1);
            return (n - 1) * FAN_STAGGER * easeSine(x);
        };
        const dealDelay = k => {
            const x = k / (n - 1);
            const eased = 0.6 * x + 0.4 * easeSine(x);                                                         // a little hesitation at the start, a little ease at the end
            return (n - 1) * GAP * eased + (noise(k + 40) - 0.5) * 12 * edge(x);
        };

        // The ring spins up while the cards are dealt in, then eases down to its normal
        // auto-rotation speed exactly as the last card lands.
        const W_END = AUTO_SPEED, W_START = -0.14;
        const rotAt = t => {
            const c = Math.max(0, Math.min(t, total)), s = c / total;
            return startRotation + W_END * c + (W_START - W_END) * (total / 3) * (1 - Math.pow(1 - s, 3));
        };

        const anims = items.map(item => {
            const id = Number(item.dataset.playerId), k = id - 1, a = (k * step) % 360;
            const p = n - 1 - k;                               // card 1 is on top of the fan and leaves first
            const leave = firstLeave + dealDelay(k), land = leave + FLIGHT;

            // Which face shows once the card lands depends on where the spinning ring has got to.
            const rotLand = rotAt(land);
            const aLand = a + rotLand;
            const back = facing(RADIUS * Math.sin(rad(aLand)), 0, RADIUS * Math.cos(rad(aLand)), aLand) < 0;
            const want = back ? -1 : 1;
            const stays = back === START_BACK;                 // cards that land showing the side they started on never turn over
            const m = Math.round((FAN_RY - (a + rotAt(leave))) / 360);   // keeps the turn short

            const deck = { x: DECK_X + p * 0.7, y: DECK_Y - p * 1.1, z: 190 + p * 1.2, ry: FAN_RY, rz: 0 };
            const th = (p - mid) * SPREAD, tilt = START_BACK ? -1 : 1;   // a card lying back-up tilts the other way on screen
            const fan = { x: PIVOT_X + FAN_R * Math.sin(rad(th)), y: PIVOT_Y - FAN_R * Math.cos(rad(th)), z: 190 + p * 3, ry: FAN_RY, rz: tilt * th };
            const sweepStart = DECK_HOLD + fanDelay(p);
            const sweepTime = FAN_TIME * (0.97 + 0.06 * noise(p + 7));      // each card swings out a touch differently
            const spinTurns = -(1 + (k % 3 === 0 ? 1 : 0));                 // like a card skimmed onto a turntable: spins about its own vertical axis, not like a clock hand

            // The card's pose in the frame the ring spins in front of (before the ring's own spin).
            const poseAt = t => {
                if (t <= sweepStart) return deck;
                if (t < sweepStart + sweepTime) {
                    const u = easeOutBack((t - sweepStart) / sweepTime);
                    return { x: deck.x + (fan.x - deck.x) * u, y: deck.y + (fan.y - deck.y) * u, z: deck.z + (fan.z - deck.z) * u, ry: FAN_RY, rz: tilt * th * u };
                }
                if (t <= leave) return fan;
                const raw = Math.min(1, (t - leave) / FLIGHT), u = easeOut(raw);
                const r = rotAt(t);
                const tx = RADIUS * Math.sin(rad(a + r)), tz = RADIUS * Math.cos(rad(a + r));
                const ryT = a + r + 360 * m;
                let o = {
                    x: fan.x + (tx - fan.x) * u,
                    z: fan.z + (tz - fan.z) * u,
                    y: fan.y * (1 - u) - 28 * Math.sin(Math.PI * raw),
                    rz: fan.rz * (1 - u) * (1 - u),
                    ry: stays ? FAN_RY + (ryT - FAN_RY) * u : FAN_RY + (ryT - FAN_RY) * smooth((raw - 0.05) / 0.33)
                };
                if (raw >= (stays ? 0 : 0.4) && raw < 1 && want * facing(o.x, o.y, o.z, o.ry) < MARGIN) {
                    const base = back ? 180 : 0, q = back ? o.ry - 180 : wrap(o.ry);
                    let lo = 0, hi = 1;
                    for (let i = 0; i < 12; i++) {
                        const mm = (lo + hi) / 2;
                        if (want * facing(o.x, o.y, o.z, base + q * mm) >= MARGIN) lo = mm; else hi = mm;
                    }
                    o.ry += q * lo - q;
                }
                o.ry += 360 * spinTurns * Math.pow(1 - u, 2);   // thrown spin, fades to exactly 0 on landing
                return o;
            };

            const frames = [];
            for (let t = 0; ; t += DT) {
                const tt = Math.min(t, total);
                const o = tt >= land ? { x: RADIUS * Math.sin(rad(a + rotAt(tt))), y: 0, z: RADIUS * Math.cos(rad(a + rotAt(tt))), ry: a + rotAt(tt) + 360 * m, rz: 0 } : poseAt(tt);
                const r = rad(rotAt(tt)), cs = Math.cos(r), sn = Math.sin(r);
                // Back into the ring's own (spinning) coordinates.
                frames.push({
                    transform: T(o.x * cs - o.z * sn, o.y, o.x * sn + o.z * cs, o.ry - (rotAt(tt)), o.rz),
                    offset: tt / total
                });
                if (tt >= total) break;
            }
            return item.animate(frames, { duration: total, easing: "linear", fill: "both" });
        });

        // The ring's spin is a Web Animation too, built from the same numbers and started in the same
        // moment as the cards, so the browser moves the ring and the cards together on every frame.
        const ringFrames = [];
        for (let t = 0; ; t += DT) {
            const tt = Math.min(t, total);
            ringFrames.push({ transform: `perspective(2000px) rotateX(-16deg) rotateY(${rotAt(tt)}deg)`, offset: tt / total });
            if (tt >= total) break;
        }
        const ringAnim = slider.animate(ringFrames, { duration: total, easing: "linear", fill: "both" });
        Promise.all(anims.map(an => an.finished).concat(ringAnim.finished)).then(() => {
            rotation = targetRotation = rotAt(total);
            anims.forEach(an => an.cancel());
            ringAnim.cancel();
            applyRotation();
            introRunning = false;
            resumeAuto(50);
        }).catch(() => { introRunning = false; });
    }
    window.__cardsIntro = playIntro;

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

/* ---------------------------
   MODE STATS PANEL (wheel design)
   Opens when a mode circle (Hardpoint / Overload / S&D) is clicked.
   Shows final numbers only. They come from computeMode(), the same
   maths the card uses.
---------------------------- */

// Scores use the same 57-99 scale as the card ratings.
function modeScore(pct) {
    return Math.round(57 + pct * 42);
}

// Stars follow the mode rating: 57 = 1 star ... 99 = 5 stars.
function starsFromRating(rating) {
    const w = (rating - 57) / 42;
    return Math.max(1, Math.min(5, Math.round(1 + w * 4)));
}

function modeScoreColor(score) {
    if (score < 40) return "#FF4444";
    if (score < 60) return "#FFFFFF";
    if (score < 80) return "#FFE066";
    if (score <= 98) return "#00FF66";
    return "#A855F7";
}

function modeEscape(text) {
    return String(text).replace(/[&<>"']/g, c => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

function modePolar(cx, cy, r, deg) {
    const a = deg * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function modeSectorPath(cx, cy, r0, r1, a0, a1) {
    const [x0, y0] = modePolar(cx, cy, r1, a0);
    const [x1, y1] = modePolar(cx, cy, r1, a1);
    const [x2, y2] = modePolar(cx, cy, r0, a1);
    const [x3, y3] = modePolar(cx, cy, r0, a0);
    const large = (a1 - a0) > 180 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r1} ${r1} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
           `L${x2.toFixed(2)} ${y2.toFixed(2)} A${r0} ${r0} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
}

function modeArcPath(cx, cy, r, a0, a1) {
    const [x0, y0] = modePolar(cx, cy, r, a0);
    const [x1, y1] = modePolar(cx, cy, r, a1);
    const large = (a1 - a0) > 180 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function modeStarsSvg(count) {
    const star = "M12 2.2l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17l-6 3.3 1.3-6.6L2.4 9.1l6.7-.8z";
    let out = "";
    for (let i = 1; i <= 5; i++) {
        out += `<svg class="mp-star ${i <= count ? "on" : "off"}" viewBox="0 0 24 24" aria-hidden="true"><path d="${star}"/></svg>`;
    }
    return `<span class="mp-stars-row" role="img" aria-label="${count} out of 5 stars">${out}</span>`;
}

// The five wheel segments: name on the wheel, wheel score, and the final number shown in the list.
function buildModeStats(s, convertedMargin) {
    const dec = n => n.toFixed(2);
    return [
        { label: "K/D", short: "K/D", name: "K/D",
          score: modeScore(s.kdPct), value: dec(s.kd), tone: s.kd < 1 ? "bad" : "good" },
        { label: "AVG MARGIN", short: "MARGIN", name: "Avg margin",
          score: modeScore(s.marginPct), value: (convertedMargin > 0 ? "+" : "") + dec(convertedMargin),
          tone: convertedMargin < 0 ? "bad" : "good" },
        { label: "WIN RATE", short: "WIN RATE", name: "Win rate",
          score: modeScore(s.wrPct), value: (s.wr * 100).toFixed(1) + "%", tone: "" },
        { label: "DAMAGE SHARE", short: "DAMAGE", name: "Damage share",
          score: modeScore(s.dmgPct), value: (s.dmgShare * 100).toFixed(1) + "%", tone: "" },
        { label: "SLAYING POWER", short: "SLAYING", name: "Slaying power",
          score: s.slayerRating, value: String(s.slayerRating), tone: "" }
    ];
}

let modeModalBound = false;

function closeModeModal() {
    const modal = document.getElementById("modeModal");
    if (modal) {
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
    }
}

function openModeModal(modeName, modeStats, player) {
    const modal = document.getElementById("modeModal");
    const panel = document.getElementById("modePanel");
    if (!modal || !panel) return;

    const s = modeStats;

    let convertedMargin = s.margin;
    if (modeName === "Hardpoint") convertedMargin *= 250;
    if (modeName === "Overload") convertedMargin *= 8;
    if (modeName === "Search & Destroy") convertedMargin *= 6;

    const stats = buildModeStats(s, convertedMargin);
    const playerName = player && player.name ? player.name : "";

    const narrow = window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
    const viewBox = narrow ? "-8 0 476 420" : "-70 0 600 420";

    // Wheel geometry
    const cx = 230, cy = 210, rIn = 62, rOut = 140, labelR = 162;
    const span = 360 / stats.length, gap = 3;
    let sectors = "", labels = "";

    stats.forEach((stat, i) => {
        const a0 = -90 + i * span + gap / 2;
        const a1 = -90 + (i + 1) * span - gap / 2;
        const mid = (a0 + a1) / 2;
        const rFill = rIn + (rOut - rIn) * (stat.score / 99);
        const [lx, ly] = modePolar(cx, cy, labelR, mid);
        const cos = Math.cos(mid * Math.PI / 180);
        const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";

        sectors += `
            <g class="mw-seg" data-i="${i}" tabindex="0" role="button" aria-label="${modeEscape(stat.label)} ${stat.score}">
                <path class="mw-track" d="${modeSectorPath(cx, cy, rIn, rOut, a0, a1)}"/>
                <path class="mw-fill" d="${modeSectorPath(cx, cy, rIn, rFill, a0, a1)}"/>
                <path class="mw-edge" d="${modeArcPath(cx, cy, rFill, a0, a1)}"/>
            </g>`;
        labels += `
            <text class="mw-label" data-i="${i}" x="${lx.toFixed(1)}" y="${(ly + 5).toFixed(1)}" text-anchor="${anchor}">
                <tspan class="mw-name">${modeEscape(narrow ? stat.short : stat.label)}</tspan>
                <tspan class="mw-val" dx="6" fill="${modeScoreColor(stat.score)}">${stat.score}</tspan>
            </text>`;
    });

    const wheel = `
        <svg class="mp-wheel-svg" viewBox="${viewBox}" role="img" aria-label="${modeEscape(modeName)} rating wheel">
            ${sectors}
            <circle class="mw-core" cx="${cx}" cy="${cy}" r="${rIn - 3}"/>
            <circle class="mw-ring" cx="${cx}" cy="${cy}" r="${rIn - 13}"/>
            <text class="mw-ovr" x="${cx}" y="${cy + 8}" text-anchor="middle" fill="${modeScoreColor(s.rating)}">${s.rating}</text>
            <text class="mw-ovr-label" x="${cx}" y="${cy + 28}" text-anchor="middle">OVR</text>
            ${labels}
        </svg>`;

    const rows = stats.map((stat, i) => `
        <div class="mp-row" data-i="${i}">
            <span>${modeEscape(stat.name)}</span>
            <b class="${stat.tone}">${modeEscape(stat.value)}</b>
        </div>`).join("");

    panel.innerHTML = `
        <div class="mp-top">
            <div class="mp-who">
                ${playerName ? `<span class="mp-player">${modeEscape(playerName)}</span>` : ""}
                <span class="mp-mode">${modeEscape(modeName)}</span>
            </div>
            <button type="button" class="mp-close" aria-label="Close">×</button>
        </div>
        <div class="mp-body">
            <div class="mp-wheel">${wheel}</div>
            <div class="mp-detail">
                <div class="mp-rows">${rows}</div>
                <div class="mp-stars"><span>Stars</span>${modeStarsSvg(starsFromRating(s.rating))}</div>
            </div>
        </div>`;

    // Hovering or tapping a wheel segment lights up its row in the list.
    const segs = Array.from(panel.querySelectorAll(".mw-seg"));
    const texts = Array.from(panel.querySelectorAll(".mw-label"));
    const listRows = Array.from(panel.querySelectorAll(".mp-row"));

    function select(i) {
        segs.forEach((g, n) => g.classList.toggle("sel", n === i));
        texts.forEach((t, n) => t.classList.toggle("sel", n === i));
        listRows.forEach((r, n) => r.classList.toggle("sel", n === i));
    }

    segs.forEach(g => {
        const i = Number(g.dataset.i);
        g.addEventListener("mouseenter", () => select(i));
        g.addEventListener("focus", () => select(i));
        g.addEventListener("click", () => select(i));
        g.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(i); }
        });
    });
    texts.forEach(t => t.addEventListener("click", () => select(Number(t.dataset.i))));
    listRows.forEach(r => r.addEventListener("mouseenter", () => select(Number(r.dataset.i))));
    panel.querySelector(".mp-close").addEventListener("click", closeModeModal);

    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");

    if (!modeModalBound) {
        modeModalBound = true;
        modal.addEventListener("click", e => { if (e.target === modal) closeModeModal(); });
        document.addEventListener("keydown", e => {
            if (e.key === "Escape" && modal.style.display === "block") closeModeModal();
        });
    }
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

/* ======================================================
   TEAM MATHS (shared by the auto and manual builders)
   Elo's expected-score formula compares two ratings, so each team is
   represented by its AVERAGE rating (the same way the Elo engine does it).
====================================================== */
function teamStats(teamA, teamB) {
    const sum = team => team.reduce((s, p) => s + p.elo, 0);
    const eloA = sum(teamA);
    const eloB = sum(teamB);
    const avgA = eloA / teamA.length;
    const avgB = eloB / teamB.length;
    const probA = 1 / (1 + Math.pow(10, (avgB - avgA) / 400));
    return { eloA, eloB, avgA, avgB, probA, probB: 1 - probA };
}

function teamStatsHtml(t) {
    return `
        <div class="popup-section">
            <h3>ELO Totals</h3>
            <p>Team A: ${t.eloA.toFixed(2)} (avg ${t.avgA.toFixed(2)})<br>
               Team B: ${t.eloB.toFixed(2)} (avg ${t.avgB.toFixed(2)})<br>
               Difference: ${Math.abs(t.eloA - t.eloB).toFixed(2)} total / ${Math.abs(t.avgA - t.avgB).toFixed(2)} average</p>
        </div>

        <div class="popup-section">
            <h3>Win Probability</h3>
            <p>Team A: ${(t.probA * 100).toFixed(1)}%<br>
               Team B: ${(t.probB * 100).toFixed(1)}%</p>
        </div>`;
}


/* ======================================================
   TEAM LINEUP VIEW (mini cards joined by green lines)
   Used by both the auto and the manual builder popups.
====================================================== */
// Where the four cards sit inside a team's box, as % of its width / height.
const LINEUP_SPOTS = [[50, 19], [16, 47], [84, 47], [50, 75]];
const LINEUP_LINES = [[0, 1], [0, 2], [1, 3], [2, 3], [0, 3], [1, 2]];   // every card is joined to every other

/* ======================================================
   PLAYER CHEMISTRY (colours the lineup links)
   For every pair that has played on the same team: win rate together,
   nudged toward 50% for small samples, ranked against all other pairs
   and turned into a 57-99 rating (same idea as the mode ratings).
   Pairs with fewer than CHEM_MIN_GAMES maps stay grey.
====================================================== */
const CHEM_MIN_GAMES = 10;     // maps together before a pair gets a colour
const CHEM_SHRINK = 10;        // pulls small samples toward 50 %
let chemData = null, chemPromise = null;

const chemKey = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;
const chemBand = r => r < 65 ? "red" : r < 80 ? "amber" : r < 95 ? "green" : "purple";

function chemBuild(days) {
    const seen = new Set(), pairs = new Map();
    days.forEach(day => (day.maps || []).forEach(m => {
        if (!m || seen.has(m.mapId)) return;
        seen.add(m.mapId);
        const win = m.game && m.game.result && m.game.result.winningTeam;
        if (win !== 1 && win !== 2) return;
        [["A", 1], ["B", 2]].forEach(([k, w]) => {
            const ids = ((m.game.teams || {})[k] || []).map(p => Number(p.playerId));
            for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
                const key = chemKey(ids[i], ids[j]);
                const e = pairs.get(key) || { ids: [ids[i], ids[j]], games: 0, wins: 0 };
                e.games++; if (win === w) e.wins++;
                pairs.set(key, e);
            }
        });
    }));
    const list = [...pairs.values()].filter(e => e.games >= CHEM_MIN_GAMES);
    list.forEach(e => { e.value = (e.wins + 0.5 * CHEM_SHRINK) / (e.games + CHEM_SHRINK); });
    const pool = list.filter(e => !e.ids.some(id => INACTIVE_PLAYER_IDS.has(id))).map(e => e.value);
    list.forEach(e => { e.rating = Math.round(57 + 42 * percentile(e.value, pool)); e.band = chemBand(e.rating); });
    const out = new Map();
    list.forEach(e => out.set(chemKey(e.ids[0], e.ids[1]), e));
    return out;
}

function chemEnsure() {
    if (chemData) return Promise.resolve(chemData);
    if (!chemPromise) {
        chemPromise = (async () => {
            const index = await loadHistoryIndexForMonthly();
            const days = await Promise.all(index.map(loadHistoryDayForMonthly));
            chemData = chemBuild(days);
            return chemData;
        })().catch(err => { chemPromise = null; throw err; });
    }
    return chemPromise;
}

// each link runs between the middles of the two card edges that face each other
function lineupEdges() {
    document.querySelectorAll("#popupContent .lineup-board").forEach(board => {
        const card = board.querySelector(".lineup-card");
        if (!card || !board.offsetHeight) return;
        const hw = card.offsetWidth / 2 / board.offsetWidth * 100, hh = card.offsetHeight / 2 / board.offsetHeight * 100;
        // which edge of card i faces card j: T/B/L/R
        const EDGE = { "0-1": "LT", "0-2": "RT", "1-3": "BL", "2-3": "BR", "0-3": "BT", "1-2": "RL" };
        const pt = (i, e) => [LINEUP_SPOTS[i][0] + (e === "L" ? -hw : e === "R" ? hw : 0), LINEUP_SPOTS[i][1] + (e === "T" ? -hh : e === "B" ? hh : 0)];
        board.querySelectorAll(".lineup-lines line[data-i]").forEach(ln => {
            const i = +ln.dataset.i, j = +ln.dataset.j, e = EDGE[i + "-" + j];
            const [x1, y1] = pt(i, e[0]), [x2, y2] = pt(j, e[1]);
            ln.setAttribute("x1", x1); ln.setAttribute("y1", y1); ln.setAttribute("x2", x2); ln.setAttribute("y2", y2);
        });
    });
}

// paints every link, fills each badge (hidden until its link is clicked) and the team Chem figure
function chemApply() {
    document.querySelectorAll("#popupContent .lineup-team").forEach(team => {
        const ratings = [];
        team.querySelectorAll(".lineup-lines line[data-a]").forEach(ln => {
            const info = chemData && chemData.get(chemKey(+ln.dataset.a, +ln.dataset.b));
            ["chem-loading", "chem-none", "chem-red", "chem-amber", "chem-green", "chem-purple"].forEach(k => ln.classList.remove(k));
            ln.classList.add(info ? "chem-" + info.band : "chem-none");
            if (info) ratings.push(info.rating);
            const badge = team.querySelector(`.chem-badge[data-a="${ln.dataset.a}"][data-b="${ln.dataset.b}"]`);
            if (badge) {
                const shown = badge.classList.contains("show"), opened = badge.classList.contains("open");
                badge.className = "chem-badge" + (info ? " chem-" + info.band : " chem-none") + (shown ? " show" : "") + (opened ? " open" : "");
                badge.innerHTML = info ? `${info.rating}<small>${info.wins}-${info.games - info.wins}</small>` : "\u2013";
            }
        });
        const num = team.querySelector(".chem-team");
        if (num) {
            if (ratings.length >= 3) {
                const avg = Math.round(ratings.reduce((x, y) => x + y, 0) / ratings.length);
                num.textContent = avg; num.style.color = { red: "#ff4d4d", amber: "#ffb020", green: "#39ff6a", purple: "#A855F7" }[chemBand(avg)];
            } else { num.innerHTML = "&ndash;"; num.style.color = ""; }
        }
    });
}

// click a link to show its number; only one is open at a time, click it again or click away to close
document.addEventListener("click", e => {
    const bd = e.target.closest && e.target.closest("#popupContent .chem-badge");
    if (bd) { if (bd.querySelector("small")) bd.classList.toggle("open"); return; }   // click the number to see the win-loss
    const ln = e.target.closest && e.target.closest("#popupContent .lineup-lines line");
    const board = ln && ln.closest(".lineup-board");
    const a = ln && (ln.dataset.a || ln.dataset.pa), b = ln && (ln.dataset.b || ln.dataset.pb);
    const badge = board && board.parentNode.parentNode.querySelector(`.chem-badge[data-a="${a}"][data-b="${b}"]`);
    const wasOpen = badge && badge.classList.contains("show");
    document.querySelectorAll("#popupContent .chem-badge.show").forEach(el => el.classList.remove("show", "open"));
    document.querySelectorAll("#popupContent .lineup-lines line.sel").forEach(el => el.classList.remove("sel"));
    if (!badge || wasOpen) return;
    const x = (+ln.getAttribute("x1") + +ln.getAttribute("x2")) / 2, y = (+ln.getAttribute("y1") + +ln.getAttribute("y2")) / 2;
    badge.style.left = x + "%"; badge.style.top = y + "%";
    badge.classList.add("show");
    board.querySelectorAll(`.lineup-lines line[data-a="${a}"][data-b="${b}"]`).forEach(el => el.classList.add("sel"));
});

function teamLineupBlock(label, team, avg, prob, cls) {
    const lines = LINEUP_LINES.map(([a, b]) =>
        `<line class="chem-loading" data-i="${a}" data-j="${b}" data-a="${team[a].id}" data-b="${team[b].id}" x1="${LINEUP_SPOTS[a][0]}" y1="${LINEUP_SPOTS[a][1]}" x2="${LINEUP_SPOTS[b][0]}" y2="${LINEUP_SPOTS[b][1]}"></line>`).join("");
    const hits = LINEUP_LINES.map(([a, b]) =>
        `<line class="chem-hit" data-i="${a}" data-j="${b}" data-pa="${team[a].id}" data-pb="${team[b].id}" x1="${LINEUP_SPOTS[a][0]}" y1="${LINEUP_SPOTS[a][1]}" x2="${LINEUP_SPOTS[b][0]}" y2="${LINEUP_SPOTS[b][1]}"></line>`).join("");
    const badges = LINEUP_LINES.map(([a, b], i) => {
        const t = (a === 0 && b === 3) ? 0.3 : 0.5;   // the two long diagonals cross in the middle, so one badge moves up
        const x = LINEUP_SPOTS[a][0] + (LINEUP_SPOTS[b][0] - LINEUP_SPOTS[a][0]) * t, y = LINEUP_SPOTS[a][1] + (LINEUP_SPOTS[b][1] - LINEUP_SPOTS[a][1]) * t;
        return `<span class="chem-badge" data-i="${a}" data-j="${b}" data-a="${team[a].id}" data-b="${team[b].id}" style="left:${x}%; top:${y}%;"></span>`;
    }).join("");
    const cards = team.map((p, i) => `
        <div class="lineup-card" style="left:${LINEUP_SPOTS[i][0]}%; top:${LINEUP_SPOTS[i][1]}%;">
            <img src="cards/${p.id}_back.webp" alt="${p.name}" title="${p.name}" loading="eager" decoding="async">
            <img class="lineup-wings" src="wings.png" alt="">
            <span class="lineup-name">${p.name}</span>
        </div>`).join("");
    return `
        <div class="lineup-team ${cls}">
            <div class="lineup-title">${label}</div>
            <div class="lineup-board">
                <svg class="lineup-lines" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}${hits}</svg>
                ${badges}
                ${cards}
            </div>
            <div class="lineup-stats">
                <div><span class="lineup-num">${avg.toFixed(1)}</span><span class="lineup-cap">Avg Elo</span></div>
                <div><span class="lineup-num">${(prob * 100).toFixed(1)}%</span><span class="lineup-cap">Win</span></div>
                <div><span class="lineup-num chem-team">&ndash;</span><span class="lineup-cap">Chem</span></div>
            </div>
        </div>`;
}

function teamLineupHtml(teamA, teamB, t) {
    return `
        <div class="lineup-wrap">
            ${teamLineupBlock("Team A", teamA, t.avgA, t.probA, t.probA >= t.probB ? "lineup-fav" : "")}
            ${teamLineupBlock("Team B", teamB, t.avgB, t.probB, t.probB > t.probA ? "lineup-fav" : "")}
        </div>`;
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

    const stats = teamStats(best.teamA, best.teamB);
    const probA = stats.probA;
    const probB = stats.probB;

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
        ${teamLineupHtml(best.teamA, best.teamB, stats)}
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

    const ready = teamA.length === 4 && teamB.length === 4;
    document.getElementById("simulateMatchBtn").style.display = ready ? "inline-block" : "none";
}

document.querySelectorAll(".manual-select").forEach(sel => {
    sel.addEventListener("change", checkManualReady);
});

document.getElementById("simulateMatchBtn").addEventListener("click", () => {

    const teamAIds = [...document.querySelectorAll(".manualA")].map(s => Number(s.value));
    const teamBIds = [...document.querySelectorAll(".manualB")].map(s => Number(s.value));
    const allIds = [...teamAIds, ...teamBIds];
    if (allIds.some(id => !id) || new Set(allIds).size !== 8) {
        showPopup("<h2>Error</h2><p>Please select 8 different players.</p>");
        return;
    }

    const teamA = teamAIds.map(id => allPlayers.find(p => p.id === id));
    const teamB = teamBIds.map(id => allPlayers.find(p => p.id === id));

    const stats = teamStats(teamA, teamB);
    const probA = stats.probA;
    const probB = stats.probB;

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
        ${teamLineupHtml(teamA, teamB, stats)}
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
            const wasShown = document.getElementById(target) && document.getElementById(target).style.display === "block";

            pages.forEach(p => {
                p.style.display = (p.id === target) ? "block" : "none";
            });

            if (target === "leaderboardPage")        title.textContent = "LEADERBOARD";
            else if (target === "teamsPage")         title.textContent = "TEAMS";
            else if (target === "seriesHistoryPage") title.textContent = "HISTORY";
            else if (target === "comparisonsPage")   title.textContent = "COMPARISONS";
            else if (target === "mapsPage")          title.textContent = "MAPS";
            else if (target === "carouselPage")      title.textContent = "CARDS";

            if (target === "teamsPage") chemEnsure().catch(() => {});   // warm the chemistry data the first time Teams opens
            if (target === "carouselPage" && !wasShown && window.__cardsIntro) window.__cardsIntro();
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
    const response = await fetch(MAP_HISTORY_INDEX, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Unable to load map history (${response.status}).`);
    return normaliseHistoryIndex(await response.json());
}

async function loadHistoryDayForMonthly(dayInfo) {
    const dateKey = String(dayInfo.date);
    if (historyDayCache.has(dateKey)) return historyDayCache.get(dateKey);
    const fileName = dayInfo.file || `${dateKey}.json`;
    const response = await fetch(`${MAP_HISTORY_FOLDER}/${fileName}`, { cache: "no-cache" });
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

    // Download all days at the same time; they are still processed below in
    // index order, so the Elo sequence is unchanged.
    const loaded = await Promise.all(matchingDays.map(info => loadHistoryDayForMonthly(info)));
    const dayPayloads = matchingDays.map((info, i) => ({ date: info.date, payload: loaded[i] }));
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
    const response = await fetch(MAP_HISTORY_INDEX, { cache: "no-cache" });
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
    const response = await fetch(file, { cache: "no-cache" });
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
    snd: ["DEN", "GRIDLOCK", "RAID", "FRINGE", "SAKE", "HACIENDA", "EXPRESS"],
    overload: ["DEN", "EXPOSURE", "SCAR", "GRIDLOCK"]
};

// Maps that have a picture in the maps/ folder.
const MAP_PICTURES = new Set([
    "COLOSSUS", "DEN", "EXPOSURE", "EXPRESS", "FREQUENCY", "FRINGE",
    "GRIDLOCK", "HACIENDA", "RAID", "SAKE", "SCAR"
]);

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
        .map((entry, i) => {
            // Picture lives in maps/<name>.webp; entries like "POOL EXHAUSTED"
            // have no picture and fall back to the plain dark card.
            const hasPicture = MAP_PICTURES.has(entry.map);
            const style = hasPicture
                ? ` style="background-image: url('maps/${entry.map.toLowerCase()}.webp')"`
                : "";
            return `
            <div class="map-card${hasPicture ? " has-picture" : ""}"${style}>
                <span>MAP ${i + 1} — ${entry.mode.toUpperCase()}</span>
                <strong class="map-card-name">${entry.map}</strong>
            </div>
        `;
        })
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






























/* ======================================================
   TEAMS + MAPS ANIMATIONS
====================================================== */
(function () {
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const EASE_OUT = "cubic-bezier(.2,.8,.2,1)";
    const OVERSHOOT = "cubic-bezier(.34,1.56,.64,1)";

    function countUp(el, to, decimals, suffix, dur, delay) {
        const start = performance.now() + delay;
        el.textContent = (0).toFixed(decimals) + suffix;
        (function tick(now) {
            const t = Math.min(1, Math.max(0, (now - start) / dur));
            const e = 1 - Math.pow(1 - t, 3);
            el.textContent = (to * e).toFixed(decimals) + suffix;
            if (t < 1) requestAnimationFrame(tick);
        })(performance.now());
    }

    /* ---------- TEAMS ---------- */
    function playLineupFx() {
        if (reduce) return;
        const root = document.getElementById("popupContent");
        const popup = document.getElementById("popupCard");
        const wrap = root.querySelector(".lineup-wrap");
        if (!wrap) return;
        const teams = [...wrap.querySelectorAll(".lineup-team")];
        popup.classList.add("lineup-cine");

        // ---- 1. measure everything while the layout is still flat
        const plan = teams.map(team => {
            const board = team.querySelector(".lineup-board");
            const bb = board.getBoundingClientRect();
            const cards = [...team.querySelectorAll(".lineup-card")].map(c => {
                const r = c.getBoundingClientRect();
                return { c, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
            });
            return { team, board, bb, cards };
        });

        // ---- 2. dress the scene
        wrap.classList.add("scene");
        // static firing-range backdrop: flat full-body targets behind the table (not part of the camera move)
        const bdrop = document.createElement("div"); bdrop.className = "fx-backdrop";
        bdrop.innerHTML = "<div class='bd-in'>" + [[17, -1, .3], [50, -3, .33], [83, -1, .3]].map(([x, y, k]) =>
            `<div class="rm-stand bd-t" style="left:${x}%;top:${y}%;transform:translateX(-50%) scale(${k})"><i class='rs-glow'></i><i class='rs-cable'></i><i class='rs-carrier'></i><i class='rs-board'></i><i class='rs-win a'></i><i class='rs-win b'></i><i class='rs-paper'></i><i class='rs-clip a'></i><i class='rs-clip b'></i></div>`).join("") + "</div>";
        popup.insertBefore(bdrop, popup.firstChild);
        window.__lineupBackdrop = bdrop;
        // the table carries on past its front edge, so the edge nearest the camera never shows
        const tableExt = document.createElement("div"); tableExt.className = "fx-tableext"; wrap.insertBefore(tableExt, wrap.firstChild);
        { const g = document.createElement("img"); g.src = "gun.png"; g.className = "lineup-gun"; g.alt = ""; g.draggable = false; wrap.appendChild(g); }
        const vig = document.createElement("div"); vig.className = "fx-vignette"; wrap.appendChild(vig);
        const grain = document.createElement("div"); grain.className = "fx-grain"; popup.appendChild(grain);
        const barT = document.createElement("div"), barB = document.createElement("div");
        barT.className = "fx-bar top"; barB.className = "fx-bar bottom"; popup.append(barT, barB);

        // one card at a time: deal -> camera follows -> turn it over -> camera zooms out -> next card, left, right, left, right...
        // deal order: left top, right top, left outer, left inner, right inner, right outer, left bottom, right bottom
        // (slots: 0 top, 1 outer-side, 2 inner-side, 3 bottom; for the right team the slot positions mirror, so 1/2 swap)
        // (the two outer cards arrive together, then the two inner cards together)
        const DEAL_ORDER = [[0, 0], [1, 0], [0, 1], [1, 2], [0, 2], [1, 1], [0, 3], [1, 3]];
        const evOf = seq => seq < 2 ? seq : seq < 6 ? 2 + Math.floor((seq - 2) / 2) : seq - 2;   // 6 beats: L-top, R-top, outer pair, inner pair, L-bottom, R-bottom
        const dealIndex = (ti, i) => DEAL_ORDER.findIndex(([a, b]) => a === ti && b === i);
        const SLIDE0 = 580, CYCLE0 = 1200, START = 700, FLIP0 = 180, TURN0 = 60;
        // cards 3-6 (the middle four) are played at double speed; 1, 2, 7 and 8 keep the full-length treatment
        const spd = k => (k === 2 || k === 3) ? 0.5 : 1 / 1.2;   // pairs: double speed; the other four: 20 % faster
        const SLIDE_OF = k => SLIDE0 * spd(k), CYCLE_OF = k => CYCLE0 * spd(k), FLIP_OF = k => FLIP0 * spd(k), TURN_OF = k => TURN0 * spd(k);
        const dealAt = k => { let t = START + 150; for (let j = 0; j < k; j++) t += CYCLE_OF(j); return t; };
        const lastFlip = dealAt(5) + SLIDE_OF(5) + TURN_OF(5) + FLIP_OF(5) * 2;
        const RISE = lastFlip + 120, RISE_DUR = 1700;
        const done = RISE + RISE_DUR;
        window.__lineupDone = done;
        bdrop.animate([{ opacity: 1 }, { opacity: 1, offset: 0.97 }, { opacity: 0 }], { duration: done + 500, fill: "forwards" }).onfinish = () => bdrop.remove();

        // ---- 3. camera: wide shot -> follows the dealt card -> stays on it while it turns -> pulls back out -> next card
        wrap.style.transformOrigin = "50% 55%";
        const lerp = (x, y, t) => x + (y - x) * t;
        const wr0 = wrap.getBoundingClientRect();
        const wcx = wr0.left + wr0.width / 2, wcy = wr0.top + wr0.height / 2;
        const HW = wr0.width / 2, HH = wr0.height / 2;
        const cardsByDeal = [], evCards = [];
        plan.forEach((P, ti) => P.cards.forEach((K, i) => {
            (evCards[evOf(dealIndex(ti, i))] = evCards[evOf(dealIndex(ti, i))] || []).push({ nx: (K.cx - wcx) / HW, ny: (K.cy - wcy) / HH });
        }));
        evCards.forEach((list, e) => { cardsByDeal[e] = { nx: list.reduce((a, c) => a + c.nx, 0) / list.length, ny: list.reduce((a, c) => a + c.ny, 0) / list.length, pair: list.length > 1 }; });
        const _ch = plan[0].cards[0].h, _WH = wrap.offsetHeight;
        const DECK = { nx: 0, ny: ((_WH - _ch - 46) + _ch / 2 - _WH / 2) / (_WH / 2) };
        const smooth = u => u * u * (3 - 2 * u);
        const N = 300, dt = done / N, alpha = 1 - Math.exp(-dt / 95);
        let fx = 0, fy = 0, gz = 0;
        const camKeys = [];
        const bdKeys = [], bdIn = bdrop.firstChild;
        // projection helpers: how the table looks (tilt = far edge width / near edge width, and where its far edge sits) for a given camera
        const CW = wrap.offsetWidth, CH = wrap.offsetHeight;
        const project = (ty, tx, rx, sc) => {
            const m = new DOMMatrix(); m.m34 = -1 / 900;
            m.translateSelf(tx, ty, 0); m.rotateAxisAngleSelf(1, 0, 0, rx); m.scaleSelf(sc, sc, 1);
            const P = (x, y) => { const q = m.transformPoint(new DOMPoint(x, y, 0, 1)); return [q.x / q.w, q.y / q.w]; };
            const tl = P(-CW / 2, -CH * .55), tr = P(CW / 2, -CH * .55), bl = P(-CW / 2, CH * .45), br = P(CW / 2, CH * .45);
            return { ratio: (tr[0] - tl[0]) / (br[0] - bl[0]), top: (tl[1] + tr[1]) / 2 };
        };
        const pr0 = popup.getBoundingClientRect();
        const boardBottom = Math.min(...[...bdrop.querySelectorAll(".rs-board")].map(e => e.getBoundingClientRect().bottom)) - pr0.top;
        const bdOy = bdrop.offsetHeight * 0.3;
        const wideTop = project(66, 0, 57, 0.84).top;
        for (let i = 0; i <= N; i++) {
            const ms = done * i / N;
            let tx_ = 0, ty_ = 0, zt = 0;                       // target focus and target zoom (0 = wide, 1 = on the card)
            const rel = ms - dealAt(0);
            if (rel >= -250 && ms < RISE) {
                let k = 0; while (k < 5 && ms >= dealAt(k + 1)) k++;
                const u = ms - dealAt(k);                       // time inside this card's cycle
                const C = cardsByDeal[k];
                if (u < SLIDE_OF(k)) {                                // following the flying card
                    const p = 1 - Math.pow(1 - Math.max(0, u) / SLIDE_OF(k), 3.3);
                    tx_ = lerp(DECK.nx, C.nx, p); ty_ = lerp(DECK.ny, C.ny, p); zt = C.pair ? .4 : 1;
                } else if (u < SLIDE_OF(k) + TURN_OF(k) + FLIP_OF(k) * 2 + 40 * spd(k)) {  // staying on it while it turns over
                    tx_ = C.nx; ty_ = C.ny; zt = C.pair ? .4 : 1;
                } else { tx_ = 0; ty_ = 0; zt = 0; }            // pull back out to the wide shot
                if (u < 0 && k === 0 || (u < 0 && k > 0)) { tx_ = DECK.nx; ty_ = DECK.ny; zt = k === 0 ? 0.0 : 0; }
            }
            fx += (tx_ - fx) * alpha; fy += (ty_ - fy) * alpha;
            gz += (zt - gz) * (1 - Math.exp(-dt / 140));
            const g = ms < RISE ? gz : gz * Math.max(0, 1 - (ms - RISE) / 450);
            let ty, tx, rx, rz, ry, sc, ce = 0;
            if (ms <= RISE) {
                const t = ms / RISE;
                ty = lerp(66, 58, t); tx = 0; rx = lerp(57, 55, t); rz = 0; sc = lerp(0.84, 0.90, t); ry = 0;
            } else {
                const u = (ms - RISE) / RISE_DUR, e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; ce = e;
                ty = lerp(58, 0, e); tx = 0; rx = lerp(55, 0, e); rz = 0; sc = lerp(0.90, 1, e); ry = 0;
            }
            const b0 = { ty, tx, rx, sc };
            sc += .25 * g;
            tx += -fx * HW * .78 * g;
            ty += -fy * HH * .55 * g;
            
            
            
            // hold the table's apparent tilt while following: solve for the pitch that gives the same far/near ratio as the un-followed shot
            const refP = project(b0.ty, b0.tx, b0.rx, b0.sc);
            if (g > 0.0005) {
                let lo = rx - 14, hi = rx + 14;
                for (let it = 0; it < 14; it++) { const mid = (lo + hi) / 2; if (project(ty, tx, mid, sc).ratio > refP.ratio) lo = mid; else hi = mid; }
                rx = (lo + hi) / 2;
            }
            const curP = project(ty, tx, rx, sc);
            { const bs = 1 + (sc - 0.84) * 0.45;
              const bx = tx * 0.32, by = (curP.top - wideTop) - ce * 300 - (bs - 1) * (boardBottom - bdOy);
              bdKeys.push({ transform: i === N ? "translate(0px, -300px) scale(1)" : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${bs.toFixed(4)})`, offset: i / N }); }
            camKeys.push({ transform: i === N ? "none" : `perspective(900px) translateY(${ty.toFixed(2)}px) translateX(${tx.toFixed(2)}px) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg) rotateZ(${rz.toFixed(3)}deg) scale(${sc.toFixed(4)})`, offset: i / N });
        }
        bdIn.animate(bdKeys, { duration: done, easing: "linear", fill: "both" });
        tableExt.animate([{ opacity: 1 }, { opacity: 1, offset: RISE / done }, { opacity: 0, offset: Math.min(1, (RISE + RISE_DUR * 0.55) / done) }, { opacity: 0 }], { duration: done, fill: "forwards" });
        wrap.animate(camKeys, { duration: done, easing: "linear", fill: "backwards" }).onfinish = () => { wrap.style.transformOrigin = ""; };

        vig.animate([{ opacity: 1 }, { opacity: 1, offset: RISE / done }, { opacity: .35 }], { duration: done, fill: "forwards" });
        grain.animate([{ opacity: .22 }, { opacity: .22, offset: .8 }, { opacity: 0 }], { duration: done + 400, fill: "forwards" }).onfinish = () => grain.remove();
        [barT, barB].forEach((b, i) => {
            const dir = i ? 1 : -1;
            b.animate([{ transform: "translateY(0)" }, { transform: "translateY(0)", offset: RISE / (RISE + 900) }, { transform: `translateY(${dir * 100}%)` }],
                { duration: RISE + 900, easing: "ease-in-out", fill: "forwards" }).onfinish = () => b.remove();
        });
        wrap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: "backwards" });

        // ---- 4. one deck of 8 in the middle of the table; every card dealt comes off it
        const wr = wrap.getBoundingClientRect();
        const cw = plan[0].cards[0].w, ch = plan[0].cards[0].h;
        const WW = wrap.offsetWidth, WH = wrap.offsetHeight;
        const deckLeft = (WW - cw) / 2, deckTop = WH - ch - 46;
        const deckX = wr.left + deckLeft + cw / 2, deckY = wr.top + deckTop + ch / 2;
        const deck = document.createElement("div");
        deck.className = "fx-deck";
        deck.style.cssText = `position:absolute;left:${deckLeft}px;top:${deckTop}px;width:${cw}px;height:${ch}px;z-index:0;pointer-events:none;filter:blur(.8px)`;
        const layers = [];
        for (let k = 0; k < 8; k++) {
            const d = document.createElement("div");
            d.style.cssText = `position:absolute;inset:0;border-radius:6px;background:url('wings.png') center/cover,#08141a;box-shadow:0 ${1 + k * .8}px ${3 + k * 1.5}px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.22);transform:translate(${(k % 3 - 1) * .7}px,${-k * 1.8}px) rotate(${(k % 4 - 1.5) * .6}deg)`;
            deck.appendChild(d); layers.push(d);
        }
        wrap.appendChild(deck);
        deck.animate([{ translate: "0 80px", opacity: 0 }, { translate: "0 0", opacity: 1 }], { duration: 650, easing: EASE_OUT, fill: "backwards" });
        deck.animate([{ opacity: 1 }, { opacity: 1 }], { duration: dealAt(5) + 400 }).onfinish = () => deck.remove();   // removed once the last card has left

        plan.forEach((P, ti) => {
            const { team, board, bb, cards } = P;

            team.querySelector(".lineup-stats").animate([{ opacity: 0 }, { opacity: 0, offset: .99 }, { opacity: 1 }], { duration: done + 300, fill: "backwards" });
            team.querySelector(".lineup-title").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, delay: RISE + 200, fill: "both" });

            cards.forEach((K, i) => {
                const { c, cx, cy } = K;
                const img = c.querySelector("img:not(.lineup-wings)"), wings = c.querySelector(".lineup-wings"), name = c.querySelector(".lineup-name");
                wings.style.display = "block";
                const dealt = dealIndex(ti, i), ev = evOf(dealt);
                const dx = deckX - (cx + 14), dy = deckY - (cy + 14);
                const side = (i % 2 ? 1 : -1);
                const delay = dealAt(ev);
                layers[7 - dealt].animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1, delay, fill: "forwards" });   // the top card leaves the deck
                c.style.zIndex = 1 + i;
                // casino flick: the card is spun off the deck, skates flat across the felt and slows to a stop
                const frames = [], FN = 40, spin = side * (540 + dealt * 40);
                for (let f = 0; f <= FN; f++) {
                    const t = f / FN;
                    const p = f === FN ? 1 : 1 - Math.pow(1 - t, 3.3);
                    const q = f === FN ? 1 : 1 - Math.pow(1 - t, 2.4);
                    frames.push({
                        translate: `${(dx * (1 - p)).toFixed(2)}px ${(dy * (1 - p)).toFixed(2)}px`,
                        scale: "1",
                        rotate: `${(f === FN ? side * 2.5 : spin * (1 - q) + side * 2.5 * q).toFixed(2)}deg`,
                        filter: f === FN ? "blur(0px)" : `blur(${(2.4 * Math.max(0, 1 - t * 1.8)).toFixed(2)}px)`,
                        opacity: f === 0 ? 0 : 1,
                        offset: t
                    });
                }
                frames[1].opacity = 1;
                c.animate(frames, { duration: SLIDE_OF(ev), delay, easing: "linear", fill: "both" });
                // slap: a quick puff on the felt where it stops
                const puff = document.createElement("div");
                puff.style.cssText = `position:absolute;left:${LINEUP_SPOTS[i][0]}%;top:${LINEUP_SPOTS[i][1]}%;width:100px;height:30px;margin:-15px 0 0 -50px;border-radius:50%;background:radial-gradient(ellipse,rgba(255,255,255,.22),transparent 70%);opacity:0;pointer-events:none;z-index:0`;
                board.appendChild(puff);
                puff.animate([{ opacity: 0, scale: ".5" }, { opacity: 1, scale: "1", offset: .3 }, { opacity: 0, scale: "1.7" }], { duration: 600, delay: delay + SLIDE_OF(ev) * .5, easing: "ease-out", fill: "forwards" }).onfinish = () => puff.remove();
                // after it has stopped it lies a touch crooked, then squares up as the camera climbs
                c.animate([{ rotate: `${side * 2.5}deg` }, { rotate: "0deg" }], { duration: 900, delay: RISE + 100, easing: "ease-in-out", fill: "both" });
                // fake flip: wings fade out, player turns up
                const SL = SLIDE_OF(ev), FLIP = FLIP_OF(ev), fAt = delay + SL + TURN_OF(ev);
                c.animate([{ scale: "1", translate: "0 0" }, { scale: "1.17", translate: "0 -12px", offset: .5 }, { scale: "1", translate: "0 0" }], { duration: FLIP * 2, delay: fAt, easing: "ease-in-out" });
                wings.animate([{ scale: "1 1" }, { scale: "0 1" }], { duration: FLIP, delay: fAt, easing: "ease-in", fill: "both" }).onfinish = () => { wings.style.display = "none"; };
                img.animate([{ scale: "0 1" }, { scale: "1 1" }], { duration: FLIP, delay: fAt + FLIP, easing: "ease-out", fill: "backwards" });
                name.animate([{ opacity: 0, translate: "0 -8px", scale: ".8" }, { opacity: 1, translate: "0 0", scale: "1" }], { duration: 450, delay: lastFlip + 60 + dealt * 55, easing: EASE_OUT, fill: "both" });   // names only once all 8 are on the table
                // glint where it turns over
                const glint = document.createElement("div");
                glint.style.cssText = `position:absolute;left:${LINEUP_SPOTS[i][0]}%;top:${LINEUP_SPOTS[i][1]}%;width:80px;height:80px;margin:-40px 0 0 -40px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.9),rgba(0,234,255,.5) 40%,transparent 70%);opacity:0;pointer-events:none;mix-blend-mode:screen;z-index:0`;
                board.appendChild(glint);
                glint.animate([{ opacity: 0, scale: ".4" }, { opacity: 1, scale: "1.3", offset: .35 }, { opacity: 0, scale: "2" }], { duration: 650, delay: fAt + FLIP, easing: "ease-out", fill: "forwards" }).onfinish = () => glint.remove();
            });

            // lines + numbers once the camera has come up
            const base = RISE + RISE_DUR - 450 + ti * 120;
            team.querySelectorAll(".lineup-lines line").forEach((ln, i) => {
                const x1 = +ln.getAttribute("x1"), y1 = +ln.getAttribute("y1");
                const x2 = +ln.getAttribute("x2"), y2 = +ln.getAttribute("y2");
                ln.setAttribute("x2", x1); ln.setAttribute("y2", y1);
                const start = performance.now() + base + i * 150;
                (function tick(now) {
                    const t = Math.min(1, Math.max(0, (now - start) / 380));
                    const e = 1 - Math.pow(1 - t, 3);
                    ln.setAttribute("x2", x1 + (x2 - x1) * e);
                    ln.setAttribute("y2", y1 + (y2 - y1) * e);
                    if (t < 1) requestAnimationFrame(tick);
                })(performance.now());
            });
            const nums = team.querySelectorAll(".lineup-num");
            if (nums[0]) countUp(nums[0], parseFloat(nums[0].textContent), 1, "", 900, base + 500);
            if (nums[1]) countUp(nums[1], parseFloat(nums[1].textContent), 1, "%", 900, base + 500);
            if (team.classList.contains("lineup-fav")) {
                team.animate([
                    { boxShadow: "0 0 0 rgba(57,255,106,0)" },
                    { boxShadow: "0 0 30px rgba(57,255,106,.55)" },
                    { boxShadow: "0 0 14px rgba(57,255,106,.18)" }
                ], { duration: 900, delay: base + 1300, easing: "ease-out", fill: "backwards" });
            }
        });
    }
    const _showPopup = showPopup;
    showPopup = function (html) {
        _showPopup(html);
        try { lineupEdges(); } catch (e) { console.error(e); }
        try { playLineupFx(); } catch (e) { console.error(e); }
        if (document.querySelector("#popupContent .lineup-wrap")) chemEnsure().then(chemApply).catch(() => chemApply());
    };

    /* ---------- MAPS ---------- */
    const _renderSeries = renderSeries;
    renderSeries = function (count) {
        _renderSeries(count);
        if (reduce) return;
        const out = document.getElementById("mapSeries" + count);
        const names = [...MAP_PICTURES];
        out.querySelectorAll(".map-card").forEach((card, i) => {
            const nameEl = card.querySelector(".map-card-name");
            const finalName = nameEl.textContent;
            const finalBg = card.style.backgroundImage;
            const hadPic = card.classList.contains("has-picture");
            const land = 700 + i * 380;
            card.classList.add("has-picture");
            const spin = setInterval(() => {
                const n = names[Math.floor(Math.random() * names.length)];
                card.style.backgroundImage = `url('maps/${n.toLowerCase()}.webp')`;
                nameEl.textContent = n;
            }, 85);
            card.style.filter = "blur(2.5px) brightness(1.15)";
            setTimeout(() => {
                clearInterval(spin);
                card.style.filter = "";
                card.style.backgroundImage = finalBg;
                nameEl.textContent = finalName;
                if (!hadPic) card.classList.remove("has-picture");
                card.animate([
                    { scale: "1.12" }, { scale: "0.96", offset: 0.55 }, { scale: "1" }
                ], { duration: 420, easing: EASE_OUT });
                card.animate([
                    { boxShadow: "0 0 26px #00eaff" }, { boxShadow: "0 0 0 transparent" }
                ], { duration: 700, easing: "ease-out" });
            }, land);
        });
    };
})();

/* ======================================================
   LINEUP POPUP CLOSE BUTTON: a little wings card in the corner.
   Tapping it pulls all 8 cards into it, then the popup closes. Tapping the dark backdrop closes too.
====================================================== */
(function () {
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ORDER = [[0, 0], [1, 0], [0, 1], [0, 2], [1, 1], [1, 2], [0, 3], [1, 3]];
    const popup = () => document.getElementById("popupCard");
    let busy = false;

    const _show = showPopup;
    showPopup = function (html) {
        busy = false;
        popup().classList.remove("lineup-cine");
        popup().querySelectorAll(".fx-close").forEach(n => n.remove());
        popup().getAnimations().forEach(a => a.cancel());
        _show(html);
        if (!reduce && popup().querySelector(".lineup-wrap")) addButton();
    };

    function addButton() {
        const pop = popup();
        const b = document.createElement("button");
        b.type = "button";
        b.className = "fx-close fx-cardback";
        b.setAttribute("aria-label", "Close");
        b.innerHTML = "<span class='fx-mini'></span>";
        b.style.pointerEvents = "none";
        pop.appendChild(b);
        const IN = window.__lineupDone || 8000;             // arrives once the camera has finished its climb
        b.animate([{ opacity: 0, scale: ".3", rotate: "-90deg", easing: "linear" }, { opacity: 0, scale: ".3", rotate: "-90deg", offset: IN / (IN + 500), easing: "cubic-bezier(.3,1.4,.5,1)" }, { opacity: 1, scale: "1", rotate: "0deg" }],
            { duration: IN + 500, easing: "linear", fill: "both" }).onfinish = () => { b.style.pointerEvents = ""; };
        b.addEventListener("click", () => close(b));
    }

    function close(btn) {
        if (busy) return; busy = true;
        const pop = popup(), wrap = pop.querySelector(".lineup-wrap");
        const teams = [...wrap.querySelectorAll(".lineup-team")];
        const cards = ORDER.map(([ti, i]) => teams[ti].querySelectorAll(".lineup-card")[i]);
        const bb = btn.getBoundingClientRect(), target = { x: bb.left + bb.width / 2, y: bb.top + bb.height / 2 };
        wrap.querySelectorAll(".lineup-name, .lineup-stats, .lineup-lines, .lineup-title, .chem-badge").forEach(el =>
            el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" }));
        const dur = 600, stag = 80, t0 = 200, shrink = .12;
        cards.slice().reverse().forEach((c, n) => {
            const r = c.getBoundingClientRect();
            const dx = target.x - (r.left + r.width / 2), dy = target.y - (r.top + r.height / 2), side = n % 2 ? 1 : -1;
            c.animate([
                { translate: "0 0", scale: "1", rotate: "0deg", opacity: 1 },
                { translate: `${dx * .55}px ${dy * .55 - 30}px`, scale: String((1 + shrink) / 2 + .1), rotate: `${side * 14}deg`, opacity: 1, offset: .5 },
                { translate: `${dx}px ${dy}px`, scale: String(shrink), rotate: `${side * 24}deg`, opacity: 1 }
            ], { duration: dur, delay: t0 + n * stag, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" });
            c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, delay: t0 + n * stag + dur - 80, fill: "forwards" });
        });
        const T = t0 + 7 * stag + dur;
        btn.animate([{ scale: "1" }, { scale: "1.3", offset: .85 }, { scale: "0.2", opacity: 0 }], { duration: T + 200, easing: "ease-in-out", fill: "forwards" });
        pop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: T + 120, fill: "forwards" }).onfinish = () => {
            pop.getAnimations().forEach(a => a.cancel());
            pop.querySelectorAll(".fx-close").forEach(n => n.remove());
            document.getElementById("popupClose").click();
        };
    }

    // tapping the dark backdrop closes it at any time (the corner card only appears once the scene has settled)
    document.getElementById("popupOverlay").addEventListener("click", () => {
        if (popup().querySelector(".fx-close")) document.getElementById("popupClose").click();
    });
})();
