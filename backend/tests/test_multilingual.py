"""Hindi / Gujarati / Hinglish query normalisation for search and the Copilot."""

import pytest

from app.search.multilingual import normalize_query


@pytest.mark.parametrize("query, expected", [
    ("laal gaadi", "red car"),
    ("kaala maanas gate paas", "black man gate near"),
    ("peeli riksha", "yellow rickshaw"),
    # Devanagari / Gujarati words ending in a vowel sign (previously never matched)
    ("लाल गाड़ी", "red car"),
    ("लाल गाडी", "red car"),
    ("सफेद कार", "white car"),
    ("नीली बाइक", "blue motorcycle"),
    ("લાલ ગાડી", "red car"),
    ("પીળી રિક્ષા", "yellow rickshaw"),
])
def test_translates(query, expected):
    assert normalize_query(query)[0] == expected


@pytest.mark.parametrize("query", [
    "pass the bus",           # English "pass" must not become "near"
    "man in a red jacket",
    "white car near the station",
])
def test_english_is_untouched(query):
    normalized, substitutions = normalize_query(query)
    assert normalized == query and substitutions == []


def test_does_not_match_inside_longer_words():
    # "lal" is a dictionary word, but must not be replaced inside "lalit"
    assert normalize_query("lalit")[0] == "lalit"
