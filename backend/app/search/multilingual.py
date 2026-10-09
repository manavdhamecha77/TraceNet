from __future__ import annotations

import os
import re
import json
import urllib.request
import urllib.error
from typing import Optional, Tuple, List, Dict, Any
from loguru import logger

from app.config import get_data_path

# Active multilingual backend setting: "offline_ai" (default), "dictionary", "openrouter"
_ACTIVE_BACKEND = "offline_ai"

# ---------------------------------------------------------------------------
# Lazy-Loaded Offline Neural Model Singletons
# ---------------------------------------------------------------------------
_TRANSLATION_MODEL = None
_TRANSLATION_TOKENIZER = None
_MULTILINGUAL_CLIP_MODEL = None


def get_offline_translation_model() -> Tuple[Any, Any]:
    """
    Lazy-load local offline MarianMT neural translation model (Hindi -> English).
    Model is located absolutely inside backend/data/models/translation_hi_en.
    """
    global _TRANSLATION_MODEL, _TRANSLATION_TOKENIZER
    if _TRANSLATION_MODEL is not None and _TRANSLATION_TOKENIZER is not None:
        return _TRANSLATION_MODEL, _TRANSLATION_TOKENIZER

    model_dir = get_data_path("models/translation_hi_en")
    if not os.path.exists(model_dir):
        logger.warning(f"Offline translation model path '{model_dir}' not found.")
        return None, None

    try:
        from transformers import MarianMTModel, MarianTokenizer
        logger.info(f"Loading offline neural translation model from {model_dir}...")
        _TRANSLATION_TOKENIZER = MarianTokenizer.from_pretrained(model_dir)
        _TRANSLATION_MODEL = MarianMTModel.from_pretrained(model_dir)
        _TRANSLATION_MODEL.eval()
        logger.info("Offline neural translation model loaded successfully.")
        return _TRANSLATION_MODEL, _TRANSLATION_TOKENIZER
    except Exception as exc:
        logger.error(f"Failed to load offline translation model: {exc}")
        return None, None


def get_offline_multilingual_clip():
    """
    Lazy-load local offline Multilingual CLIP SentenceTransformer model.
    Model is located absolutely inside backend/data/models/multilingual_clip.
    Embeds 50+ languages directly into the 512-dim OpenAI CLIP vector space.
    """
    global _MULTILINGUAL_CLIP_MODEL
    if _MULTILINGUAL_CLIP_MODEL is not None:
        return _MULTILINGUAL_CLIP_MODEL

    model_dir = get_data_path("models/multilingual_clip")
    if not os.path.exists(model_dir):
        logger.warning(f"Offline multilingual CLIP model path '{model_dir}' not found.")
        return None

    try:
        from sentence_transformers import SentenceTransformer
        logger.info(f"Loading offline multilingual CLIP model from {model_dir}...")
        _MULTILINGUAL_CLIP_MODEL = SentenceTransformer(model_dir)
        logger.info("Offline multilingual CLIP model loaded successfully.")
        return _MULTILINGUAL_CLIP_MODEL
    except Exception as exc:
        logger.error(f"Failed to load offline multilingual CLIP model: {exc}")
        return None


# ---------------------------------------------------------------------------
# Unicode Script & Language Detection
# ---------------------------------------------------------------------------
_DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")
_GUJARATI_RE = re.compile(r"[\u0A80-\u0AFF]")
_BENGALI_RE = re.compile(r"[\u0980-\u09FF]")
_TAMIL_RE = re.compile(r"[\u0B80-\u0BFF]")
_TELUGU_RE = re.compile(r"[\u0C00-\u0C7F]")
_URDU_ARABIC_RE = re.compile(r"[\u0600-\u06FF]")

