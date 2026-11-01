/* ======================================================
   KNOCKOUT RULES (Rules button on the Knockout tab)
   The full rules, written from the numbers in js/knockoutRules.js so the
   page can never disagree with them.
====================================================== */
import { KNOCKOUT_RULES as R } from "./knockoutRules.js";
import { ordinal } from "./ui.js";

function rulesHtml() {
    const tierList = R.tierNames.map((name, i) => {
        const from = i === 0 ? 1 : R.premierSize + (i - 1) * R.tierSize + 1;
        const to = i === 0 ? R.premierSize : from + R.tierSize - 1;
        return `<b>${name}</b> ranks ${from}–${to}`;
    }).join(", ");
    return `
    <div class="ko-rules-grid">
        <section><h4>1 · Who plays where</h4>
            <p>On the 1st of every month, the previous month's final Monthly Rankings set the tiers. Only qualified players count (at least 10 maps that month).</p>
            <p>${tierList}. If more players qualify, each extra group of ${R.tierSize} makes a new tier. One to three players left over join the last tier.</p>
            <p>The monthly table in the top right shows exactly why everyone is where they are.</p></section>
        <section><h4>2 · The draw</h4>
            <p>Seeds follow the monthly rank inside each tier. Seeds 1 and 2 go in opposite halves, so they can only meet in the final.</p>
            <p>In a six-player tier, seeds 1 and 2 get a bye to the semi-finals while 3 v 6 and 4 v 5 play round 1. A four-player tier starts at the semi-finals: 1 v 4 and 2 v 3.</p></section>
        <section><h4>3 · Series formats</h4>
            <p>Every round before the final is played as one of: <b>${R.earlyRoundFormats.join("</b>, <b>")}</b>. The two captains agree which. ${R.preferredEarlyFormat.replace("1x ", "")} is preferred; the others are there for anyone who can't fit nine maps into one night.</p>
            <p>For 2x Bo5 the maps from both sets are added together.</p>
            <p>The final is always a <b>${R.finalFormat.replace("1x ", "")}</b>.</p></section>
        <section><h4>4 · Deadlines</h4>
            <p>All rounds before the final must be finished by the end of week 3 (the ${ordinal(R.earlyRoundsDeadlineDay)}).</p>
            <p>The final is played in the last week, from the ${ordinal(R.earlyRoundsDeadlineDay + 1)} to the end of the month.</p></section>
        <section><h4>5 · Elo</h4>
            <p>Every map in a Cup series counts for Elo as normal, for every player.</p>
            <p>The two <b>captains</b> play for more: their Elo change on each map is multiplied by <b>${R.captainMultiplier}x</b>, for wins and for losses.</p>
            <p>The winner of each tier's final is that tier's MVP and gets a <b>+${R.tierWinnerBonus} Elo</b> bonus.</p></section>
        <section><h4>6 · Wager</h4>
            <p>Once a month, a captain can offer the other captain a wager before their series starts. If both agree, the captains play for <b>${R.wagerMultiplier}x</b> instead of ${R.captainMultiplier}x for that whole series.</p>
            <p>${R.captainMultiplier}x is the default. A wager is never forced on anyone.</p></section>
        <section><h4>7 · Knock-out Cards</h4>
            <p>Every player's Knock-out Card starts from zero. It only counts maps from Captain's Cup series and compares you with everyone else's Cup maps.</p>
            <p>Your normal card still counts every map, Cup maps included. The bottom left of the card shows the tier you fought in.</p></section>
    </div>`;
}

export function setupKnockoutRulesButton() {
    const button = document.getElementById("koRulesButton");
    const panel = document.getElementById("koRules");
    panel.innerHTML = rulesHtml();
    button.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        button.classList.toggle("active", !panel.hidden);
        button.setAttribute("aria-expanded", String(!panel.hidden));
    });
}
