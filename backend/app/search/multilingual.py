import os
import re
import json
import urllib.request
import urllib.error

_ACTIVE_BACKEND = "dictionary"

# Phonetic and unicode translation dictionary
_DICT = {
    # Colors
    "laal": "red", "lal": "red", "laali": "red",
    "kaala": "black", "kali": "black", "kalo": "black",
    "safed": "white", "chitta": "white", "dholo": "white", "dholi": "white",
    "neela": "blue", "nila": "blue", "nilo": "blue",
    "peela": "yellow", "pila": "yellow", "pilo": "yellow",
    "hara": "green", "hari": "green", "lilo": "green", "lili": "green",
    "gulabi": "pink",
    "bhura": "brown", "bhurak": "brown",
    "narangi": "orange", "kesari": "orange",
    "jamuni": "purple", "jambli": "purple",
    "sunehra": "yellow", "sona": "yellow",
    
    # Vehicle words
    "gaadi": "car", "gadi": "car", "chadi": "car",
    "bike": "motorcycle", "bik": "motorcycle",
    "scooty": "scooter", "scuty": "scooter",
    "riksha": "rickshaw", "rickshaw": "rickshaw",
    "tempo": "tempo",
    "truck": "truck", "truk": "truck",
    "bus": "bus",
    "chaar-paiyo": "four-wheeler", "char-paiya": "four-wheeler",
    
    # Clothing/apparel
    "kurta": "kurta",
    "pajama": "pants", "payjama": "pants",
    "topi": "cap", "topy": "cap",
    "chashma": "glasses",
    "dupatta": "scarf",
    "jacket": "jacket",
    "shirt": "shirt",
    "patloon": "pants",
    "ghaghra": "skirt",
    "saree": "saree", "sari": "saree",
    
    # Actions/context
    "daudto": "running", "daudta": "running", "daudti": "running", "bhaagto": "running", "bhaagta": "running",
    "ubho": "standing", "ubha": "standing",
    "besto": "sitting", "bestha": "sitting",
    "laine": "carrying", "lai ne": "carrying", "leke": "carrying",
    
    # Person pronouns
    "maanas": "man", "manas": "man",
    "aurat": "woman", "bai": "woman", "bae": "woman",
    "chokro": "boy", "chhokra": "boy",
    "chhokri": "girl", "chokri": "girl",
    
    # Location/time
    "gate": "gate",
    "paas": "near", "pase": "near", "pass": "near",
    "pehele": "before", "pahele": "before",
    "pachhi": "after", "baad": "after",
    "saanje": "evening", "saaj": "evening",
    "aathe": "morning", "savaare": "morning", "savare": "morning",
    
    # Gujarati native script
    "\u0aaa\u0ac0\u0ab3\u0acb": "yellow",  # પીળો
    "\u0a95\u0abe\u0ab3\u0acb": "black",   # કાળો
    "\u0ab2\u0abe\u0ab2": "red",            # લાલ
    "\u0ab8\u0aab\u0ac7\u0aa6": "white",    # સફેદ
    "\u0aa8\u0ac0\u0ab2\u0acb": "blue",     # નીલો
    "\u0ab2\u0ac0\u0ab2\u0acb": "green",    # લીલો
    "\u0a97\u0abe\u0aa1\u0ac0": "car",      # ગાડી
    "\u0a95\u0abe\u0ab0": "car",            # કાર
    "\u0aae\u0abe\u0aa3\u0ab8": "man",      # માણસ
    "\u0ab8\u0acd\u0aa4\u0acd\u0ab0\u0ac0": "woman", # સ્ત્રી
    "\u0aaa\u0abe\u0ab8\u0ac7": "near",     # પાસે
    "\u0aa8\u0a9c\u0ac0\u0a95": "near",     # નજીક
    "\u0a97\u0ac7\u0a9f": "gate",           # ગેટ
    
    # Devanagari native script
    "\u0932\u093e\u0932": "red",            # लाल
    "\u0915\u093e\u0932\u093e": "black",   # काला
    "\u0938\u092b\u0947\u0926": "white",   # सफेद
    "\u0928\u0940\u0932\u093e": "blue",    # नीला
    "\u092a\u0940\u0932\u093e": "yellow",  # पीला
    "\u0939\u0930\u093e": "green",         # हरा
    "\u0917\u0941\u0932\u093e\u092c\u0940": "pink",   # गुलाबी
    "\u092d\u0942\u0930\u093e": "brown",   # भूरा
    "\u0928\u093e\u0930\u0902\u0917\u0940": "orange", # नारंगी
    "\u0915\u093e\u0930": "car",           # कार
    "\u0917\u093e\u0921\u093c\u0940": "car",# गाड़ी
    "\u0917\u093e\u0921\u0940": "car",     # गाडी
    "\u0906\u0926\u092e\u0940": "man",     # आदमी
    "\u092e\u0939\u093f\u0932\u093e": "woman", # महिला
    "\u0914\u0930\u0924": "woman",         # औरत
    "\u092a\u093e\u0938": "near",          # पास
    "\u0917\u0947\u091f": "gate",          # गेट
}

# Create a regex pattern to match any of the dictionary keys as whole words
_DICT_PATTERN = re.compile(
    r'\b(' + '|'.join(map(re.escape, sorted(_DICT.keys(), key=len, reverse=True))) + r')\b',
    re.IGNORECASE | re.UNICODE
)

def normalize_query(query: str, backend: str = "dictionary") -> tuple[str, list[str]]:
    global _ACTIVE_BACKEND
    actual_backend = backend if backend != "dictionary" else _ACTIVE_BACKEND
    
    if actual_backend == "openrouter":
        api_key = os.environ.get("OPENROUTER_API_KEY", "")
        if not api_key:
            fallback_query, fallback_subs = normalize_query(query, "dictionary")
            return fallback_query, fallback_subs + ["[OpenRouter fallback: missing API key]"]
            
        try:
            req = urllib.request.Request(
                "https://openrouter.ai/api/v1/chat/completions",
                data=json.dumps({
                    "model": "meta-llama/llama-3.2-3b-instruct:free",
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a forensic search assistant. Translate this CCTV surveillance search query from Hindi, Gujarati, Hinglish, or Gujlish to English. Preserve specific details like colors, clothing, vehicle types, location markers, and time references. Output ONLY the English translation, nothing else."
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
            with urllib.request.urlopen(req, timeout=8) as response:
                resp_data = json.loads(response.read().decode("utf-8"))
                translated = resp_data["choices"][0]["message"]["content"].strip()
                return translated, ["[OpenRouter translated]"]
        except Exception as e:
            fallback_query, fallback_subs = normalize_query(query, "dictionary")
            return fallback_query, fallback_subs + [f"[OpenRouter fallback: {str(e)}]"]
    
    # Dictionary backend or fallback
    substitutions = []
    
    def replace_func(match):
        word = match.group(0).lower()
        replacement = _DICT.get(word, word)
        if replacement != word:
            substitutions.append(f"{match.group(0)}->{replacement}")
        return replacement
        
    normalized = _DICT_PATTERN.sub(replace_func, query)
    return normalized, substitutions

def get_multilingual_config() -> dict:
    return {
        "backend": _ACTIVE_BACKEND,
        "available_backends": ["dictionary", "openrouter"],
        "openrouter_configured": bool(os.environ.get("OPENROUTER_API_KEY", ""))
    }

def set_multilingual_backend(backend: str) -> None:
    global _ACTIVE_BACKEND
    if backend not in ("dictionary", "openrouter"):
        raise ValueError("Invalid backend. Must be 'dictionary' or 'openrouter'.")
    _ACTIVE_BACKEND = backend
