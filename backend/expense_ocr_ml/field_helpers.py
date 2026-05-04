import re
from typing import Dict, List

from category_rules import CATEGORY_RULES
from ocr_ensemble import extract_amount_values, extract_date_value, text_has_amount, text_has_date


FIELD_THRESHOLDS = {
    "Vendor": 0.50,
    "Date": 0.50,
    "Total": 0.55,
    "Description": 0.58,
    "Category": 0.32,
}
TARGET_FIELDS = ["Vendor", "Date", "Total", "Description", "Category"]
MAX_REASONABLE_TOTAL = 200000.0
CATEGORY_MODEL_MIN_CONFIDENCE = 0.50
VENDOR_STOPWORDS = (
    "invoice",
    "date",
    "time",
    "gst",
    "tel",
    "phone",
    "mobile",
    "vehicle",
    "qty",
    "rate",
    "amount",
    "total",
    "original",
    "duplicate",
    "receipt",
    "subtotal",
    "cgst",
    "sgst",
    "igst",
    "tax invoice",
    "bill no",
    "invoice no",
)
VENDOR_GENERIC_HEADINGS = (
    "invoice",
    "tax invoice",
    "retail invoice",
    "receipt",
    "bill",
    "cash memo",
    "hotel confirmation",
    "electronics repair invoice",
)
VENDOR_ADDRESS_TERMS = (
    "road",
    "rd",
    "street",
    "st",
    "lane",
    "ln",
    "nagar",
    "floor",
    "building",
    "complex",
    "tower",
    "plaza",
    "society",
    "suite",
    "office",
    "branch",
    "opp",
    "opposite",
    "near",
    "pune",
    "mumbai",
    "bangalore",
    "bengaluru",
    "delhi",
    "india",
)
VENDOR_BUSINESS_TERMS = (
    "hotel",
    "restaurant",
    "restro",
    "resto",
    "cafe",
    "bar",
    "bakery",
    "snacks",
    "juice",
    "mart",
    "store",
    "traders",
    "enterprises",
    "services",
    "travels",
    "resort",
    "residency",
    "caterers",
    "foods",
    "petroleum",
    "pharmacy",
    "medical",
    "clinic",
    "bhavan",
    "bhuvan",
    "hospitalities",
    "hub",
    "dhaba",
    "indianoil",
    "hpcl",
    "bpcl",
    "fuel center",
    "petrol pump",
)
DESCRIPTION_NEGATIVE_HINTS = (
    "payment terms",
    "please make the payment",
    "due date",
    "invoice",
    "gst",
    "thank you",
    "feel free to contact",
    "company name",
)
DESCRIPTION_HINTS = (
    "petrol",
    "diesel",
    "fuel",
    "food",
    "meal",
    "taxi",
    "fare",
    "room",
    "service",
    "subscription",
    "payment",
    "paid to",
)
TOTAL_PRIORITY_HINTS = (
    "grand total",
    "total amount",
    "net amount",
    "net payable",
    "amount payable",
    "payable",
    "final amount",
    "amount paid",
    "including gst",
    "incl gst",
    "incl. gst",
    "gross amount",
    "total :",
    "total:",
    "total -",
    "total rs",
    "total ₹",
    "sale :",
    "sale rs",
)
TOTAL_NEGATIVE_HINTS = (
    "subtotal",
    "sub total",
    "taxable",
    "cgst",
    "sgst",
    "igst",
    "vat",
    "discount",
    "round off",
    "change",
    "balance",
    "food total",
    "bevrages total",
    "beverages total",
    "tax",
    "service charge",
)
MONTH_PATTERN = r"(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)"
CATEGORY_HINTS = (
    "travel",
    "trip",
    "taxi",
    "cab",
    "fuel",
    "petrol",
    "diesel",
    "food",
    "meal",
    "restaurant",
    "hotel",
    "room",
    "stationary",
    "stationery",
    "office supply",
    "office supplies",
    "notebook",
    "pen",
    "paper",
    "medical",
    "clinic",
    "hospital",
    "pharmacy",
    "medicine",
)
PAYMENT_SCREENSHOT_HINTS = (
    "upi",
    "gpay",
    "google pay",
    "phonepe",
    "paytm",
    "paid to",
    "received from",
    "beneficiary",
    "transaction",
    "utr",
    "debited",
    "credited",
)
PAYMENT_VENDOR_LABELS = (
    "paid to",
    "received from",
    "beneficiary",
    "merchant",
    "banking name",
    "banking narne",
)


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").strip())


