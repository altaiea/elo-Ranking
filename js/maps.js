/* ======================================================
   MAPS TAB: random map sets
   5 maps: no map repeats at all.
   7 / 9 maps: no map repeats within the same mode.
====================================================== */
import { MAP_PICTURES, MAP_POOL, MAP_SET_PATTERNS } from "./config.js";
import { reduceMotion } from "./ui.js";

const EASE_OUT = "cubic-bezier(.2,.8,.2,1)";

export function generateMapSet(count) {
    const pattern = MAP_SET_PATTERNS[count] || [];
    const usedByMode = { hardpoint: new Set(), snd: new Set(), overload: new Set() };
    const usedGlobal = new Set();

    return pattern.map(modeKey => {
        const pool = MAP_POOL[modeKey];
        if (!pool || pool.length === 0) return { mode: modeKey, map: "NO MAPS IN POOL" };
        const available = count === 5
            ? pool.filter(m => !usedGlobal.has(m))
            : pool.filter(m => !usedByMode[modeKey].has(m));
        if (available.length === 0) return { mode: modeKey, map: "POOL EXHAUSTED" };
        const chosen = available[Math.floor(Math.random() * available.length)];
        usedByMode[modeKey].add(chosen);
        usedGlobal.add(chosen);
        return { mode: modeKey, map: chosen };
    });
}

const pictureUrl = name => `url('maps/${name.toLowerCase()}.webp')`;

function renderMapSet(count) {
    const output = document.getElementById(`mapSeries${count}`);
    output.innerHTML = generateMapSet(count).map((entry, i) => {
        // Entries like "POOL EXHAUSTED" have no picture and keep the plain dark card.
        const hasPicture = MAP_PICTURES.has(entry.map);
        const style = hasPicture ? ` style="background-image: ${pictureUrl(entry.map)}"` : "";
        return `
            <div class="map-card${hasPicture ? " has-picture" : ""}"${style}>
                <span>MAP ${i + 1} — ${entry.mode.toUpperCase()}</span>
                <strong class="map-card-name">${entry.map}</strong>
            </div>`;
    }).join("");
    if (!reduceMotion()) spinCards(output);
}

// Slot-machine reveal: each card flicks through random maps, then lands on its own.
function spinCards(output) {
    const names = [...MAP_PICTURES];
    output.querySelectorAll(".map-card").forEach((card, i) => {
        const nameEl = card.querySelector(".map-card-name");
        const finalName = nameEl.textContent;
        const finalBg = card.style.backgroundImage;
        const hadPic = card.classList.contains("has-picture");
        card.classList.add("has-picture");
        const spin = setInterval(() => {
            const n = names[Math.floor(Math.random() * names.length)];
            card.style.backgroundImage = pictureUrl(n);
            nameEl.textContent = n;
        }, 85);
        card.style.filter = "blur(2.5px) brightness(1.15)";
        setTimeout(() => {
            clearInterval(spin);
            card.style.filter = "";
            card.style.backgroundImage = finalBg;
            nameEl.textContent = finalName;
            if (!hadPic) card.classList.remove("has-picture");
            card.animate([{ scale: "1.12" }, { scale: "0.96", offset: 0.55 }, { scale: "1" }], { duration: 420, easing: EASE_OUT });
            card.animate([{ boxShadow: "0 0 26px #00eaff" }, { boxShadow: "0 0 0 transparent" }], { duration: 700, easing: "ease-out" });
        }, 700 + i * 380);
    });
}

export function setupMaps() {
    document.querySelectorAll(".map-series-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const count = parseInt(btn.dataset.count, 10);
            const loader = document.getElementById("mapLoading");
            loader.style.display = "block";
            document.getElementById(`mapSeries${count}`).innerHTML = "";
            setTimeout(() => {
                loader.style.display = "none";
                renderMapSet(count);
            }, 600); // smooth delay
        });
    });
}
