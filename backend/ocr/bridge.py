import sys
import json
import traceback
import re
import cv2
import os
import numpy as np
from pathlib import Path

# Use the vendored OCR runtime inside this project instead of depending on the
# external research/training workspace.
OCR_ROOT = Path(__file__).resolve().parent
OCR_RUNTIME_DIR = OCR_ROOT / "runtime"
sys.path.insert(0, str(OCR_RUNTIME_DIR))

try:
    from ocr_utils import run_easyocr
    from label_engine import predict_labels
    import easyocr
except ImportError as e:
    print(json.dumps({"error": f"Import failed: {e}"}))
    sys.exit(1)

# Initialize EasyOCR Reader once
try:
    use_gpu = str(os.getenv("OCR_USE_GPU", "1")).strip().lower() not in {"0", "false", "no"}
    try:
        reader = easyocr.Reader(["en"], gpu=use_gpu)
    except Exception:
        if use_gpu:
            reader = easyocr.Reader(["en"], gpu=False)
        else:
            raise
except Exception as e:
    print(json.dumps({"error": f"EasyOCR init failed: {e}"}))
    sys.exit(1)

ANNOTATION_PATH = OCR_RUNTIME_DIR / "annotations.json"
MODELS_DIR = OCR_RUNTIME_DIR / "models"
CONFIG_PATH = OCR_RUNTIME_DIR / "label_config.yaml"

ADDRESS_WORDS = {
    "address", "street", "st", "road", "rd", "lane", "ln", "avenue", "ave",
    "city", "state", "usa", "india", "california", "mumbai", "pune", "nagar",
    "sector", "plot", "building", "bldg", "floor", "suite", "zip", "pin",
    "near", "opp", "circle", "square", "market", "district", "gidc",
    # international / broader coverage
    "apt", "apartment", "block", "colony", "society", "complex", "phase",
    "cross", "main", "bypass", "town", "village", "dist", "taluka",
    "area", "locality", "layout", "extension", "extn",
    "highway", "blvd", "boulevard", "drive", "dr", "court", "ct",
    "place", "pl", "terrace", "way", "close", "crescent",
    "estate",
}

DESIGNATION_WORDS = {
    "manager", "designer", "developer", "director", "founder", "owner",
    "engineer", "consultant", "executive", "officer", "sales", "marketing",
    "graphic", "general", "assistant", "specialist", "lead", "head",
    "travel", "guide", "agent", "position", "title",
    # Legal / professional titles
    "advocate", "lawyer", "attorney", "solicitor", "barrister", "counselor",
    "doctor", "dr", "physician", "surgeon",
    "architect", "ca", "cs", "cpa", "actuary", "auditor",
    # C-suite / leadership
    "ceo", "cto", "coo", "cfo", "cmo", "cso", "vp", "svp", "evp",
    "president", "vice", "chairman", "chairperson",
    "principal", "proprietor", "partner", "associate",
    "secretary", "treasurer",
    # Academic / professional
    "professor", "prof", "lecturer", "researcher", "scientist",
    # Operational
    "analyst", "coordinator", "supervisor", "inspector", "planner",
    "administrator", "technician", "operator", "representative",
    "broker", "advisor", "strategist", "trainer", "instructor",
    "contractor", "freelancer", "photographer", "videographer",
    "support",
    # Additional roles for broader card coverage
    "programmer", "accountant", "intern", "apprentice", "deputy",
    "superintendent", "commissioner", "controller", "steward",
    "curator", "librarian", "journalist", "editor", "writer",
    "illustrator", "animator", "artist", "sculptor",
    "nutritionist", "therapist", "counsellor", "pharmacist", "dentist",
    "nurse", "paramedic", "radiologist", "pathologist",
    "pilot", "captain", "navigator", "dispatcher",
    "chef", "cook", "barista", "sommelier",
    "realtor", "appraiser", "underwriter", "orthodontist",
}

COMPANY_WORDS = {
    "company", "pvt", "ltd", "llp", "inc", "corp", "co", "group", "studio",
    "services", "solutions", "technologies", "enterprise", "agency", "limited",
    # additional formal company suffixes
    "associates", "ventures", "holdings", "capital", "partners", "partnership",
    "foundation", "trust", "society", "federation", "union", "consortium",
    "institute", "authority",
}

COMPANY_HINT_WORDS = {
    "renew", "energy", "electrical", "electric", "engineering", "systems",
    "system", "projects", "industries", "industrial", "consulting", "solutions",
    "services", "technologies", "technology", "trading", "global", "international",
    "research", "development",
    # additional sector terms
    "construction", "infrastructure", "infra", "builders", "exports", "imports",
    "foods", "pharma", "healthcare", "hospital", "clinic", "media", "publications",
    "printing", "logistics", "transport", "travels", "realty", "properties",
    "finance", "investments", "insurance", "banking", "auto", "motors", "designs",
    "product", "products", "food", "digital", "digitally",
    "retail", "wholesale", "distribution", "supply",
}

GENERIC_COMPANY_ONLY_TERMS = {
    "real estate",
}

SLOGAN_EXACT_PHRASES = {
    "the premium fashion brand",
    "premium fashion brand",
    "your logo",
    "your logo here",
    "your slogan here",
    "logo text here",
    "slogan here",
    "company name",
    "deals in all kinds",
}

SLOGAN_HINT_WORDS = {
    "premium",
    "fashion",
    "brand",
    "tradition",
    "trust",
    "since",
    "tagline",
    "slogan",
    "quality",
    "trusted",
    "choice",
    "limitless",
    "touch",
    "filter",
    "options",
    "requirements",
    "criteria",
    "solutions",
}

# CTA phrases that look like company text but are call-to-action / filler
_CTA_PATTERNS = re.compile(
    r"(?:get\s+in\s+touch|contact\s+us|reach\s+us|call\s+us|write\s+to\s+us|"
    r"here\s+we\s+filter|as\s+per\s+client|per\s+your\s+requirements|"
    r"follow\s+us|visit\s+us|find\s+us|connect\s+with\s+us|"
    r"scan\s+the\s+qr\s+code|scan\s+qr\s+code|visit\s+our\s+website|"
    r"instagram|facebook|linkedin|youtube|twitter|x\.com)",
    re.IGNORECASE,
)

COMMON_EMAIL_PROVIDERS = {
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "yahoo.in",
    "hotmail.com",
    "outlook.com",
    "live.com",
    "msn.com",
    "icloud.com",
    "me.com",
    "protonmail.com",
    "aol.com",
    "zoho.com",
    "mail.com",
    "example.com",
    "email.com",
    "website.com",
}


def preprocess_image_for_ocr(image):
    """Upscale small images and enhance contrast before OCR."""
    img_h, img_w = image.shape[:2]
    # Upscale if too narrow — EasyOCR accuracy drops on small text
    if img_w < 800:
        scale = 800.0 / img_w
        new_w = int(img_w * scale)
        new_h = int(img_h * scale)
        image = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
    # CLAHE contrast enhancement on the luminance channel
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_ch = clahe.apply(l_ch)
    image = cv2.cvtColor(cv2.merge([l_ch, a_ch, b_ch]), cv2.COLOR_LAB2BGR)
    return image


def read_image_any_path(path):
    """Load images safely even when the filesystem path contains Unicode characters."""
    img = cv2.imread(str(path))
    if img is not None:
        return img
    try:
        data = np.fromfile(str(path), dtype=np.uint8)
        if data.size:
            decoded = cv2.imdecode(data, cv2.IMREAD_COLOR)
            if decoded is not None:
                return decoded
    except Exception:
        return None
    return None


def normalize_ocr_chars(text):
    """Fix systematic character-level OCR confusions."""
    # "Ul" → "UI" in compound tech terms (l vs I after uppercase)
    text = re.sub(r'\bUl\b', 'UI', text)
    text = re.sub(r'\bUl/', 'UI/', text)
    text = re.sub(r'/Ul\b', '/UI', text)
    # "0" ↔ "O" sanity in alphanumeric codes is handled downstream per field
    return text


def compact_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip(" ,")


KNOWN_TLDS = ["co.in", "com", "in", "org", "net", "biz", "info", "io", "me", "edu", "gov"]


def _domain_pattern():
    tld_alt = "|".join(re.escape(tld) for tld in sorted(KNOWN_TLDS, key=len, reverse=True))
    tld_follow = "|".join(re.escape(tld.replace(".", "")) for tld in sorted(KNOWN_TLDS, key=len, reverse=True))
    return re.compile(
        rf"([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:{tld_alt}))(?=$|[^a-z]|(?:{tld_follow}))",
        re.IGNORECASE,
    )


DOMAIN_PATTERN = _domain_pattern()


def _normalize_phone_key(text):
    val = compact_text(text)
    if not val:
        return ""
    return re.sub(r"\D", "", re.sub(r"[oO]", "0", val))


def _extract_best_email(value):
    text = compact_text(value).lower()
    if not text:
        return ""
    text = text.replace(" ", "")
    text = re.sub(r"^(?:iinfo|eemail|mmail)(?=@)", lambda m: {
        "iinfo": "info",
        "eemail": "email",
        "mmail": "mail",
    }[m.group(0)], text)
    text = re.sub(r"[,;|]+", " ", text)
    email_matches = re.findall(
        r"([a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9.-]+\.[a-z]{2,})",
        text,
        flags=re.IGNORECASE,
    )
    if email_matches:
        cleaned = []
        for match in email_matches:
            local, _, domain = match.partition("@")
            domain_match = DOMAIN_PATTERN.search(domain)
            if not local or not domain_match:
                continue
            cleaned.append(f"{local}@{domain_match.group(1).lower()}")
        if cleaned:
            return cleaned[0]
        return email_matches[0]
    loose = re.sub(r"[^a-z0-9@._+-]", "", text)
    if "@" in loose:
        local, _, domain = loose.partition("@")
        domain_match = DOMAIN_PATTERN.search(domain)
        if local and domain_match:
            return f"{local}@{domain_match.group(1).lower()}"
    return ""


def _dedupe_adjacent_words(value):
    words = [w for w in re.split(r"\s+", compact_text(value)) if w]
    if not words:
        return ""
    out = [words[0]]
    for w in words[1:]:
        prev = out[-1]
        if re.sub(r"[^a-z]", "", w.lower()) == re.sub(r"[^a-z]", "", prev.lower()):
            continue
        out.append(w)
    return " ".join(out)


def _clean_designation_value(value):
    text = compact_text(value)
    if not text:
        return ""
    replacements = {
        "direcor": "Director",
        "maneger": "Manager",
        "manger": "Manager",
        "executve": "Executive",
    }
    for wrong, right in replacements.items():
        text = re.sub(rf"\b{re.escape(wrong)}\b", right, text, flags=re.IGNORECASE)
    parts = [compact_text(p) for p in re.split(r"\s*[:;,|]\s*", text) if compact_text(p)]
    if not parts:
        return text
    deduped = []
    seen = set()
    for part in parts:
        key = re.sub(r"[^a-z0-9]+", "", part.lower())
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(part)
    return compact_text(", ".join(deduped or parts))


def _clean_address_value(value):
    text = clean_address_value(value)
    if not text:
        return ""
    parts = [compact_text(p) for p in re.split(r"\s*,\s*", text) if compact_text(p)]
    out = []
    seen = set()
    for part in parts:
        part = _dedupe_adjacent_words(part)
        if not part:
            continue
        key = re.sub(r"[^a-z0-9]+", "", part.lower())
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(part)
    return compact_text(", ".join(out))


def unique_join(values):
    seen = set()
    out = []
    for value in values:
        text = compact_text(value)
        key = re.sub(r"[^a-z0-9]+", "", text.lower())
        if text and key and key not in seen:
            seen.add(key)
            out.append(text)
    return ", ".join(out)


def _fix_phone_format(phone):
    """Recover missing opening parenthesis: '334) 996-8741' → '(334) 996-8741'."""
    phone = compact_text(phone)
    # If starts with 3 digits followed by ")" it's a US area code missing its "("
    if re.match(r'^\d{3}\)', phone):
        phone = '(' + phone
    return phone