# Common transliterated / phonetic keywords for Hinglish & Gujlish detection
_INDIC_PHONETIC_MARKERS = {
    "laal", "lal", "laali", "kalo", "kala", "kali", "kaala", "kaali",
    "safed", "chitta", "dholo", "dholi", "peela", "peeli", "pilo", "pili",
    "neela", "neeli", "nilo", "nili", "lilo", "lili", "hara", "hari",
    "gaadi", "gadi", "scooty", "riksha", "tempo", "chhokra", "chokro", "chokri",
    "maanas", "manas", "aadmi", "admi", "aurat", "mahila", "stree", "ladka", "ladki",
    "kurta", "pajama", "topi", "chashma", "dupatta", "ghaghra", "saree", "sari",
    "jhola", "thela", "theli", "valo", "wala", "wali", "wale", "walo",
    "paas", "pase", "najik", "laine", "leke", "ubho", "ubha", "khada", "khadi",
    "besto", "daudto", "bhaagto", "chori"
}


def detect_query_language(text: str) -> Tuple[str, str, bool]:
    """
    Detect language, ISO code, and whether the query is multilingual.
    Returns: (language_name, lang_code, is_multilingual)
    """
    clean = text.strip()
    if not clean:
        return "English", "en", False

    if _GUJARATI_RE.search(clean):
        return "Gujarati", "gu", True
    if _DEVANAGARI_RE.search(clean):
        return "Hindi", "hi", True
    if _BENGALI_RE.search(clean):
        return "Bengali", "bn", True
    if _TAMIL_RE.search(clean):
        return "Tamil", "ta", True
    if _TELUGU_RE.search(clean):
        return "Telugu", "te", True
    if _URDU_ARABIC_RE.search(clean):
        return "Urdu", "ur", True

    # Check for Romanized Indian scripts (Hinglish / Gujlish)
    words = re.findall(r"\b[a-zA-Z]+\b", clean.lower())
    indic_hits = sum(1 for w in words if w in _INDIC_PHONETIC_MARKERS)
    if indic_hits >= 1:
        # Check specific Gujarati markers vs Hindi markers
        gu_markers = {"maanas", "chokro", "chokri", "dholo", "dholi", "lilo", "pilo", "pase", "valo", "laine", "ubho", "besto"}
        if any(w in gu_markers for w in words):
            return "Gujlish", "gu-Latn", True
        return "Hinglish", "hi-Latn", True

    return "English", "en", False


