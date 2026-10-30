import json
from pathlib import Path

from codstats_ocr.scoreboard_parser import (
    Detection,
    _number_below,
    _registry_match,
    load_registry,
    match_player_id,
    locate_selected_player_region,
    locate_score_regions,
    parse_numeric_text,
    parse_overtime_text,
    parse_scoreboard_data,
)


ROOT = Path(__file__).resolve().parents[1]


def test_known_clear_frame():
    data = json.loads((ROOT / "tests" / "fixtures" / "clear_scoreboard_ocr.json").read_text(encoding="utf-8"))
    result = parse_scoreboard_data(data, load_registry(ROOT / "player_registry.json"))
    assert result["complete"] is True
    assert result["mode"]["value"] == "Hardpoint"
    assert result["teams"]["teamA"]["score"] == 218
    assert result["teams"]["teamB"]["score"] == 250
    assert [p["name"] for p in result["teams"]["teamA"]["players"]] == [
        "kazzi11", "CR7", "iShxdows", "Putin be Shootin"
    ]
    assert [p["name"] for p in result["teams"]["teamB"]["players"]] == [
        "Obey", "symbrrr", "Toji Fushiguro", "Hazza"
    ]
    assert result["selectedPlayer"]["id"] == "Putin be Shootin#5892567"
    assert result["selectedPlayer"]["eliminations"] == 28
    assert result["selectedPlayer"]["deaths"] == 32


def test_player_only_ocr_confusions():
    registry = load_registry(ROOT / "player_registry.json")
    cases = {
        "55 Kazzie": "kazzi11",
        "CR?": "CR7",
        "tepSymbrrr": "symbrrr",
        "Toji Fushigura": "Toji Fushiguro",
        "PutinbeShootin": "Putin be Shootin",
        "iShxd0ws": "iShxdows",
        "safy Apes": "safy_apex",
    }
    for observed, expected in cases.items():
        match = _registry_match(observed, registry)
        assert match is not None, observed
        assert match["name"] == expected, observed


def test_short_player_ids_use_visual_context_only_in_player_matching():
    registry = load_registry(ROOT / "player_registry.json")
    assert _registry_match("20", registry)["name"] == "zu"
    assert match_player_id("20#5870464", registry)["name"] == "zu"
    assert match_player_id("CR1#1364023", registry)["name"] == "CR7"
    assert parse_numeric_text("20") == (20, False)


def test_stat_columns_reject_ratio_and_allow_small_position_fallback():
    label = Detection("ELIMINATIONS", 1.0, (100, 100, 200, 120))
    ratio = Detection("1.11", 1.0, (130, 125, 175, 160))
    slightly_shifted = Detection("31", 0.95, (190, 130, 222, 160))
    assert _number_below([ratio, slightly_shifted], label) == slightly_shifted


def test_selected_hud_name_fallback_owns_stats_without_hash():
    registry = load_registry(ROOT / "player_registry.json")
    data = {
        "rec_texts": [
            "safy_apex", "Safy Apex", "ELIMINATIONS", "DEATHS",
            "20", "32", "ELIM/D RATIO", "0.63",
        ],
        "rec_scores": [0.99, 0.97, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
        "rec_boxes": [
            [510, 175, 590, 195],  # leaderboard occurrence: ineligible
            [185, 238, 250, 254],  # selected HUD occurrence
            [340, 230, 430, 247], [445, 230, 500, 247],
            [350, 250, 405, 287], [445, 250, 485, 287],
            [520, 230, 620, 247], [530, 250, 590, 287],
        ],
    }
    result = parse_scoreboard_data(data, registry)
    player = result["selectedPlayer"]
    assert player["name"] == "safy_apex"
    assert player["registryId"] == 13
    assert player["id"] == "safy_apex"
    assert player["identitySource"] == "selected_hud_name"
    assert player["fullIdResolved"] is False
    assert player["eliminations"] == 20
    assert player["deaths"] == 32


def test_numeric_corrections_are_isolated():
    assert parse_numeric_text("G") == (6, True)
    assert parse_numeric_text("I5") == (15, True)
    assert parse_numeric_text("2B") == (28, True)
    assert parse_numeric_text("PLAYER") == (None, False)


def test_selected_player_region_is_located_and_padded():
    data = json.loads((ROOT / "tests" / "fixtures" / "clear_scoreboard_ocr.json").read_text(encoding="utf-8"))
    box = locate_selected_player_region(data, (1080, 1920, 3))
    assert box is not None
    left, top, right, bottom = box
    # Clear fixture ID and the two stat values must all sit inside the lock.
    assert left < 356 and top < 546
    assert right > 1092 and bottom > 644


def test_overload_overtime_time_parsing():
    assert parse_overtime_text("1:23.4") == (83.4, "time")
    assert parse_overtime_text("O:45") == (45.0, "time")
    assert parse_overtime_text("-") == (None, "dnf")
    assert parse_overtime_text("DNF") == (None, "dnf")
    assert parse_overtime_text("PLAYER") == (None, None)


def test_overload_overtime_difference_without_normal_scores():
    data = {
        "rec_texts": ["CDL OVERLOAD", "GUILD", "0:45", "-", "JSOC",
                      "LEVELPLAYER", "LEVELPLAYER"],
        "rec_scores": [0.99, 0.99, 0.98, 0.95, 0.99, 0.99, 0.99],
        "rec_boxes": [
            [10, 10, 180, 35], [100, 100, 200, 140],
            [290, 100, 360, 140], [640, 100, 660, 140],
            [800, 100, 900, 140], [120, 200, 300, 230],
            [700, 200, 880, 230],
        ],
    }
    result = parse_scoreboard_data(data, [])
    assert result["mode"]["value"] == "Overload"
    assert result["modeScore"]["difference"] == 1
    assert result["modeScore"]["overtime"]["winner"] == "teamA"


def test_team_intro_screen_cannot_supply_a_score():
    data = {
        "rec_texts": ["CDL SEARCH AND DESTROY", "GUILD", "1", "6", "JSOC"],
        "rec_scores": [0.99] * 5,
        "rec_boxes": [
            [20, 20, 280, 50], [100, 100, 220, 140],
            [390, 100, 420, 140], [580, 100, 610, 140],
            [800, 100, 920, 140],
        ],
    }
    result = parse_scoreboard_data(data, [])
    assert result["mode"]["value"] == "Search and Destroy"
    assert result["leaderboardVisible"] is False
    assert result["teams"] is None
    assert result["modeScore"] is None


def test_score_regions_have_safe_centre_gap_without_team_anchors():
    left, right = locate_score_regions(
        {"rec_texts": [], "rec_scores": [], "rec_boxes": []},
        (1080, 1920, 3),
    )
    assert left == (749, 162, 941, 313)
    assert right == (979, 162, 1171, 313)
    assert left[2] < 960 < right[0]
