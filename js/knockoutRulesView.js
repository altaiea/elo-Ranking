/* ======================================================
   KNOCKOUT RULES (Rules button on the Knockout tab)
   The full rules, written from the numbers in js/knockoutRules.js so the
   page can never disagree with them.
====================================================== */
import { KNOCKOUT_RULES as R } from "./knockoutRules.js";
import { ordinal } from "./ui.js";
import { showKnockoutPanel } from "./knockoutPanels.js";

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
            <p>Every series is first to a majority: Bo9 first to 5, Bo7 first to 4, Bo5 first to 3. Once someone clinches, the series is over.</p>
            <p>For 2x Bo5 the maps from both sets are added together. Win both sets and you win the series. If the sets are split, it goes to mode aggregates: total HP points, total SND rounds and total Overload points across both sets. Win two of the three modes and you win. If the modes are still level, the bigger total margin across all maps decides it.</p>
            <p>The final is always a <b>${R.finalFormat.replace("1x ", "")}</b>.</p></section>
        <section><h4>4 · Deadlines</h4>
            <p>All rounds before the final must be finished by the end of week 3 (the ${ordinal(R.earlyRoundsDeadlineDay)}).</p>
            <p>The final is played in the last week, from the ${ordinal(R.earlyRoundsDeadlineDay + 1)} to the end of the month.</p></section>
        <section><h4>5 · Elo</h4>
            <p>Every map in a Cup series counts for Elo as normal, for every player.</p>
            <p>For the two <b>captains</b>, the whole series counts as one result. Their Elo changes from every map in the series are added together (both sets for 2x Bo5), and that series total is multiplied by <b>${R.captainMultiplier}x</b>, whether they win or lose.</p>
            <p>The winner of each tier's final is that tier's MVP and gets a <b>+${R.tierWinnerBonus} Elo</b> bonus.</p>
            <p><b>Nothing is created or lost.</b> The captains' extra is paid back by the other players in the series, shared by how many of its maps each played. The +${R.tierWinnerBonus} is split evenly across the rest of the winner's tier. The total Elo of everyone stays the same.</p></section>
        <section><h4>6 · Wager</h4>
            <p>Before any series, a captain can offer the other captain a wager. Only the two captains can wager, and only with each other.</p>
            <p>If both agree, their series total counts <b>${R.wagerMultiplier}x</b> instead of ${R.captainMultiplier}x. ${R.captainMultiplier}x is the default, and a wager is never forced on anyone.</p></section>
        <section><h4>7 · Knock-out Cards</h4>
            <p>Every player's Knock-out Card starts from zero. It only counts maps from Captain's Cup series and compares you with everyone else's Cup maps.</p>
            <p>Your normal card still counts every map, Cup maps included. The bottom left of the card shows the tier you fought in.</p></section>
        <section><h4>8 · Series MVP (the trophy)</h4>
            <p>Every map gives you a score out of 10 (6 is average, 8+ is a carry). It is <b>not Elo</b>. Half of it compares your KD and kills with <b>your own team</b>, half with <b>everyone in the lobby</b> (both teams). Winning or losing doesn't change it.</p>
            <p>Your series score is the average of your maps. The highest is the Series MVP and gets a trophy on their card.</p>
            <p><b>Example (SND):</b> Player 1 goes 9/5. Against their own team they carried: <b>8.5</b>. Against the whole lobby they were a bit above average: <b>6.5</b>. Half and half: <b>7.5</b> for that map.</p></section>
        <section><h4>9 · MVP questions</h4>
            <p><b>Is this Elo?</b><br>No. It never adds or takes away Elo. It's just a match rating.</p>
            <p><b>I won the series. Why am I not MVP?</b><br>Winning doesn't count. It's only about how well you played compared with the others.</p>
            <p><b>I had a good KD. Why is my score low?</b><br>It's relative. If your teammates or the lobby did even better, your score drops.</p>
            <p><b>Can one huge map win it?</b><br>Not on its own. It's your average across every map, so steady games win.</p>
            <p><b>What if two players tie?</b><br>Whoever played more maps in the series gets it.</p>
            <p><b>When do I get the trophy?</b><br>Once the series is finished. It shows on your card with how many you've won.</p>
            <p><b>Where can I see everyone's scores?</b><br>Open <b>History</b>, tap a series, then tap the <b>Series MVP</b> button.</p>
        </section>
    </div>`;
}

export function setupKnockoutRulesButton() {
    const button = document.getElementById("koRulesButton");
    const panel = document.getElementById("koRules");
    panel.innerHTML = rulesHtml();
    button.addEventListener("click", () => {
        showKnockoutPanel(panel.hidden ? "koRules" : null);
    });
}
