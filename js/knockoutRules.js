// ===============================
// CAPTAIN'S CUP (KNOCKOUT) RULES
// ===============================
// The rules and bracket maths for the monthly knockout. No page code, so the
// Three.js game (and a port in the parser) can use exactly the same numbers.
//
// How a month works:
//   - Tiers come from the PREVIOUS month's final Monthly Rankings (qualified
//     players only): Premier is ranks 1-6, then tiers of 4 (Swing, Challenger,
//     ...). One to three players left over join the last tier, which then gets
//     byes for its top seeds.
//   - Each tier is a tennis-seeded knockout: seeds 1 and 2 sit in opposite
//     halves, so they can only meet in the final.
//   - Every round before the final is played as 2x Bo5, 1x Bo7 or 1x Bo9
//     (captains' choice, Bo9 preferred) and must be done by the end of week 3.
//     The final is a Bo9 in the last week.
//   - Elo works as normal for everyone. In a cup series the two captains'
//     Elo changes are multiplied by 1.5 (wins and losses). Once a month a
//     captain can agree a wager with the other captain to make it 2x instead.
//   - The tier winner gets +20 Elo.

export const KNOCKOUT_RULES = {
    premierSize: 6,
    tierSize: 4,
    tierNames: ["Premier", "Swing", "Challenger"],
    captainMultiplier: 1.5,
    wagerMultiplier: 2,
    wagersPerCaptainPerMonth: 1,
    tierWinnerBonus: 20,
    earlyRoundFormats: ["2x Bo5", "1x Bo7", "1x Bo9"],
    preferredEarlyFormat: "1x Bo9",
    finalFormat: "1x Bo9",
    earlyRoundsDeadlineDay: 21   // end of week 3; the final is played from the 22nd
};

export const tierName = index => KNOCKOUT_RULES.tierNames[index] || `Tier ${index + 1}`;
export const tierKey = index => tierName(index).toLowerCase().replace(/[^a-z0-9]+/g, "-");

// "2026-11" -> "2026-10"
export function previousMonthKey(monthKey) {
    const [y, m] = String(monthKey).split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// rankedIds: player ids in final monthly-ranking order (qualified players only).
// Returns [{ index, key, name, playerIds }].
export function buildTiers(rankedIds, rules = KNOCKOUT_RULES) {
    const ids = rankedIds.map(Number);
    const groups = [];
    if (ids.length) groups.push(ids.slice(0, rules.premierSize));
    for (let i = rules.premierSize; i < ids.length; i += rules.tierSize) groups.push(ids.slice(i, i + rules.tierSize));
    // A short last group (1-3 players) joins the tier above it, unless that is Premier.
    const last = groups[groups.length - 1];
    if (groups.length > 2 && last.length < rules.tierSize) groups[groups.length - 2].push(...groups.pop());
    return groups.map((playerIds, index) => ({ index, key: tierKey(index), name: tierName(index), playerIds }));
}

// Slot order for a bracket of `size` (a power of two), tennis style:
// 4 -> [1,4,2,3], 8 -> [1,8,4,5,2,7,3,6]. The first half of the list is the
// top half of the draw.
export function seedOrder(size) {
    let order = [1];
    while (order.length < size) {
        const n = order.length * 2;
        order = order.flatMap(s => [s, n + 1 - s]);
    }
    return order;
}

const samePair = (a, b) => a.length === 2 && b.length === 2 &&
    ((a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]));

// Builds the rounds of one tier and fills in results.
// series: [{ captains: [idA, idB], winner: id, score?: [a, b], format?, multiplier? }]
// Returns { size, rounds: [[match...]...], champion } where a match is
// { round, index, slots: [{ seed, playerId } | null, ...], bye, series, winner }.
export function buildBracket(playerIds, series = []) {
    const n = playerIds.length;
    if (!n) return { size: 0, rounds: [], champion: null };
    let size = 1;
    while (size < n) size *= 2;
    const entry = seed => seed <= n ? { seed, playerId: Number(playerIds[seed - 1]) } : null;

    const rounds = [];
    let current = seedOrder(size).map(entry);
    if (size === 1) return { size, rounds: [], champion: current[0] };

    for (let round = 0; current.length > 1; round += 1) {
        const matches = [];
        const next = [];
        for (let i = 0; i < current.length; i += 2) {
            const slots = [current[i], current[i + 1]];
            const present = slots.filter(Boolean);
            const match = { round, index: i / 2, slots, bye: false, series: null, winner: null };
            if (present.length === 1 && round === 0) {
                // A seed with no opponent in the first round goes straight through.
                match.bye = true;
                match.winner = present[0];
            } else if (present.length === 2) {
                const pair = present.map(s => s.playerId);
                match.series = series.find(s => samePair((s.captains || []).map(Number), pair)) || null;
                const winnerId = Number(match.series?.winner);
                match.winner = present.find(s => s.playerId === winnerId) || null;
            }
            matches.push(match);
            next.push(match.winner);
        }
        rounds.push(matches);
        current = next;
    }
    return { size, rounds, champion: current[0] || null };
}

// Elo multiplier for a captain in a cup series (1.5 normally, 2 with a wager).
export function captainMultiplier(seriesEntry, rules = KNOCKOUT_RULES) {
    return seriesEntry?.wager ? rules.wagerMultiplier : rules.captainMultiplier;
}