# ---------------------------------------------------------------------------
# Comprehensive Forensic CCTV Translation & Normalization Dictionary
# Covers Colors, Vehicles, Apparel, People, Actions, and Spatial Relations
# ---------------------------------------------------------------------------
_FORENSIC_DICT: Dict[str, str] = {
    # ── Colors: Hinglish / Gujlish / Phonetic
    "laal": "red", "lal": "red", "laali": "red", "laalo": "red",
    "kaala": "black", "kala": "black", "kali": "black", "kaali": "black", "kalo": "black",
    "safed": "white", "chitta": "white", "chitti": "white", "dholo": "white", "dholi": "white", "dholu": "white",
    "neela": "blue", "nila": "blue", "neeli": "blue", "nili": "blue", "nilo": "blue", "vadli": "blue",
    "peela": "yellow", "pila": "yellow", "peeli": "yellow", "pili": "yellow", "peelo": "yellow", "pilo": "yellow",
    "hara": "green", "hari": "green", "hare": "green", "lilo": "green", "lili": "green", "lilu": "green",
    "gulabi": "pink", "gulabee": "pink",
    "bhura": "brown", "bhuri": "brown", "bhure": "brown", "bhuro": "brown", "bhurak": "brown",
    "narangi": "orange", "kesari": "orange", "bhagwa": "orange",
    "jamuni": "purple", "jambli": "purple", "jambu": "purple",
    "slaty": "gray", "slethi": "gray", "gray": "gray", "grey": "gray",
    "sunehra": "yellow", "soneri": "yellow",

    # ── Colors: Native Devanagari (Hindi)
    "लाल": "red", "काला": "black", "काली": "black", "काले": "black",
    "सफेद": "white", "सफ़ेद": "white", "चिट्टा": "white",
    "नीला": "blue", "नीली": "blue", "नीले": "blue",
    "पीला": "yellow", "पीली": "yellow", "पीले": "yellow",
    "हरा": "green", "हरी": "green", "हरे": "green",
    "गुलाबी": "pink",
    "भूरा": "brown", "भूरे": "brown", "भूरी": "brown",
    "नारंगी": "orange", "केसरी": "orange", "भगवा": "orange",
    "जामुनी": "purple", "बैंगनी": "purple",
    "स्लेटी": "gray", "धूसर": "gray",

    # ── Colors: Native Gujarati
    "લાલ": "red", "કાળો": "black", "કાળી": "black", "કાળું": "black",
    "સફેદ": "white", "ધોળો": "white", "ધોળી": "white", "ધોળું": "white",
    "નીલો": "blue", "વાદળી": "blue", "ભૂરો": "blue",
    "પીળો": "yellow", "પીળી": "yellow", "પીળું": "yellow",
    "લીલો": "green", "લીલી": "green", "લીલું": "green",
    "ગુલાબી": "pink", "જાંબલી": "purple", "નારંગી": "orange", "કેસરી": "orange",

    # ── Vehicles: Phonetic
    "gaadi": "car", "gadi": "car", "chadi": "car", "motor": "car", "gaddian": "car",
    "bike": "motorcycle", "bik": "motorcycle", "motorcycle": "motorcycle",
    "scooty": "scooter", "scuty": "scooter", "scooter": "scooter", "activa": "scooter", "jupiter": "scooter",
    "riksha": "rickshaw", "rickshaw": "rickshaw", "auto": "rickshaw", "auto-rickshaw": "rickshaw",
    "tempo": "tempo", "chhakdo": "auto",
    "truck": "truck", "truk": "truck", "lorry": "truck",
    "bus": "bus",
    "cycle": "bicycle", "saikal": "bicycle",
    "chaar-paiyo": "car", "char-paiya": "car",

    # ── Vehicles: Native Devanagari
    "कार": "car", "गाड़ी": "car", "गाडी": "car", "मोटर": "car", "वाहन": "vehicle",
    "बाइक": "motorcycle", "मोटरसाइकिल": "motorcycle",
    "स्कूटर": "scooter", "स्कूटी": "scooter", "एक्टिवा": "scooter",
    "रिक्शा": "rickshaw", "रिक्शावाला": "rickshaw", "ऑटो": "rickshaw", "ऑटोरिक्शा": "rickshaw",
    "टेम्पो": "tempo", "ट्रक": "truck", "बस": "bus", "साइकिल": "bicycle", "साइकल": "bicycle",

    # ── Vehicles: Native Gujarati
    "ગાડી": "car", "કાર": "car", "મોટર": "car",
    "બાઇક": "motorcycle", "મોટરસાઇકલ": "motorcycle",
    "સ્કૂટર": "scooter", "સ્કૂટી": "scooter", "એક્ટિવા": "scooter",
    "રિક્ષા": "rickshaw", "ઓટો": "rickshaw", "ટેમ્પો": "tempo",
    "ટ્રક": "truck", "બસ": "bus", "સાયકલ": "bicycle",

    # ── People / Pronouns: Phonetic
    "aadmi": "man", "admi": "man", "maanas": "man", "manas": "man", "purush": "man",
    "aurat": "woman", "mahila": "woman", "stree": "woman", "bai": "woman", "bae": "woman",
    "ladka": "boy", "larka": "boy", "chokro": "boy", "chhokra": "boy", "chokra": "boy",
    "ladki": "girl", "larki": "girl", "chokri": "girl", "chhokri": "girl",
    "vyakti": "person", "shakhs": "person", "banda": "person", "koi": "someone",
    "baccha": "child", "bacha": "child", "bachi": "child", "balak": "child",

    # ── People: Native Devanagari
    "आदमी": "man", "व्यक्ति": "person", "पुरुष": "man", "बंदा": "person",
    "औरत": "woman", "महिला": "woman", "स्त्री": "woman",
    "लड़का": "boy", "लडका": "boy", "लड़की": "girl", "लडकी": "girl",
    "बच्चा": "child", "बालक": "child",

    # ── People: Native Gujarati
    "માણસ": "man", "પુરુષ": "man", "વ્યક્તિ": "person",
    "સ્ત્રી": "woman", "મહિલા": "woman",
    "છોકરો": "boy", "છોકરી": "girl", "બાળક": "child",

    # ── Clothing / Apparel: Phonetic
    "kurta": "kurta", "kurti": "kurta",
    "pajama": "pants", "payjama": "pants", "pant": "pants", "patloon": "pants", "jeans": "jeans",
    "topi": "cap", "topy": "cap", "pagdi": "turban", "pagri": "turban",
    "chashma": "glasses", "chashme": "glasses", "goggles": "glasses",
    "dupatta": "scarf", "chunni": "scarf",
    "jacket": "jacket", "hoodie": "hoodie", "sweater": "sweater", "kot": "coat",
    "shirt": "shirt", "t-shirt": "t-shirt", "tshirt": "t-shirt",
    "saree": "saree", "sari": "saree", "ghaghra": "skirt", "dress": "dress",
    "backpack": "backpack", "bag": "bag", "jhola": "bag", "jholo": "bag", "theli": "bag", "thela": "bag",

    # ── Clothing: Native Devanagari
    "शर्ट": "shirt", "कमीज": "shirt", "टी-शर्ट": "t-shirt", "टीशर्ट": "t-shirt",
    "पैंट": "pants", "पेंट": "pants", "पतलून": "pants", "जींस": "jeans",
    "कुर्ता": "kurta", "कुर्ती": "kurta", "पजामा": "pants", "पायजामा": "pants",
    "टोपी": "cap", "चश्मा": "glasses", "चश्मे": "glasses",
    "जैकेट": "jacket", "हुडी": "hoodie", "स्वेटर": "sweater",
    "दुपट्टा": "scarf", "चुन्नी": "scarf", "साड़ी": "saree", "साड़ी": "saree", "घाघरा": "skirt",
    "बैग": "bag", "थैला": "bag", "झोला": "bag", "बैकपैक": "backpack",

    # ── Clothing: Native Gujarati
    "શર્ટ": "shirt", "ટી-શર્ટ": "t-shirt",
    "પેન્ટ": "pants", "જીન્સ": "jeans", "ચોરણો": "pants",
    "કુર્તો": "kurta", "પાયજામો": "pants", "ટોપી": "cap", "ચશ્મા": "glasses",
    "જેકેટ": "jacket", "હૂડી": "hoodie", "સ્વેટર": "sweater",
    "દુપટ્ટો": "scarf", "સાડી": "saree", "ઘાઘરો": "skirt",
    "બેગ": "bag", "થેલો": "bag", "ઝોલો": "bag", "બેકપેક": "backpack",

    # ── Actions / Context: Phonetic
    "pehne": "wearing", "pehna": "wearing", "pehna hua": "wearing",
    "paherelo": "wearing", "pahereli": "wearing", "paheri": "wearing",
    "leke": "carrying", "laine": "carrying", "uthaye": "carrying", "pakde": "holding",
    "daudta": "running", "daudto": "running", "bhaagta": "running", "bhaagto": "running",
    "ubho": "standing", "ubha": "standing", "khada": "standing", "khadi": "standing",
    "besto": "sitting", "baitha": "sitting", "baithi": "sitting",
    "chori": "theft", "snatching": "theft snatching", "bhagyo": "fled",

    # ── Actions: Native Devanagari
    "पहने": "wearing", "पहने हुए": "wearing", "पहनी": "wearing",
    "लिए": "carrying", "लेकर": "carrying", "पकड़े": "holding",
    "दौड़ता": "running", "भागता": "running", "दौड़ता": "running",
    "खड़ा": "standing", "खड़ी": "standing", "बैठा": "sitting", "बैठी": "sitting",
    "चोरी": "theft", "झपटमारी": "snatching",

    # ── Actions: Native Gujarati
    "પહેરેલો": "wearing", "પહેરેલી": "wearing", "પહેરી": "wearing",
    "લઈને": "carrying", "દોડતો": "running", "ભાગતો": "running",
    "ઉભો": "standing", "ઉભી": "standing", "બેઠો": "sitting", "બેઠી": "sitting",
    "ચોરી": "theft",

    # ── Location & Spatial Relations: Phonetic & Native
    "gate": "gate", "get": "gate", "darwaza": "gate", "darwajo": "gate",
    "paas": "near", "pase": "near", "pass": "near", "najik": "near", "samne": "in front of", "piche": "behind",
    "pehele": "before", "pahele": "before", "pachhi": "after", "baad": "after",
    "saanje": "evening", "saam": "evening", "shaam": "evening", "savare": "morning", "subah": "morning",
    "ગેટ": "gate", "પાસે": "near", "નજીક": "near", "સામે": "in front of", "પાછળ": "behind",
    "સવારે": "morning", "સાંજે": "evening",
    "गेट": "gate", "पास": "near", "नजदीक": "near", "सामने": "in front of", "पीछे": "behind",
    "सुबह": "morning", "शाम": "evening",
}

