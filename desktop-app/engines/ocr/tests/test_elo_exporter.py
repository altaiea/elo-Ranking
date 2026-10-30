from codstats_ocr.elo_exporter import build_elo_document, convert_game


def _result(mode="Hardpoint", score_a=218, score_b=250):
    players = []
    for registry_id in range(1, 9):
        players.append({
            "team": "teamA" if registry_id <= 4 else "teamB",
            "registryId": registry_id,
            "eliminations": registry_id + 10,
            "deaths": registry_id + 5,
        })
    return {
        "source": "1.mp4",
        "mode": {"value": mode},
        "modeScore": {
            "teamA": score_a,
            "teamB": score_b,
            "difference": score_a - score_b,
            "overtime": None,
        },
        "players": players,
    }


def test_team_b_win_exports_positive_difference():
    game = convert_game(_result())
    assert game["result"]["winningTeam"] == 2
    assert game["result"]["scoreDifference"] == 32
    assert len(game["teams"]["A"]) == 4
    assert len(game["teams"]["B"]) == 4


def test_search_and_destroy_exports_as_snd():
    game = convert_game(_result("Search and Destroy", 3, 6))
    assert game["gameMode"] == "SND"
    assert game["result"]["winningTeam"] == 2
    assert game["result"]["scoreDifference"] == 3


def test_overload_overtime_matches_java_importer():
    result = _result("Overload", 7, 7)
    result["modeScore"]["overtime"] = {
        "active": True,
        "teamA": {"seconds": 44.0},
        "teamB": {"seconds": None},
        "winner": "teamA",
    }
    game = convert_game(result)
    assert game["result"] == {
        "type": "overtime",
        "overtime": {"teamA": "0:44", "teamB": "DNF"},
        "winningTeam": 1,
        "scoreDifference": 1,
    }


def test_document_has_required_wrapper():
    document, skipped = build_elo_document([_result()], "2026-09-09")
    assert skipped == []
    assert document["schemaVersion"] == 1
    assert document["date"] == "2026-09-09"
    assert len(document["games"]) == 1