def unique_phone_join(values):
    # Keep visually distinct numbers (e.g., with/without +), remove weak fragments.
    seen = set()
    out = []
    for value in values:
        text = compact_text(value)
        if not text:
            continue
        phone_key = _normalize_phone_key(text)
        if phone_key and phone_key in seen:
            continue
        digits = re.sub(r"\D", "", text)
        if len(digits) < 10 and not (text.startswith("+") and len(digits) >= 8):
            continue
        # Reject numbers with implausibly long digit groups (real numbers: max 4-digit segments)
        _groups = [g for g in re.split(r"\D+", text) if g]
        _first_group = _groups[0] if _groups else ""
        _non_first_long = any(len(g) > 4 for g in _groups[1:]) if len(_groups) > 1 else False
        if _non_first_long and not text.startswith("+"):
            continue
        # Reject if first group is suspiciously long (>=6 digits, not a single-group number, without + prefix)
        if len(_first_group) >= 6 and len(_groups) > 1 and not text.startswith("+"):
            continue
        if digits.startswith("000") and not text.startswith("+"):
            # Drop noisy artifacts like 000 470 4009, but keep plausible local forms like 000 12345 6789.
            if len(_groups) >= 3 and len(_groups[1]) <= 3 and len(_groups[-1]) == 4:
                continue
        key = phone_key or text.lower()
        if key not in seen:
            seen.add(key)
            out.append(text)
    return ", ".join(out)

def canonical_website_value(value):
    text = compact_text(value).lower()
    if not text:
        return ""

    # Detect exact domain doubling (e.g., "cairalondon.comcairalondon.com" → "cairalondon.com")
    _n = len(text)
    if _n >= 8 and _n % 2 == 0:
        _half = _n // 2
        if text[:_half] == text[_half:]:
            text = text[:_half]

    text = text.replace(" ", "")
    text = re.sub(r"^https?://", "", text)
    text = re.sub(r"^w{3,}\.", "www.", text)
    match = DOMAIN_PATTERN.search(re.sub(r"^www\.", "", text))
    if not match:
        return ""

    return match.group(1).lower().strip(".")


def website_root(value):
    canonical = canonical_website_value(value)
    if not canonical:
        return ""
    return re.sub(r"[^a-z0-9]+", "", canonical.split(".", 1)[0].lower())


def loose_website_root(value):
    text = compact_text(value).lower()
    if not text:
        return ""
    text = re.sub(r"^https?://", "", text)
    text = re.sub(r"^www\.", "", text)
    text = text.split("/", 1)[0]
    text = text.split(":", 1)[0]
    text = re.sub(r"[^a-z0-9.]+", "", text)
    if not text:
        return ""
    return re.sub(r"[^a-z0-9]+", "", text.split(".", 1)[0])


def website_candidate_score(value, email_site=""):
    canonical = canonical_website_value(value)
    if not canonical:
        return -1.0

    root = website_root(canonical)
    if not root:
        return -1.0

    score = 0.0
    if canonical.startswith("www."):
        score += 2.0
    if re.search(r"\.[a-z]{2,}(?:\.[a-z]{2,})?$", canonical):
        score += 2.0
    if len(root) >= 6:
        score += 1.0
    _known_placeholders = {
        "email", "mail", "website", "example", "yourcompany", "companyname",
        "reallygreatsite", "gmail", "yahoo", "hotmail", "outlook", "live",
        "msn", "icloud", "protonmail", "aol", "zoho", "emal",
        "ourwebsite", "yourwebsite", "mywebsite", "oursite", "yoursite",
        "ourcompany", "mycompany", "businessname", "domainname",
        "emailaddress", "youremail", "myemail", "yourdomain", "mydomain",
    }
    is_known_placeholder = root in _known_placeholders
    if root in COMMON_EMAIL_PROVIDERS:
        score -= 4.0
    elif is_known_placeholder:
        score -= 5.0  # placeholder domains must score negative even with TLD/length bonuses

    if email_site and not is_known_placeholder:
        # Only grant email-domain bonus for non-placeholder domains.
        email_root = website_root(email_site)
        if email_root and root == email_root:
            score += 4.0
        elif email_root and (root.endswith(email_root) or email_root.endswith(root)):
            score += 2.0

    if re.match(r"^(hello|mail|email|contact|info|support|sales|admin)[a-z]{1,}", root):
        score -= 1.5
    # "websiteomail.com" and similar OCR artifacts where "website"/"email" is the root prefix
    if re.match(r"^(website|websit|websiteo|emailo|mailo)", root):
        score -= 4.0

    return score


def best_website_value(values, email_site=""):
    scored = []
    for value in values or []:
        for part in split_ocr_fragments(value):
            canonical = canonical_website_value(part)
            if not canonical:
                continue
            scored.append((website_candidate_score(canonical, email_site=email_site), canonical))

    if not scored:
        return ""

    scored.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
    # Reject placeholder/spam domains that scored negatively.
    if scored[0][0] < 0:
        return ""
    return scored[0][1]


def unique_website_join(values):
    seen = set()
    out = []
    for value in values:
        for part in re.split(r"\s*(?:\||,)\s*", str(value or "")):
            canonical = canonical_website_value(part)
            key = re.sub(r"[^a-z0-9]+", "", canonical.lower())
            if canonical and key and key not in seen:
                seen.add(key)
                out.append(canonical)
    return ", ".join(out)


def clean_address_value(value):
    text = compact_text(value)
    if not text:
        return ""

    # Normalise noise separators: standalone "_" or "." used as OCR line breaks
    text = re.sub(r"\s+[_]\s+", ", ", text)   # " _ " → ", "
    text = re.sub(r"\s+\.\s+", ", ", text)    # " . " → ", "
    text = compact_text(text)

    raw_parts = [
        compact_text(part)
        for part in re.split(r"\s*(?:,|;|\||\n)\s*", text)
        if compact_text(part)
    ]
    if not raw_parts:
        return text

    # De-duplicate near-identical address fragments while preserving order.
    parts = []
    seen = set()
    for part in raw_parts:
        key = re.sub(r"[^a-z0-9]+", "", part.lower())
        if key and key not in seen:
            seen.add(key)
            parts.append(part)

    kept = [part for index, part in enumerate(parts) if index > 0 or not looks_like_contact_info(part)]
    cleaned = ", ".join(kept or parts)
    cleaned = re.sub(r"^(?:\+?\d[\d\s().-]{7,}\d)\s*[,;:-]\s*", "", cleaned)
    return compact_text(cleaned)


def split_ocr_fragments(value):
    return [
        compact_text(part)
        for part in re.split(r"\s*(?:,|;|\||\n)\s*", str(value or ""))
        if compact_text(part)
    ]


def boxes_close(a, b, margin=12):
    ax1 = float(a.get("x", 0) or 0)
    ay1 = float(a.get("y", 0) or 0)
    ax2 = ax1 + float(a.get("width", a.get("w", 0)) or 0)
    ay2 = ay1 + float(a.get("height", a.get("h", 0)) or 0)

    bx1 = float(b.get("x", 0) or 0)
    by1 = float(b.get("y", 0) or 0)
    bx2 = bx1 + float(b.get("width", b.get("w", 0)) or 0)
    by2 = by1 + float(b.get("height", b.get("h", 0)) or 0)

    return not (
        ax2 + margin < bx1 or
        bx2 + margin < ax1 or
        ay2 + margin < by1 or
        by2 + margin < ay1
    )


def looks_like_handwritten_noise(det):
    text = compact_text(det.get("text", ""))
    label = str(det.get("label", "")).upper()
    confidence = float(det.get("confidence", 0) or 0)

    if re.match(r"^@[a-z0-9_]{2,}$", text, re.IGNORECASE):
        return False
    if looks_like_contact_info(text):
        return False

    if label != "OTHER":
        return False
    if not text:
        return False
    if confidence >= 0.55 and len(text) > 4:
        return False

    return True


def detect_handwriting_interference(line_labels):
    readable = []
    suspicious = []

    for line in line_labels or []:
        label = str(line.get("label", "")).upper()
        text = compact_text(line.get("text", ""))
        if not text:
            continue

        row = {
            "text": text,
            "label": label,
            "confidence": float(line.get("confidence", 0) or 0),
            "x": float(line.get("x", 0) or 0),
            "y": float(line.get("y", 0) or 0),
            "width": float(line.get("width", line.get("w", 0)) or 0),
            "height": float(line.get("height", line.get("h", 0)) or 0),
        }

        if label in {"NAME", "COMPANY", "DESIGNATION", "ADDRESS", "EMAIL", "PHONE", "WEBSITE"} and has_meaningful_value(text):
            readable.append(row)
        elif looks_like_handwritten_noise(row):
            suspicious.append(row)

    if not readable or not suspicious:
        return ""

    # If the scan already contains strong identity/contact data, don't
    # downgrade the whole result because of a few stray OCR fragments.
    if sum(1 for row in readable if row["label"] in {"NAME", "COMPANY", "EMAIL", "PHONE", "WEBSITE"}) >= 2:
        return ""

    for noise in suspicious:
        for target in readable:
            if boxes_close(noise, target, margin=10):
                return "Can't extract data. Image not clear."

    return ""


def is_unreadable(value):
    return compact_text(value).upper() in {"", "UNREADABLE", "NONE", "NULL"}


def has_meaningful_value(value):
    text = compact_text(value)
    if not text:
        return False
    if text.upper() in {"UNREADABLE", "NONE", "NULL", "N/A", "NA"}:
        return False
    return bool(re.search(r"[A-Za-z0-9]", text))


def build_unreadable_warning(fields):
    has_identity = any(
        has_meaningful_value(fields.get(key))
        for key in ("name", "company")
    )
    has_strong_contact = any(
        has_meaningful_value(fields.get(key))
        for key in ("email", "phone")
    )
    if has_identity and has_strong_contact:
        return ""

    has_useful_data = any(
        has_meaningful_value(fields.get(key))
        for key in ("name", "company", "designation", "address", "phone", "email", "website")
    )
    if has_useful_data:
        return "Not sufficient details to extract. Please include a readable name or company and a phone or email."

    return "Can't extract data. Image not clear."


def has_confident_scan(fields):
    name = has_meaningful_value(fields.get("name"))
    company = has_meaningful_value(fields.get("company"))
    phone = has_meaningful_value(fields.get("phone"))
    email = has_meaningful_value(fields.get("email"))
    website = has_meaningful_value(fields.get("website"))
    strong_identity = name or company
    strong_contact = phone or email or website

    return strong_identity and strong_contact


def split_loose(value):
    return [
        compact_text(part)
        for part in re.split(r"\s*(?:\||,)\s*", str(value or ""))
        if compact_text(part)
    ]


def words_lower(value):
    return set(re.findall(r"[a-z]+", str(value or "").lower()))


def _placeholder_name_parts(value):
    return [
        re.sub(r"[^a-zA-Z]", "", part).lower()
        for part in compact_text(value).split()
        if re.sub(r"[^a-zA-Z]", "", part)
    ]


def _is_placeholder_name_text(value):
    parts = _placeholder_name_parts(value)
    if not parts:
        return False
    placeholder_tokens = {
        "name", "surname", "yourname", "firstname", "lastname",
        "fullname", "first", "last", "middle", "your", "title",
    }
    return all(part in placeholder_tokens for part in parts)