# Separate Latin keys (which use \b word boundary) and Unicode keys (which use direct phrase matching)
_LATIN_KEYS = [k for k in _FORENSIC_DICT.keys() if k.isascii()]
_UNICODE_KEYS = [k for k in _FORENSIC_DICT.keys() if not k.isascii()]

_LATIN_PATTERN = re.compile(
    r"\b(" + "|".join(map(re.escape, sorted(_LATIN_KEYS, key=len, reverse=True))) + r")\b",
    re.IGNORECASE
)

def _openrouter_key() -> str:
    """OPENROUTER_API_KEY from backend/.env (or the process environment). Never accepted over the API."""
    from app.config import get_settings

    return (get_settings().openrouter_api_key or os.environ.get("OPENROUTER_API_KEY", "")).strip()

_UNICODE_PATTERN = re.compile(
    r"(" + "|".join(map(re.escape, sorted(_UNICODE_KEYS, key=len, reverse=True))) + r")",
    re.UNICODE
)


class NormalizationResult(tuple):
    """
    Subclass of tuple (normalized_str, substitutions_list) for 100% backwards
    compatibility with legacy unpackers: `normalized, subs = normalize_query(q)`.
    Also provides .details attribute with language detection and audit metadata.
    """
    def __new__(cls, normalized: str, substitutions: List[str], details: Optional[Dict[str, Any]] = None):
        return super().__new__(cls, (normalized, substitutions))

    def __init__(self, normalized: str, substitutions: List[str], details: Optional[Dict[str, Any]] = None):
        self.normalized = normalized
        self.substitutions = substitutions
        self.details = details or {}


