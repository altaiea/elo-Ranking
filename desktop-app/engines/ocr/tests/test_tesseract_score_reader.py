from codstats_ocr.tesseract_score_reader import _choose_reading


def test_tesseract_vote_selects_repeated_score():
    value, confidence = _choose_reading(["6", "", "6", "5", "6"], "Hardpoint")
    assert value == 6
    assert confidence == 0.75


def test_snd_rejects_values_above_six():
    value, confidence = _choose_reading(["8", "6", "6", "16"], "Search and Destroy")
    assert value == 6
    assert confidence == 1.0