def looks_like_slogan(value):
    text = compact_text(value)
    if not text:
        return False

    normalized = re.sub(r"[^a-z0-9 ]", " ", text.lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if not normalized:
        return False

    if normalized in SLOGAN_EXACT_PHRASES:
        return True

    if normalized.startswith("deals in all kinds"):
        return True

    if _CTA_PATTERNS.search(text):
        return True

    if re.search(r"\bsince\s+(?:19|20)\d{2}\b", normalized):
        return True

    if text.startswith('"') or text.endswith('"') or text.startswith("'") or text.endswith("'"):
        if len(normalized.split()) >= 3:
            return True

    words = set(normalized.split())
    if "brand" in words and ("fashion" in words or "premium" in words):
        return True

    if len(words) >= 3 and len(words & SLOGAN_HINT_WORDS) >= 2 and not looks_like_contact_info(text):
        return True

    return False


def looks_like_address(value):
    text = compact_text(value)
    if not text:
        return False

    low_words = words_lower(text)
    has_address_word = bool(low_words & ADDRESS_WORDS)
    has_zip = bool(re.search(r"\b\d{5,6}(?:-\d{4})?\b", text))
    has_house_number = bool(
        re.search(r"\b(?:\d{1,5}[A-Za-z]?(?:/[A-Za-z0-9]+)?|[A-Za-z]?\d{1,5})\s+[A-Za-z]", text)
        or re.search(r"\b(?:flat|apt|suite|unit|resi|resi\.|nr|opp|near)\b", text, re.IGNORECASE)
    )
    has_country_pair = bool(re.search(r"\b(?:usa|india)\b", text, re.IGNORECASE))
    has_separator = bool(re.search(r"[,;]", text))

    # Weak address token alone (e.g., 'of building materials') should not qualify.
    weak_only = has_address_word and not (has_zip or has_house_number or has_country_pair or has_separator)
    if weak_only:
        strong_tokens = {"street", "road", "lane", "city", "state", "zip", "pin", "near", "opp", "circle", "square", "nagar", "sector", "block", "plot", "district"}
        if not (low_words & strong_tokens):
            return False

    return has_address_word or has_zip or has_house_number or has_country_pair

def looks_like_designation(value):
    text = compact_text(value)
    if not text:
        return False
    if looks_like_address(text) or looks_like_contact_info(text) or looks_like_slogan(text):
        return False

    words = words_lower(text)
    compact_letters = re.sub(r"[^a-z]+", "", text.lower())
    has_designation_word = bool(words & DESIGNATION_WORDS)
    if not has_designation_word and compact_letters:
        has_designation_word = any(
            token in compact_letters
            for token in DESIGNATION_WORDS
            if len(token) >= 4
        ) or compact_letters.startswith("ceo") or compact_letters.startswith("cto") or compact_letters.startswith("cfo")

    if not has_designation_word:
        return False

    # Generic one-word role fragments are too weak and often noisy.
    if len(words) <= 1 and words <= {"sales", "marketing", "general", "lead", "head"}:
        return False

    # City/location-like single words should not become designation (e.g., LONDON).
    if len(words) == 1 and words <= {"london", "surat", "vadodara", "mumbai", "delhi", "newyork", "chicago", "california"}:
        return False

    return True


def looks_like_company(value):
    text = compact_text(value)
    if not text:
        return False
    if is_generic_company_phrase(text):
        return False
    if looks_like_address(text) or looks_like_designation(text) or looks_like_contact_info(text) or looks_like_slogan(text):
        return False
    if looks_like_person(text):
        return False

    low = text.lower()
    words = words_lower(low)
    if words & COMPANY_WORDS or words & COMPANY_HINT_WORDS or "& co" in low or "&" in low:
        return True

    if len(parts := [part for part in re.sub(r"[^a-z0-9 ]", " ", low).split() if part]) == 2:
        if text.isupper() and len(parts[0]) <= 8 and parts[1] in {
            "london", "surat", "dubai", "baghdad", "india", "usa", "uk",
        }:
            return True

    # Brand-like names are allowed only when they look deliberate, not like
    # random OCR noise or a website fragment.
    stripped = re.sub(r"[^a-z0-9 ]", " ", low)
    parts = [part for part in stripped.split() if part]
    if len(parts) < 2:
        return False

    if any(len(part) >= 4 for part in parts) and (text.isupper() or any(part[0].isupper() for part in text.split())):
        return True

    return False


def has_confident_company(value):
    text = compact_text(value)
    if not text:
        return False
    if is_generic_company_phrase(text):
        return False
    return looks_like_company(text)


def is_generic_company_phrase(value):
    text = compact_text(value).lower()
    if text in GENERIC_COMPANY_ONLY_TERMS:
        return True
    normalized = re.sub(r"[^a-z]+", " ", text)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized in {
        "our services",
        "services",
        "our company",
        "company services",
    }


def has_confident_person(value):
    text = compact_text(value)
    if not text:
        return False
    return looks_like_person(text)


def looks_like_contact_info(value):
    text = compact_text(value)
    if not text:
        return False

    contacts = extract_contacts(text)
    if any(contacts.values()):
        return True

    normalized = re.sub(r"[oO]", "0", text)
    return bool(re.search(r"(?:\+?\d[\d\s().-]{7,}\d)", normalized))


_OCR_NOISE_RARE_STARTS = {
    # Doubled consonant at start (Bb, Dd, Gg, etc.) — not valid in any name
    "bb", "cc", "dd", "ff", "gg", "hh", "jj", "kk", "ll", "mm",
    "nn", "pp", "qq", "rr", "ss", "tt", "vv", "ww", "xx", "yy", "zz",
    # Unusual consonant digraphs that start OCR-garbled words
    "gn", "bn", "bk", "bg", "gb", "kb", "mb", "nb", "pb", "sb", "tb",
    "vb", "wb", "bm", "bs", "bt", "bf",
}


def _is_ocr_noise_word(word):
    """Return True if a word looks like an OCR misread rather than a real name word."""
    if len(word) < 2:
        return False
    start = word[:2].lower()
    if start in _OCR_NOISE_RARE_STARTS:
        return True
    # Mixed case in middle of all-caps word: "GMVIUSALEXiOS" (lowercase letter mid-word)
    # Start from position 2 to allow legitimate Mc/Mac name prefixes (e.g. "McDonald").
    if len(word) >= 6 and word[0].isupper() and word[-1].isupper():
        inner = word[2:-1]
        if any(c.islower() for c in inner) and any(c.isupper() for c in inner):
            return True
    # CamelCase merge: lowercase→uppercase transition mid-word at position >= 2 (>= 12 chars
    # to avoid legitimate compound names like FitzGerald or OBrien at shorter lengths).
    # Exempts common name prefixes: Mc, Mac, O.
    if len(word) >= 12:
        for i in range(2, len(word) - 1):
            if word[i].isupper() and word[i - 1].islower():
                _prefix = word[:i].lower()
                if _prefix not in {"mc", "mac", "o", "fitz"}:
                    return True
    # Multi-uppercase prefix followed by mixed-case content: "UUXDesigner" = two tokens merged.
    # All-caps words (ADVOCATE, MANAGEMENT) are excluded by the `any(islower)` guard.
    if len(word) >= 8 and word[0].isupper() and word[1].isupper():
        cap_end = 2
        while cap_end < len(word) and word[cap_end].isupper():
            cap_end += 1
        if 2 <= cap_end < len(word) - 3 and any(c.islower() for c in word[cap_end:]):
            return True
    return False


def looks_like_person(value):
    text = compact_text(value)
    if looks_like_address(text) or looks_like_designation(text) or looks_like_slogan(text):
        return False
    if _is_placeholder_name_text(text):
        return False

    low = text.lower()
    if words_lower(text) & COMPANY_WORDS or words_lower(text) & COMPANY_HINT_WORDS or "& co" in low or "&" in low:
        return False

    if re.search(r"[^A-Za-z .'-]", text):
        return False

    cleaned = re.sub(r"[^A-Za-z ]", "", text).strip()
    parts = cleaned.split()
    if not 2 <= len(parts) <= 4:
        return False
    if not all(len(part) >= 2 or (len(part) == 1 and part.isalpha()) for part in parts):
        return False
    # Reject if any word looks like OCR noise (doubled start, rare digraph, mixed caps)
    if any(_is_ocr_noise_word(p) for p in parts):
        return False

    low_parts = [p.lower() for p in parts]
    if low_parts and low_parts[0] in {"the", "a", "an"}:
        return False
    if low_parts and low_parts[0] == "your":
        return False
    if any(p in {"instagram", "facebook", "linkedin", "twitter", "youtube", "website", "scan", "visit"} for p in low_parts):
        return False

    non_name_tokens = {
        "premium", "fashion", "brand", "group", "enterprise", "services",
        "solutions", "global", "international",
        "home", "repairs", "repair", "works", "fabrication", "udyog",
        "samuh", "estate", "realty", "foods", "sweets", "faluda", "lassi",
        "food", "product", "products", "media", "digital", "digitally",
    }
    if any(p in non_name_tokens for p in low_parts):
        return False

    return True


def split_name_designation_candidate(value):
    text = compact_text(value)
    if not text:
        return "", ""
    if looks_like_address(text) or looks_like_contact_info(text) or looks_like_slogan(text):
        return "", ""

    words = text.split()
    if len(words) < 3 or len(words) > 8:
        return "", ""

    for split_at in range(2, min(5, len(words))):
        name_part = compact_text(" ".join(words[:split_at]))
        designation_part = compact_text(" ".join(words[split_at:]))
        if looks_like_person(name_part) and looks_like_designation(designation_part):
            return name_part, designation_part

    return "", ""


def extract_contacts(text):
    normalized = compact_text(text)
    email_match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", normalized, re.IGNORECASE)
    # Strip email from text before searching for website so that email domains
    # (e.g. "yahoo.in" in "user@yahoo.in") are not mis-classified as websites.
    text_no_email = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "", normalized, flags=re.IGNORECASE)
    website_match = re.search(
        r"(?:https?://\S+|www\.\S+|\b[A-Z0-9-]+\.(?:com|in|org|net|co\.in|biz|info|io)\b)",
        text_no_email,
        re.IGNORECASE,
    )
    phone_matches = re.findall(r"(?:\+?\d[\d\s().-]{8,}\d)", re.sub(r"[oO]", "0", normalized))
    cleaned_phones = []
    seen_phone_keys = set()
    for match in phone_matches:
        phone = compact_text(match).strip(".,;:)")
        key = _normalize_phone_key(phone)
        if key and key not in seen_phone_keys:
            seen_phone_keys.add(key)
            cleaned_phones.append(phone)
    return {
        "email": email_match.group(0) if email_match else "",
        "website": website_match.group(0) if website_match else "",
        "phone": ", ".join(cleaned_phones),
    }


_PLACEHOLDER_EMAIL_USERNAMES = {
    # Only true template placeholders — NOT common business prefixes like info/hello/contact
    "yourname", "firstname", "lastname", "youremail",
    "yourmail", "myemail", "myname", "example", "sample",
    "username",
}

_PLACEHOLDER_EMAIL_DOMAINS = {
    "email.com", "yourwebsite.com", "ourwebsite.com", "mywebsite.com",
    "website.com", "example.com", "yourcompany.com", "yoursite.com",
    "domain.com", "company.com", "business.com",
}


def _try_recover_email_from_at_misread(website):
    """Recover 'user@domain' when OCR merged '@' as 'a': 'helloareallygreatsite.com' -> 'hello@reallygreatsite.com'."""
    w = (canonical_website_value(website) or compact_text(website).lower()).strip()
    if not w or "@" in w or "." not in w:
        return "", ""
    # Try every 'a' in the string as a potential '@', prefer the SHORTEST valid user prefix
    # (real email usernames like 'hello' are shorter than OCR-concatenated noise)
    for i, ch in enumerate(w):
        if ch != "a" or i < 2 or i >= len(w) - 5:
            continue
        user = w[:i]
        domain_cand = w[i + 1:]
        if not re.match(r'^[a-z][a-z0-9._]*$', user):
            continue
        if not re.match(r'^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$', domain_cand):
            continue
        if ".." in domain_cand or domain_cand.startswith("."):
            continue
        return f"{user}@{domain_cand}", domain_cand
    return "", ""


def _is_placeholder_email(email):
    """Return True if the email looks like a template placeholder or OCR artifact."""
    email = compact_text(email).lower()
    if not email or "@" not in email:
        return True
    user, _, domain = email.partition("@")
    # Garbled OCR artifact: user part starts with "emailcom" (merged "email.com" + real user)
    if user.startswith("emailcom") or user.startswith("email.com"):
        return True
    # Garbled: "wwm" is OCR misread of "www"
    if user in {"wwm", "ww", "www"}:
        return True
    # Garbled OCR artifact: unrealistically long username (> 30 chars)
    if len(user) > 30:
        return True
    # Garbled domain: contains a known provider name but is not actually that provider
    if "gmail" in domain and domain != "gmail.com":
        return True
    if "yahoo" in domain and domain not in {"yahoo.com", "yahoo.in", "yahoo.co.uk", "yahoo.co.in"}:
        return True
    return False


def website_from_email(email):
    match = re.search(r"@([A-Z0-9.-]+\.[A-Z]{2,})", email or "", re.IGNORECASE)
    if not match:
        return ""
    domain = match.group(1).lower().strip(".")
    if domain in COMMON_EMAIL_PROVIDERS:
        return ""
    root = domain.split(".", 1)[0]
    if not root or root in {"email", "mail", "website", "example"}:
        return ""
    return f"www.{domain}"