def _clean_translated_text(text: str) -> str:
    """Post-clean generated translation text for forensic CLIP alignment."""
    t = text.strip()
    # Normalize excessive punctuation or trailing periods
    t = re.sub(r"[\.!?\n\r]+$", "", t)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def normalize_with_dictionary(query: str) -> NormalizationResult:
    """Normalize query using forensic domain lexical substitutions."""
    substitutions: List[str] = []

    def replace_unicode(match):
        raw = match.group(0)
        replacement = _FORENSIC_DICT.get(raw, raw)
        if replacement != raw:
            substitutions.append(f"{raw}->{replacement}")
        return replacement

    def replace_latin(match):
        raw = match.group(0)
        word = raw.lower()
        replacement = _FORENSIC_DICT.get(word, raw)
        if replacement.lower() != word:
            substitutions.append(f"{raw}->{replacement}")
        return replacement

    # 1. Replace non-ASCII Unicode tokens first
    normalized = _UNICODE_PATTERN.sub(replace_unicode, query)
    # 2. Replace Latin tokens with word boundary
    normalized = _LATIN_PATTERN.sub(replace_latin, normalized)
    # 3. Remove filler words in Hinglish/Gujlish like "valo", "wala", "wali", "ma", "me", "ke", "na", "ane", "aur"
    normalized = re.sub(r"\b(valo|wala|wali|wale|walo|ma|me|ke|ki|ka|na|ne|no|ni|nu|ane|aur|hai|che|chhe)\b", " ", normalized, flags=re.I)
    normalized = re.sub(r"\s+", " ", normalized).strip()

    lang_name, lang_code, is_multi = detect_query_language(query)
    details = {
        "original_query": query,
        "normalized_query": normalized,
        "detected_language": lang_name,
        "language_code": lang_code,
        "is_multilingual": is_multi,
        "backend_used": "offline_dictionary",
    }
    return NormalizationResult(normalized, substitutions, details)


