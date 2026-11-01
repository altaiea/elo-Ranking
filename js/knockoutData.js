// ===============================
// CAPTAIN'S CUP DATA
// ===============================
// Reads knockout/index.json and knockout/YYYY-MM.json (see knockout/README.md).
// Kept apart from js/data.js so the existing site code is untouched.
// No page code, so the Three.js game can import it too.

// A month with no file yet simply has no results.
export async function loadKnockoutMonth(monthKey) {
    if (!/^\d{4}-\d{2}$/.test(String(monthKey))) return { series: [] };
    const response = await fetch(`knockout/${monthKey}.json`, { cache: "no-cache" });
    if (response.status === 404) return { series: [] };
    if (!response.ok) throw new Error(`Could not load knockout/${monthKey}.json (HTTP ${response.status})`);
    const data = await response.json();
    return { ...data, series: Array.isArray(data?.series) ? data.series : [] };
}

// Months with a results file: knockout/index.json is { "months": ["2026-11", ...] }.
export async function loadKnockoutMonths() {
    const response = await fetch("knockout/index.json", { cache: "no-cache" });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`Could not load knockout/index.json (HTTP ${response.status})`);
    return ((await response.json())?.months || []).filter(m => /^\d{4}-\d{2}$/.test(String(m))).sort();
}

// Every month's file: [{ month, tiers?, series: [...] }].
export async function loadAllKnockoutMonths() {
    const months = await loadKnockoutMonths();
    const files = await Promise.all(months.map(month => loadKnockoutMonth(month).catch(() => ({ series: [] }))));
    return files.map((file, i) => ({ ...file, month: months[i] }));
}
