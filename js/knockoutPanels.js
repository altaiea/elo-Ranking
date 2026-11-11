const panels = ["koCards", "koRules", "koHistory"];

export function showKnockoutPanel(selected) {
    for (const id of panels) {
        const panel = document.getElementById(id);
        const button = document.getElementById(id + "Button");
        const active = id === selected;
        panel.hidden = !active;
        button.classList.toggle("active", active);
        button.setAttribute("aria-expanded", String(active));
    }
}