def normalize_ocr_text(text: str) -> str:
    text = clean_text(text)
    text = re.sub(r"(?<=\d)\s*[;:]\s*(?=\d)", ":", text)
    text = re.sub(r"(?<=\d)\s*[.]\s*(?=\d)", ".", text)
    text = re.sub(r"(?<=\d)\s*[-]\s*(?=[A-Za-z])", "-", text)
    text = re.sub(r"(?<=[A-Za-z])\s*[-]\s*(?=\d)", "-", text)
    text = re.sub(r"(?<=\d)\s+0o\b", "00", text, flags=re.IGNORECASE)
    text = re.sub(r"\b0o\b", "00", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<=\d)[oO](?=\d)", "0", text)
    text = re.sub(r"(?<=\d)[oO](?=\.)", "0", text)
    text = re.sub(r"\bAHOUNT\b", "AMOUNT", text, flags=re.IGNORECASE)
    text = re.sub(r"\bNARNE\b", "NAME", text, flags=re.IGNORECASE)
    text = re.sub(r"\bPRODUC\b", "PRODUCT", text, flags=re.IGNORECASE)
    return text


def strip_vendor_labels(text: str) -> str:
    cleaned = normalize_ocr_text(text)
    cleaned = re.sub(
        r"^(?:(?:paid to|received from)\s+(?:merchant|beneficiary)\b|paid to|received from|beneficiary|merchant|banking name|vendor|seller|store|shop)\s*[:\-]?\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\b(?:invoice|receipt|bill)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -:|")
    return cleaned.rstrip(".")