def normalize_query(query: str, backend: str = "offline_ai") -> NormalizationResult:
    """
    Multilingual query normalization engine.
    Supports:
    - 'offline_ai' (default): Local offline MarianMT neural translation for Hindi +
                              specialized offline forensic lexical engine for Gujarati / Hinglish.
    - 'dictionary': Direct rule/dictionary replacement.
    - 'openrouter': Cloud LLM translation via OpenRouter API (if configured).
    """
    global _ACTIVE_BACKEND
    actual_backend = backend if backend not in ("", "default") else _ACTIVE_BACKEND

    lang_name, lang_code, is_multi = detect_query_language(query)

    # 1. English queries pass through with zero modification
    if not is_multi and lang_code == "en":
        details = {
            "original_query": query,
            "normalized_query": query,
            "detected_language": "English",
            "language_code": "en",
            "is_multilingual": False,
            "backend_used": "pass-through",
        }
        return NormalizationResult(query, [], details)

    # 2. OpenRouter backend (if explicitly selected and key is present)
    if actual_backend == "openrouter":
        api_key = _openrouter_key()
        if api_key:
            try:
                req = urllib.request.Request(
                    "https://openrouter.ai/api/v1/chat/completions",
                    data=json.dumps({
                        "model": "meta-llama/llama-3.2-3b-instruct:free",
                        "messages": [
                            {
                                "role": "system",
                                "content": "You are a forensic CCTV search assistant. Translate this CCTV search query from Hindi, Gujarati, Hinglish, or Gujlish to concise English. Preserve colors, clothing, vehicle types, gates, and spatial markers. Output ONLY the English translation."
                            },
                            {
                                "role": "user",
                                "content": f"Query: {query}"
                            }
                        ]
                    }).encode("utf-8"),
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://tracenet-erakshak.local"
                    }
                )
                with urllib.request.urlopen(req, timeout=6) as response:
                    resp_data = json.loads(response.read().decode("utf-8"))
                    translated = resp_data["choices"][0]["message"]["content"].strip()
                    cleaned = _clean_translated_text(translated)
                    details = {
                        "original_query": query,
                        "normalized_query": cleaned,
                        "detected_language": lang_name,
                        "language_code": lang_code,
                        "is_multilingual": True,
                        "backend_used": "openrouter_cloud",
                    }
                    return NormalizationResult(cleaned, ["[OpenRouter neural translated]"], details)
            except Exception as e:
                logger.warning(f"OpenRouter translation failed ({e}); falling back to offline AI engine.")

    # 3. Offline AI Engine (Default & Recommended)
    if actual_backend in ("offline_ai", "openrouter"):
        # Hindi Devanagari -> Use offline neural MarianMT model
        if lang_code == "hi" or _DEVANAGARI_RE.search(query):
            tr_model, tr_tok = get_offline_translation_model()
            if tr_model is not None and tr_tok is not None:
                try:
                    # Pre-clean known transliterated loanwords before neural translation
                    prepped = query
                    for loan, target in [("टी-शर्ट", "t-shirt"), ("टीशर्ट", "t-shirt"), ("जींस", "jeans"), ("हुडी", "hoodie")]:
                        prepped = prepped.replace(loan, target)

                    inputs = tr_tok([prepped], return_tensors="pt", truncation=True, max_length=128)
                    outputs = tr_model.generate(**inputs, max_length=128, num_beams=2)
                    decoded = tr_tok.batch_decode(outputs, skip_special_tokens=True)
                    if decoded and decoded[0].strip():
                        translated_text = _clean_translated_text(decoded[0])
                        # Remove leading "A / The" if followed by forensic terms
                        translated_text = re.sub(r"^(The|A|An)\s+", "", translated_text, flags=re.I)
                        details = {
                            "original_query": query,
                            "normalized_query": translated_text,
                            "detected_language": "Hindi",
                            "language_code": "hi",
                            "is_multilingual": True,
                            "backend_used": "offline_neural_marianmt",
                        }
                        return NormalizationResult(
                            translated_text,
                            [f"Offline Neural Model: '{query}' -> '{translated_text}'"],
                            details
                        )
                except Exception as exc:
                    logger.error(f"Neural translation execution error: {exc}. Falling back to lexical.")

        # Gujarati script, Hinglish, Gujlish, or fallback -> Offline Lexical & Phrasal Normalizer
        lex_res = normalize_with_dictionary(query)
        lex_res.details["backend_used"] = "offline_lexical_engine"
        return lex_res

    # 4. Fallback to dictionary
    return normalize_with_dictionary(query)