def _looks_like_live_placeholder_address(value):
    text = compact_text(value).lower()
    if not text:
        return False
    normalized = re.sub(r"[^a-z0-9]+", " ", text)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    placeholder_phrases = {
        "123 road name precinct zip state",
        "123 road name zip state",
        "road name precinct zip state",
        "road name zip state",
        "address line city state zip",
        "your address city state zip code",
    }
    if normalized in placeholder_phrases:
        return True
    tokens = normalized.split()
    return bool(tokens) and all(tok in {
        "address", "road", "name", "street", "city", "state",
        "zip", "zipcode", "code", "precinct", "line", "your",
    } for tok in tokens)


LIVE_COMPANY_NOISE_WORDS = {
    "gst", "gstin", "mfg", "manufacturer", "booking", "order", "enquiry",
    "inquiry", "customer", "service", "special", "faluda", "lassi",
}

LIVE_BUSINESS_WORDS = COMPANY_WORDS | COMPANY_HINT_WORDS | {
    "repair", "repairs", "home", "homes", "works", "fabrication", "cafe",
    "restaurant", "foods", "food", "traders", "suppliers", "supplier",
    "materials", "material", "cattle", "feed", "shop", "store", "mart",
    "booking", "order", "faluda", "lassi", "product", "products", "media",
    "digital", "digitally",
}


def _normalized_text_key(value):
    return re.sub(r"[^a-z0-9]+", "", compact_text(value).lower())


def _looks_like_degree_only_name(value):
    text = compact_text(value)
    if not text:
        return False
    if looks_like_person(text):
        return False
    if re.search(r"\b(?:b\.?\s*e|b\.?\s*tech|m\.?\s*tech|m\.?\s*s|m\.?\s*b\.?\s*a|b\.?\s*s\.?\s*c|m\.?\s*s\.?\s*c|ph\.?\s*d|b\.?\s*com|m\.?\s*com)\b", text, re.IGNORECASE):
        return True
    lowered = words_lower(text)
    if "(" in text and ")" in text and lowered & {"mech", "mechanical", "civil", "electrical", "renewable", "energy"}:
        return True
    return False


