// ===============================
// SITE SETTINGS
// ===============================
// Everything that changes when a player joins or a card is added lives here.
// No page code: the Three.js game can import this file as it is.

export const PLAYER_NAMES = {
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
    16: "SION",
    17: "HAMZ"
};

export function getPlayerName(id) {
    return PLAYER_NAMES[id] || "Player " + id;
}

// Players listed here remain fully viewable, but are excluded from percentile
// pools and from the ranking numbers.
export const INACTIVE_PLAYER_IDS = new Set([14]); // MASEEH

// IDs that always appear, even before the stats JSON includes them.
export const PLACEHOLDER_PLAYER_IDS = [15, 16, 17];
// Starting Elo for a placeholder that is not in the stats JSON yet (default 0).
// Must match the starting Elo set for that player in CODStats (stats.json).
export const PLACEHOLDER_STARTING_ELO = { 17: 925 }; // HAMZ

// Every player with a card, in carousel order.
export const CARD_PLAYER_IDS = Array.from({ length: 17 }, (_, i) => i + 1);

// Intro videos are PAUSED until the new intros are made (Nov 2026): cards open
// straight to the art with no video download or wait. Set this back to true to
// turn them on again; the list below says which players have one.
export const INTROS_ENABLED = false;

// Players whose intro video exists (cards/web/N_intro.mp4).
export const INTRO_PLAYER_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17]);

// Intro videos framed differently from the default (see style.css .video-N).
export const INTRO_VIDEO_CLASSES = { 2: "video-2", 3: "video-3", 5: "video-5" };

// Cards whose artwork has a see-through background and need the wings behind them.
// None since the new card template (Nov 2026): every card's art is fully painted.
export const CARDS_WITH_WINGS_UNDERLAY = new Set([]);

// Cards whose rating box sits on the right instead of the left.
// None since the new card template: the banner is top-left on every card.
export const DATE_BOX_RIGHT_SIDE = new Set([]);

// Web-sized copies made by tools/optimize_media.py. The originals stay in cards/.
export const cardAssets = {
    thumb: id => `cards/web/${id}_thumb.webp`,
    art: id => `cards/web/${id}_card.webp`,
    intro: id => INTROS_ENABLED && INTRO_PLAYER_IDS.has(Number(id)) ? `cards/web/${id}_intro.mp4` : null,
    streakFire: tier => `cards/streak/fire_${tier}.webp`,
    wings: "wings.webp",
    wingsThumb: "wings_thumb.webp",
    cardWings: "card_wings.webp",       // the wings that attach to the outside of a card (tools/make_card_wings.py)
    hands: "hands.webp",
    gun: "gun.webp"
};

// ===============================
// MAPS
// ===============================
export const MAP_POOL = {
    hardpoint: ["SAKE", "COLOSSUS", "DEN", "SCAR", "GRIDLOCK", "HACIENDA", "FREQUENCY"],
    snd: ["DEN", "GRIDLOCK", "RAID", "FRINGE", "SAKE", "HACIENDA", "EXPRESS"],
    overload: ["DEN", "EXPOSURE", "SCAR", "GRIDLOCK"]
};

// Maps that have a picture in the maps/ folder.
export const MAP_PICTURES = new Set([
    "COLOSSUS", "DEN", "EXPOSURE", "EXPRESS", "FREQUENCY", "FRINGE",
    "GRIDLOCK", "HACIENDA", "RAID", "SAKE", "SCAR"
]);

// Mode order for each map-set size.
export const MAP_SET_PATTERNS = {
    5: ["hardpoint", "snd", "overload", "hardpoint", "snd"],
    7: ["hardpoint", "snd", "overload", "hardpoint", "snd", "overload", "snd"],
    9: ["hardpoint", "snd", "overload", "hardpoint", "snd", "overload", "snd", "hardpoint", "snd"]
};

// ===============================
// GAME MODES
// ===============================
// prefix: the key prefix in current_stats.json (hpKills, sndWins, ...)
// marginScale: turns the stored 0-1 margin back into points / rounds / goals per map
export const MODES = [
    { name: "Hardpoint", prefix: "hp", marginScale: 250, unitLabel: "AVG POINTS / MAP" },
    { name: "Search & Destroy", prefix: "snd", marginScale: 6, unitLabel: "AVG ROUNDS / MAP" },
    { name: "Overload", prefix: "overload", marginScale: 8, unitLabel: "AVG GOALS / MAP" }
];

export const modeByPrefix = prefix => MODES.find(m => m.prefix === prefix);
