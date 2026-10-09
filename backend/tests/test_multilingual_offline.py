import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.search.multilingual import (
    normalize_query,
    encode_multilingual_query,
    get_multilingual_config,
    detect_query_language
)


def test_language_detection():
    assert detect_query_language("man in red jacket")[1] == "en"
    assert detect_query_language("लाल शर्ट में आदमी")[1] == "hi"
    assert detect_query_language("લાલ શર્ટમાં માણસ")[1] == "gu"
    assert detect_query_language("kaala backpack leke ladka")[1] == "hi-Latn"
    assert detect_query_language("laal jacket valo maanas gate pase")[1] == "gu-Latn"


def test_hindi_neural_translation():
    res = normalize_query("लाल शर्ट में आदमी")
    norm = res[0]
    assert "red" in norm.lower()
    assert "shirt" in norm.lower()
    assert res.details["detected_language"] == "Hindi"
    assert res.details["is_multilingual"] is True


def test_gujarati_normalization():
    res = normalize_query("સફેદ કાર ગેટ 3 પાસે")
    norm = res[0]
    assert "white" in norm.lower()
    assert "car" in norm.lower()
    assert "gate" in norm.lower()
    assert res.details["detected_language"] == "Gujarati"
    assert res.details["is_multilingual"] is True


def test_hinglish_normalization():
    res = normalize_query("kaala backpack leke ladka")
    norm = res[0]
    assert "black" in norm.lower()
    assert "backpack" in norm.lower() or "bag" in norm.lower()
    assert "boy" in norm.lower()


def test_multilingual_embedding():
    res = normalize_query("लाल शर्ट में आदमी")
    vec = encode_multilingual_query("लाल शर्ट में आदमी", res[0], target_dim=512)
    assert vec is not None
    assert len(vec) == 512


def test_multilingual_config():
    cfg = get_multilingual_config()
    assert cfg["backend"] == "offline_ai"
    assert cfg["offline_models_available"] is True
    assert "offline_ai" in cfg["available_backends"]


if __name__ == "__main__":
    test_language_detection()
    print("Language detection passed!")
    test_hindi_neural_translation()
    print("Hindi neural translation passed!")
    test_gujarati_normalization()
    print("Gujarati normalization passed!")
    test_hinglish_normalization()
    print("Hinglish normalization passed!")
    test_multilingual_embedding()
    print("Multilingual embedding passed!")
    test_multilingual_config()
    print("Multilingual config passed!")
    print("ALL TESTS PASSED SUCCESSFULLY!")
