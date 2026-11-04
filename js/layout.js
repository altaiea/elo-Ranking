// ======================================================
// LAYOUT: side menu, and the bottom bar on phones
// ======================================================
// The site keeps a fixed 1100px canvas (meta viewport), so on a phone everything
// is drawn small. The bottom bar and page header are sized to the phone's real
// width and zoomed up so they read like a phone app.

export function setupLayout() {
    const html = document.documentElement;
    const rail = document.getElementById("rail");
    const head = document.getElementById("pageHead");
    if (!rail) return;
    const fit = () => {
        const sw = screen.width, phone = sw <= 700 && innerWidth > sw * 1.2;
        html.classList.toggle("is-phone", phone);
        rail.style.width = phone ? sw + "px" : "";
        rail.style.zoom = phone ? String(innerWidth / sw) : "";
        if (head) head.style.zoom = phone ? String(Math.min(2.2, innerWidth / sw)) : "";
    };
    fit();
    addEventListener("resize", fit);
}
