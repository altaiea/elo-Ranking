from codstats_ocr.review import set_overtime_result, set_standard_score


def test_manual_standard_score_preserves_signed_internal_difference():
    result = {"modeScore": {"teamAName": "GUILD", "teamBName": "JSOC"}}
    set_standard_score(result, 1, 6)
    assert result["modeScore"]["teamA"] == 1
    assert result["modeScore"]["teamB"] == 6
    assert result["modeScore"]["difference"] == -5
    assert result["modeScore"]["manuallyValidated"] is True


def test_manual_overtime_uses_lower_time_and_dnf():
    result = {"modeScore": {"teamAName": "GUILD", "teamBName": "JSOC"}}
    set_overtime_result(result, "DNF", "0:44")
    overtime = result["modeScore"]["overtime"]
    assert overtime["winner"] == "teamB"
    assert overtime["difference"] == -1
    assert overtime["teamA"]["raw"] == "DNF"
    assert overtime["teamB"]["seconds"] == 44.0