def normalize_vendor_text(text: str) -> str:
    cleaned = strip_vendor_labels(text)
    if not cleaned:
        return ""

    cleaned = re.split(
        r"\b(?:add|address|gst|gstin|tel|phone|mobile|invoice|bill|voucher|receipt|date|time|nozzle|product|vehicle|density|rate|amount|total)\b\s*[:\-]?",
        cleaned,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    cleaned = re.sub(
        r"\b(?:shop|plot|flat|floor|gate|road|rd|lane|ln|building|bldg|complex|society|nagar|pune|mumbai|bangalore|bengaluru|delhi|india|opp|opposite|near)\b.*$",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\b(?:s\.?\s*no|hissa|no)\.?\s*\d+[A-Za-z/-]*\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bcts?\b\s*\d+\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bsv\b\s*\d+\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"\b(?:utr|txn|transaction|reference|ref(?:erence)?\s*no|gst\s*no|contact|email|mail|table|qty|quantity|particulars|waiter|employee|emp\.?\s*no|t\s*-?\s*no)\b.*$",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\b[a-z]*\d+[a-z0-9/-]*\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b\d{4,}\b", " ", cleaned)
    cleaned = re.sub(r"\([^)]*\)", " ", cleaned)
    cleaned = re.sub(r"[|_/\\~]+", " ", cleaned)
    cleaned = re.sub(r"^[=:\-*]+", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -,:;.")

    tokens = []
    for token in cleaned.split():
        alnum = re.sub(r"[^A-Za-z0-9&'.-]", "", token)
        if len(alnum) <= 1 or re.fullmatch(r"\d+", alnum):
            continue
        tokens.append(alnum)

    cleaned = " ".join(tokens).strip(" -,:;.")
    if len(cleaned) <= 3:
        return strip_vendor_labels(text)
    return cleaned


def is_generic_vendor_heading(text: str) -> bool:
    lowered = normalize_vendor_text(text).lower()
    if not lowered:
        return True
    if any(token in lowered for token in ("www.", ".com", "@", "template", "email", "mailaddress")):
        return True
    if lowered in VENDOR_GENERIC_HEADINGS:
        return True
    if any(lowered.startswith(prefix) for prefix in ("invoice", "receipt", "bill", "statement")):
        return True
    if "invoice" in lowered and not vendor_signal(lowered):
        return True
    return False


def vendor_signal(text: str) -> int:
    lowered = clean_text(text).lower()
    terms = (
        "ltd",
        "limited",
        "pvt",
        "private",
        "store",
        "mart",
        "restaurant",
        "hotel",
        "services",
        "bank",
        "petroleum",
        "pharmacy",
        "medical",
        "clinic",
    )
    return 1 if any(term in lowered for term in terms) else 0


def receipt_like(document_style: str) -> int:
    return 1 if document_style == "receipt" else 0


def build_feature_row(candidate: dict, document_style: str) -> Dict[str, object]:
    bbox = candidate.get("bbox_pct", {})
    text = clean_text(candidate.get("text", ""))
    return {
        "text": text,
        "raw_text": text,
        "x": float(bbox.get("x", 0.0)),
        "y": float(bbox.get("y", 0.0)),
        "width": float(bbox.get("width", 0.0)),
        "height": float(bbox.get("height", 0.0)),
        "right_bias": 100.0 - float(bbox.get("x2", bbox.get("x", 0.0) + bbox.get("width", 0.0))),
        "bottom_bias": 100.0 - float(bbox.get("y2", bbox.get("y", 0.0) + bbox.get("height", 0.0))),
        "confidence": float(candidate.get("confidence", 0.0)),
        "char_len": len(text),
        "digit_ratio": sum(ch.isdigit() for ch in text) / max(1, len(text)),
        "amount_signal": 1 if text_has_amount(text) else 0,
        "date_signal": 1 if text_has_date(text) else 0,
        "vendor_signal": vendor_signal(text),
        "receipt_like": receipt_like(document_style),
    }


def amount_to_float(value: str) -> float:
    try:
        cleaned = re.sub(r"[^0-9.\-]", "", str(value).replace(",", ""))
        if cleaned.count(".") > 1:
            first_dot = cleaned.find(".")
            cleaned = cleaned[: first_dot + 1] + cleaned[first_dot + 1 :].replace(".", "")
        if cleaned in {"", ".", "-", "-."}:
            return 0.0
        return float(cleaned)
    except Exception:
        return 0.0


def is_reasonable_total_amount(value: str) -> bool:
    amount = amount_to_float(value)
    return 0 < amount <= MAX_REASONABLE_TOTAL


def line_center_x(item: dict) -> float:
    bbox = item.get("bbox_pct", {})
    return float(bbox.get("x", 0.0)) + (float(bbox.get("width", 0.0)) / 2.0)


def line_is_amount_only(text: str) -> bool:
    normalized = normalize_ocr_text(text)
    stripped = re.sub(r"(?i)\b(?:rs|inr|usd|eur|aed|amt|amount|total|paid)\b", " ", normalized)
    stripped = stripped.replace("₹", " ").replace("$", " ")
    stripped = re.sub(r"\s+", "", stripped)
    return bool(stripped) and bool(re.fullmatch(r"[\(\-]?\d[\d,]*(?:\.\d{1,2})?[\)]?", stripped))


def infer_decimal_amount_candidates(value: str, text: str) -> List[str]:
    digits_only = re.sub(r"[^0-9]", "", value)
    if "." in value or len(digits_only) < 4 or len(digits_only) > 6:
        return []

    lowered = normalize_ocr_text(text).lower()
    amount_line_hint = line_is_amount_only(text) or any(
        token in lowered for token in ("total", "amount", "amt", "paid", "rs", "inr", "₹")
    )
    if not amount_line_hint and int(digits_only) <= MAX_REASONABLE_TOTAL:
        return []

    whole = digits_only[:-2]
    decimal = digits_only[-2:]
    if not whole:
        return []
    return [f"{int(whole)}.{decimal}"]


def normalize_amount_text(text: str) -> str:
    normalized = normalize_ocr_text(text)
    values = list(extract_amount_values(normalized))
    for value in list(values):
        values.extend(infer_decimal_amount_candidates(value, normalized))
    if not values:
        return ""

    filtered = [value for value in values if is_reasonable_total_amount(value)]
    if not filtered:
        return ""

    lowered = normalized.lower()
    if any(token in lowered for token in ("amount", "total", "amt", "inr", "rs", "usd", "eur", "aed", "$", "₹", "paid")) and len(filtered) > 1:
        best = filtered[-1]
    elif ("₹" in normalized or "rs" in lowered or "inr" in lowered) and filtered:
        best = filtered[-1]
    else:
        best = max(filtered, key=amount_to_float)

    if best and "." not in best and re.search(rf"{re.escape(best)}\s*[.,]\s*$", normalized):
        best = f"{best}.00"
    elif best and re.fullmatch(r"\d+\.\d", best):
        best = f"{best}0"

    number = amount_to_float(best)
    if not is_reasonable_total_amount(best):
        return ""
    return f"{number:.2f}"


def normalize_date_text(text: str) -> str:
    normalized = normalize_ocr_text(text)
    normalized = re.sub(r"(?<=\d)\s*[.]\s*(?=\d)", ".", normalized)
    month_patterns = [
        rf"\b{MONTH_PATTERN}\s+\d{{1,2}}(?:st|nd|rd|th)?[,]?\s+\d{{2,4}}\b",
        rf"\b\d{{1,2}}(?:st|nd|rd|th)?\s+{MONTH_PATTERN}[,]?\s+\d{{2,4}}\b",
        rf"\b\d{{1,2}}\s*[-/.]\s*{MONTH_PATTERN}\s*[-/.]\s*\d{{2,4}}\b",
    ]
    for pattern in month_patterns:
        match = re.search(pattern, normalized, re.IGNORECASE)
        if match:
            return clean_text(match.group(0))

    numeric_match = re.search(r"\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})\b", normalized)
    if numeric_match:
        return numeric_match.group(0).replace(".", "-").replace("/", "-")

    # Handle common OCR typos for dates like "27-Cs-2026"
    normalized_for_ocr_typos = re.sub(r"\bCs\b", "09", normalized, flags=re.IGNORECASE)
    normalized_for_ocr_typos = re.sub(r"\bO\b", "0", normalized_for_ocr_typos, flags=re.IGNORECASE)
    
    numeric_match_ocr = re.search(r"\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})\b", normalized_for_ocr_typos)
    if numeric_match_ocr:
        return numeric_match_ocr.group(0).replace(".", "-").replace("/", "-")

    normalized = re.sub(r"\b([0-3]?\d)\s*-\s*([A-Za-z]{3,9})\s*-\s*(\d{2,4})\b", r"\1-\2-\3", normalized)
    extracted = extract_date_value(normalized)
    return extracted.replace(".", "-").replace("/", "-") if extracted else ""


def parse_normalized_date_text(text: str) -> str:
    candidate = normalize_date_text(text)
    if not candidate:
        return ""

    candidate = candidate.strip()
    parsed = None

    if re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", candidate):
        year_text, month_text, day_text = candidate.split("-")
        parsed = (int(year_text), int(month_text), int(day_text))
    elif re.fullmatch(r"\d{1,2}-\d{1,2}-\d{2,4}", candidate):
        first_text, second_text, year_text = candidate.split("-")
        year = int(year_text) if len(year_text) == 4 else int(f"20{year_text}")
        first = int(first_text)
        second = int(second_text)
        month = second if first > 12 else first
        day = first if first > 12 else second
        parsed = (year, month, day)
    elif re.search(MONTH_PATTERN, candidate, re.IGNORECASE):
        from datetime import datetime

        cleaned = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", candidate, flags=re.IGNORECASE)
        for fmt in ("%b %d %Y", "%B %d %Y", "%d %b %Y", "%d %B %Y"):
            try:
                dt = datetime.strptime(cleaned, fmt)
                parsed = (dt.year, dt.month, dt.day)
                break
            except ValueError:
                continue

    if not parsed:
        return ""

    year, month, day = parsed
    if year < 2018 or year > 2030:
        return ""

    from datetime import date

    try:
        validated = date(year, month, day)
    except ValueError:
        return ""

    return validated.isoformat()


def maybe_fix_payment_amount_text(text: str, amount: str, document_style: str, x: float, y: float, is_largest_font: bool = False) -> str:
    if document_style != "payment_screenshot":
        return amount
    
    # Removed the aggressive first-digit truncation heuristic. 
    # This caused severe bugs with GPay payment totals (e.g., 2500 extracting as 500).
    return amount


def looks_like_vendor_text(text: str) -> bool:
    cleaned = normalize_vendor_text(text)
    lowered = cleaned.lower()
    if len(cleaned) < 4:
        return False
    if is_generic_vendor_heading(cleaned):
        return False
    if any(stopword in lowered for stopword in VENDOR_STOPWORDS):
        return False
    if any(term in lowered for term in VENDOR_ADDRESS_TERMS):
        return False
    if re.search(r"[@]|www\.|\.com", lowered):
        return False
    digit_count = sum(ch.isdigit() for ch in cleaned)
    digit_ratio = digit_count / max(1, len(cleaned))
    digit_groups = re.findall(r"\d[\d,./:-]*", cleaned)
    if text_has_date(cleaned) and digit_ratio > 0.25:
        return False
    letters = sum(ch.isalpha() for ch in cleaned)
    if text_has_amount(cleaned) and digit_ratio > 0.35 and len(digit_groups) >= 2:
        return False
    if len(digit_groups) >= 4 and letters <= digit_count:
        return False
    if re.search(r"\b(?:table|qty|quantity|particulars|waiter|employee|emp\.?\s*no|t\s*-?\s*no)\b", lowered):
        return False
    return letters >= 4


def looks_like_description_text(text: str) -> bool:
    lowered = normalize_ocr_text(text).lower()
    if any(hint in lowered for hint in DESCRIPTION_NEGATIVE_HINTS):
        return False
    if any(hint in lowered for hint in DESCRIPTION_HINTS):
        return True
    if len(text) < 4:
        return False
        
    letters = sum(ch.isalpha() for ch in text)
    total_chars = len(text.replace(" ", ""))
    
    if total_chars == 0 or (letters / total_chars) < 0.5:
        return False
        
    words = [w for w in text.split() if sum(c.isalpha() for c in w) >= 3]
    if not words:
        return False
        
    return letters >= 4 and not text_has_amount(text)


def looks_like_category_text(text: str) -> bool:
    lowered = normalize_ocr_text(text).lower()
    return any(hint in lowered for hint in CATEGORY_HINTS)


def has_category_keywords(*texts: str) -> bool:
    haystack = " ".join(normalize_ocr_text(text).lower() for text in texts if text).strip()
    if not haystack:
        return False
    if any(hint in haystack for hint in CATEGORY_HINTS):
        return True
    for keywords in CATEGORY_RULES.values():
        for keyword in keywords:
            if keyword in haystack:
                return True
    return False


def score_rule_categories(*texts: str) -> Dict[str, int]:
    haystack = " ".join(normalize_ocr_text(text).lower() for text in texts if text).strip()
    scores = {category: 0 for category in CATEGORY_RULES}
    if not haystack:
        return scores
    for category, keywords in CATEGORY_RULES.items():
        for keyword in keywords:
            if keyword in haystack:
                scores[category] += max(1, len(keyword.split()))
    return scores


def add_field_biases(field: str, candidate: dict, document_style: str, base_score: float) -> float:
    text = normalize_ocr_text(candidate.get("text", ""))
    bbox = candidate.get("bbox_pct", {})
    y = float(bbox.get("y", 0.0))
    x = float(bbox.get("x", 0.0))
    score = base_score
    lowered = text.lower()

    if field == "Date":
        score += 0.30 if normalize_date_text(text) else -0.25
        if any(token in lowered for token in ("date", "dt")):
            score += 0.10
        if document_style == "receipt" and y < 65:
            score += 0.03
    elif field == "Total":
        if text_has_amount(text):
            score += 0.20
        if any(token in lowered for token in ("total", "amount", "amt", "grand", "inr", "rs", "$", "₹", "paid")):
            score += 0.20
        if any(token in lowered for token in TOTAL_PRIORITY_HINTS):
            score += 0.18
        if line_is_amount_only(text):
            score += 0.10
        if any(token in lowered for token in TOTAL_NEGATIVE_HINTS) and not any(token in lowered for token in TOTAL_PRIORITY_HINTS):
            score -= 0.22
        if document_style == "receipt" and y > 45:
            score += 0.08
        if document_style == "receipt" and y < 55 and not any(token in lowered for token in TOTAL_PRIORITY_HINTS):
            score -= 0.18
        if document_style == "payment_screenshot" and any(token in lowered for token in ("paid to", "you paid", "money sent", "received from", "debited", "credited")):
            score += 0.18
        if document_style == "payment_screenshot" and y < 40:
            score += 0.18
            if any(token in lowered for token in ("inr", "rs", "₹")):
                score += 0.35
        if document_style == "payment_screenshot" and 30 <= x <= 70:
            score += 0.08
        if "balance" in lowered:
            score -= 0.18
        if x > 45:
            score += 0.06
    elif field == "Vendor":
        if vendor_signal(text):
            score += 0.18
        if looks_like_vendor_text(text):
            score += 0.12
        else:
            score -= 0.25
        if len(strip_vendor_labels(text)) < 5:
            score -= 0.20
        if document_style == "receipt" and y < 35:
            score += 0.14
        if document_style == "payment_screenshot" and any(token in lowered for token in ("paid to", "merchant", "beneficiary", "received from", "banking name")):
            score += 0.12
    elif field == "Description":
        if looks_like_description_text(text):
            score += 0.15
        if document_style == "payment_screenshot" and any(token in lowered for token in ("payment", "transaction", "transfer", "upi", "ref")):
            score += 0.08
        if document_style == "receipt" and 35 <= y <= 90:
            score += 0.04
    elif field == "Category":
        if looks_like_category_text(text):
            score += 0.25
        if any(token in lowered for token in ("category", "account head")):
            score += 0.10

    return score


def vendor_quality_score(text: str, y: float = 0.0, document_style: str = "receipt") -> float:
    cleaned = normalize_vendor_text(text)
    lowered = cleaned.lower()
    if not cleaned:
        return -1.0

    score = 0.35 + min(len(cleaned) / 80.0, 0.2)
    if vendor_signal(cleaned):
        score += 0.18
    if any(term in lowered for term in VENDOR_BUSINESS_TERMS):
        score += 0.14
    if any(term in lowered for term in VENDOR_ADDRESS_TERMS):
        score -= 0.45
    if re.search(r"[@]|www\.|\.com", lowered):
        score -= 0.50
    if document_style == "receipt" and y < 35:
        score += 0.18
    return score


def build_category_context(lines: List[dict], known_fields: Dict[str, dict]) -> str:
    parts = [
        known_fields.get("Description", {}).get("text", ""),
        known_fields.get("Vendor", {}).get("text", ""),
        known_fields.get("Category", {}).get("text", ""),
    ]
    seen = {clean_text(part).lower() for part in parts if part}
    for line in lines:
        text = normalize_ocr_text(line.get("text", ""))
        normalized_key = clean_text(text).lower()
        if len(text) < 2 or normalized_key in seen:
            continue
        seen.add(normalized_key)
        parts.append(text)
    return clean_text(" | ".join(part for part in parts if part))