def encode_multilingual_query(
    original_query: str,
    normalized_query: str,
    target_dim: int = 512,
) -> Optional[List[float]]:
    """
    Encode query using the offline Multilingual CLIP model.
    If original query is multilingual and target dimension matches 512,
    blends the multilingual vector with the English CLIP embedding for
    optimal semantic precision and forensic attribute alignment.
    """
    if target_dim != 512:
        # If active model dimension is not 512 (e.g. 768 or 1024), return None
        # so query engine encodes normalized English query with the primary active encoder.
        return None

    lang_name, lang_code, is_multi = detect_query_language(original_query)
    if not is_multi:
        return None

    multi_clip = get_offline_multilingual_clip()
    if multi_clip is None:
        return None

    try:
        import numpy as np
        # 1. Embed original query in multilingual space
        v_multi = np.array(multi_clip.encode(original_query), dtype=np.float32)
        v_multi /= np.linalg.norm(v_multi) + 1e-12

        # 2. If we have a clean English normalized translation, embed that too and blend
        if normalized_query and normalized_query.lower() != original_query.lower():
            v_eng = np.array(multi_clip.encode(normalized_query), dtype=np.float32)
            v_eng /= np.linalg.norm(v_eng) + 1e-12
            # 60% multilingual semantic weight + 40% English attribute alignment weight
            v_blended = 0.60 * v_multi + 0.40 * v_eng
            v_blended /= np.linalg.norm(v_blended) + 1e-12
            return v_blended.tolist()

        return v_multi.tolist()
    except Exception as exc:
        logger.error(f"Failed to encode with multilingual CLIP: {exc}")
        return None


def get_multilingual_config() -> Dict[str, Any]:
    """Retrieve active multilingual search engine configuration and model health."""
    tr_path = get_data_path("models/translation_hi_en")
    clip_path = get_data_path("models/multilingual_clip")
    has_offline = os.path.exists(tr_path) and os.path.exists(clip_path)

    return {
        "backend": _ACTIVE_BACKEND,
        "available_backends": ["offline_ai", "dictionary", "openrouter"],
        "openrouter_configured": bool(_openrouter_key()),
        "offline_models_available": has_offline,
        "offline_translation_model": "Helsinki-NLP/opus-mt-hi-en" if os.path.exists(tr_path) else None,
        "offline_multilingual_clip": "sentence-transformers/clip-ViT-B-32-multilingual-v1" if os.path.exists(clip_path) else None,
    }


def set_multilingual_backend(backend: str) -> None:
    """Set active multilingual backend."""
    global _ACTIVE_BACKEND
    if backend not in ("offline_ai", "dictionary", "openrouter"):
        raise ValueError("Invalid backend. Must be 'offline_ai', 'dictionary', or 'openrouter'.")
    _ACTIVE_BACKEND = backend