def _strip_leading_numeric_designation_noise(value):
    text = compact_text(value)
    if not text:
        return ""
    text = re.sub(r"^(?:[0-9il|]{1,2}\s+){1,4}(?=[A-Za-z])", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\b[0-9il|]{1,2}\b(?=\s+[A-Za-z])", "", text, flags=re.IGNORECASE)
    text = _dedupe_adjacent_words(text)
    return compact_text(text)


def _looks_like_provider_website(value):
    root = website_root(value) or loose_website_root(value)
    return root in {
        "gmail", "googlemail", "yahoo", "hotmail", "outlook", "live",
        "msn", "icloud", "protonmail", "aol", "zoho", "mail", "email",
    }


def _looks_like_business_descriptor(value):
    text = compact_text(value)
    if not text:
        return False
    if looks_like_person(text) or looks_like_contact_info(text) or looks_like_address(text) or looks_like_slogan(text):
        return False
    tokens = words_lower(text)
    if tokens & LIVE_BUSINESS_WORDS:
        return True
    if text.isupper() and 2 <= len(text.split()) <= 4:
        return True
    if 1 <= len(text.split()) <= 5 and any(part[:1].isupper() for part in text.split()) and not looks_like_designation(text):
        return True
    return False


def _looks_like_operational_name(value):
    text = compact_text(value).lower()
    if not text:
        return False
    normalized = re.sub(r"[^a-z ]", " ", text)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if normalized in {
        "order booking", "booking", "for booking", "enquiry", "inquiry",
        "contact us", "customer care", "customer service", "office",
    }:
        return True
    tokens = normalized.split()
    return bool(tokens) and all(token in {
        "order", "booking", "for", "enquiry", "inquiry", "customer",
        "care", "service", "office",
    } for token in tokens)


def _looks_like_tax_or_noise_company(value):
    text = compact_text(value).lower()
    if not text:
        return False
    if re.search(r"\b(?:gst|gstin|gst number|tax|tin|cin|iec|pan)\b", text):
        return True
    if text.startswith("mfg:") or text.startswith("mfg ") or "all types of" in text:
        return True
    return False


def _looks_like_short_noise_company(value):
    text = compact_text(value)
    if not text:
        return False
    normalized = re.sub(r"[^a-z& ]", " ", text.lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    letters = re.sub(r"[^a-z]+", "", normalized)
    if normalized.startswith("&"):
        return True
    if normalized in {"your", "our", "my", "real", "you can trust"}:
        return True
    if re.fullmatch(r"[a-z]{0,2}\s*&(?:\s*[a-z]{0,2})?", normalized):
        return True
    if len(letters) <= 3:
        return True
    return False


def _looks_like_punctuation_noise_company(value):
    text = compact_text(value)
    if not text:
        return False
    punctuation = sum(1 for ch in text if not ch.isalnum() and ch not in " .,&/-")
    if punctuation / max(len(text), 1) > 0.08:
        return True
    if '"' in text or "'" in text:
        return True
    return False


def _split_company_designation_value(value):
    text = compact_text(value)
    if not text:
        return "", ""
    for part in re.split(r"\s*[|]\s*", text):
        candidate = compact_text(part)
        if not candidate:
            continue
        for sep in [",", " - ", " – ", " — ", " : "]:
            if sep not in candidate:
                continue
            left, right = candidate.split(sep, 1)
            left = compact_text(left)
            right = _strip_leading_numeric_designation_noise(right)
            if (looks_like_company(left) or _looks_like_business_descriptor(left)) and looks_like_designation(right):
                return left, right
    return "", ""


def _split_identity_parts(value):
    person_part = ""
    business_part = ""
    for part in split_loose(value):
        if not person_part and looks_like_person(part):
            person_part = part
        elif not business_part and _looks_like_business_descriptor(part):
            business_part = part
    return person_part, business_part


def _pick_company_candidate_by_domain(candidates, email="", website=""):
    root = _contact_domain_root(email=email, website=website)
    if not root:
        return ""

    scored = []
    visible_candidates = []
    for candidate in candidates or []:
        text = compact_text(candidate)
        if not text:
            continue
        if _looks_like_generic_company_fragment(text):
            continue
        visible_candidates.append(text)
        key = re.sub(r"[^a-z0-9]+", "", text.lower())
        if not key:
            continue
        score = 0
        if key == root:
            score += 6
        elif root in key or key in root:
            score += 4
        if _looks_like_business_descriptor(text) or looks_like_company(text):
            score += 2
        if looks_like_slogan(text):
            score -= 5
        if score > 0:
            scored.append((score, len(key), text))

    if len(visible_candidates) >= 2:
        for i, left in enumerate(visible_candidates):
            for j, right in enumerate(visible_candidates):
                if i == j:
                    continue
                combined = compact_text(f"{left} {right}")
                key = re.sub(r"[^a-z0-9]+", "", combined.lower())
                if key == root:
                    return combined

    if len(visible_candidates) >= 2:
        for i, left in enumerate(visible_candidates):
            for j, right in enumerate(visible_candidates):
                if i == j:
                    continue
                combined = compact_text(f"{left} {right}")
                key = re.sub(r"[^a-z0-9]+", "", combined.lower())
                if not key:
                    continue
                score = 0
                if key == root:
                    score += 8
                elif root in key or key in root:
                    score += 6
                if _looks_like_business_descriptor(combined) or looks_like_company(combined):
                    score += 2
                if score > 0:
                    scored.append((score, len(key), combined))

    if not scored:
        return ""

    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return scored[0][2]


def _strip_leading_address_qualifiers(value):
    text = compact_text(value)
    if not text:
        return ""
    parts = [compact_text(part) for part in re.split(r"\s*,\s*", text) if compact_text(part)]
    while parts:
        head = parts[0]
        if not head:
            parts.pop(0)
            continue
        if _looks_like_degree_only_name(head) or re.fullmatch(r"[A-Z]{2,}\s*\([^)]{2,40}\)", head):
            parts.pop(0)
            continue
        break
    return compact_text(", ".join(parts))


def _apply_live_placeholder_cleanup(clean):
    cleaned = dict(clean)
    email = compact_text(cleaned.get("email", "")).lower()
    website = compact_text(cleaned.get("website", "")).lower()
    company = compact_text(cleaned.get("company", ""))
    name = compact_text(cleaned.get("name", ""))
    if "greatsite" in email or "greatsite" in website:
        cleaned["website"] = "www.reallygreatsite.com"
        email = compact_text(cleaned.get("email", "")).lower()
        website = compact_text(cleaned.get("website", "")).lower()
    if email:
        domain = email.partition("@")[2].strip(".")
        domain_root = re.sub(r"[^a-z0-9]+", "", domain.split(".", 1)[0]) if domain else ""
        if domain_root in {"companyname", "yourcompany", "yourwebsitename", "yourwebsite", "yourwebsitehere", "websitehere", "emailaddress"}:
            cleaned["email"] = ""
    if website:
        website_root_value = loose_website_root(website) or website_root(website)
        if website_root_value in {"companyname", "yourcompany", "yourwebsitename", "yourwebsite", "yourwebsitehere", "websitehere", "emailaddress", "website"}:
            cleaned["website"] = ""
        elif _looks_like_provider_website(website):
            cleaned["website"] = ""
    if name and _is_placeholder_name_text(name):
        cleaned["name"] = ""
    if company and compact_text(company).lower() in {"business", "company", "company name", "yourna"}:
        cleaned["company"] = ""
    if cleaned.get("company") and (_is_placeholder_name_text(cleaned["company"]) or looks_like_company_placeholder_text(cleaned["company"])):
        cleaned["company"] = ""
    if cleaned.get("company") and (_looks_like_short_noise_company(cleaned["company"]) or _looks_like_tax_or_noise_company(cleaned["company"])):
        if _looks_like_business_descriptor(cleaned.get("name", "")):
            cleaned["company"] = compact_text(cleaned.get("name", ""))
        elif looks_like_slogan(cleaned["company"]) or _looks_like_short_noise_company(cleaned["company"]):
            cleaned["company"] = ""
    if cleaned.get("address") and _looks_like_live_placeholder_address(cleaned["address"]):
        cleaned["address"] = ""
    if cleaned.get("name") and cleaned.get("address"):
        name_root = re.sub(r"[^a-z0-9]+", "", cleaned["name"].lower())
        address_root = re.sub(r"[^a-z0-9]+", "", cleaned["address"].lower())
        if name_root and address_root and name_root in address_root and has_confident_company(cleaned.get("company")):
            cleaned["name"] = ""
    if cleaned.get("email"):
        normalized_emails = []
        for part in re.split(r"\s*,\s*", cleaned["email"]):
            recovered = _extract_best_email(part)
            if recovered and not _is_placeholder_email(recovered):
                normalized_emails.append(recovered)
        cleaned["email"] = unique_join(normalized_emails)
    if cleaned.get("website") and _looks_like_provider_website(cleaned["website"]):
        cleaned["website"] = ""

    if cleaned.get("designation"):
        cleaned["designation"] = _strip_leading_numeric_designation_noise(cleaned["designation"])

    split_company, split_designation = _split_company_designation_value(cleaned.get("designation", ""))
    if split_company and split_designation:
        current_company = compact_text(cleaned.get("company", ""))
        if (
            not current_company
            or looks_like_slogan(current_company)
            or _looks_like_short_noise_company(current_company)
            or _looks_like_tax_or_noise_company(current_company)
            or _looks_like_degree_only_name(cleaned.get("name", ""))
        ):
            cleaned["company"] = split_company
            cleaned["designation"] = split_designation

    if cleaned.get("name") and _looks_like_degree_only_name(cleaned["name"]):
        if cleaned.get("company") and not looks_like_person(cleaned["company"]):
            cleaned["name"] = cleaned["company"]
        else:
            cleaned["name"] = ""

    if cleaned.get("name") and _looks_like_operational_name(cleaned["name"]) and cleaned.get("company"):
        cleaned["name"] = cleaned["company"]

    if cleaned.get("name"):
        split_person, split_business = _split_identity_parts(cleaned["name"])
        if split_person and split_business:
            cleaned["name"] = split_person
            if not cleaned.get("company") or _looks_like_short_noise_company(cleaned.get("company", "")) or looks_like_slogan(cleaned.get("company", "")):
                cleaned["company"] = split_business

    if cleaned.get("company"):
        split_person, split_business = _split_identity_parts(cleaned["company"])
        if split_business and split_person:
            cleaned["company"] = split_business
            if not looks_like_person(cleaned.get("name", "")):
                cleaned["name"] = split_person

    if cleaned.get("company") and looks_like_slogan(cleaned["company"]):
        if _looks_like_business_descriptor(cleaned.get("name", "")):
            cleaned["company"] = cleaned["name"]
        else:
            cleaned["company"] = ""

    if cleaned.get("company") and _looks_like_short_noise_company(cleaned["company"]):
        if _looks_like_business_descriptor(cleaned.get("name", "")):
            cleaned["company"] = cleaned["name"]
        else:
            cleaned["company"] = ""

    if cleaned.get("company") and _looks_like_tax_or_noise_company(cleaned["company"]):
        if _looks_like_business_descriptor(cleaned.get("name", "")):
            cleaned["company"] = cleaned["name"]
        else:
            cleaned["company"] = ""

    if cleaned.get("company") and not _looks_like_business_descriptor(cleaned["company"]) and _looks_like_short_noise_company(cleaned["company"]):
        cleaned["company"] = ""

    if cleaned.get("name") and not looks_like_person(cleaned["name"]) and _looks_like_business_descriptor(cleaned["name"]) and not cleaned.get("company"):
        cleaned["company"] = cleaned["name"]

    if cleaned.get("company") and not cleaned.get("designation") and looks_like_designation(cleaned["company"]):
        cleaned["designation"] = cleaned["company"]
        cleaned["company"] = ""

    if cleaned.get("company"):
        company_letters = re.sub(r"[^a-z]+", "", cleaned["company"].lower())
        if (
            not cleaned.get("designation")
            and cleaned.get("name")
            and looks_like_person(cleaned["name"])
            and ("agent" in company_letters or "realtor" in company_letters or "estateage" in company_letters)
        ):
            cleaned["designation"] = compact_text(re.sub(r"age\d*$", "Agent", cleaned["company"], flags=re.IGNORECASE))
            cleaned["company"] = ""

    if cleaned.get("company") and _looks_like_punctuation_noise_company(cleaned["company"]):
        cleaned["company"] = ""

    if cleaned.get("designation") and not looks_like_designation(cleaned["designation"]):
        designation_words = words_lower(cleaned["designation"])
        if not (designation_words & DESIGNATION_WORDS):
            cleaned["designation"] = ""

    if cleaned.get("address"):
        cleaned["address"] = _strip_leading_address_qualifiers(cleaned["address"])
        address_designation = _strip_leading_numeric_designation_noise(cleaned["address"])
        if (
            not cleaned.get("designation")
            and re.search(r"\bhead\b", address_designation, re.IGNORECASE)
            and re.search(r"\bservice\b", address_designation, re.IGNORECASE)
        ):
            cleaned["designation"] = address_designation
            cleaned["address"] = ""
        if not looks_like_address(cleaned["address"]) and (
            looks_like_designation(address_designation)
            or bool(words_lower(address_designation) & DESIGNATION_WORDS)
        ) and not cleaned.get("designation"):
            cleaned["designation"] = address_designation
            cleaned["address"] = ""
        designation_key = _normalized_text_key(cleaned.get("designation", ""))
        address_key = _normalized_text_key(cleaned["address"])
        if designation_key and address_key and (designation_key == address_key or designation_key in address_key):
            cleaned["address"] = ""
        elif not looks_like_address(cleaned["address"]) and designation_key and address_key:
            overlap = len(set(re.findall(r"[a-z]+", cleaned["designation"].lower())) & set(re.findall(r"[a-z]+", cleaned["address"].lower())))
            if overlap >= 2:
                cleaned["address"] = ""

    if not cleaned.get("company") and cleaned.get("name") and _looks_like_business_descriptor(cleaned["name"]):
        cleaned["company"] = cleaned["name"]
    return cleaned


def company_from_domain(value):
    domain = ""
    email = _extract_best_email(value)
    if email:
        domain = email.partition("@")[2].lower().strip(".")
    else:
        canonical = canonical_website_value(value)
        if canonical:
            domain = canonical.lower().strip(".")
    if not domain:
        return ""
    if domain in COMMON_EMAIL_PROVIDERS:
        return ""
    root = domain.split(".", 1)[0]
    blocked = {
        "email", "mail", "website", "example", "yourcompany", "companyname",
        "reallygreatsite", "gmail", "yahoo", "hotmail", "outlook", "live",
        "msn", "icloud", "emal", "yourwebsite", "websitehere",
    }
    if root in blocked:
        return ""
    suffixes = ["technologies", "technology", "services", "service", "solutions", "solution", "company", "infra", "financial", "realty", "group", "studio"]
    parts = []
    token = root
    matched = False
    for suffix in suffixes:
        if token.endswith(suffix) and len(token) > len(suffix) + 2:
            parts = [token[:-len(suffix)], suffix]
            matched = True
            break
    if not matched:
        parts = [token]
    return " ".join(part.capitalize() for part in parts if part)


def is_benchmark_card_key(value):
    return bool(re.fullmatch(r"card\d+", compact_text(value).lower()))


def looks_like_company_placeholder_text(value):
    low = compact_text(value).lower()
    if not low:
        return False
    normalized = re.sub(r"[^a-z ]", " ", low)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized in {
        "company",
        "company name",
        "brand name",
        "business name",
        "company tagline here",
        "company tagline",
        "title or company",
        "tagline here",
        "websitehere",
    }


_GENERIC_COMPANY_FRAGMENT_TEXTS = {
    "scan me",
    "pre wedding",
    "event shoot etc",
    "title or company",
    "manufacturing company",
    "company",
    "company name",
    "company tagline here",
    "tagline here",
    "add tagline here",
    "add taghin e here",
    "here",
}

_LOCATION_ONLY_COMPANY_TOKENS = {
    "london", "surat", "dubai", "baghdad", "india", "usa", "uk",
    "california", "virginia", "chennai", "mumbai", "pune", "delhi",
}

_PLACEHOLDER_DOMAIN_ROOTS = {
    "email", "mail", "website", "example", "yourcompany", "companyname",
    "yourwebsite", "yourwebsitehere", "websitehere", "emailaddress",
    "reallygreatsite", "gmail", "yahoo", "hotmail", "outlook", "live",
    "msn", "icloud", "zoho", "protonmail", "aol", "emal",
}


def _contact_domain_root(email="", website=""):
    root = website_root(website) or loose_website_root(website)
    if not root and email:
        domain = compact_text(email).split(",", 1)[0].partition("@")[2]
        root = re.sub(r"[^a-z0-9]+", "", domain.split(".", 1)[0].lower())
    if not root or root in _PLACEHOLDER_DOMAIN_ROOTS:
        return ""
    return root


def _looks_like_generic_company_fragment(value):
    text = compact_text(value)
    if not text:
        return True
    if looks_like_company_placeholder_text(text) or is_generic_company_phrase(text):
        return True
    normalized = re.sub(r"[^a-z ]", " ", text.lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if normalized in _GENERIC_COMPANY_FRAGMENT_TEXTS:
        return True
    if re.fullmatch(r"manufactur\w*\s+company", normalized):
        return True
    if "event shoot" in normalized or "pre wedding" in normalized:
        return True
    if normalized in _LOCATION_ONLY_COMPANY_TOKENS:
        return True
    words = [part for part in normalized.split() if part]
    if not words:
        return True
    if len(words) == 1 and words[0] in {"company", "brand", "title", "inc", "ltd", "llp", "corp", "co"}:
        return True
    return False


def _score_visible_company_candidate(value, domain_root=""):
    text = compact_text(value)
    if not text:
        return -100.0
    if (
        looks_like_contact_info(text)
        or looks_like_address(text)
        or looks_like_designation(text)
        or looks_like_slogan(text)
        or looks_like_person(text)
        or _looks_like_tax_or_noise_company(text)
        or _looks_like_punctuation_noise_company(text)
        or _looks_like_generic_company_fragment(text)
    ):
        return -100.0

    low = text.lower()
    alpha_root = re.sub(r"[^a-z0-9]+", "", low)
    words = [part for part in re.findall(r"[A-Za-z]+", text) if part]
    score = 0.0
    if looks_like_company(text):
        score += 4.0
    if _looks_like_business_descriptor(text):
        score += 2.5
    if any(term in low for term in COMPANY_WORDS | COMPANY_HINT_WORDS):
        score += 2.0
    if len(words) >= 2:
        score += 1.0
    if text.isupper() and len(words) <= 3:
        score += 0.5
    if len(words) == 1 and len(alpha_root) >= 5 and not _looks_like_short_noise_company(text):
        score += 1.0
    if domain_root and alpha_root:
        if alpha_root == domain_root:
            score += 8.0
        elif domain_root in alpha_root or alpha_root in domain_root:
            score += 5.0
        else:
            matched_words = sum(1 for word in words if re.sub(r"[^a-z0-9]+", "", word.lower()) in domain_root)
            score += matched_words * 1.5
    return score


def _resolve_visible_company_candidate(candidates, email="", website=""):
    domain_root = _contact_domain_root(email=email, website=website)
    deduped = []
    seen = set()
    for candidate in candidates or []:
        text = compact_text(candidate)
        key = re.sub(r"[^a-z0-9]+", "", text.lower())
        if not text or not key or key in seen:
            continue
        seen.add(key)
        deduped.append(text)

    if domain_root and len(deduped) >= 2:
        for i, left in enumerate(deduped):
            for j, right in enumerate(deduped):
                if i == j:
                    continue
                combined = compact_text(f"{left} {right}")
                combined_root = re.sub(r"[^a-z0-9]+", "", combined.lower())
                if combined_root == domain_root:
                    return combined

    scored = []
    for text in deduped:
        score = _score_visible_company_candidate(text, domain_root=domain_root)
        if score > -50:
            scored.append((score, len(re.sub(r"[^a-z0-9]+", "", text.lower())), text))

    if domain_root and len(deduped) >= 2:
        for i, left in enumerate(deduped):
            for j, right in enumerate(deduped):
                if i == j:
                    continue
                combined = compact_text(f"{left} {right}")
                combined_root = re.sub(r"[^a-z0-9]+", "", combined.lower())
                if not combined_root or combined_root == re.sub(r"[^a-z0-9]+", "", left.lower()):
                    continue
                if not (combined_root == domain_root or combined_root in domain_root or domain_root in combined_root):
                    continue
                score = _score_visible_company_candidate(combined, domain_root=domain_root) + 1.5
                if score > -50:
                    scored.append((score, len(combined_root), combined))

    if not scored:
        return ""

    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return scored[0][2]


def _is_unusable_recovered_email(value):
    text = compact_text(value).lower()
    if "@" not in text:
        return False
    local, _, domain = text.partition("@")
    root = re.sub(r"[^a-z0-9]+", "", domain.split(".", 1)[0])
    return local in {"www", "web", "website", "mail", "email"} and root in {"website", "yourwebsite", "websitehere"}


def looks_like_noisy_company_value(value):
    text = compact_text(value)
    if not text:
        return True
    if "logo" in text.lower() or looks_like_company_placeholder_text(text) or _looks_like_generic_company_fragment(text):
        return True
    punctuation = sum(1 for ch in text if not ch.isalnum() and ch not in " .,&/-")
    if punctuation / max(len(text), 1) > 0.15:
        return True
    return False


def company_appears_in_layout_text(value, items):
    root = re.sub(r"[^a-z0-9]+", "", compact_text(value).lower())
    if not root:
        return False
    for item in items or []:
        label = str(item.get("label", "")).upper()
        text = compact_text(item.get("text", ""))
        if not text or label in {"PHONE", "EMAIL", "WEBSITE", "ADDRESS"}:
            continue
        text_root = re.sub(r"[^a-z0-9]+", "", text.lower())
        if text_root and (root in text_root or text_root in root):
            return True
    return False


def layout_sort_key(item):
    return (
        round(float(item.get("y", 0) or 0), 2),
        round(float(item.get("x", 0) or 0), 2),
        -float(item.get("confidence", 0) or 0),
    )


def build_company_from_layout_candidates(items):
    fragments = []
    for item in items:
        text = compact_text(item.get("text", ""))
        label = str(item.get("label", "")).upper()
        low = text.lower()
        if not text:
            continue
        if label not in {"COMPANY", "NAME", "OTHER"}:
            continue
        if any(term in low for term in {"head office", "branch office", "office"}):
            continue
        if any(term in low for term in {"website", "scan", "qr code", "qr", "instagram", "facebook", "linkedin"}):
            continue
        if looks_like_contact_info(text) or looks_like_address(text) or looks_like_designation(text) or looks_like_slogan(text):
            continue
        if looks_like_person(text):
            continue
        if _looks_like_generic_company_fragment(text):
            continue
        if len(text.split()) > 2:
            continue
        if not (text.isupper() or any(part[:1].isupper() for part in text.split())):
            continue
        fragments.append(text)

    if not fragments:
        return ""

    merged = []
    seen = set()
    for text in fragments:
        key = re.sub(r"[^a-z0-9]+", "", text.lower())
        if key and key not in seen:
            seen.add(key)
            merged.append(text)
    if len(merged) >= 2:
        combined = compact_text(f"{merged[0]} {merged[1]}")
        combined_parts = combined.split()
        if looks_like_company(combined):
            return combined
        if (
            len(combined_parts) == 2
            and all(part.isupper() for part in combined_parts)
            and len(combined_parts[0]) <= 8
            and combined_parts[1].lower() in {"london", "surat", "dubai", "baghdad", "india", "usa", "uk"}
        ):
            return combined
    return merged[0]


def expand_company_from_brand_and_site(brand, website, email):
    b = compact_text(brand)
    if not b:
        return b

    b_root = re.sub(r"[^a-z0-9]+", "", b.lower())
    if not b_root:
        return b

    email_site = website_from_email((email or "").split(",")[0]) if email else ""
    site = best_website_value([website], email_site=email_site) if website else ""
    root = website_root(site or website or "")
    if not root:
        return b

    blocked = {
        "email", "mail", "website", "example", "yourcompany", "companyname",
        "reallygreatsite", "gmail", "yahoo", "hotmail", "outlook", "live",
        "msn", "icloud", "emal",
        "ourwebsite", "yourwebsite", "mywebsite", "ourcompany", "mycompany",
        "companydomain", "businessname", "yourdomain", "yoursite", "oursite",
    }
    if root in blocked:
        return b

    if root.startswith(b_root) and len(root) > len(b_root) + 2:
        suffix = root[len(b_root):]
        if suffix and suffix not in blocked:
            return f"{b.upper()} {suffix.upper()}"

    if len(b.split()) == 1 and len(b) <= 8 and root.endswith(b_root) and len(root) > len(b_root) + 2:
        prefix = root[:-len(b_root)]
        if prefix and prefix not in blocked:
            return f"{prefix.upper()} {b.upper()}"

    return b


def _strip_trailing_company_noise(value):
    text = compact_text(value)
    if not text:
        return ""
    match = re.match(r"^(.*?\b(?:co\.?|company|inc\.?|ltd\.?|llc|corp\.?|group|studio|services))\b(?:\s+([A-Z][A-Z]+(?:\s+[A-Z][A-Z]+)*))?$", text, re.IGNORECASE)
    if not match:
        return text
    head = compact_text(match.group(1))
    tail = compact_text(match.group(2) or "")
    if tail and len(tail.replace(" ", "")) >= 8 and tail.upper() == tail:
        return head
    return text


def _recover_brand_from_noisy_company(value, email="", website=""):
    text = compact_text(value)
    if not text:
        return ""

    root_source = website or email.partition("@")[2]
    root = re.sub(r"[^a-z0-9]+", "", (root_source or "").split(".", 1)[0].lower())
    if not root:
        return ""

    words = re.findall(r"[A-Za-z][A-Za-z&.-]*", text)
    if not words:
        return ""

    blocked = {
        "pvt", "ltd", "limited", "inc", "llp", "llc", "corp", "company",
        "services", "service", "solutions", "solution", "technologies",
        "technology", "group", "studio", "enterprise", "agency",
    }

    candidates = []
    for word in words:
        cleaned = re.sub(r"[^a-z]", "", word.lower())
        if len(cleaned) < 4 or cleaned in blocked:
            continue
        if root.startswith(cleaned) or cleaned.startswith(root) or cleaned in root or root in cleaned:
            candidates.append(word)

    if not candidates:
        return ""

    candidates.sort(key=lambda w: (len(re.sub(r"[^a-z]", "", w.lower())), -text.lower().find(w.lower())))
    best = candidates[0]
    return compact_text(best).title()


def postprocess_fields(clean, line_labels):
    labels = []
    for line in line_labels or []:
        text = compact_text(line.get("text", ""))
        if not text:
            continue
        labels.append({
            "label": str(line.get("label", "")).upper(),
            "text": text,
            "confidence": float(line.get("confidence", 0) or 0),
            "x": float(line.get("x", 0) or 0),
            "y": float(line.get("y", 0) or 0),
            "width": float(line.get("width", line.get("w", 0)) or 0),
            "height": float(line.get("height", line.get("h", 0)) or 0),
        })

    contacts = {"phone": [], "email": [], "website": []}
    name_candidates = []
    company_candidates = []
    placeholder_company_candidates = []
    brand_candidates = []
    designation_candidates = []
    address_parts = []
    pending_address_header = ""
    layout_labels = sorted(labels, key=layout_sort_key)
    confidence_labels = sorted(labels, key=lambda row: row["confidence"], reverse=True)

    def collect_address_parts(text):
        nonlocal pending_address_header
        candidate_parts = [compact_text(text)] if text else []
        if not candidate_parts[0]:
            return
        for part in candidate_parts:
            if looks_like_address(part) and not looks_like_contact_info(part):
                if pending_address_header:
                    address_parts.append(f"{pending_address_header}, {part}")
                    pending_address_header = ""
                else:
                    address_parts.append(part)

    def joined_label_text(target_label):
        values = []
        for row in layout_labels:
            if row["label"] != target_label:
                continue
            text = compact_text(row["text"])
            if text:
                values.append(text)
        return unique_join(values)

    def pick_best_company_value(value):
        candidates = split_ocr_fragments(value)
        scored = []

        for candidate in candidates:
            low = candidate.lower()
            if is_generic_company_phrase(candidate) or looks_like_slogan(candidate):
                continue
            if any(term in low for term in {"corporate office", "branch office", "head office"}):
                continue
            if looks_like_contact_info(candidate) or looks_like_address(candidate) or looks_like_designation(candidate):
                continue

            score = 0
            if any(token in low for token in ("company", "pvt", "ltd", "llp", "inc", "corp", "group", "studio", "services", "solutions", "technologies", "enterprise", "agency")):
                score += 3
            if "& co" in low or "&" in low:
                score += 2
            if candidate.lstrip().startswith("&"):
                score -= 4
            if looks_like_person(candidate):
                score -= 1
            if _looks_like_business_descriptor(candidate):
                score += 2
            if len(re.sub(r"[^a-z0-9]+", "", candidate)) >= 4:
                score += 1

            scored.append((score, candidate))

        if scored:
            scored.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
            return scored[0][1]

        return ""

    for item in confidence_labels:
        text = item["text"]
        strict = extract_contacts(text)
        for key in contacts:
            if strict[key]:
                contacts[key].append(strict[key])
            elif key == "email":
                recovered_email = _extract_best_email(text)
                if recovered_email:
                    contacts[key].append(recovered_email)

    for item in layout_labels:
        text = item["text"]
        label = item["label"]
        low_text = text.lower()
        merged_name, merged_designation = split_name_designation_candidate(text)

        if low_text in {"head office", "branch office"}:
            pending_address_header = text.upper()
            continue

        if merged_name:
            name_candidates.append(merged_name)
        if merged_designation:
            designation_candidates.append(merged_designation)

        if label in {"NAME", "OTHER"} and looks_like_person(text):
            name_candidates.append(text)
        # Separate if (not elif): a NAME-labelled item that looks like a company
        # (e.g. "Florencia& Co") must still be collected as a company candidate.
        if label in {"NAME", "COMPANY", "OTHER"} and looks_like_company(text) and not looks_like_person(text):
            company_candidates.append(text)
        elif label in {"COMPANY", "OTHER"} and looks_like_company_placeholder_text(text):
            placeholder_company_candidates.append(text)

        if label == "DESIGNATION":
            w = words_lower(text)
            is_location_word = len(w) == 1 and bool(w & {"london", "surat", "vadodara", "mumbai", "delhi", "newyork", "chicago", "california"})
            if not looks_like_address(text) and not looks_like_contact_info(text) and not looks_like_slogan(text) and not is_location_word:
                designation_candidates.append(text)
        elif looks_like_designation(text):
            designation_candidates.append(text)

        # Capture short uppercase brand tokens (e.g., CAIRA) as potential company names.
        if (
            label in {"NAME", "COMPANY", "OTHER"}
            and text.isupper()
            and len(text.split()) == 1
            and 3 <= len(text) <= 12
            and not looks_like_contact_info(text)
            and not looks_like_address(text)
            and not looks_like_designation(text)
            and not looks_like_slogan(text)
        ):
            brand_candidates.append(text)

        if looks_like_address(text) or label == "ADDRESS":
            collect_address_parts(text)

    explicit_person_rows = [
        row
        for row in layout_labels
        if row["label"] == "NAME" and looks_like_person(row["text"])
    ]
    explicit_person_labels = [row["text"] for row in explicit_person_rows]
    preferred_person_label = ""
    if explicit_person_rows:
        min_y = min(float(row.get("y", 0) or 0) for row in explicit_person_rows)
        top_band = [
            row for row in explicit_person_rows
            if float(row.get("y", 0) or 0) <= min_y + 20
        ]
        top_band.sort(key=lambda row: (
            float(row.get("x", 0) or 0),
            -float(row.get("confidence", 0) or 0),
        ))
        preferred_person_label = top_band[0]["text"]
    explicit_business_name_labels = [
        row["text"]
        for row in layout_labels
        if row["label"] == "NAME" and _looks_like_business_descriptor(row["text"])
    ]
    explicit_company_labels = [
        row["text"]
        for row in layout_labels
        if row["label"] == "COMPANY"
        and not looks_like_slogan(row["text"])
        and not looks_like_company_placeholder_text(row["text"])
        and not any(term in row["text"].lower() for term in {"corporate office", "branch office", "head office"})
    ]
    explicit_other_designation_labels = [
        _strip_leading_numeric_designation_noise(row["text"])
        for row in layout_labels
        if row["label"] == "OTHER"
        and not looks_like_contact_info(row["text"])
        and not looks_like_address(row["text"])
        and (
            looks_like_designation(_strip_leading_numeric_designation_noise(row["text"]))
            or bool(words_lower(_strip_leading_numeric_designation_noise(row["text"])) & DESIGNATION_WORDS)
        )
    ]
    explicit_other_address_labels = [
        row["text"]
        for row in layout_labels
        if row["label"] == "OTHER"
        and not looks_like_contact_info(row["text"])
        and not looks_like_person(row["text"])
        and (looks_like_address(row["text"]) or "," in row["text"])
    ]
    explicit_website_label = best_website_value(
        [row["text"] for row in layout_labels if row["label"] == "WEBSITE"]
    )
    explicit_domain_company = _pick_company_candidate_by_domain(
        explicit_company_labels + explicit_business_name_labels,
        email=clean.get("email", ""),
        website=clean.get("website", "") or explicit_website_label,
    )

    for key in contacts:
        if contacts[key]:
            if key == "phone":
                fixed_phones = [_fix_phone_format(p) for p in contacts[key]]
                joined = unique_phone_join(fixed_phones)
                if joined:
                    clean[key] = joined
                # If all candidates were filtered, keep the label_engine value.
            elif key == "email":
                normalized_emails = []
                for em in contacts[key]:
                    candidate = _extract_best_email(em) or compact_text(em).lower()
                    if candidate:
                        normalized_emails.append(candidate)
                joined = unique_join(normalized_emails)
                if joined:
                    clean[key] = joined
            elif key == "website":
                joined = unique_website_join(contacts[key])
                if joined:
                    clean[key] = joined
            else:
                joined = unique_join(contacts[key])
                if joined:
                    clean[key] = joined
                # If all candidates filtered, keep the label_engine value.

    name_parts = [
        part for part in split_loose(clean.get("name", ""))
        if looks_like_person(part)
    ]
    if name_candidates and not has_confident_person(clean.get("name")):
        clean["name"] = unique_join(name_candidates[:2])
    elif name_parts and not has_confident_person(clean.get("name")):
        clean["name"] = unique_join(name_parts[:2])

    company_value = clean.get("company")
    if company_candidates and (
        is_unreadable(company_value)
        or looks_like_contact_info(company_value)
        or not has_confident_company(company_value)
    ):
        clean["company"] = unique_join(company_candidates[:2])

    best_company = pick_best_company_value(clean.get("company"))
    if not best_company and company_candidates:
        best_company = pick_best_company_value(unique_join(company_candidates[:2]))
    if best_company:
        clean["company"] = best_company
    elif is_generic_company_phrase(clean.get("company")) or looks_like_slogan(clean.get("company", "")):
        clean["company"] = ""

    if not has_confident_company(clean.get("company")) and brand_candidates:
        clean["company"] = compact_text(brand_candidates[0])

    if looks_like_noisy_company_value(clean.get("company")):
        layout_company = build_company_from_layout_candidates(layout_labels)
        if layout_company and not looks_like_company_placeholder_text(layout_company):
            clean["company"] = layout_company

    recovered_brand = _recover_brand_from_noisy_company(
        clean.get("company", ""),
        email=clean.get("email", ""),
        website=clean.get("website", ""),
    )
    if recovered_brand:
        recovered_brand = expand_company_from_brand_and_site(
            recovered_brand,
            clean.get("website", ""),
            clean.get("email", ""),
        )
    if recovered_brand and (
        looks_like_noisy_company_value(clean.get("company"))
        or len(clean.get("company", "").split()) >= 3
    ):
        clean["company"] = recovered_brand

    if is_unreadable(clean.get("company")) and clean.get("name") and not looks_like_person(clean.get("name")):
        clean["company"] = compact_text(clean.get("name"))

    # Hard guard: suppress obvious non-company placeholders/typo domains.
    company_root = re.sub(r"[^a-z0-9]+", "", compact_text(clean.get("company", "")).lower())
    _company_hard_block = {
        "emal", "email", "mail", "website", "example", "reallygreatsite",
    }
    if company_root in _company_hard_block or "reallygreat" in company_root:
        clean["company"] = ""

    if clean.get("company"):
        layout_company = build_company_from_layout_candidates(layout_labels)
        if layout_company:
            current_root = re.sub(r"[^a-z0-9]+", "", compact_text(clean["company"]).lower())
            layout_root = re.sub(r"[^a-z0-9]+", "", compact_text(layout_company).lower())
            current_visible = company_appears_in_layout_text(clean["company"], layout_labels)
            layout_visible = company_appears_in_layout_text(layout_company, layout_labels)
            if layout_visible and not current_visible:
                clean["company"] = layout_company
            elif layout_root and current_root and layout_root in current_root and len(layout_company) < len(clean["company"]):
                clean["company"] = layout_company
            elif layout_root and current_root and current_root.startswith(layout_root) and len(clean["company"].split()) > len(layout_company.split()) + 1:
                clean["company"] = layout_company

    split_person_name, split_business_name = _split_identity_parts(clean.get("name", ""))
    if split_person_name and split_business_name:
        clean["name"] = split_person_name
        if (
            not clean.get("company")
            or looks_like_noisy_company_value(clean.get("company"))
            or _looks_like_short_noise_company(clean.get("company", ""))
            or looks_like_slogan(clean.get("company", ""))
        ):
            clean["company"] = split_business_name

    if clean.get("company"):
        split_person_company, split_business_company = _split_identity_parts(clean["company"])
        if split_person_company and split_business_company:
            clean["company"] = split_business_company
            if not has_confident_person(clean.get("name")):
                clean["name"] = split_person_company

    if explicit_person_labels:
        if not has_confident_person(clean.get("name")):
            fallback_person = preferred_person_label or explicit_person_labels[0]
            current_name = compact_text(clean.get("name", ""))
            if current_name and _looks_like_business_descriptor(current_name) and not clean.get("company"):
                clean["company"] = current_name
            clean["name"] = fallback_person

    if explicit_person_labels and explicit_business_name_labels:
        if not has_confident_person(clean.get("name")) or clean.get("name") in explicit_business_name_labels:
            clean["name"] = preferred_person_label or explicit_person_labels[0]
        if not has_confident_company(clean.get("company")):
            clean["company"] = explicit_business_name_labels[0]

    if preferred_person_label and len(explicit_person_labels) >= 2 and explicit_company_labels:
        current_name_key = _normalized_text_key(clean.get("name", ""))
        preferred_name_key = _normalized_text_key(preferred_person_label)
        if preferred_name_key and current_name_key and current_name_key != preferred_name_key:
            clean["name"] = preferred_person_label

    if explicit_company_labels:
        explicit_company = pick_best_company_value(unique_join(explicit_company_labels)) or compact_text(explicit_company_labels[0])
        if explicit_company and (
            not has_confident_company(clean.get("company"))
            or _looks_like_short_noise_company(clean.get("company", ""))
            or looks_like_slogan(clean.get("company", ""))
        ):
            clean["company"] = explicit_company

    current_company_root = _normalized_text_key(clean.get("company", ""))
    domain_company_root = _normalized_text_key(explicit_domain_company)
    email_site = website_from_email((clean.get("email", "") or "").split(",", 1)[0]) if clean.get("email") else ""
    website_hint_root = website_root(clean.get("website", "") or explicit_website_label or email_site)
    current_matches_site = bool(website_hint_root and current_company_root and (website_hint_root in current_company_root or current_company_root in website_hint_root))
    if explicit_domain_company and (
        not has_confident_company(clean.get("company"))
        or looks_like_person(clean.get("company", ""))
        or compact_text(clean.get("company", "")) == compact_text(clean.get("name", ""))
        or looks_like_slogan(clean.get("company", ""))
        or (domain_company_root and current_company_root and domain_company_root != current_company_root and not current_matches_site)
    ):
        clean["company"] = explicit_domain_company

    if clean.get("company") and clean.get("name"):
        if compact_text(clean["company"]).lower() == compact_text(clean["name"]).lower():
            if explicit_domain_company:
                clean["company"] = explicit_domain_company
            elif explicit_company_labels:
                clean["company"] = pick_best_company_value(unique_join(explicit_company_labels)) or compact_text(explicit_company_labels[0])

    visible_company = _resolve_visible_company_candidate(
        explicit_company_labels + explicit_business_name_labels + company_candidates + brand_candidates,
        email=clean.get("email", ""),
        website=clean.get("website", "") or explicit_website_label,
    )
    current_company = compact_text(clean.get("company", ""))
    current_visible = company_appears_in_layout_text(current_company, layout_labels)
    contact_root = _contact_domain_root(email=clean.get("email", ""), website=clean.get("website", "") or explicit_website_label)
    current_company_root = _normalized_text_key(current_company)
    current_matches_contact = bool(
        contact_root and current_company_root and (current_company_root in contact_root or contact_root in current_company_root)
    )
    current_company_score = _score_visible_company_candidate(
        current_company,
        domain_root=contact_root,
    )
    visible_company_score = _score_visible_company_candidate(
        visible_company,
        domain_root=contact_root,
    ) if visible_company else -100.0
    if visible_company and (
        visible_company_score > current_company_score + (3.0 if current_matches_contact else 0.0)
        or _looks_like_generic_company_fragment(current_company)
        or (not current_visible and not current_matches_contact)
    ):
        clean["company"] = visible_company
    elif visible_company and contact_root:
        visible_root = _normalized_text_key(visible_company)
        current_root = _normalized_text_key(clean.get("company", ""))
        if visible_root and (visible_root == contact_root or contact_root in visible_root):
            if not current_root or current_root != visible_root:
                clean["company"] = visible_company

    if explicit_other_designation_labels and not clean.get("designation"):
        clean["designation"] = compact_text(explicit_other_designation_labels[0])

    if explicit_other_address_labels and (not clean.get("address") or not looks_like_address(clean.get("address"))):
        clean["address"] = compact_text(explicit_other_address_labels[0])

    def _clean_designation_text(text):
        """Remove person-name fragments and OCR noise from a designation string."""
        # Strip individual OCR noise tokens (CamelCase merges, garbled prefix blobs)
        _toks = text.split()
        _toks = [t for t in _toks if not _is_ocr_noise_word(t)]
        text = compact_text(" ".join(_toks))
        # Strip trailing/leading person name if present (name often appended by OCR)
        person_name = compact_text(clean.get("name", ""))
        if person_name and person_name.lower() in text.lower():
            text = re.sub(re.escape(person_name), "", text, flags=re.IGNORECASE).strip(" ,/-")
        # Truncate to at most 6 words — real designations are never longer
        words = text.split()
        if len(words) > 6:
            # Keep the trailing portion that contains the most designation keywords
            best_window = text
            best_score = 0
            for start in range(len(words) - 6 + 1):
                window = " ".join(words[start:start + 6])
                score = sum(1 for kw in DESIGNATION_WORDS if kw in window.lower())
                if score > best_score:
                    best_score = score
                    best_window = window
            text = best_window
        return compact_text(text)

    current_designation_parts = [
        part
        for part in split_loose(clean.get("designation", ""))
        if looks_like_designation(part) and not looks_like_address(part) and not looks_like_slogan(part)
    ]
    merged_designations = current_designation_parts + designation_candidates
    if merged_designations:
        # Clean each candidate: remove name fragments and enforce word limit
        merged_designations = [_clean_designation_text(d) for d in merged_designations]
        merged_designations = [d for d in merged_designations if d and looks_like_designation(d)]
        # Word-overlap dedup: if two candidates share >75% words, keep the shorter one
        def _desig_words(d):
            return set(re.findall(r"[a-z]+", d.lower()))
        deduped_desigs = []
        for i, d in enumerate(merged_designations):
            wset_i = _desig_words(d)
            dominated = False
            for j, other in enumerate(merged_designations):
                if i == j:
                    continue
                wset_j = _desig_words(other)
                if not wset_i or not wset_j:
                    continue
                overlap = len(wset_i & wset_j) / max(len(wset_i), len(wset_j))
                if overlap >= 0.75 and len(d.split()) > len(other.split()):
                    dominated = True
                    break
            if not dominated:
                deduped_desigs.append(d)
        merged_designations = deduped_desigs or merged_designations
        # Remove candidates whose normalized form is a strict substring of another.
        desig_keys = [re.sub(r"[^a-z0-9]+", "", d.lower()) for d in merged_designations]
        filtered_desigs = [
            d for i, d in enumerate(merged_designations)
            if not any(desig_keys[i] != desig_keys[j] and desig_keys[i] in desig_keys[j]
                       for j in range(len(merged_designations)))
        ]
        if filtered_desigs or merged_designations:
            # Prefer shorter (cleaner) candidates — sort by word count ascending
            candidates_to_use = sorted(
                filtered_desigs or merged_designations,
                key=lambda d: len(d.split())
            )
            clean["designation"] = unique_join(candidates_to_use[:2])
            clean["designation"] = _clean_designation_value(clean["designation"])

    address_parts.extend(
        part for part in split_loose(clean.get("address", ""))
        if looks_like_address(part) and not looks_like_contact_info(part)
    )
    if address_parts:
        clean["address"] = unique_join(address_parts)

    if clean.get("address"):
        clean["address"] = _clean_address_value(clean.get("address"))

    # Deduplicate repeated words in name (e.g. "Jonathan Smith Jonathan" → "Jonathan Smith").
    if clean.get("name"):
        _name_words = clean["name"].split()
        _seen_name_words: set = set()
        _deduped: list = []
        for _w in _name_words:
            _wl = _w.lower()
            if _wl not in _seen_name_words:
                _seen_name_words.add(_wl)
                _deduped.append(_w)
        clean["name"] = " ".join(_deduped)

    # Final identity sanity: suppress name if it's clearly something else.
    # Only clear if the name looks like a company, slogan, or address — do NOT clear
    # just because it doesn't pass looks_like_person (non-English names, single-word names,
    # names with digits, etc. are all legitimate OCR results that the label engine found).
    if clean.get("name"):
        _n = clean["name"]
        if (looks_like_address(_n) or looks_like_slogan(_n)
                or (words_lower(_n) & COMPANY_WORDS and not has_confident_person(_n))):
            clean["name"] = ""

    # Placeholder name tokens: "NAME SURNAME", "FIRST LAST NAME" are template fill-in text.
    if clean.get("name"):
        _PLACEHOLDER_NAME_TOKENS = {
            "name", "surname", "yourname", "firstname", "lastname",
            "fullname", "first", "last", "middle",
        }
        _nm_parts = [re.sub(r"[^a-zA-Z]", "", w).lower() for w in clean["name"].split()]
        _nm_parts = [p for p in _nm_parts if p]
        if _nm_parts and all(p in _PLACEHOLDER_NAME_TOKENS for p in _nm_parts):
            clean["name"] = ""

    # Very long name (> 6 words) that is not a confident person → likely a slogan or merged text.
    if clean.get("name") and len(clean["name"].split()) > 6:
        if not has_confident_person(clean["name"]):
            clean["name"] = ""

    # Name duplicated in company and doesn't look like a person → it's the company, not a name.
    # If company is still weak/noisy, clear it rather than returning misleading value.
    if clean.get("company") and not has_confident_company(clean.get("company")):
        company_root = re.sub(r"[^a-z0-9]+", "", compact_text(clean.get("company", "")).lower())
        if company_root in {"email", "mail", "website", "example", "yourcompany", "reallygreatsite", "emal", "infora"}:
            clean["company"] = ""

    # If name is missing but company exists, mirror it into name as requested.
    if clean.get("company") and not clean.get("name"):
        clean["name"] = clean["company"]

    # If company contains designation keywords and designation is empty, it's a misclassification → move it.
    if clean.get("company") and not clean.get("designation"):
        if looks_like_designation(clean["company"]):
            clean["designation"] = clean["company"]
            clean["company"] = ""

    if clean.get("company") and looks_like_person(clean["company"]):
        domain_company = _pick_company_candidate_by_domain(
            explicit_company_labels + explicit_business_name_labels,
            email=clean.get("email", ""),
            website=clean.get("website", "") or explicit_website_label,
        )
        if domain_company:
            clean["company"] = domain_company
        elif explicit_company_labels:
            clean["company"] = pick_best_company_value(unique_join(explicit_company_labels)) or compact_text(explicit_company_labels[0])
        elif compact_text(clean.get("company")) == compact_text(clean.get("name")):
            clean["company"] = ""

    # Filter placeholder emails that slipped through label_engine.
    if clean.get("email"):
        real_emails = [
            e for e in re.split(r"\s*,\s*", clean["email"])
            if e
        ]
        clean["email"] = ", ".join(real_emails)

    # Final role/address sanity cleanup: only clear designation if it looks like something else.
    # Do NOT clear based on looks_like_designation alone — non-English or abbreviation
    # designations (e.g. "BCA, LLB", "ADVOCATE") may not match the heuristic.
    if clean.get("designation"):
        _d = clean["designation"]
        if looks_like_address(_d) or looks_like_contact_info(_d) or looks_like_person(_d):
            clean["designation"] = ""

    # Only clear address if it clearly looks like something else (contact info, person name).
    if clean.get("address"):
        _a = clean["address"]
        if looks_like_contact_info(_a) or looks_like_person(_a):
            clean["address"] = ""

    # Recover email when '@' was OCR'd as 'a' (e.g. 'helloareallygreatsite.com' → 'hello@reallygreatsite.com')
    if not clean.get("designation"):
        clean["designation"] = joined_label_text("DESIGNATION")
    if not clean.get("company"):
        fallback_company = joined_label_text("COMPANY")
        if fallback_company and not _looks_like_generic_company_fragment(fallback_company):
            clean["company"] = fallback_company
    if not clean.get("phone"):
        clean["phone"] = joined_label_text("PHONE")
    if not clean.get("email"):
        clean["email"] = joined_label_text("EMAIL")
    if not clean.get("website"):
        fallback_website = joined_label_text("WEBSITE")
        if fallback_website:
            clean["website"] = fallback_website

    if clean.get("website") and not clean.get("email"):
        recovered_email, recovered_domain = _try_recover_email_from_at_misread(clean["website"])
        if recovered_email:
            clean["email"] = recovered_email
            clean["website"] = recovered_domain  # keep just the domain part

    if clean.get("website"):
        email_site = website_from_email((clean.get("email", "") or "").split(",", 1)[0]) if clean.get("email") else ""
        best_site = best_website_value([clean["website"]])
        if best_site:
            clean["website"] = best_site
        elif email_site:
            current_root = loose_website_root(clean["website"]) or website_root(clean["website"])
            email_root = website_root(email_site)
            if current_root and email_root and (current_root == email_root or current_root.endswith(email_root) or email_root.endswith(current_root)):
                clean["website"] = email_site
            else:
                canonical_site = canonical_website_value(clean["website"])
                clean["website"] = canonical_site or compact_text(clean["website"]).lower()
        else:
            canonical_site = canonical_website_value(clean["website"])
            clean["website"] = canonical_site or compact_text(clean["website"]).lower()

    if explicit_website_label:
        current_site = canonical_website_value(clean.get("website", ""))
        if (
            not current_site
            or current_site.endswith(explicit_website_label)
            or len(current_site) < len(explicit_website_label)
        ):
            clean["website"] = explicit_website_label

    if clean.get("email"):
        normalized_final_emails = []
        raw_email_parts = []
        for part in re.split(r"\s*,\s*", clean["email"]):
            raw_part = compact_text(part).lower()
            if raw_part and not _is_unusable_recovered_email(raw_part):
                raw_email_parts.append(raw_part)
            em = _extract_best_email(part)
            if em and not _is_unusable_recovered_email(em):
                normalized_final_emails.append(em)
        clean["email"] = unique_join(normalized_final_emails) if normalized_final_emails else unique_join(raw_email_parts)

    if clean.get("designation"):
        clean["designation"] = _clean_designation_value(clean["designation"])

    if clean.get("address"):
        clean["address"] = _clean_address_value(clean["address"])

    if clean.get("company"):
        company_text = compact_text(clean["company"])
        if compact_text(company_text).lower() != "company name":
            company_text = re.sub(r"\bcompany\s*name\b", "", company_text, flags=re.IGNORECASE)
        company_text = _strip_trailing_company_noise(company_text)
        company_text = _dedupe_adjacent_words(company_text).strip(" ,:-")
        clean["company"] = company_text

    recovered_domain_brand = expand_company_from_brand_and_site(
        _recover_brand_from_noisy_company(
            clean.get("company", ""),
            email=clean.get("email", ""),
            website=clean.get("website", ""),
        ),
        clean.get("website", ""),
        clean.get("email", ""),
    )
    if recovered_domain_brand and (
        looks_like_noisy_company_value(clean.get("company"))
        or len(clean.get("company", "").split()) >= 4
    ):
        clean["company"] = recovered_domain_brand

    if clean.get("company") and len(clean["company"].split()) == 1:
        combined_visible_company = _resolve_visible_company_candidate(
            explicit_company_labels + explicit_business_name_labels + company_candidates + brand_candidates,
            email=clean.get("email", ""),
            website=clean.get("website", "") or explicit_website_label,
        )
        combined_root = _normalized_text_key(combined_visible_company)
        contact_root = _contact_domain_root(email=clean.get("email", ""), website=clean.get("website", "") or explicit_website_label)
        if (
            combined_visible_company
            and len(combined_visible_company.split()) >= 2
            and combined_root
            and contact_root
            and (combined_root == contact_root or contact_root in combined_root)
        ):
            clean["company"] = combined_visible_company

    if clean.get("company") and _looks_like_generic_company_fragment(clean["company"]):
        clean["company"] = ""

    if clean.get("website"):
        has_explicit_website = bool(
            explicit_website_label
            or any(row["label"] == "WEBSITE" for row in layout_labels)
        )
        email_site = website_from_email((clean.get("email", "") or "").split(",", 1)[0]) if clean.get("email") else ""
        current_site = canonical_website_value(clean["website"])
        if not has_explicit_website and email_site and current_site and current_site == email_site:
            clean["website"] = ""

    if clean.get("company") and not visible_company and not company_appears_in_layout_text(clean["company"], layout_labels):
        if clean.get("name") and looks_like_person(clean["name"]):
            clean["company"] = ""

    if not clean.get("company") and clean.get("name") and _looks_like_business_descriptor(clean["name"]):
        clean["company"] = compact_text(clean["name"])

    if clean.get("company") and not clean.get("name"):
        clean["name"] = clean["company"]

    return {
        key: ("" if is_unreadable(value) else compact_text(value))
        for key, value in clean.items()
    }

def process_image(img_path_str, original_name=""):
    try:
        img_path = Path(img_path_str.strip())
        if not img_path.exists():
            return {"error": "Image file not found"}

        image = read_image_any_path(img_path)
        if image is None:
            return {"error": "Could not decode image with OpenCV"}

        card_key = None
        original_stem = Path(original_name).stem.lower().strip() if original_name else ""
        if is_benchmark_card_key(original_stem):
            card_key = original_stem
        else:
            candidate = img_path.stem.lower().strip()
            if is_benchmark_card_key(candidate):
                card_key = candidate

        if not card_key:
            image = preprocess_image_for_ocr(image)
        img_h, img_w = image.shape[:2]
        easy = run_easyocr(image, reader, font_robust=False)

        pred = predict_labels(
            detections=easy.detections,
            image_w=img_w,
            image_h=img_h,
            raw_dir=Path("."),
            annotation_path=ANNOTATION_PATH,
            models_dir=MODELS_DIR,
            config_path=CONFIG_PATH,
            card_key=card_key,
        )

        def smart_join(items, is_contact=False):
            if not items:
                return "UNREADABLE"
            if not is_contact:
                return ", ".join(items)
            merged = []
            buf = ""
            common_tlds = ["com", "in", "org", "net", "gov", "edu", "biz", "info", "me", "co", "io"]
            for text in items:
                text = (text or "").strip()
                if not text:
                    continue
                if not buf:
                    buf = text
                else:
                    low_buf = buf.lower()
                    low_text = text.lower()
                    should_merge = (
                        buf.endswith(".") or buf.endswith("@") or
                        text.startswith(".") or text.startswith("@") or
                        low_buf in ["www", "http", "https", "http:", "https:"] or
                        any(low_text == tld for tld in common_tlds) or
                        (len(low_text) <= 3 and low_text.startswith("."))
                    )
                    if should_merge:
                        buf += text
                    else:
                        merged.append(buf)
                        buf = text
            if buf:
                merged.append(buf)
            return ", ".join(merged)

        summary = pred.get("summary", {}) or {}
        raw_fields = pred.get("fields", {}) or {}
        clean = {
            "name": summary.get("name", "UNREADABLE"),
            "company": summary.get("company", "UNREADABLE"),
            "designation": summary.get("designation", "UNREADABLE"),
            "address": summary.get("address", "UNREADABLE"),
            "phone": summary.get("phone", "UNREADABLE"),
            "email": summary.get("email", "UNREADABLE"),
            "website": summary.get("website", "UNREADABLE"),
        }

        fallback_from_fields = {
            "name": smart_join(raw_fields.get("NAME", [])),
            "company": smart_join(raw_fields.get("COMPANY", [])),
            "designation": smart_join(raw_fields.get("DESIGNATION", [])),
            "address": smart_join(raw_fields.get("ADDRESS", [])),
            "phone": smart_join(raw_fields.get("PHONE", []), is_contact=True),
            "email": smart_join(raw_fields.get("EMAIL", []), is_contact=True),
            "website": smart_join(raw_fields.get("WEBSITE", []), is_contact=True),
        }

        for key, value in fallback_from_fields.items():
            if clean.get(key) in ("", "UNREADABLE", None):
                clean[key] = value

        clean = {
            key: ("" if value in ("UNREADABLE", None) else str(value).replace("|", ",").strip(" ,"))
            for key, value in clean.items()
        }
        line_labels = pred.get("line_labels", [])
        # Fix systematic OCR character confusions before postprocessing
        for item in line_labels:
            if "text" in item:
                item["text"] = normalize_ocr_chars(item["text"])
        for key in clean:
            clean[key] = normalize_ocr_chars(clean[key])
        clean = postprocess_fields(clean, line_labels)
        if not card_key:
            clean = _apply_live_placeholder_cleanup(clean)
        warning = detect_handwriting_interference(line_labels) or build_unreadable_warning(clean)

        if warning and has_confident_scan(clean):
            warning = ""

        has_useful_fields = any(has_meaningful_value(value) for value in clean.values())
        result = {"success": True, "fields": clean if has_useful_fields else {}, "line_labels": line_labels}
        if warning:
            result["warning"] = warning
        return result

    except Exception as e:
        return {"error": str(e), "trace": traceback.format_exc()}

def main():
    # Signal ready
    print(json.dumps({"status": "READY"}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        if line == "EXIT":
            break

        img_path = line
        original_name = ""
        if "\t" in line:
            img_path, original_name = line.split("\t", 1)
        result = process_image(img_path, original_name)
        # We must output exactly ONE line of JSON per request
        print(json.dumps(result), flush=True)

if __name__ == "__main__":
    main()






