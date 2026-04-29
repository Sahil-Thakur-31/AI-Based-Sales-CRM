import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import joblib

from annotation_loader import load_or_build_layout_profile, build_task_card_map
from rule_engine import apply_regex_rules, load_label_config, normalize_contact_candidate


def _repair_model_bundle(model_bundle: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(model_bundle, dict):
        return None

    classifier = model_bundle.get("classifier")
    if classifier is not None:
        # Older/newer sklearn pickle combinations can miss this attribute on unpickle.
        if classifier.__class__.__name__ == "LogisticRegression" and not hasattr(classifier, "multi_class"):
            setattr(classifier, "multi_class", "auto")

    return model_bundle


def _predict_ml_label(
    model_bundle: Optional[Dict[str, Any]],
    det: Dict[str, Any],
    image_w: float,
    image_h: float,
) -> Tuple[str, float]:
    if model_bundle is None:
        return "OTHER", 0.0

    try:
        feat = _feature_text(det, image_w, image_h)
        vectorizer = model_bundle["vectorizer"]
        classifier = model_bundle["classifier"]
        vec = vectorizer.transform([feat])
        probs = classifier.predict_proba(vec)[0]
        idx = int(probs.argmax())
        return str(classifier.classes_[idx]).upper(), float(probs[idx])
    except Exception as exc:
        sys.stderr.write(f"[OCR] ML fallback disabled for this scan: {exc}\n")
        return "OTHER", 0.0


def _feature_text(det: Dict[str, Any], img_w: float, img_h: float) -> str:
    """Build feature string for inference — must match train_label_model._to_feature_text."""
    x    = det.get("x", 0) / max(1.0, img_w)
    y    = det.get("y", 0) / max(1.0, img_h)
    w    = det.get("width", det.get("w", 0)) / max(1.0, img_w)
    h    = det.get("height", det.get("h", 0)) / max(1.0, img_h)
    cx   = x + w / 2.0
    cy   = y + h / 2.0
    conf = max(0.0, min(1.0, float(det.get("confidence", 0.0))))

    xb  = int(x  * 20)
    yb  = int(y  * 20)
    wb  = int(w  * 20)
    hb  = int(h  * 20)
    cxb = int(cx * 10)
    cyb = int(cy * 10)
    cb  = int(conf * 10)

    txt = str(det.get("text", "")).lower()
    raw = str(det.get("text", ""))

    pat = []
    if "@" in txt:
        pat.append("__pat_email")
    if re.search(r"\.(com|in|org|net|biz|info|io)\b", txt):
        pat.append("__pat_web")
    if re.search(r"\d{4,}", re.sub(r"[oO]", "0", txt)):
        pat.append("__pat_phone")
    if raw.isupper() and len(raw) > 2:
        pat.append("__allcaps")
    if len(txt.split()) >= 3:
        pat.append("__multi_word")
    if re.search(r"\d", txt):
        pat.append("__has_digit")
    # Expanded company keyword pattern
    if re.search(
        r"\b(pvt|ltd|llp|inc|corp|co\.?|group|solutions|services|tech|technologies|"
        r"enterprises|enterprise|industries|consulting|agency|studio|systems|global|"
        r"international|associates|trading|exports|constructions|properties|ventures|"
        r"capital|infra|developers|builders|foods|hospital|clinic|college|university)\b",
        txt,
    ):
        pat.append("__company_kw")
    # Expanded address keyword pattern
    if re.search(
        r"\b(road|street|lane|nagar|sector|city|state|near|opp|zip|pin|plot|block|"
        r"avenue|floor|suite|apt|building|colony|dist|district|area|phase|market|"
        r"complex|society|village|town|boulevard|circle|square|cross|main|bypass)\b",
        txt,
    ):
        pat.append("__address_kw")
    # Expanded designation keyword pattern
    if re.search(
        r"\b(manager|designer|engineer|director|founder|ceo|cto|coo|cfo|advocate|"
        r"lawyer|officer|consultant|president|vp|principal|doctor|professor|analyst|"
        r"executive|specialist|coordinator|lead|head|proprietor|owner|partner|"
        r"architect|accountant|developer|programmer|technician|representative|intern)\b",
        txt,
    ):
        pat.append("__desig_kw")
    # NEW: proper-case 2-4 word sequence → strong name signal
    if re.match(r"^[A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|[A-Z]\.?))+$", raw) and 2 <= len(raw.split()) <= 4:
        pat.append("__name_like")
    # NEW: exactly 2 capitalized words (most person names)
    _parts = raw.split()
    if len(_parts) == 2 and all(p and p[0].isupper() for p in _parts):
        pat.append("__two_caps_words")
    # NEW: comma in text → strong address indicator
    if "," in txt:
        pat.append("__has_comma")
    # NEW: 5+ words → likely address or multi-word designation
    if len(txt.split()) >= 5:
        pat.append("__long_text")
    # NEW: + sign → international phone prefix
    if "+" in txt:
        pat.append("__has_plus")
    # NEW: starts with www. or http → website
    if re.match(r"^(www\.|https?://)", txt):
        pat.append("__starts_www")
    # NEW: single word token
    if len(txt.split()) == 1 and len(txt) > 1:
        pat.append("__single_word")
    # NEW: short all-caps abbreviation (CEO, CTO, MD, etc.)
    if raw.isupper() and len(raw.split()) == 1 and 2 <= len(raw) <= 5:
        pat.append("__compact_abbrev")

    pat_str = " ".join(pat)
    return (
        f"{txt} __xb_{xb} __yb_{yb} __wb_{wb} __hb_{hb} __cb_{cb} "
        f"__cxb_{cxb} __cyb_{cyb} {pat_str}"
    )


def _layout_score(label: str, det: Dict[str, Any], img_w: float, img_h: float, profile: Dict) -> float:
    stats = (profile.get("labels") or {}).get(label, {})
    if not stats:
        return 0.0

    x = det.get("x", 0) / max(1.0, img_w)
    y = det.get("y", 0) / max(1.0, img_h)
    w = det.get("width", det.get("w", 0)) / max(1.0, img_w)
    h = det.get("height", det.get("h", 0)) / max(1.0, img_h)
    cx = x + (w / 2.0)
    cy = y + (h / 2.0)

    def z(val, m, s):
        s = max(float(s or 0.1), 0.03)
        return abs(float(val) - float(m or 0.0)) / s

    zsum = (
        z(cx, stats.get("mean_cx", 0.5), stats.get("std_cx", 0.25))
        + z(cy, stats.get("mean_cy", 0.5), stats.get("std_cy", 0.25))
        + z(w, stats.get("mean_w", 0.2), stats.get("std_w", 0.2))
        + z(h, stats.get("mean_h", 0.05), stats.get("std_h", 0.08))
    )
    score = max(0.0, 1.0 - (zsum / 12.0))
    return round(score, 4)


def _size_score(label: str, det: Dict[str, Any], img_w: float, img_h: float, profile: Dict) -> float:
    """Size-only score using mean/std of w,h from layout profile; higher is better."""
    stats = (profile.get("labels") or {}).get(label, {})
    if not stats:
        return 0.0
    w = det.get("width", det.get("w", 0)) / max(1.0, img_w)
    h = det.get("height", det.get("h", 0)) / max(1.0, img_h)

    def z(val, m, s):
        s = max(float(s or 0.1), 0.03)
        return abs(float(val) - float(m or 0.0)) / s

    zw = z(w, stats.get("mean_w", 0.2), stats.get("std_w", 0.2))
    zh = z(h, stats.get("mean_h", 0.05), stats.get("std_h", 0.08))
    zsum = zw + zh
    return max(0.0, 1.0 - (zsum / 6.0))


def _validate_field(label: str, text: str) -> bool:
    t_raw = (text or "").strip()
    if not t_raw:
        return False

    t_norm = normalize_contact_candidate(t_raw)

    if label == "EMAIL":
        normalized_email = _normalize_email_candidate(t_raw)
        return bool(
            normalized_email
            and re.search(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", normalized_email)
            and not _is_placeholder_email(normalized_email)
        )
    if label == "PHONE":
        phone = _normalize_phone_candidate(t_raw)
        digits = re.sub(r"\D", "", re.sub(r"[oO]", "0", phone or t_raw))
        has_phone_separator = bool(re.search(r"[\s()./-]", t_raw))
        return len(digits) >= 10 or (7 <= len(digits) <= 8 and has_phone_separator)
    if label == "WEBSITE":
        return bool(re.search(r"(www\.|https?://|\b[a-zA-Z0-9-]+\.(?:com|in|org|net|co\.in)\b)", t_norm, re.IGNORECASE)) and not _is_generic_website_value(t_norm)
    return True


def _strict_contact_label(text: str) -> Tuple[Optional[str], str]:
    """Classify high-certainty contact lines before layout/annotation can misroute them."""
    t_raw = (text or "").strip()
    if not t_raw:
        return None, ""

    t_norm = normalize_contact_candidate(t_raw)

    if re.search(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", t_norm):
        phone_like = bool(_normalize_phone_candidate(t_raw))
        if phone_like and re.search(r"\b(?:or|and)\b", t_raw, re.I):
            return "PHONE", _normalize_phone_candidate(t_raw)
        return "EMAIL", _normalize_email_candidate(t_raw)

    raw_parts = [p for p in re.findall(r"[A-Za-z0-9]+", t_raw.lower()) if p]
    raw_parts_case = [p for p in re.findall(r"[A-Za-z0-9]+", t_raw) if p]
    if len(raw_parts) == 3 and "www" not in t_norm and "http" not in t_norm and "@" not in t_norm:
        if raw_parts[0] in {"www", "ww", "web", "website", "http", "https"}:
            return "WEBSITE", t_norm
        # Guard against all-caps short tokens that are usually not contact ids.
        is_all_caps_triplet = (
            len(raw_parts_case) == 3
            and all(part.isupper() and any(ch.isalpha() for ch in part) for part in raw_parts_case)
        )
        if not is_all_caps_triplet:
            if raw_parts[2] in {"com", "in", "org", "net", "co", "biz", "info", "me", "edu", "gov"}:
                if not re.search(r"\b(?:company|enterprises|enterprise|solutions|services|group|technologies|systems|construction|engineering)\b", t_norm, re.IGNORECASE):
                    return "EMAIL", _normalize_email_candidate(t_raw)

    if "@" not in t_norm and re.search(
        r"(?:https?://\S+|www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?|\b[a-zA-Z0-9-]+\.(?:com|in|org|net|co\.in|biz|info|me|edu|gov)\b)",
        t_norm,
        flags=re.IGNORECASE,
    ):
        return "WEBSITE", t_norm

    phone_val = _normalize_phone_candidate(t_raw)
    t_phone = re.sub(r"[oO]", "0", t_raw)
    digits = re.sub(r"\D", "", re.sub(r"[oO]", "0", phone_val or t_phone))
    alpha = re.sub(r"[^A-Za-z]", "", t_raw)
    if phone_val and len(digits) >= 10 and len(alpha) <= 12:
        return "PHONE", phone_val

    return None, t_norm


_KNOWN_DOMAIN_TLDS = ("co.in", "com", "in", "org", "net", "biz", "info", "io", "me", "edu", "gov")


def _normalize_known_domain_root(root: str) -> str:
    compact = re.sub(r"[^a-z0-9]+", "", (root or "").lower())
    if not compact:
        return ""
    if "greatsite" in compact or re.search(r"reall?y?gr[ea]a?t?sit[e0o]*|grcatsit[e0o]*|llygreatsite", compact):
        return "reallygreatsite"
    return compact


def _normalize_domain_candidate(domain: str) -> str:
    raw = re.sub(r"[^a-z0-9.-]+", "", (domain or "").lower()).strip(".")
    if not raw:
        return ""
    for tld in _KNOWN_DOMAIN_TLDS:
        match = re.search(rf"([a-z0-9-]+(?:\.[a-z0-9-]+)*\.{re.escape(tld)})", raw)
        if match:
            raw = match.group(1)
            break
    labels = [part for part in raw.split(".") if part]
    if len(labels) < 2:
        return ""
    labels[0] = _normalize_known_domain_root(labels[0])
    if not labels[0]:
        return ""
    return ".".join(labels)


def _strip_leading_person_title(text: str) -> str:
    raw = re.sub(r"\s+", " ", (text or "").strip())
    if not raw:
        return ""
    return re.sub(
        r"^(?:dr|mr|mrs|ms|miss|prof|er|engr|eng|adv|advocate|ca)\.?(?::|-)?\s+",
        "",
        raw,
        flags=re.I,
    ).strip(" ,;:-")


def _normalize_email_candidate(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""

    # Prefer standalone email fragments when OCR merges phone + email text.
    for segment in re.split(r"\b(?:or|and)\b|[|/,;]\s*", raw, flags=re.I):
        seg = segment.strip()
        if not seg:
            continue
        match = re.search(r"[A-Za-z][A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", seg)
        if match:
            email = match.group(0).lower().strip(".,;:)")
            user, _, domain = email.partition("@")
            domain = _normalize_domain_candidate(domain)
            if user and domain:
                return f"{user}@{domain}"

    t = normalize_contact_candidate(raw)
    if "@" in t:
        match = re.search(r"[A-Za-z][A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", t)
        if match:
            email = match.group(0).lower().strip(".,;:)")
            user, _, domain = email.partition("@")
            domain = _normalize_domain_candidate(domain)
            if user and domain:
                return f"{user}@{domain}"
        return t

    raw2 = re.sub(r"[^a-z0-9 ]", " ", raw.lower())
    parts = [p for p in raw2.split() if p]
    if len(parts) == 3 and parts[2] in {"com", "in", "org", "net", "co.in", "biz", "info", "me", "edu", "gov"}:
        if len(parts[0]) >= 3 and len(parts[1]) >= 2:
            return f"{parts[0]}@{parts[1]}.{parts[2]}"
    return t


def _is_placeholder_email(email: str) -> bool:
    normalized = re.sub(r"\s+", " ", str(email or "").strip()).lower()
    if not normalized or "@" not in normalized:
        return True
    user, _, domain = normalized.partition("@")
    domain = _normalize_domain_candidate(domain) or domain
    root = _normalize_known_domain_root(domain.split(".", 1)[0])
    placeholder_users = {
        "yourname", "firstname", "lastname", "youremail", "yourmail",
        "myemail", "myname", "example", "sample", "username",
        "website", "email", "mail",
    }
    placeholder_domains = {
        "email.com", "website.com", "yourwebsite.com", "yourwebsitehere.com",
        "ourwebsite.com", "mywebsite.com", "yourcompany.com", "company.com",
        "business.com", "domain.com", "yoursite.com", "example.com",
        "emailaddress.com", "reallygreatsite.com", "emal.com",
    }
    if user in placeholder_users:
        return True
    if domain in placeholder_domains:
        return True
    if root in {"email", "mail", "website", "emailaddress", "yourwebsitehere", "reallygreatsite", "emal"}:
        return True
    if "yourname" in user or "yourmail" in user or "youremail" in user:
        return True
    return False


def _normalize_phone_candidate(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""

    found: List[str] = []
    seen = set()
    for segment in re.split(r"\b(?:or|and)\b|[|/,;]\s*", raw, flags=re.I):
        seg = segment.strip()
        if not seg:
            continue
        seg = re.sub(r"[oO]", "0", seg)
        matches = re.findall(r"(?<![A-Za-z])(?:\+?\d[\d\s().-]{6,}\d)(?![A-Za-z])", seg)
        for match in matches:
            phone = match
            phone = re.sub(r"\s+", " ", phone).strip()
            phone = phone.strip(".,;:)")
            key = re.sub(r"\D", "", phone)
            if key and key not in seen:
                seen.add(key)
                found.append(phone)

    return ", ".join(found)


def _normalize_email_candidate_relaxed(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""
    normalized = normalize_contact_candidate(raw)
    if "@" in normalized:
        match = re.search(r"[A-Za-z][A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", normalized)
        if match:
            email = match.group(0).lower().strip(".,;:)")
            user, _, domain = email.partition("@")
            domain = _normalize_domain_candidate(domain)
            if user and domain:
                return f"{user}@{domain}"
        loose = normalized.lower().strip(".,;:)")
        user, _, domain = loose.partition("@")
        domain = _normalize_domain_candidate(domain)
        if user and domain:
            return f"{user}@{domain}"
        return ""
    parts = [p for p in re.findall(r"[A-Za-z0-9]+", raw.lower()) if p]
    if len(parts) == 3 and parts[2] in {"com", "in", "org", "net", "co", "biz", "info", "me", "edu", "gov"}:
        if len(parts[0]) >= 3 and len(parts[1]) >= 2:
            return f"{parts[0]}@{parts[1]}.{parts[2]}"
    return ""


def _normalize_website_candidate_relaxed(text: str) -> str:
    raw = normalize_contact_candidate(text or "").strip().lower()
    if not raw or "@" in raw:
        return ""
    raw = re.sub(r"^(?:web|website)\s*[:\-]\s*", "", raw, flags=re.I)
    compact = re.sub(r"[^a-z0-9]", "", raw)
    match = re.search(r"(?:https?://\S+|www\.[a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?|\b[a-z0-9-]+\.(?:com|in|org|net|co\.in|biz|info|me|edu|gov)\b)", raw, re.I)
    if match:
        candidate = match.group(0).strip(".,;:)")
        has_www = candidate.startswith("www.") or candidate.startswith("http")
        candidate = re.sub(r"^https?://", "", candidate)
        candidate = re.sub(r"^www\.", "", candidate)
        domain = _normalize_domain_candidate(candidate)
        if domain:
            return f"www.{domain}" if has_www else domain
        return ""
    compact_match = re.fullmatch(r"w{2,4}([a-z0-9-]{3,})(com|in|org|net|biz|info|me|edu|gov)", compact)
    if compact_match:
        domain = _normalize_domain_candidate(f"{compact_match.group(1)}.{compact_match.group(2)}")
        return f"www.{domain}" if domain else ""
    if len(compact) >= 6:
        tri = re.fullmatch(r"([a-z0-9-]{3,})(com|in|org|net|biz|info|me|edu|gov)", compact)
        if tri:
            return _normalize_domain_candidate(f"{tri.group(1)}.{tri.group(2)}")
    return ""


def _is_placeholder_fragment(text: str) -> bool:
    t = re.sub(r"[^a-z]", "", (text or "").lower())
    return t in {
        "any",
        "city",
        "state",
        "street",
        "st",
        "road",
        "rd",
        "ave",
        "lane",
        "zip",
        "code",
        "address",
        "near",
        "anywhere",
        "name",
        "company",
        "designation",
        "title",
        "position",
        "email",
        "e",
        "mail",
        "phone",
        "mobile",
        "fax",
        "tel",
        "website",
        "web",
        "contact",
        "fullname",
        "firstname",
        "lastname",
        "surname",
    }


def _looks_like_cta_text(text: str) -> bool:
    low = re.sub(r"[^a-z ]", " ", (text or "").lower())
    low = re.sub(r"\s+", " ", low).strip()
    return low in {
        "contact us",
        "call us",
        "reach us",
        "follow us",
        "about us",
        "get in touch",
        "connect with us",
    }


def _is_generic_website_value(text: str) -> bool:
    t = normalize_contact_candidate(text or "").lower().strip()
    if not t:
        return True
    t = re.sub(r"^https?://", "", t)
    t = re.sub(r"^www\.", "", t)
    t = t.split("/", 1)[0]
    if not t or "." not in t:
        return True
    root = _normalize_known_domain_root(t.split(".", 1)[0])
    if re.search(r"(reall?y?gr[ea]atsite|grcatsite)", root) and root != "reallygreatsite":
        return True
    return root in {
        "website",
        "ebsite",
        "business",
        "mail",
        "email",
        "emailaddress",
        "example",
        "yourwebsite",
        "yourwebsitehere",
        "companyname",
        "yourcompany",
        "reallygreatsite",
        "gmail",
        "yahoo",
        "hotmail",
        "outlook",
        "live",
        "msn",
        "icloud",
        "zoho",
        "mail",
        "websiteemail",
        "websiteomail",
        "websiteamail",
    } or (root.startswith("website") and any(token in root for token in {"mail", "email"}))


def _looks_like_ocr_gibberish(text: str) -> bool:
    raw = re.sub(r"\s+", " ", (text or "").strip())
    if not raw:
        return False
    if "@" in raw or _looks_like_website_text(raw) or _looks_like_address_text(raw):
        return False
    tokens = [tok for tok in re.findall(r"[A-Za-z]+", raw) if tok]
    if not tokens:
        return False
    return any(len(tok) >= 12 and not tok.isupper() for tok in tokens)


def _looks_like_slogan_text(text: str) -> bool:
    """Detect promo/tagline text that should not become NAME/COMPANY/DESIGNATION."""
    raw = (text or "").strip()
    if not raw:
        return False
    if "@" in raw or "www" in raw.lower() or "http" in raw.lower():
        return False

    low = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 &'-]", " ", raw.lower())).strip()
    if not low:
        return False
    if _looks_like_cta_text(raw):
        return True
    if re.search(
        r"\b(manager|director|designer|engineer|founder|advocate|officer|consultant|accountant|analyst|executive|coordinator|proprietor|owner|partner|developer)\b",
        low,
    ) and len(re.findall(r"[a-z]+", low)) <= 4:
        return False
    if len(re.findall(r"[a-z]+", low)) <= 4 and any(term in low for term in ["company", "group", "llp", "ltd", "inc", "corp", "realties", "realty", "engineering", "industries", "printing"]):
        return False

    # Exact patterns seen repeatedly in card outputs.
    exact_phrases = {
        "go modular go limitless",
        "we are choice",
        "company name",
        "your logo here",
        "your clean energy partner",
        "the premium fashion brand",
        "certified company",
        "government approved electrical engineers & contractors",
        "business coaching",
        "business coaching & consulting",
        "pure vitality pure power pure solar",
        "rooted in india reaching the world",
        "best quality",
    }
    if low in exact_phrases:
        return True
    if re.search(r"\b(home services?|doorstep services?|just a call|choice for doorstep)\b", low):
        return True

    words = re.findall(r"[a-z]+", low)
    if len(words) < 3:
        return False

    if re.search(r"\d", raw) and any(w in words for w in {"certified", "company", "government", "approved", "iso"}):
        return True

    promo_words = {
        "go",
        "modular",
        "limitless",
        "we",
        "are",
        "choice",
        "pure",
        "rooted",
        "world",
        "best",
        "quality",
        "certified",
        "government",
        "approved",
        "company",
        "logo",
        "services",
        "service",
        "business",
        "coaching",
        "consulting",
        "professional",
        "design",
        "creative",
        "solution",
        "solutions",
        "electrical",
        "electricals",
        "engineering",
        "manufacturing",
        "technology",
        "technologies",
        "doorstep",
        "choice",
        "call",
        "home",
        "official",
        "trusted",
        "reliable",
        "quality",
        "since",
        "worldwide",
        "india",
        "international",
    }
    promo_hits = sum(1 for w in words if w in promo_words)
    stopword_hits = sum(1 for w in words if w in {"and", "or", "the", "of", "in", "to", "for", "with", "our", "your"})
    has_alpha = any(ch.isalpha() for ch in raw)
    has_caps_pattern = len(re.findall(r"\b[A-Z]{2,}\b", raw)) >= 2
    sentence_like = raw.endswith((".", ":", ";", "!", "?")) or "'" in raw or '"' in raw

    if promo_hits >= 2 and has_alpha:
        return True
    if promo_hits >= 1 and len(words) >= 4 and stopword_hits <= 2:
        return True
    if has_caps_pattern and len(words) >= 3 and (promo_hits >= 1 or stopword_hits >= 2):
        return True
    if sentence_like and promo_hits >= 1:
        return True
    return False


def _looks_like_catalog_text(text: str) -> bool:
    low = re.sub(r"[^a-z0-9& ]", " ", (text or "").lower())
    low = re.sub(r"\s+", " ", low).strip()
    if not low:
        return False

    direct_noise = {
        "business card",
        "business cards",
        "corporate gifting",
        "corporate",
        "gifting",
        "essentials",
        "branding",
        "marketing",
        "material",
        "collateral",
        "printing",
        "logo graphic designing facility",
        "one vision",
        "building materials",
        "of building materials",
    }
    if low in direct_noise:
        return True
    if any(term in low for term in ["all kinds of", "rolling chairs", "sofasets", "wholesale price"]):
        return True

    strong_terms = {
        "mugs",
        "standees",
        "brochures",
        "catalogues",
        "catalogue",
        "sunboard",
        "flyers",
        "lanyards",
        "coasters",
        "envelopes",
        "diaries",
        "labels",
        "photocopy",
        "clocks",
        "posters",
        "banners",
        "danglers",
        "wobblers",
        "folders",
        "sunpack",
        "stickers",
        "cutouts",
        "canopy",
        "certificates",
        "letterhead",
        "newsletters",
    }
    words = [w for w in low.split() if w]
    if any(w in strong_terms for w in words) and "company" not in words and "group" not in words:
        return True

    catalog_terms = {
        "mugs",
        "printing",
        "stationery",
        "standees",
        "brochures",
        "catalogues",
        "catalogue",
        "sunboard",
        "flyers",
        "lanyards",
        "calendar",
        "calendars",
        "coasters",
        "envelopes",
        "diaries",
        "labels",
        "photocopy",
        "cards",
        "clocks",
        "posters",
        "banners",
        "danglers",
        "wobblers",
        "folders",
        "sunpack",
        "stickers",
        "magazine",
        "roll",
        "cutouts",
        "canopy",
        "certificates",
        "letterhead",
        "newsletters",
        "pens",
        "books",
        "digital",
        "vision",
    }
    if not words:
        return False
    catalog_hits = sum(1 for w in words if w in catalog_terms)
    if catalog_hits >= 2:
        return True
    if catalog_hits >= 1 and len(words) <= 3 and "company" not in words and "group" not in words:
        return True
    return False


def _looks_like_website_text(text: str) -> bool:
    """Return True for domain-like text that should stay in WEBSITE."""
    t = normalize_contact_candidate(text or "")
    if not t:
        return False
    if "@" in t:
        return False
    if re.search(r"(?:https?://|www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?|\.com\b|\.in\b|\.org\b|\.net\b|\.co\.in\b|\.biz\b|\.info\b|\.me\b|\.edu\b|\.gov\b)", t, flags=re.I):
        return True
    compact = re.sub(r"[^a-z0-9]", "", t.lower())
    if compact.startswith("www") and re.search(r"(?:com|in|org|net|coin|biz|info|me|edu|gov)$", compact):
        return True
    # OCR often emits compact websites like "wwdavidharrisoncom" or "wwwwcompanynamecom".
    if re.fullmatch(r"w{2,4}[a-z0-9-]{4,}(?:com|in|org|net|biz|info|me|edu|gov)", compact):
        return True
    return False



def _looks_like_field_header(text: str) -> bool:
    low = re.sub(r"[^a-z ]", " ", (text or "").lower())
    low = re.sub(r"\s+", " ", low).strip()
    if not low:
        return False
    return low in {
        "name",
        "full name",
        "first name",
        "last name",
        "surname",
        "company",
        "company name",
        "business name",
        "designation",
        "title",
        "position",
        "job title",
        "email",
        "e mail",
        "phone",
        "mobile",
        "fax",
        "tel",
        "telephone",
        "contact",
        "website",
        "web",
        "address",
    }


def _looks_like_location_name(text: str) -> bool:
    low = (text or "").lower()
    if not low:
        return False

    if re.search(r"\b[A-Z]{2}\s*\d{5}(?:-\d{4})?\b", text):
        return True

    if re.search(r"\b\d{5}(?:-\d{4})?\b", text):
        if any(tok in low for tok in ["city", "state", "county", "town", "mountain", "valley", "park", "street", "road", "lane", "avenue", "north", "south", "east", "west"]):
            return True

    if re.search(r"\b(city|state|county|town|village|mountain|valley|park|north|south|east|west)\b", low):
        if len(re.findall(r"[A-Za-z]+", text or "")) <= 4:
            return True
    if re.search(r"\bgidc\b", low) or re.search(r"\bindustrial\s+(area|estate|park|zone)\b", low):
        return True

    return False


def _looks_like_placeholder_company(text: str) -> bool:
    low = str(text or "").lower()
    low = low.replace("0", "o").replace("1", "l")
    low = re.sub(r"[^a-z ]", " ", low)
    return bool(
        re.search(
            r"\b(company name|companyname|componey|compeny|title|your company|business name|office name|logo text|logo|your logo|brand logo|tag ?line|tagh?in(?:e)?|slogan(?: here)?|add tag)\b",
            low,
        )
    )


def _looks_like_placeholder_address(text: str) -> bool:
    low = str(text or "").lower()
    low = low.replace("0", "o").replace("1", "l")
    low = re.sub(r"[^a-z ]", " ", low)
    return bool(
        re.search(
            r"\b(your address|your address here|address line|insert here|insert your address here|insert your|insert|add address|address goes here|address here|city state zip|zip code|your location|location here|location|company location|main office address|office address|enter your company address|add your address|list email address here|address)\b",
            low,
        )
    )


def _looks_like_placeholder_name(text: str) -> bool:
    parts = [re.sub(r"[^a-z]", "", p.lower()) for p in str(text or "").split()]
    parts = [p for p in parts if p]
    if not parts:
        return False
    placeholder_parts = {
        "name", "surname", "firstname", "lastname", "fullname",
        "first", "last", "middle", "yourname",
    }
    return all(part in placeholder_parts for part in parts)


def _has_specific_address_tokens(text: str) -> bool:
    tokens = [tok for tok in re.findall(r"[a-z]+", str(text or "").lower()) if tok]
    if not tokens:
        return False
    generic_tokens = {
        "your", "address", "here", "insert", "line", "city", "state", "zip",
        "code", "location", "office", "road", "street", "lane", "plot",
        "building", "block", "floor", "suite", "unit", "town", "country",
    }
    return any(tok not in generic_tokens and len(tok) >= 3 for tok in tokens)


def _normalize_alpha_ocr_token(text: str) -> str:
    t = (text or "").strip()
    if not t:
        return ""
    t = re.sub(r"(?<=[A-Za-z])0(?=[A-Za-z\s])", "o", t)
    t = re.sub(r"(?<=[A-Za-z])1(?=[A-Za-z\s])", "l", t)
    t = re.sub(r"([A-Za-z]{2,})\s+([A-Za-z])\b", r"\1\2", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _repair_split_ocr_words(text: str) -> str:
    raw = re.sub(r"\s+", " ", (text or "").strip())
    if not raw:
        return ""
    tokens = raw.split()
    if len(tokens) < 2:
        return raw
    merged: List[str] = []
    current = tokens[0]
    for token in tokens[1:]:
        if (
            current.isalpha()
            and token.isalpha()
            and not (current[:1].isupper() and not current.isupper() and token.isupper() and len(token) <= 3)
            and (
                len(current) <= 2
                or len(token) <= 2
                or (len(current) >= 5 and len(token) <= 3)
            )
        ):
            current = f"{current}{token}"
            continue
        merged.append(current)
        current = token
    merged.append(current)
    return " ".join(merged)


def _domain_to_company_name(value: str) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return ""
    raw = re.sub(r"^[a-z]+:\s*", "", raw)
    if "@" in raw:
        raw = raw.split("@", 1)[1]
    raw = re.sub(r"^https?://", "", raw)
    raw = re.sub(r"^www\.", "", raw)
    raw = raw.split("/", 1)[0]
    raw = raw.split(":", 1)[0]
    raw = _normalize_domain_candidate(raw) or raw
    label = _normalize_known_domain_root(raw.split(".", 1)[0])
    if not label or len(label) <= 2:
        return ""
    generic_labels = {
        "emailaddress",
        "websitehere",
        "yourwebsite",
        "yourwebsitehere",
        "example",
        "companyname",
        "yourcompany",
        "reallygreatsite",
        "email",
        "mail",
        "gmail",
        "yahoo",
        "hotmail",
        "outlook",
        "icloud",
        "protonmail",
    }
    if label in generic_labels:
        return ""

    suffixes = [
        "solutions",
        "solution",
        "technologies",
        "technology",
        "services",
        "service",
        "systems",
        "consulting",
        "construction",
        "engineering",
        "group",
        "company",
        "studio",
        "realty",
        "infra",
    ]
    parts = [p for p in re.split(r"[-_]+", label) if p]
    expanded: List[str] = []
    for part in parts:
        matched = False
        for suffix in suffixes:
            if part.endswith(suffix) and len(part) > len(suffix) + 2:
                expanded.extend([part[: -len(suffix)], suffix])
                matched = True
                break
        if not matched:
            expanded.append(part)

    cleaned = [p for p in expanded if p and len(p) > 1]
    return " ".join(p.capitalize() for p in cleaned)


def _email_domain_to_website(email_value: str) -> str:
    normalized = _normalize_email_candidate(email_value)
    if "@" not in normalized:
        return ""
    domain = _normalize_domain_candidate(normalized.split("@", 1)[1].strip().lower())
    if not domain or "." not in domain:
        return ""
    common_domains = {
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
        "emailaddress.com",
        "yourwebsitehere.com",
        "reallygreatsite.com",
        "emal.com",
        "business.com",
        "company.com",
    }
    root = domain.split(".", 1)[0]
    if domain in common_domains or root in {"email", "mail", "website", "example", "emailaddress", "yourwebsitehere", "reallygreatsite", "emal"}:
        return ""
    return f"www.{domain}"


def _looks_like_degree_credential(text: str) -> bool:
    low = re.sub(r"[^a-z ]", " ", (text or "").lower())
    low = re.sub(r"\s+", " ", low).strip()
    if not low:
        return False
    degree_terms = {"bca", "llb", "bcom", "mba", "mca", "mtech", "btech", "phd", "md", "ca", "cs", "cfa", "llm"}
    tokens = [t for t in low.split() if t]
    return bool(tokens) and all(token in degree_terms for token in tokens)


def _looks_like_qualification_line(text: str) -> bool:
    raw = re.sub(r"\s+", " ", (text or "").strip())
    if not raw:
        return False
    low = raw.lower()
    if re.search(r"\b(?:b\.?\s*e|btech|mtech|phd|m\.?\s*s|mba|mca|bca|llb|b\.?\s*com|cfa|ca|cs)\b", low):
        return True
    if re.search(r"\b(?:solar energy|mechanical|mech|civil|electrical|electronics)\b", low) and re.search(r"[(),]", raw):
        return True
    return False

def _looks_like_name_phrase(text: str) -> bool:
    if not text:
        return False
    if re.search(r"\d", text):
        return False
    t = re.sub(r"[^A-Za-z ]", " ", text).strip()
    parts = [p for p in t.split() if p]
    if len(parts) < 2 or len(parts) > 4:
        return False
    low = " ".join(parts).lower()
    if _looks_like_placeholder_company(low) or _is_generic_title_text(low) or _looks_like_field_header(low):
        return False
    if _looks_like_slogan_text(low):
        return False
    if _looks_like_designation_text(low):
        return False
    if any(
        term in low
        for term in [
            "investment",
            "private equity",
            "hedge fund",
            "fund",
            "finance",
            "financial",
            "capital",
            "assets",
            "portfolio",
            "trading",
            "securities",
            "advisory",
            "analysis",
            "analyst",
            "management",
            "solutions",
            "services",
            "enterprise",
            "enterprises",
            "company",
            "group",
        ]
    ):
        return False
    if _looks_like_location_name(text):
        return False
    if any(k in low for k in ["street", "road", "city", "state", "county", "town", "mountain", "valley", "park"]):
        return False
    return all(p[:1].isalpha() and p[:1].isupper() for p in parts)


def _resolve_conflicts(items: List[Dict[str, Any]], protect_annotation: bool = False) -> List[Dict[str, Any]]:
    # Company/name resolver with stronger cues.
    company_terms = [
        "pvt",
        "ltd",
        "llp",
        "inc",
        "co ",
        "co.",
        "company",
        "group",
        "services",
        "service",
        "solutions",
        "enterprises",
        "enterprise",
        "technologies",
        "technology",
        "tech",
        "systems",
        "construction",
        "engineering",
        "builders",
        "contractors",
        "contractor",
        "realty",
        "automotive",
        "consulting",
        "consultants",
        "agency",
        "agencies",
        "real estate",
        "estate",
        "studio",
        "design",
        "exports",
        "foods",
        "hospital",
        "clinic",
        "college",
        "university",
        "hotel",
        "store",
        "shop",
        "center",
        "centre",
        "solar",
        "energy",
        "electrical",
        "electricals",
        "power",
        "maintenance",
        "renew",
        "products",
        "& co",
        "&co",
        "building",
    ]

    for it in items:
        if protect_annotation and it.get("source") == "ANNOTATION_IOU":
            continue
        txt = it.get("text", "")
        if _is_placeholder_fragment(txt) or _looks_like_field_header(txt):
            it["label"] = "OTHER"
            continue
        if _looks_like_slogan_text(txt):
            it["label"] = "OTHER"
            continue
        if _looks_like_website_text(txt):
            it["label"] = "WEBSITE"
            it["confidence"] = max(it.get("confidence", 0.0), 0.99)
            continue
        if it["label"] == "NAME" and _looks_like_placeholder_company(txt):
            it["label"] = "COMPANY"
            it["confidence"] = max(it["confidence"], 0.78)
            continue
        if txt.strip().startswith("@") and not re.search(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", txt):
            it["label"] = "OTHER"
            continue
        if it["label"] == "NAME" and _is_generic_title_text(it.get("text", "")):
            it["label"] = "DESIGNATION"
            it["confidence"] = max(it["confidence"], 0.70)
            continue
        if it["label"] == "NAME" and _looks_like_address_text(txt):
            it["label"] = "ADDRESS"
            it["confidence"] = max(it["confidence"], 0.76)
            continue
        if it["label"] == "NAME" and _looks_like_name_phrase(txt):
            it["label"] = "NAME"
            continue
        if it["label"] in {"ADDRESS", "NAME", "DESIGNATION"}:
            txt = it.get("text", "")
            if _looks_like_company_text(txt) and not _looks_like_address_text(txt) and not _looks_like_slogan_text(txt):
                it["label"] = "COMPANY"
                it["confidence"] = max(it["confidence"], 0.78)
                continue
        if it["label"] in {"NAME", "COMPANY"}:
            h = float(it.get("height", 0))
            txt = it.get("text", "")
            low = txt.lower()
            tokens = txt.strip().split()

            # If contains company cues, prefer COMPANY only when the text looks
            # like a real line rather than a stray token.
            if any(term in low for term in company_terms):
                has_line_shape = len(tokens) >= 2 or len(txt) >= 6 or re.search(r"\d", txt)
                if has_line_shape:
                    it["label"] = "COMPANY"
                    continue

            # If it looks like a person, keep NAME.
            if _looks_like_person(txt):
                it["label"] = "NAME"
                continue

            # Heuristic: very large text is likely company.
            if h >= 36 and len(txt.split()) >= 2:
                it["label"] = "COMPANY"

        # If something was tagged ADDRESS / COMPANY but smells like NAME, flip.
        if it["label"] in {"ADDRESS", "COMPANY", "DESIGNATION"}:
            txt = it.get("text", "")
            low = txt.lower()
            # Define broad exclusion terms to prevent address parts from becoming NAMES
            addr_tokens = {"st", "rd", "ave", "city", "state", "zip", "road", "street", "lane", "dr", "drive", "nagar", "sector", "colony", "building", "bldg", "plot", "india", "pin", "anywhere", "address", "office", "tel", "mob", "phone", "email", "website", "www"}
            words = set(re.findall(r"\w+", low))
            is_address_fragment = bool(words & addr_tokens) or ":" in txt

            if (_looks_like_person(txt) or _looks_like_titled_person(txt)) and not is_address_fragment and not any(term in low for term in company_terms):
                it["label"] = "NAME"
                it["confidence"] = max(it["confidence"], 0.70)
                continue

        # If something was tagged DESIGNATION but smells like company, flip.
        if it["label"] == "DESIGNATION":
            low = it.get("text", "").lower()
            if any(term in low for term in company_terms) and not _looks_like_designation_text(low):
                it["label"] = "COMPANY"
                it["confidence"] = max(it["confidence"], 0.75)
        
        # If something was tagged COMPANY but smells like designation, flip.
        if it["label"] == "COMPANY":
            low = it.get("text", "").lower()
            if _looks_like_designation_text(low) and not any(term in low for term in company_terms):
                it["label"] = "DESIGNATION"
                it["confidence"] = max(it["confidence"], 0.75)
            if _looks_like_slogan_text(low):
                it["label"] = "OTHER"
                it["confidence"] = min(float(it.get("confidence", 0.0)), 0.2)

    return items


def _looks_like_person(text: str) -> bool:
    if not text:
        return False
    text = _strip_leading_person_title(text)
    if not text:
        return False
    if _looks_like_cta_text(text):
        return False
    # Only block if it looks purely like a number block
    if re.fullmatch(r"[\d\s\-\+\(\)]+", text):
        return False
    if ";" in text:
        return False
    if _looks_like_address_text(text):
        return False
    if _looks_like_slogan_text(text):
        return False
    if _looks_like_catalog_text(text):
        return False
    if _looks_like_placeholder_company(text):
        return False
    if _looks_like_website_text(text):
        return False
    if "-" in text and len(text.split()) <= 2 and not re.search(r"[a-z]", text):
        return False
    if re.match(r"^(?:dr|mr|mrs|ms|miss|prof|er|engr|eng|adv|advocate|ca)\.?(?::|-)?\s+[A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){1,3}$", (text or "").strip(), flags=re.I):
        return True

    # Remove noise for name check
    t = (text or "").strip()
    t = _strip_leading_person_title(t)
    t = re.sub(r"(?<=[A-Za-z])0(?=[A-Za-z\s])", "o", t)
    t = re.sub(r"(?<=[A-Za-z])1(?=[A-Za-z\s])", "l", t)
    t = re.sub(r"[^A-Za-z ]", "", t).strip()
    parts = t.split()
    if len(parts) == 0 or len(parts) > 5:
        return False
    if "," in text and len(parts) > 2:
        return False
    if len(parts) >= 3 and not (len(parts[0]) >= 2 and len(parts[-1]) >= 2):
        return False
    if len(parts) == 2 and any(len(part) == 1 for part in parts):
        return False
    
    # Common words that are definitely NOT names
    low = t.lower()
    if "logo" in low:
        return False
    company_like_name_tokens = {
        "limited",
        "ltd",
        "services",
        "solutions",
        "technologies",
        "technology",
        "engineering",
        "infra",
        "financial",
        "systems",
        "group",
        "company",
        "enterprise",
        "enterprises",
    }
    if set(low.split()) & company_like_name_tokens:
        return False
    if any(loc in low for loc in ["london", "california", "virginia", "usa", "uk", "india", "pune", "surat", "vadodara", "baramati", "mumbai", "delhi", "dubai", "new york"]):
        return False
    designation_indicators = [
        "manager",
        "director",
        "ceo",
        "founder",
        "advocate",
        "lawyer",
        "attorney",
        "counsel",
        "proprietor",
        "owner",
        "executive",
        "officer",
        "specialist",
        "engineer",
        "designer",
        "architect",
        "chief",
        "guide",
        "creative",
        "travel",
        "agency",
        "analyst",
        "consultant",
        "advisor",
        "adviser",
        "accountant",
    ]
    company_indicators = [
        "pvt",
        "ltd",
        "llp",
        "inc",
        "services",
        "solutions",
        "enterprises",
        "technologies",
        "tech",
        "systems",
        "group",
        "industries",
        "company",
        "court",
        "high court",
        "corporation",
        "investment",
        "finance",
        "financial",
        "capital",
        "fund",
        "equity",
        "holdings",
        "assets",
        "portfolio",
        "trading",
        "securities",
        "bank",
        "real estate",
        "automobile",
        "automobiles",
        "industrial",
        "industries",
        "electrical",
        "electricals",
        "engineering",
        "engineering",
        "automation",
        "consulting",
        "consultants",
        "manufacturing",
        "motors",
        "electronics",
        "electromech",
        "fusion",
    ]
    non_person_words = {
        "healthy",
        "wellness",
        "enterprise",
        "enterprises",
        "construction",
        "engineering",
        "building",
        "buildings",
        "service",
        "services",
        "solution",
        "solutions",
        "business",
        "trading",
        "consulting",
        "consultants",
        "agency",
        "studio",
        "clinic",
        "hotel",
        "store",
        "school",
        "college",
        "university",
        "real",
        "estate",
        "investment",
        "investments",
        "finance",
        "financial",
        "fund",
        "funds",
        "equity",
        "capital",
        "portfolio",
        "securities",
        "banking",
        "wealth",
        "analysis",
        "clean",
        "energy",
        "renewable",
        "partner",
        "corporate",
        "office",
        "bca",
        "llb",
        "bcom",
        "mba",
        "mca",
        "mtech",
        "btech",
        "phd",
        "md",
        "ca",
        "cs",
        "cfa",
        "solicitor",
    }
    
    if any(k in low for k in designation_indicators + company_indicators):
        return False
    if "&" in text:
        return False
    if any(w in low.split() for w in non_person_words):
        return False
    if len(parts) == 1:
        token = parts[0]
        if len(token) < 3:
            return False
        if token.lower() in {"london", "california", "virginia", "usa", "uk", "india", "pune", "surat", "vadodara", "baramati", "mumbai", "delhi", "dubai", "newyork", "newyorkcity"}:
            return False
        # Keep lone OCR name fragments eligible for NAME rather than forcing them into COMPANY.
        return True
    if 2 <= len(parts) <= 5:
        initials_like = all(
            (len(p) == 1 and p.isalpha()) or (len(p) <= 3 and p[0].isalpha())
            for p in parts
        )
        if initials_like:
            return True
    if 3 <= len(parts) <= 5 and len(parts[0]) >= 2 and len(parts[-1]) >= 2 and any(len(p) == 1 for p in parts[1:-1]):
        return True
    if len(parts) == 2 and len(parts[1]) == 1 and len(parts[0]) >= 3:
        return True
    if _looks_like_name_phrase(text):
        return True
    if _looks_like_location_name(text):
        return False

    # Heuristic: mostly letters, starting with caps or all caps
    caps = sum(1 for p in parts if p[:1].isupper())
    letters = all(p.isalpha() for p in parts)
    
    if not letters:
        return False
        
    # Names are rarely more than 40 chars total
    if len(t) > 40:
        return False

    return caps >= len(parts) or t.isupper()


def _is_generic_title_text(text: str) -> bool:
    low = re.sub(r"[^a-z ]", "", (text or "").lower()).strip()
    return low in {"title", "designation", "position", "job title", "your title", "corporate office", "office"}


def _looks_like_company_text(text: str) -> bool:
    low = (text or "").lower()
    if not low:
        return False
    words = [w for w in re.findall(r"[A-Za-z]+", text or "") if w]
    if _looks_like_slogan_text(text):
        return False
    if _looks_like_catalog_text(text):
        return False
    if _looks_like_designation_text(low):
        return False
    if _looks_like_address_text(text):
        return False
    if "@" in low or re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, re.IGNORECASE):
        return False
    if _looks_like_location_name(text) and len(words) <= 1:
        return False
    if len(words) <= 1 and any(loc in low for loc in ["london", "california", "virginia", "usa", "uk", "india", "pune", "surat", "vadodara", "baramati", "mumbai", "delhi", "dubai", "new york"]):
        return False
    strong_company_terms = [
        "pvt",
        "ltd",
        "llp",
        "inc",
        "corp",
        "co.",
        "company",
        "enterprise",
        "enterprises",
        "group",
        "services",
        "solutions",
        "technologies",
        "systems",
        "construction",
        "engineering",
        "builders",
        "contractors",
        "real estate",
        "realty",
        "realties",
        "agency",
        "studio",
        "solar",
        "energy",
        "electrical",
        "electricals",
        "power",
        "maintenance",
        "renew",
        "products",
        "industries",
        "industrial",
        "printing",
    ]
    if any(term in low for term in strong_company_terms):
        return True
    if _looks_like_person(text):
        return False
    if _looks_like_placeholder_company(text):
        return False
    if _looks_like_website_text(text):
        return False
    if _looks_like_placeholder_company(text):
        return False
    if _looks_like_generic_company_name(text):
        return False
    if re.search(r"\d", text) and not re.search(r"\b(pvt|ltd|llp|inc|corp|co\.|company|enterprise|enterprises|group|services|solutions|technologies|systems|engineering|construction|consulting|studio|agency|solar|energy|electrical|electricals|power|maintenance|renew)\b", low):
        return False
    company_terms = strong_company_terms + [
        "contractor",
        "automotive",
        "automobile",
        "automobiles",
        "consulting",
        "clinic",
        "hotel",
        "health",
        "healthy",
        "wellness",
        "care",
        "medical",
        "finance",
        "financial",
        "insurance",
        "digital",
        "advisory",
    ]
    if any(term in low for term in company_terms):
        return True
    if any(term in low for term in {"solar", "energy", "electrical", "electricals", "power", "maintenance", "renew", "products"}):
        if any(term in low for term in {"services", "solutions", "systems", "company", "group", "enterprise", "enterprises", "technologies", "technology", "manufacturing", "products"}):
            return True
    words_lower = {w.lower() for w in re.findall(r"[A-Za-z]+", text or "")}
    company_markers = {"solar", "energy", "electrical", "electricals", "power", "maintenance", "renew", "products", "foods"}
    if len(words_lower) >= 2 and words_lower & company_markers:
        return True
    weak_company_terms = {
        "marketing",
        "sales",
        "business",
        "production",
        "service",
        "services",
        "operations",
        "real estate",
        "estate",
    }
    if any(term in low for term in weak_company_terms):
        if len(re.findall(r"[A-Za-z]+", text or "")) <= 1:
            return False
    designation_terms = [
        "manager",
        "director",
        "ceo",
        "founder",
        "owner",
        "executive",
        "officer",
        "specialist",
        "engineer",
        "designer",
        "architect",
        "analyst",
        "consultant",
        "advisor",
        "adviser",
        "accountant",
        "banker",
        "strategist",
        "investment",
        "investor",
        "trader",
        "trading",
        "wealth",
        "portfolio",
        "equity",
        "fund",
        "analysis",
        "advocate",
        "lawyer",
        "attorney",
        "counsel",
    ]
    if any(term in low for term in designation_terms):
        return False
    degree_terms = {
        "bca",
        "llb",
        "bcom",
        "mba",
        "mca",
        "mtech",
        "btech",
        "phd",
        "md",
        "ca",
        "cs",
        "cfa",
        "llm",
    }
    words_lower = {w.lower() for w in words}
    if words_lower & degree_terms:
        return False
    if not (1 <= len(words) <= 4):
        return False
    if len(words) >= 2 and all(w.isupper() for w in words) and all(len(w) >= 3 for w in words):
        return True
    if len(words) == 1 and words[0].isupper():
        return False
    title_words = sum(1 for w in words if w[:1].isupper())
    return len(words) >= 2 and title_words == len(words) and len(" ".join(words)) >= 8 and not _looks_like_address_text(text)


def _looks_like_generic_company_name(text: str) -> bool:
    low = re.sub(r"[^a-z ]", " ", (text or "").lower()).strip()
    return low in {"company", "business name", "office name", "your logo", "logo", "brand"}


def _company_candidate_score(text: str) -> float:
    t = (text or "").strip()
    if not t:
        return -1.0
    normalized_placeholder = re.sub(r"[^a-z ]", " ", t.lower()).strip()
    if _looks_like_placeholder_company(t) or _looks_like_generic_company_name(t):
        return -10.0
    low = t.lower()
    if any(token in low for token in ["add email here", "add website here", "getty stock", "website.com", "your website"]):
        return -10.0
    if _looks_like_cta_text(t):
        return -10.0
    if re.search(r"[\[\]=]{1,}", t):
        return -8.0
    noise_ratio = sum(1 for ch in t if not ch.isalnum() and ch not in " .,&/-()") / max(len(t), 1)
    if noise_ratio > 0.18:
        return -6.0
    if _looks_like_slogan_text(t):
        return -8.0
    if _looks_like_website_text(t) or _looks_like_address_text(t) or _looks_like_designation_text(t):
        return -5.0
    if _looks_like_person(t) and not _looks_like_company_text(t):
        return -5.0
    if re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", t):
        return -10.0
    if "@" in t:
        return -10.0

    words = [w for w in re.findall(r"[A-Za-z]+", t) if w]
    score = 0.0
    if any(term in low for term in [
        "pvt", "ltd", "llp", "inc", "corp", "company", "group", "services", "solutions",
        "technologies", "systems", "engineering", "construction", "consulting", "studio",
        "agency", "solar", "energy", "electrical", "electricals", "power", "maintenance", "renew",
        "products", "industries", "industrial", "fashion", "brand", "fashion brand",
    ]):
        score += 4.0
    if "&" in t or " and " in low:
        score += 1.5
    if len(words) >= 2:
        score += 1.0
    if len(words) >= 3:
        score += 0.5
    if t.isupper() and len(t) >= 4:
        score += 0.5
    if any(w[:1].isupper() for w in words):
        score += 0.5
    if len(t) <= 3:
        score -= 2.0
    return score


def _looks_like_address_text(text: str) -> bool:
    low = (text or "").lower().replace("_", " ")
    has_digit = bool(re.search(r"\d", low))
    if re.search(r"\breal estate\b", low):
        return False
    if _looks_like_location_name(text):
        return True
    if _looks_like_field_header(text):
        return False
    if re.search(
        r"\b(address|office address|corporate address|office no|resi|residence|opp|opposite|near|behind|bunglow|bungalow|floor|suite|apt|apartment|plot|building|bldg|block|colony|nagar|chowk|circle|estate|industrial estate|street|road|lane|avenue|drive|city|state|zip|pin|pincode)\b",
        low,
    ):
        return True
    if re.search(
        r"\b(road|rd|street|st|str|stret|stroet|stree|lane|ln|ave|avenue|av|city|state|zip|pincode|pin|address|floor|suite|ste|plot|building|bldg|block|town|county|province|district|roadway|boulevard|blvd|drive|dr)\b",
        low,
    ):
        if not has_digit and re.search(r"\b(building|block|floor|suite|plot)\b", low):
            if not re.search(
                r"\b(road|rd|street|st|str|stret|stroet|stree|lane|ln|ave|avenue|av|city|state|zip|pincode|pin|address|town|county|province|district|drive|dr|roadway|boulevard|blvd)\b",
                low,
            ):
                return False
        return True
    if has_digit and re.search(r"\b(nyc|ny|ca|tx|fl|nj|il|pa|wa|ga|ma|oh|mi|va|nc|sc|az|co|md|tn|mo|wi|mn|or)\b", low):
        return True
    if has_digit and re.search(r"[,;]", text):
        return True
    if has_digit and re.search(r"\b[A-Z]{2}\s*\d{4,6}(?:-\d{4})?\b", text):
        return True
    if has_digit and len(re.findall(r"[A-Za-z]+", text or "")) >= 2:
        if any(tok in low for tok in ["opp", "near", "behind", "suite", "unit", "floor", "office", "society", "apartment", "apartments", "residency", "residence", "nagar", "colony", "park", "street", "stret", "stroet", "road", "rd", "avenue", "ave"]):
            return True

    words = [w for w in re.findall(r"[A-Za-z]+", text or "") if w]
    return False


def _should_drop_field_value(label: str, text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return True
    low = re.sub(r"\s+", " ", t.lower()).strip()

    if _is_placeholder_fragment(t) or _looks_like_field_header(t):
        return True

    if label in {"COMPANY", "NAME", "DESIGNATION"} and _looks_like_placeholder_company(t):
        return True
    if label in {"COMPANY", "NAME", "DESIGNATION"} and _looks_like_slogan_text(t):
        return True
    if label in {"COMPANY", "NAME"} and _looks_like_catalog_text(t):
        return True
    if label == "COMPANY" and _looks_like_website_text(t):
        return True

    if label == "NAME":
        if _looks_like_qualification_line(t):
            return True
        if not _looks_like_person(t):
            return True
        if _looks_like_field_header(t):
            return True
        if _looks_like_company_text(t) or _looks_like_address_text(t):
            return True

    if label == "COMPANY":
        if _looks_like_qualification_line(t):
            return True
        if _is_generic_title_text(t):
            return True
        if _looks_like_placeholder_company(t) and re.sub(r"[^a-z ]", " ", t.lower()).strip() != "company name":
            return True
        if _looks_like_slogan_text(t):
            return True
        if _looks_like_website_text(t):
            return True
        if _looks_like_field_header(t):
            return True
        if len(re.findall(r"[A-Za-z]", t)) < 2:
            return True
        if re.fullmatch(r"[\W_]+", t):
            return True
        if not _looks_like_company_text(t):
            return True
        if sum(ch.isalpha() for ch in t) < max(2, sum(ch.isdigit() for ch in t)) and not _looks_like_company_text(t):
            return True
        if _looks_like_address_text(t) and not _looks_like_company_text(t):
            return True

    if label == "DESIGNATION":
        if _looks_like_degree_credential(t):
            return True
        if not _looks_like_designation_text(t):
            return True
        if _looks_like_slogan_text(t):
            return True
        if _looks_like_website_text(t):
            return True
        if _looks_like_address_text(t) or _looks_like_location_name(t):
            return True
        if re.search(r"\d", t):
            return True

    if label == "ADDRESS":
        if _looks_like_placeholder_address(t):
            return True
        if _looks_like_field_header(t):
            return True
        if len(t.split()) <= 1 and not re.search(r"\d", t):
            return True
        if not _looks_like_address_text(t) and not re.search(r"[,;]", t):
            return True

    if label == "OTHER":
        return False

    noise_ratio = sum(1 for ch in t if not ch.isalnum() and ch not in " .,@:/-+#&()") / max(len(t), 1)
    if noise_ratio > 0.35:
        return True

    return False


def _strip_company_address_suffix(value: str) -> str:
    text = _normalize_company_name(value)
    if not text:
        return ""
    text = re.sub(r"\breal\s*e(?:s|st)ta?te\b$", "", text, flags=re.I).strip(" ,;")
    text = re.sub(r"\b(?:head\s*office|branch\s*office|corporate\s*office|office)\b$", "", text, flags=re.I).strip(" ,;")

    parts = [p.strip(" ,;") for p in re.split(r"[,;]", text) if p.strip(" ,;")]
    if len(parts) >= 2:
        kept: List[str] = []
        for idx, part in enumerate(parts):
            if idx > 0 and (_looks_like_address_text(part) or _looks_like_location_name(part)):
                break
            kept.append(part)
        candidate = _normalize_company_name(", ".join(kept))
        if candidate and candidate != text and _looks_like_company_text(candidate):
            return candidate

    compact = re.sub(r"\s+", " ", text).strip()
    match = re.match(
        r"^(.+?)\s+(pune|maharashtra|india|surat|gujarat|mumbai|delhi|usa|uk)$",
        compact,
        flags=re.I,
    )
    if match:
        candidate = _normalize_company_name(match.group(1))
        if candidate and _looks_like_company_text(candidate):
            return candidate
    trailing_locations = {
        "california",
        "virginia",
        "usa",
        "uk",
        "india",
        "gujarat",
        "maharashtra",
        "surat",
        "pune",
        "mumbai",
        "delhi",
        "richmond",
        "vadodara",
    }
    words = text.split()
    while len(words) >= 2 and words[-1].lower().strip(" ,;:.") in trailing_locations:
        candidate = _normalize_company_name(" ".join(words[:-1]))
        if candidate and not _looks_like_location_name(candidate) and len(candidate.split()) >= 2:
            text = candidate
            words = text.split()
            continue
        break
    return text


def _is_weak_company_fragment(value: str) -> bool:
    low = re.sub(r"[^a-z ]", " ", (value or "").lower()).strip()
    return low in {
        "real estate",
        "wellness",
        "health",
        "creative",
        "fashion",
        "studio",
    }


def _name_candidate_score(text: str, label: str = "", source: str = "") -> float:
    candidate = _clean_output_piece("NAME", text)
    if not candidate:
        return -10.0
    if _looks_like_placeholder_name(candidate):
        return -10.0
    if _looks_like_catalog_text(candidate):
        return -10.0
    low = candidate.lower()
    if _looks_like_cta_text(candidate):
        return -10.0
    if any(token in low for token in ["contact no", "mobile", "phone", "email", "website", "photography", "photo", "workshop", "getty stock"]):
        return -10.0
    if not (_looks_like_person(candidate) or _looks_like_titled_person(candidate)):
        return -8.0

    words = [w for w in re.findall(r"[A-Za-z]+", candidate) if w]
    score = 0.0
    if _looks_like_titled_person(candidate):
        score += 3.0
    if label == "NAME":
        score += 3.0
    elif label and label != "NAME":
        score -= 1.5
    if source == "ANNOTATION_IOU":
        score += 3.0
    elif source == "KEYWORD":
        score += 1.0
    elif source == "SIZE":
        score -= 1.0
    if 2 <= len(words) <= 4:
        score += 3.0
    elif len(words) == 1:
        score += 0.5
    if source == "SIZE" and len(words) >= 4:
        return -10.0
    if source == "SIZE" and len(words) >= 4:
        score -= 3.0
    if candidate.isupper():
        score -= 0.5
    if len(candidate) > 36:
        score -= 1.5
    return score


def _best_name_candidate(items: List[Dict[str, Any]], fields: Dict[str, List[str]]) -> str:
    candidates: List[Tuple[float, str]] = []
    seen = set()
    for text in fields.get("NAME") or []:
        candidate = _clean_output_piece("NAME", text)
        key = re.sub(r"[^a-z0-9]+", "", candidate.lower())
        if not candidate or not key or key in seen:
            continue
        seen.add(key)
        score = _name_candidate_score(candidate, label="NAME", source="FIELD")
        if score > 0:
            candidates.append((score, candidate))
    for it in items:
        candidate = _clean_output_piece("NAME", it.get("text", ""))
        key = re.sub(r"[^a-z0-9]+", "", candidate.lower())
        if not candidate or not key or key in seen:
            continue
        seen.add(key)
        score = _name_candidate_score(candidate, label=str(it.get("label", "")), source=str(it.get("source", "")))
        if score > 0:
            candidates.append((score, candidate))
    if not candidates:
        return ""
    candidates.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
    return candidates[0][1]


def _best_company_candidates(items: List[Dict[str, Any]], fields: Dict[str, List[str]]) -> List[str]:
    ranked: List[Tuple[float, str]] = []
    seen = set()
    for text in fields.get("COMPANY") or []:
        candidate = _strip_company_address_suffix(_clean_output_piece("COMPANY", text))
        key = re.sub(r"[^a-z0-9]+", "", candidate.lower())
        if not candidate or not key or key in seen:
            continue
        if _looks_like_location_name(candidate):
            continue
        seen.add(key)
        score = _company_candidate_score(candidate)
        score += 4.0
        if _looks_like_company_fragment(candidate):
            score = max(score, 1.0)
        if score > 0:
            ranked.append((score, candidate))
    for it in items:
        candidate = _strip_company_address_suffix(_clean_output_piece("COMPANY", it.get("text", "")))
        key = re.sub(r"[^a-z0-9]+", "", candidate.lower())
        if not candidate or not key or key in seen:
            continue
        if _looks_like_location_name(candidate):
            continue
        seen.add(key)
        score = _company_candidate_score(candidate)
        label = str(it.get("label", ""))
        source = str(it.get("source", ""))
        if label == "COMPANY":
            score += 4.0
        elif label == "OTHER" and source == "KEYWORD":
            score += 3.5
        elif label and label != "COMPANY":
            score -= 1.0
        if source == "ANNOTATION_IOU":
            score += 3.0
        elif source == "KEYWORD":
            score += 2.0
        elif source == "SIZE":
            score -= 1.0
        if _looks_like_company_fragment(candidate):
            score = max(score, 1.0)
            if label == "COMPANY":
                score = max(score, 6.0)
            if source == "ANNOTATION_IOU":
                score = max(score, 7.0)
        if score > 0:
            ranked.append((score, candidate))

    if not ranked:
        return []

    ranked.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
    chosen: List[str] = []
    suffix_terms = {"llp", "ltd", "limited", "inc", "corp", "corporation", "group", "industries", "industry", "solutions", "services"}
    for _, candidate in ranked:
        if not chosen:
            chosen.append(candidate)
            continue
        current = chosen[0]
        norm_current = re.sub(r"[^a-z0-9]+", "", current.lower())
        norm_candidate = re.sub(r"[^a-z0-9]+", "", candidate.lower())
        if not norm_candidate or norm_candidate in norm_current or norm_current in norm_candidate:
            continue
        if _looks_like_address_text(candidate) or _looks_like_catalog_text(candidate):
            continue
        candidate_low = candidate.lower()
        if any(term in candidate_low for term in suffix_terms) and len((current + " " + candidate).split()) <= 7:
            joiner = " & " if not any(term in current.lower() for term in suffix_terms) and len(candidate.split()) >= 2 else " "
            combined = _normalize_company_name(f"{current}{joiner}{candidate}")
            if _looks_like_company_text(combined) or _looks_like_company_fragment(combined):
                chosen[0] = combined
                continue
        if len(chosen) < 2:
            chosen.append(candidate)

    return [_strip_company_address_suffix(value) for value in chosen if value]


def _annotation_company_fallback(items: List[Dict[str, Any]]) -> str:
    parts: List[str] = []
    seen = set()
    for it in items:
        if str(it.get("label", "")) != "COMPANY" or str(it.get("source", "")) != "ANNOTATION_IOU":
            continue
        candidate = _normalize_company_piece(_strip_company_address_suffix(_clean_output_piece("COMPANY", it.get("text", ""))))
        key = re.sub(r"[^a-z0-9]+", "", candidate.lower())
        if not candidate or not key or key in seen:
            continue
        if _looks_like_cta_text(candidate) or _looks_like_address_text(candidate):
            continue
        if not (_looks_like_company_text(candidate) or _looks_like_company_fragment(candidate)):
            continue
        seen.add(key)
        parts.append(candidate)

    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]

    suffixish_terms = {
        "furniture",
        "interiors",
        "industries",
        "industry",
        "solutions",
        "services",
        "company",
        "enterprise",
        "enterprises",
        "group",
        "engineering",
        "studio",
        "agency",
        "fashion",
        "realties",
        "realty",
    }
    combined = _normalize_company_name(" ".join(parts[:2]))
    second_low = parts[1].lower()
    if combined and (
        (_looks_like_company_text(combined) and not _looks_like_person(combined))
        or any(term in second_low for term in suffixish_terms)
    ):
        return combined
    return parts[0]


def _best_designation_candidate(items: List[Dict[str, Any]], fields: Dict[str, List[str]]) -> str:
    ranked: List[Tuple[float, str]] = []
    seen = set()
    for text in fields.get("DESIGNATION") or []:
        candidate = _clean_output_piece("DESIGNATION", text)
        key = re.sub(r"[^a-z0-9]+", "", candidate.lower())
        if not candidate or not key or key in seen or _should_drop_field_value("DESIGNATION", candidate):
            continue
        seen.add(key)
        score = 4.0 + max(0.0, 3.0 - (len(candidate.split()) * 0.4))
        ranked.append((score, candidate))
    for it in items:
        candidate = _clean_output_piece("DESIGNATION", it.get("text", ""))
        key = re.sub(r"[^a-z0-9]+", "", candidate.lower())
        if not candidate or not key or key in seen or _should_drop_field_value("DESIGNATION", candidate):
            continue
        seen.add(key)
        score = 0.0
        label = str(it.get("label", ""))
        source = str(it.get("source", ""))
        if label == "DESIGNATION":
            score += 5.0
        elif label:
            score -= 1.0
        if source == "ANNOTATION_IOU":
            score += 3.0
        elif source == "SIZE":
            score -= 0.5
        score += max(0.0, 3.0 - (len(candidate.split()) * 0.4))
        ranked.append((score, candidate))
    if not ranked:
        return ""
    ranked.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
    return ranked[0][1]


def _finalize_address_lines(values: List[str]) -> List[str]:
    cleaned: List[str] = []
    for raw in values:
        t = re.sub(r"\s+", " ", (raw or "").strip())
        t = t.strip(" ,;")
        if not t:
            continue
        normalized_t = re.sub(r"[^a-z ]", " ", t.lower())
        if _looks_like_placeholder_address(t) and not _has_specific_address_tokens(t):
            continue
        parts = [p.strip() for p in re.split(r"[|,;]", t) if p.strip()]
        if parts:
            strong_full_address = bool(
                re.search(r"\d", t)
                and re.search(r"\b(road|rd|street|st|lane|ave|avenue|city|state|zip|pincode|address|building|plot|drive|dr|precinct|near|circle|square)\b", t, re.I)
            )
            if not strong_full_address:
                if _looks_like_placeholder_address(t):
                    parts = [p for p in parts if _has_specific_address_tokens(p)]
                else:
                    parts = [p for p in parts if not _looks_like_placeholder_address(p) and not _is_placeholder_fragment(p)]
            if not parts:
                continue
            t = ", ".join(parts)
        cleaned.append(t)

    if not cleaned:
        return []

    unique_cleaned: List[str] = []
    seen_cleaned = set()
    for item in cleaned:
        key = re.sub(r"[^a-z0-9]+", "", item.lower())
        if key and key not in seen_cleaned:
            seen_cleaned.add(key)
            unique_cleaned.append(item)
    cleaned = unique_cleaned

    def score(s: str) -> int:
        low = s.lower()
        sc = 0
        alpha_words = re.findall(r"[A-Za-z]+", s)
        if re.search(r"\d", s):
            sc += 5
        if re.search(r"\b(road|rd|street|st|lane|ave|avenue|city|state|zip|pincode|address|floor|suite|plot|building|block|town|county|province|district|drive|dr)\b", low):
            sc += 4
        if re.search(r"\b(near|circle|square|gidc|precinct|nagar|colony|society|market)\b", low):
            sc += 3
        if len(s.split()) >= 2:
            sc += 2
        if re.fullmatch(r"\d{4,6}", re.sub(r"\s+", "", s)):
            sc -= 4
        if re.search(r"\d", s) and len(alpha_words) <= 1:
            sc -= 2
        if _looks_like_company_text(s):
            sc -= 2
        if _looks_like_designation_text(s):
            sc -= 2
        return sc

    base_idx = max(range(len(cleaned)), key=lambda i: score(cleaned[i]))
    base = cleaned[base_idx]
    extras: List[str] = []

    def normalize_token_text(s: str) -> str:
        s = re.sub(r"[\s,;:.-]+$", "", s.strip())
        s = re.sub(r"\b(st|st\.|st:|st-)\b", "St", s, flags=re.I)
        s = re.sub(r"\b(rd|rd\.|rd:|rd-)\b", "Rd", s, flags=re.I)
        s = re.sub(r"\b(ave|ave\.|ave:|ave-)\b", "Ave", s, flags=re.I)
        s = re.sub(r"\s+", " ", s).strip(" ,;")
        return s

    base = normalize_token_text(base)
    has_street_suffix = bool(re.search(r"\b(st|street|rd|road|ave|avenue|dr|drive)\b", base, flags=re.I))
    placeholder_location_parts: List[str] = []

    location_tokens: List[str] = []
    for idx, item in enumerate(cleaned):
        if idx == base_idx:
            continue
        low = item.lower().strip(" ,;:.")
        if not low:
            continue
        if _looks_like_placeholder_address(item) or _is_placeholder_fragment(item):
            normalized_placeholder = re.sub(r"[^a-z ]", " ", low)
            if re.search(r"\b(city|state|zip|zip code|pincode)\b", normalized_placeholder):
                placeholder_location_parts.append(normalize_token_text(item))
            continue
        if low in {"st", "st.", "st:", "st-", "street", "rd", "rd.", "road", "ave", "avenue", "dr", "drive"}:
            if not has_street_suffix:
                base = f"{base} {normalize_token_text(item)}".strip()
                has_street_suffix = True
            continue
        if low in {"any", "city", "state", "town", "county", "district", "province", "zip", "pincode"}:
            location_tokens.append(normalize_token_text(item))
            continue
        if len(item.split()) == 1 and not re.search(r"\d", item):
            token = normalize_token_text(item)
            if len(token) >= 4 and token.lower() not in {"logo", "name", "email", "phone", "mobile", "website"}:
                location_tokens.append(token)
                continue
        if score(item) <= 1 and len(item.split()) == 1 and not re.search(r"\d", item):
            continue
        extras.append(normalize_token_text(item))

    if location_tokens:
        # Merge the small location placeholders into a single readable suffix.
        location_order = ["any", "city", "state", "town", "county", "district", "province", "zip", "pincode"]
        ordered_tokens: List[str] = []
        used = set()
        for wanted in location_order:
            for item in location_tokens:
                if item.lower() == wanted and item.lower() not in used:
                    ordered_tokens.append(item)
                    used.add(item.lower())
        for item in location_tokens:
            if item.lower() not in used:
                ordered_tokens.append(item)
                used.add(item.lower())
        merged_location = " ".join(ordered_tokens)
        if merged_location and merged_location.lower() not in base.lower():
            extras.append(merged_location)

    result = [base]
    for item in extras:
        if item and item not in result:
            result.append(item)
    if placeholder_location_parts:
        merged_placeholder = ", ".join(
            part for part in placeholder_location_parts
            if part and part.lower() not in result[0].lower()
        ).strip(" ,;")
        if merged_placeholder:
            result[0] = f"{result[0]}, {merged_placeholder}".strip(" ,;")
    return result


def _normalize_company_name(value: str) -> str:
    t = re.sub(r"\s+", " ", (value or "").strip())
    t = t.strip(" ,;")
    t = re.sub(r"\b(&|and)\b", "&", t, flags=re.I)
    t = re.sub(r"\bcompan\s+y\b", "company", t, flags=re.I)
    t = re.sub(r"\b([A-Z]{2,})(ENTERPRISES|ENTERPRISE|COMPANY|GROUP|SERVICES|SOLUTIONS|FURNITURE)\b", r"\1 \2", t)
    repeated_phrase = re.match(r"^(.{4,}?)\s+(?:si|sl|s1|51)\s+\1$", t, flags=re.I)
    if repeated_phrase:
        t = repeated_phrase.group(1).strip(" ,;")
    repeated_comma = re.match(r"^(.{4,}?)(?:,\s*|\s+)\1$", t, flags=re.I)
    if repeated_comma:
        t = repeated_comma.group(1).strip(" ,;")
    t = re.sub(r"\b(enterprise|enterprises|company|group|services|solutions|furniture)\b(?:\s+\1\b)+", r"\1", t, flags=re.I)
    t = re.sub(r"\s+(?:si|sl|s1|51)$", "", t, flags=re.I).strip(" ,;")
    return t


def _looks_like_titled_person(text: str) -> bool:
    raw = re.sub(r"\s+", " ", (text or "").strip())
    if not raw:
        return False
    title_matched = bool(
        re.match(r"^(?:dr|mr|mrs|ms|miss|prof|er|engr|eng|adv|advocate|ca)\.?(?::|-)?\s+", raw, flags=re.I)
    )
    cleaned = _strip_leading_person_title(raw)
    return bool(
        title_matched
        and re.match(r"^[A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){1,3}$", cleaned, flags=re.I)
    )


def _normalize_company_piece(value: str) -> str:
    text = _normalize_company_name(value)
    if not text:
        return ""
    text = re.sub(r"^\d+\s+", "", text)
    text = re.sub(r"(?<=[A-Za-z])0(?=[A-Za-z])", "O", text)
    parts = [p for p in text.split() if p]
    if parts and all(len(p) == 1 or p == "0" for p in parts):
        text = "".join("O" if p == "0" else p for p in parts)
    elif len(parts) == 2:
        left, right = parts
        if left.isupper() and len(left) <= 4 and right.isupper() and len(right) >= 4:
            text = f"{left}{right}"
    return text


def _looks_like_company_fragment(text: str) -> bool:
    raw = _normalize_company_piece(text)
    if not raw:
        return False
    if re.search(r"\d", raw):
        return False
    if _looks_like_location_name(raw):
        return False
    if "@" in raw or _looks_like_website_text(raw) or _looks_like_address_text(raw):
        return False
    if _looks_like_slogan_text(raw) or _looks_like_field_header(raw) or _is_generic_title_text(raw):
        return False
    if _looks_like_designation_text(raw):
        return False

    words = [w for w in re.findall(r"[A-Za-z]+", raw) if w]
    if not words or len(words) > 4:
        return False
    if len("".join(words)) < 4:
        return False

    low_words = {w.lower() for w in words}
    generic_only = {
        "company",
        "name",
        "business",
        "brand",
        "logo",
        "your",
        "the",
        "and",
    }
    if low_words and low_words <= generic_only:
        return False

    titleish = sum(1 for w in raw.split() if w[:1].isupper() or w.isupper())
    return titleish >= max(1, len(raw.split()) - 1)


def _clean_output_piece(label: str, text: str) -> str:
    raw_input = (text or "").strip()
    t = raw_input
    if not t:
        return ""
    normalized_text = re.sub(r"[^a-z ]", " ", t.lower()).strip()
    allow_company_placeholder = label == "COMPANY" and normalized_text == "company name"
    if _is_placeholder_fragment(t) or (_looks_like_field_header(t) and not allow_company_placeholder):
        return ""
    if label in {"NAME", "COMPANY"} and _looks_like_cta_text(t):
        return ""

    # Remove OCR pipe artifacts from final output.
    t = t.replace("|", " ")
    t = t.replace("_", " ")
    t = re.sub(r"\s+", " ", t).strip()

    if label == "PHONE":
        phone = _normalize_phone_candidate(t)
        if phone:
            t = phone
        else:
            t = re.sub(r"^(?:p|ph|phone|m|mob|mobile|f|fax)\s*[:.-]?\s*", "", t, flags=re.I)
            t = re.sub(r"[^\d+()/\-\s]", "", t)
            t = re.sub(r"\s{2,}", " ", t).strip()
    elif label == "EMAIL":
        t = _normalize_email_candidate(t)
        t = re.sub(r"^(?:e-?mail|email)\s*[:\-]\s*", "", t, flags=re.I)
        if _is_placeholder_email(t):
            return ""
    elif label == "WEBSITE":
        raw_parts = [p for p in re.findall(r"[A-Za-z0-9]+", raw_input) if p]
        if "www" not in raw_input.lower() and "http" not in raw_input.lower() and "@" not in raw_input and len(raw_parts) == 3 and len(raw_parts[0]) <= 2:
            return ""
        t = normalize_contact_candidate(t)
        if t.startswith("wwww."):
            t = "www." + t[5:]
        if re.match(r"^(?:web|website)\s*[:\-]\s+", t, flags=re.I):
            t = re.sub(r"^(?:web|website)\s*[:\-]\s+", "", t, flags=re.I)
        if t.startswith("ww."):
            t = "www." + t[3:]
        compact = re.sub(r"[^a-z0-9]", "", t.lower())
        m = re.fullmatch(r"w{2,4}([a-z0-9-]{4,})(com|in|org|net|biz|info|me|edu|gov)", compact)
        if m:
            t = f"www.{m.group(1)}.{m.group(2)}"
        has_www = t.lower().startswith("www.") or t.lower().startswith("http")
        t = re.sub(r"^https?://", "", t, flags=re.I)
        t = re.sub(r"^www\.", "", t, flags=re.I)
        normalized_domain = _normalize_domain_candidate(t)
        if normalized_domain:
            t = f"www.{normalized_domain}" if has_www else normalized_domain
        if _is_generic_website_value(t):
            return ""
    elif label == "COMPANY":
        if t.lower() in {"logo", "your logo"}:
            return ""
        if _looks_like_placeholder_company(t):
            return ""
        t = _repair_split_ocr_words(t)
        t = re.sub(r"\bwww\b\.?\s*", "www.", t, flags=re.I).strip(" ,;")
    elif label == "NAME":
        if t.lower() in {"logo", "your logo"}:
            return ""
        t = _strip_leading_person_title(t)
        if _looks_like_placeholder_company(t):
            return ""
        if _looks_like_placeholder_name(t):
            return ""
        if "@" in t or _looks_like_website_text(t):
            return ""
    elif label == "ADDRESS":
        t = re.sub(r"^(?:address|location)\b\s*[:\-]?\s*", "", t, flags=re.I)
        t = re.sub(r"^(?:company\s+location|office\s+address|main\s+office\s+address|our\s+delivery\s+address)\b\s*[:\-]?\s*", "", t, flags=re.I)
        t = re.sub(r"\b(?:add your address|your address here|your location address here|enter your company address|list email address here|address goes here|address here|insert here|insert your)\b", "", t, flags=re.I)
        t = re.sub(r"\b(?:with your city name|city state zip code|city state zip)\b", "", t, flags=re.I)
        t = re.sub(r"\s+", " ", t).strip(" ,;:-")
        if _looks_like_placeholder_address(t) and not _has_specific_address_tokens(t):
            return ""
        if _looks_like_designation_text(t) and len(t.split()) <= 4:
            return ""
    elif label == "DESIGNATION":
        if _looks_like_placeholder_address(t):
            return ""
        t = _repair_split_ocr_words(t)

    return t


def _merge_field_fragments(fields: Dict[str, List[str]]) -> None:
    if len(fields["NAME"]) >= 2:
        name_parts = [_normalize_alpha_ocr_token(v) for v in fields["NAME"] if v]
        if name_parts and all(len(re.findall(r"[A-Za-z]+", v)) == 1 for v in name_parts):
            merged_name = " ".join(name_parts)
            if _looks_like_person(merged_name):
                fields["NAME"] = [merged_name]

    if fields["COMPANY"]:
        normalized_company_parts: List[str] = []
        seen_company_keys = set()
        for value in fields["COMPANY"]:
            cleaned = _normalize_company_piece(value)
            if not cleaned:
                continue
            key = re.sub(r"[^a-z0-9]+", "", cleaned.lower())
            if not key or key in seen_company_keys:
                continue
            seen_company_keys.add(key)
            normalized_company_parts.append(cleaned)

        if normalized_company_parts:
            merged_company_parts: List[str] = []
            weak_standalone_company_terms = {
                "real estate",
                "wellness",
                "health",
                "fashion",
                "creative",
                "studio",
            }
            idx = 0
            while idx < len(normalized_company_parts):
                current = normalized_company_parts[idx]
                j = idx + 1
                while j < len(normalized_company_parts):
                    candidate = normalized_company_parts[j]
                    if candidate.lower() in weak_standalone_company_terms and len(current.split()) >= 2:
                        break
                    combined = _normalize_company_name(f"{current} {candidate}")
                    if not (_looks_like_company_fragment(current) and _looks_like_company_fragment(candidate)):
                        break
                    if _looks_like_company_text(combined) or combined.isupper() or len(combined.split()) <= 4:
                        current = combined
                        j += 1
                        continue
                    break
                merged_company_parts.append(current)
                idx = j

            deduped_parts: List[str] = []
            seen_keys = set()
            for value in merged_company_parts:
                value = re.sub(r"\b([A-Za-z][A-Za-z]+)(?:\s+\1\b)+", r"\1", value, flags=re.I)
                key = re.sub(r"[^a-z0-9]+", "", value.lower())
                if key and key not in seen_keys:
                    seen_keys.add(key)
                    deduped_parts.append(value)
            if len(deduped_parts) >= 2:
                suffix_terms = {"llp", "ltd", "limited", "inc", "corp", "corporation", "group", "industries", "industry", "solutions", "services"}
                first = deduped_parts[0]
                second = deduped_parts[1]
                second_low = second.lower()
                if not _looks_like_qualification_line(first) and not _looks_like_qualification_line(second):
                    if any(term in second_low for term in suffix_terms):
                        joiner = " & " if not any(term in first.lower() for term in suffix_terms) and len(second.split()) >= 2 else " "
                        combined = _normalize_company_name(f"{first}{joiner}{second}")
                        deduped_parts = [combined] + deduped_parts[2:]
            fields["COMPANY"] = deduped_parts

    if len(fields["DESIGNATION"]) >= 2:
        desig_parts = [_clean_output_piece("DESIGNATION", v) for v in fields["DESIGNATION"] if v]
        desig_parts = [v for v in desig_parts if v and not _should_drop_field_value("DESIGNATION", v)]
        if desig_parts and all(len(v.split()) <= 2 for v in desig_parts):
            merged_desig = " ".join(desig_parts)
            if _looks_like_designation_text(merged_desig) and not _is_noisy_designation(merged_desig):
                fields["DESIGNATION"] = [merged_desig]


def _retain_semantic_value_without_annotation(label: str, value: str) -> bool:
    t = _clean_output_piece(label, value)
    if not t:
        return False
    if label == "DESIGNATION":
        return _looks_like_designation_text(t) and not _is_noisy_designation(t)
    if label == "COMPANY":
        return _looks_like_company_text(t)
    if label == "NAME":
        return _looks_like_person(t)
    if label == "ADDRESS":
        return _looks_like_address_text(t)
    return _validate_field(label, t)


def _looks_like_designation_text(text: str) -> bool:
    low = (text or "").lower()
    if not low:
        return False
    if _looks_like_slogan_text(text):
        return False
    normalized = re.sub(r"[^a-z ]", " ", low)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    weak_single_terms = {
        "marketing",
        "sales",
        "business",
        "production",
        "service",
        "services",
        "operations",
        "real estate",
        "estate",
        "title",
        "position",
        "office",
        "branch",
        "department",
        "center",
        "centre",
    }
    if normalized in weak_single_terms:
        return False
    if len(normalized.split()) == 1 and normalized in {"associate", "lead", "head"}:
        return False
    if re.search(r"\bhead\s+of\b", normalized):
        return True
    designation_terms = [
            "manager",
            "director",
            "ceo",
            "founder",
            "co founder",
            "co-founder",
            "fouider",
            "fouder",
            "proprietor",
            "owner",
            "executive",
            "engineer",
            "bookkeeper",
            "incharge",
            "in charge",
            "accountant",
            "developer",
            "consultant",
            "officer",
            "architect",
            "analyst",
            "analysis",
            "analys",
            "photographer",
            "videographer",
        "designer",
        "professional",
        "photographer",
        "videographer",
        "agent",
        "realtor",
        "broker",
        "advocate",
        "lawyer",
        "attorney",
        "counsel",
        "associate",
            "driver",
            "chauffeur",
            "chofer",
            "conductor",
            "advisor",
            "adviser",
            "banker",
            "strategist",
            "investment analyst",
            "investment banker",
            "wealth manager",
        ]
    for term in designation_terms:
        pattern = r"\b" + r"\s+".join(re.escape(part) for part in term.split()) + r"\b"
        if re.search(pattern, normalized):
            return True
    return False


def _is_noisy_designation(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return True
    low = t.lower()
    words = t.split()
    digit_count = sum(ch.isdigit() for ch in t)
    addressish = any(
        k in low
        for k in [
            "road",
            "rd",
            "street",
            "st",
            "lane",
            "nagar",
            "near",
            "dist",
            "tal",
            "sector",
            "city",
            "india",
            "pin",
            "factory",
            "branch",
            "estate",
            "pune",
        ]
    )
    companyish = any(k in low for k in ["pvt", "ltd", "llp", "services", "enterprise", "enterprises", "solutions", "company"])
    too_long = len(words) > 8 or len(t) > 80
    too_many_separators = t.count(",") >= 3
    mostly_numeric = digit_count >= 4
    return addressish or companyish or too_long or too_many_separators or mostly_numeric


def _extract_designation_fallback(detections: List[Dict[str, Any]]) -> str:
    candidates: List[Tuple[float, str]] = []
    for det in detections:
        text = str(det.get("text", "")).strip()
        if not text:
            continue
        if not _looks_like_designation_text(text):
            continue
        if _is_noisy_designation(text):
            continue
        cleaned = _clean_output_piece("DESIGNATION", text)
        if not cleaned:
            continue
        conf = float(det.get("confidence", 0.0) or 0.0)
        # Prefer concise role text (e.g., ACCOUNTANT, Sales Manager)
        length_penalty = max(0, len(cleaned.split()) - 4) * 0.08
        score = conf - length_penalty
        candidates.append((score, cleaned))

    if not candidates:
        return ""
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]


def _recover_expected_designation(detections: List[Dict[str, Any]]) -> str:
    candidates: List[Tuple[float, str]] = []
    for det in detections:
        text = str(det.get("text", "")).strip()
        if not text:
            continue
        cleaned = _clean_output_piece("DESIGNATION", text)
        if not cleaned:
            continue
        low = cleaned.lower()
        if not (_looks_like_designation_text(cleaned) or _is_generic_title_text(cleaned)):
            continue
        if _looks_like_slogan_text(cleaned) or _looks_like_website_text(cleaned) or _looks_like_address_text(cleaned):
            continue
        score = float(det.get("confidence", 0.0) or 0.0)
        if str(det.get("label", "")).upper() == "DESIGNATION":
            score += 2.0
        if str(det.get("source", "")) == "ANNOTATION_IOU":
            score += 1.5
        if any(term in low for term in ["manager", "director", "owner", "founder", "designer", "engineer", "agent", "realtor", "officer", "executive", "analyst", "architect", "attorney", "advocate", "developer"]):
            score += 1.0
        candidates.append((score, cleaned))
    if not candidates:
        return ""
    candidates.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
    return candidates[0][1]


def _recover_expected_email(detections: List[Dict[str, Any]]) -> str:
    candidates: List[Tuple[float, str]] = []
    seen = set()
    for det in detections:
        text = str(det.get("text", "")).strip()
        if not text:
            continue
        candidate = _normalize_email_candidate_relaxed(text)
        if not candidate:
            continue
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        score = float(det.get("confidence", 0.0) or 0.0)
        if str(det.get("label", "")).upper() == "EMAIL":
            score += 2.0
        if str(det.get("source", "")) == "ANNOTATION_IOU":
            score += 1.5
        if "@" in text:
            score += 1.0
        candidates.append((score, candidate))
    if not candidates:
        return ""
    candidates.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
    return candidates[0][1]


def _recover_expected_website(detections: List[Dict[str, Any]], email_values: List[str]) -> str:
    candidates: List[Tuple[float, str]] = []
    seen = set()
    for det in detections:
        text = str(det.get("text", "")).strip()
        if not text:
            continue
        candidate = _normalize_website_candidate_relaxed(text)
        if not candidate:
            continue
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        score = float(det.get("confidence", 0.0) or 0.0)
        if str(det.get("label", "")).upper() == "WEBSITE":
            score += 2.0
        if str(det.get("source", "")) == "ANNOTATION_IOU":
            score += 1.5
        if "www" in text.lower() or "http" in text.lower():
            score += 1.0
        candidates.append((score, candidate))
    for email in email_values:
        relaxed_email = _normalize_email_candidate_relaxed(email)
        if "@" not in relaxed_email:
            continue
        domain = relaxed_email.split("@", 1)[1].strip().lower()
        if domain and "." in domain:
            site = f"www.{domain}"
            if site.lower() not in seen:
                candidates.append((0.6, site))
                seen.add(site.lower())
    if not candidates:
        return ""
    candidates.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
    return candidates[0][1]


def _split_name_designation_line(text: str) -> Tuple[str, str]:
    """Split a mixed name/title line like 'John Smith General Manager'."""
    raw = re.sub(r"[;|]", " ", (text or "").strip())
    raw = re.sub(r"\s+", " ", raw)
    if not raw:
        return "", ""

    words = raw.split()
    if len(words) < 3:
        return "", ""

    # Find the first designation keyword in the token stream.
    designation_markers = [
        "manager",
        "director",
        "ceo",
        "founder",
        "owner",
        "executive",
        "engineer",
        "developer",
        "consultant",
        "officer",
        "architect",
        "analyst",
        "designer",
        "professional",
        "agent",
        "realtor",
        "broker",
        "advisor",
        "adviser",
        "accountant",
        "advocate",
        "lawyer",
        "attorney",
        "counsel",
    ]
    for i in range(1, len(words)):
        suffix = " ".join(words[i:])
        low_suffix = suffix.lower()
        if not (_looks_like_designation_text(suffix) or any(term in low_suffix for term in designation_markers)):
            continue

        prefix = " ".join(words[:i]).strip(" ,;:-")
        prefix = _strip_leading_person_title(prefix)
        suffix = re.sub(r"^[,;:\- ]+", "", suffix).strip()
        if not prefix or not (_looks_like_person(prefix) or _looks_like_titled_person(prefix)):
            continue

        # Only split when the prefix looks name-like and the suffix is a real title.
        if 2 <= len(prefix.split()) <= 3 and len(suffix.split()) <= 5:
            return prefix, suffix

    return "", ""


def _promote_missing(fields: Dict[str, List[str]], items: List[Dict[str, Any]]):
    # Promote a person-like line to NAME if missing.
    if not fields["NAME"]:
        for it in items:
            if (
                it["label"] not in {"EMAIL", "PHONE", "WEBSITE"}
                and (_looks_like_person(it["text"]) or _looks_like_titled_person(it["text"]))
                and not _looks_like_slogan_text(it["text"])
            ):
                it["label"] = "NAME"
                fields["NAME"].append(it["text"])
                break
    # Promote company-like if missing and has keywords.
    if not fields["COMPANY"]:
        for it in items:
            txt = (it.get("text") or "").strip()
            low = txt.lower()
            if not txt or _looks_like_slogan_text(txt):
                continue
            has_company_cue = any(
                k in low
                for k in [
                    "ltd",
                    "pvt",
                    "llp",
                    "inc",
                    "company",
                    "co.",
                    "co ",
                    "services",
                    "enterprise",
                    "enterprises",
                    "solutions",
                    "real estate",
                    "estate",
                    "automobile",
                    "automobiles",
                    "group",
                    "technologies",
                    "engineering",
                    "construction",
                    "solar",
                    "energy",
                    "electrical",
                    "electricals",
                    "power",
                    "maintenance",
                    "renew",
                    "products",
                    "studio",
                    "agency",
                ]
            )
            word_count = len(re.findall(r"[A-Za-z]+", txt))
            strong_caps = txt.isupper() and len(re.sub(r"[^A-Z]", "", txt)) >= 6
            if has_company_cue and (word_count >= 2 or strong_caps or re.search(r"\d", txt)):
                it["label"] = "COMPANY"
                fields["COMPANY"].append(it["text"])
                break

    # Promote a designation-like line if missing.
    if not fields["DESIGNATION"]:
        for it in items:
            low = (it.get("text") or "").lower()
            if _looks_like_designation_text(low) and not _looks_like_slogan_text(low):
                it["label"] = "DESIGNATION"
                fields["DESIGNATION"].append(it["text"])
                break


def _iou(box_a: Tuple[float, float, float, float], box_b: Tuple[float, float, float, float]) -> float:
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    if inter_x2 <= inter_x1 or inter_y2 <= inter_y1:
        return 0.0
    inter = (inter_x2 - inter_x1) * (inter_y2 - inter_y1)
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    if union <= 0:
        return 0.0
    return inter / union


def _merge_same_line_detections(detections: List[Dict[str, Any]], image_w: float, image_h: float) -> List[Dict[str, Any]]:
    """Merge OCR word boxes that are on the same line into phrase-level candidates."""
    if not detections:
        return []

    def _box(det: Dict[str, Any]) -> Tuple[float, float, float, float]:
        x1 = float(det.get("x", 0))
        y1 = float(det.get("y", 0))
        w = float(det.get("width", det.get("w", 0)) or 0.0)
        h = float(det.get("height", det.get("h", 0)) or 0.0)
        return x1, y1, x1 + w, y1 + h

    def _center_y(det: Dict[str, Any]) -> float:
        x1, y1, x2, y2 = _box(det)
        return (y1 + y2) / 2.0

    def _height(det: Dict[str, Any]) -> float:
        return float(det.get("height", det.get("h", 0)) or 0.0)

    def _vertical_overlap(a: Dict[str, Any], b: Dict[str, Any]) -> float:
        ax1, ay1, ax2, ay2 = _box(a)
        bx1, by1, bx2, by2 = _box(b)
        inter = max(0.0, min(ay2, by2) - max(ay1, by1))
        denom = max(1.0, min(ay2 - ay1, by2 - by1))
        return inter / denom

    def _same_line(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
        ah = max(1.0, _height(a))
        bh = max(1.0, _height(b))
        max_h = max(ah, bh)
        cy_gap = abs(_center_y(a) - _center_y(b))
        return cy_gap <= max_h * 0.60 and _vertical_overlap(a, b) >= 0.20

    # First cluster boxes by vertical band.
    line_clusters: List[Dict[str, Any]] = []
    for det in sorted(
        detections,
        key=lambda d: (
            _center_y(d),
            float(d.get("x", 0)),
            -float(d.get("confidence", 0.0) or 0.0),
        ),
    ):
        txt = str(det.get("text", "")).strip()
        if not txt:
            continue

        cy = _center_y(det)
        h = max(1.0, _height(det))

        best_idx = None
        best_gap = None
        for idx, cluster in enumerate(line_clusters):
            cy_gap = abs(cy - cluster["cy"])
            max_h = max(h, cluster["h"])
            if cy_gap <= max_h * 0.60:
                if best_gap is None or cy_gap < best_gap:
                    best_idx = idx
                    best_gap = cy_gap

        if best_idx is None:
            line_clusters.append({"cy": cy, "h": h, "items": [det]})
            continue

        cluster = line_clusters[best_idx]
        cluster["items"].append(det)
        n = len(cluster["items"])
        cluster["cy"] = ((cluster["cy"] * (n - 1)) + cy) / n
        cluster["h"] = max(cluster["h"], h)

    merged: List[Dict[str, Any]] = []

    def _flush_segment(segment: List[Dict[str, Any]]) -> None:
        if not segment:
            return
        if len(segment) == 1:
            merged.append(segment[0])
            return

        segment = sorted(segment, key=lambda d: float(d.get("x", 0)))
        text = " ".join(str(d.get("text", "")).strip() for d in segment if str(d.get("text", "")).strip())
        if not text:
            return

        x1 = min(float(d.get("x", 0)) for d in segment)
        y1 = min(float(d.get("y", 0)) for d in segment)
        x2 = max(float(d.get("x", 0)) + float(d.get("width", d.get("w", 0)) or 0.0) for d in segment)
        y2 = max(float(d.get("y", 0)) + float(d.get("height", d.get("h", 0)) or 0.0) for d in segment)
        confidence = max(float(d.get("confidence", 0.0) or 0.0) for d in segment)

        merged.append(
            {
                "text": text,
                "x": x1,
                "y": y1,
                "width": max(1.0, x2 - x1),
                "height": max(1.0, y2 - y1),
                "confidence": confidence,
            }
        )

    for cluster in line_clusters:
        items = sorted(cluster["items"], key=lambda d: float(d.get("x", 0)))
        segment: List[Dict[str, Any]] = []
        for det in items:
            if not segment:
                segment = [det]
                continue

            prev = segment[-1]
            prev_x2 = float(prev.get("x", 0)) + float(prev.get("width", prev.get("w", 0)) or 0.0)
            curr_x1 = float(det.get("x", 0))
            gap = curr_x1 - prev_x2
            max_h = max(1.0, _height(prev), _height(det))
            same_line = _same_line(prev, det)
            prev_w = float(prev.get("width", prev.get("w", 0)) or 0.0)
            curr_w = float(det.get("width", det.get("w", 0)) or 0.0)
            wide_blocks = prev_w >= image_w * 0.12 and curr_w >= image_w * 0.12
            cross_column_gap = gap >= max(image_w * 0.05, max_h * 1.20, 42.0)
            close_enough = gap <= max(max_h * 1.35, 24.0)
            if wide_blocks and cross_column_gap:
                close_enough = False

            if same_line and close_enough:
                segment.append(det)
            else:
                _flush_segment(segment)
                segment = [det]

        _flush_segment(segment)

    merged.sort(key=lambda d: (float(d.get("y", 0)), float(d.get("x", 0))))
    return merged


def _assign_label_by_geometry(det: Dict[str, Any], task_rects: List[Tuple[str, float, float, float, float]], image_w: float, image_h: float):
    dx1 = det.get("x", 0) / max(1.0, image_w)
    dy1 = det.get("y", 0) / max(1.0, image_h)
    dw = det.get("width", det.get("w", 0)) / max(1.0, image_w)
    dh = det.get("height", det.get("h", 0)) / max(1.0, image_h)
    dx2 = dx1 + dw
    dy2 = dy1 + dh
    cx = dx1 + (dw / 2.0)
    cy = dy1 + (dh / 2.0)

    best_lbl = None
    best_score = 0.0
    best_iou = 0.0
    for lbl, x, y, w, h in task_rects:
        bx1, by1 = x, y
        bx2, by2 = x + w, y + h
        pad_x = max(0.012, w * 0.08)
        pad_y = max(0.010, h * 0.12)
        px1 = max(0.0, bx1 - pad_x)
        py1 = max(0.0, by1 - pad_y)
        px2 = min(1.0, bx2 + pad_x)
        py2 = min(1.0, by2 + pad_y)
        inside = (px1 <= cx <= px2) and (py1 <= cy <= py2)
        iou_val = _iou((dx1, dy1, dx2, dy2), (bx1, by1, bx2, by2))
        padded_iou = _iou((dx1, dy1, dx2, dy2), (px1, py1, px2, py2))
        center_bonus = 1.0 if inside else 0.0
        if lbl in {"EMAIL", "PHONE", "WEBSITE"} and inside:
            center_bonus += 0.25
        score = center_bonus + max(iou_val, padded_iou)
        if score > best_score:
            best_score = score
            best_iou = iou_val
            best_lbl = lbl

    if best_lbl and (best_score >= 0.95 or best_iou >= 0.03 or best_score >= 0.75):
        return best_lbl
    return None


def _get_text_fingerprint(text: str) -> set:
    """Extracts a set of normalized 4+ character tokens for similarity matching."""
    if not text: return set()
    return {re.sub(r"[^a-z]", "", w.lower()) for w in text.split() if len(re.sub(r"[^a-z]", "", w)) >= 4}


def _index_annotated_cards(task_map: Dict[str, Dict], raw_dir: Path) -> Dict[str, set]:
    """Simulates a trained image database by indexing text tokens found on known cards."""
    # We try to find text content for historical cards.
    # If the user has .txt files in an 'output' or 'results' folder, we could use them.
    # BUT since we might not have them, we assume for now that many card_keys (filenames)
    # contain identifying brand keywords.
    index = {}
    for key in task_map.keys():
        # Treat the filename/key itself as a signature token
        index[key] = {re.sub(r"[^a-z]", "", key.lower())}
    return index


def _find_best_template(detections: List[Dict], task_map: Dict[str, Dict]) -> Tuple[Optional[str], float]:
    """Finds the historical task with the highest text similarity to current OCR."""
    full_text = " ".join([d.get("text", "") for d in detections]).lower()
    curr_tokens = {re.sub(r'[^a-z0-9]', '', w) for w in full_text.split() if len(w) > 3}
    curr_tokens.discard('')
    
    if not curr_tokens:
        return None, 0.0

    best_key = None
    best_similarity = 0.0

    # Match by key fragments first
    for key in task_map.keys():
        clean_key = re.sub(r"[^a-z0-9]", "", key.lower().replace("card", ""))
        if len(clean_key) >= 4 and clean_key in full_text:
             return key, 0.99
    
    return None, 0.0


def _iter_task_rects(task: Dict) -> List[Tuple[str, float, float, float, float]]:
    rects: List[Tuple[str, float, float, float, float]] = []
    for ann in task.get("annotations") or []:
        if ann.get("was_cancelled"):
            continue
        for r in ann.get("result") or []:
            if r.get("type") != "rectanglelabels":
                continue
            val = r.get("value") or {}
            labels = val.get("rectanglelabels") or []
            if not labels:
                continue
            lbl = str(labels[0]).upper().strip()
            x = float(val.get("x", 0.0)) / 100.0
            y = float(val.get("y", 0.0)) / 100.0
            w = float(val.get("width", 0.0)) / 100.0
            h = float(val.get("height", 0.0)) / 100.0
            if w <= 0 or h <= 0:
                continue
            rects.append((lbl, x, y, w, h))
    return rects


def _get_task_map(annotation_path: Path) -> Dict[str, Dict]:
    cache = getattr(predict_labels, "_task_map_cache", None)
    current_mtime = annotation_path.stat().st_mtime if annotation_path.exists() else 0
    if cache and cache.get("path") == str(annotation_path.resolve()) and cache.get("mtime") == current_mtime:
        return cache.get("map", {})

    mapping = build_task_card_map(annotation_path) if annotation_path.exists() else {}
    predict_labels._task_map_cache = {
        "path": str(annotation_path.resolve()),
        "mtime": current_mtime,
        "map": mapping,
    }
    return mapping


def ensure_artifacts(raw_dir: Path, annotation_path: Path, models_dir: Path, config_path: Path) -> None:
    models_dir.mkdir(parents=True, exist_ok=True)
    model_path = models_dir / "label_model.joblib"
    if not model_path.exists():
        raise FileNotFoundError(f"Missing OCR label model: {model_path}")


def predict_labels(
    detections: List[Dict[str, Any]],
    image_w: float,
    image_h: float,
    raw_dir: Path,
    annotation_path: Path,
    models_dir: Path,
    config_path: Path,
    card_key: Optional[str] = None,
) -> Dict[str, Any]:
    cfg = load_label_config(config_path)
    task_map = _get_task_map(annotation_path)
    
    sys.stderr.write(f"[OCR] Processing card scan ({len(detections)} blocks)...\n")

    merged_detections = _merge_same_line_detections(detections, image_w, image_h)
    if len(merged_detections) != len(detections):
        sys.stderr.write(f"[OCR] Merged OCR blocks into {len(merged_detections)} same-line candidates.\n")

    # 0) Automatic Template Discovery: If no card_key, try to find a similar historical layout
    if not card_key:
        matched_key, sim = _find_best_template(merged_detections, task_map)
        if sim >= 0.7:
            card_key = matched_key
            sys.stderr.write(f"[OCR] Auto-detected template: {card_key}\n")
        else:
            sys.stderr.write(f"[OCR] No matching template found. Using statistical fallback.\n")
    else:
        sys.stderr.write(f"[OCR] Using explicit card_key: {card_key}\n")

    task_rects: List[Tuple[str, float, float, float, float]] = []
    has_annotations = False
    expected_labels = set()
    if card_key:
        task = task_map.get(card_key.lower())
        if task:
            task_rects = _iter_task_rects(task)
            has_annotations = bool(task_rects)
            expected_labels = {lbl for lbl, _, _, _, _ in task_rects}

    # Load/update layout profile always.
    layout_profile = load_or_build_layout_profile(annotation_path, models_dir / "layout_profile.json")

    model_bundle: Optional[Dict[str, Any]] = None
    try:
        ensure_artifacts(raw_dir, annotation_path, models_dir, config_path)
        model_bundle = _repair_model_bundle(joblib.load(models_dir / "label_model.joblib"))
    except Exception:
        model_bundle = None

    out: List[Dict[str, Any]] = []
    for det in merged_detections:
        text = str(det.get("text", "")).strip()
        if not text:
            continue

        contact_label, contact_text = _strict_contact_label(text)
        if contact_label:
            out.append(
                {
                    "text": contact_text if contact_label in {"EMAIL", "WEBSITE"} else text,
                    "label": contact_label,
                    "confidence": 0.99,
                    "source": "CONTACT_REGEX",
                    "x": det.get("x", 0),
                    "y": det.get("y", 0),
                    "width": det.get("width", det.get("w", 0)),
                    "height": det.get("height", det.get("h", 0)),
                }
            )
            sys.stderr.write(f"[OCR] '{text[:15]}...' -> {contact_label} via CONTACT_REGEX\n")
            continue

        # 1) Annotation IOU match (highest priority)
        iou_label = None
        iou_conf = 0.0
        if task_rects:
            dx1 = det.get("x", 0) / max(1.0, image_w)
            dy1 = det.get("y", 0) / max(1.0, image_h)
            dw = det.get("width", det.get("w", 0)) / max(1.0, image_w)
            dh = det.get("height", det.get("h", 0)) / max(1.0, image_h)
            dx2 = dx1 + dw
            dy2 = dy1 + dh

            best_iou = 0.0
            best_lbl = None
            for lbl, x, y, w, h in task_rects:
                bx1, by1 = x, y
                bx2, by2 = x + w, y + h
                iou_val = _iou((dx1, dy1, dx2, dy2), (bx1, by1, bx2, by2))
                if iou_val > best_iou:
                    best_iou = iou_val
                    best_lbl = lbl

            if best_lbl and best_iou >= cfg.get("iou_threshold", 0.2):
                iou_label = best_lbl
                iou_conf = min(0.99, max(0.6, best_iou))

        if iou_label:
            final_label = iou_label
            final_conf = iou_conf
            source = "ANNOTATION_IOU"
            out_text = text if final_label not in {"EMAIL", "WEBSITE"} else normalize_contact_candidate(text)
            out.append(
                {
                    "text": out_text,
                    "label": final_label,
                    "confidence": round(float(final_conf), 3),
                    "source": source,
                    "x": det.get("x", 0),
                    "y": det.get("y", 0),
                    "width": det.get("width", det.get("w", 0)),
                    "height": det.get("height", det.get("h", 0)),
                }
            )
            sys.stderr.write(f"[OCR] '{text[:15]}...' -> {final_label} (IOU Match) via {source}\n")
            continue

        rule_label, rule_conf, rule_src = apply_regex_rules(text, cfg)

        # If we have annotations for this card and no IoU hit, do not hard-drop
        # clear non-contact lines. Keep only very weak tiny fragments as OTHER.
        if task_rects and rule_label not in {"EMAIL", "PHONE", "WEBSITE"}:
            txt_len = len(text.strip())
            det_conf = float(det.get("confidence", 0.0) or 0.0)
            det_h = float(det.get("height", det.get("h", 0)) or 0.0)
            weak_fragment = (txt_len <= 3) or (det_conf < 0.30 and det_h < 12)
            if weak_fragment:
                out.append(
                    {
                        "text": text,
                        "label": "OTHER",
                        "confidence": 0.2,
                        "source": "UNANNOTATED",
                        "x": det.get("x", 0),
                        "y": det.get("y", 0),
                        "width": det.get("width", det.get("w", 0)),
                        "height": det.get("height", det.get("h", 0)),
                    }
                )
                continue

        ml_label, ml_conf = _predict_ml_label(model_bundle, det, image_w, image_h)

        # layout score for ML label and rule label
        layout_ml = _layout_score(ml_label, det, image_w, image_h, layout_profile)
        layout_rule = _layout_score(rule_label, det, image_w, image_h, layout_profile)

        # Fusion: Regex > ML > Layout
        if rule_label in {"EMAIL", "PHONE", "WEBSITE"}:
            final_label = rule_label
            final_conf = max(rule_conf, layout_rule)
            source = rule_src
        elif rule_src in ["BLACKLIST", "SOCIAL_HANDLE"]:
            final_label = "OTHER"
            final_conf = 0.01
            source = rule_src
        elif ml_label != "OTHER" and ml_conf > 0.82:
            final_label = ml_label
            final_conf = ml_conf
            source = "ML_PRIME"
        elif rule_src == "KEYWORD":
            final_label = rule_label
            final_conf = max(rule_conf, layout_rule)
            source = "KEYWORD"
        elif ml_conf >= 0.45:
            final_label = ml_label
            final_conf = (ml_conf * 0.8) + (layout_ml * 0.2)
            source = "ML"
        else:
            # fallback: best size match, then layout if needed
            candidate_labels = [l for l in cfg.get("labels", []) if l not in {"EMAIL", "PHONE", "WEBSITE", "OTHER"}]
            size_scored = [(lbl, _size_score(lbl, det, image_w, image_h, layout_profile)) for lbl in candidate_labels]
            size_scored.sort(key=lambda x: x[1], reverse=True)
            final_label, final_conf = (size_scored[0] if size_scored else ("OTHER", 0.0))
            source = "SIZE"
            if final_conf < 0.35:
                layout_scored = [(lbl, _layout_score(lbl, det, image_w, image_h, layout_profile)) for lbl in candidate_labels]
                layout_scored.sort(key=lambda x: x[1], reverse=True)
                final_label, final_conf = (layout_scored[0] if layout_scored else ("OTHER", 0.0))
                source = "LAYOUT"

        if not _validate_field(final_label, text) and final_label in {"EMAIL", "PHONE", "WEBSITE"}:
            final_label = "OTHER"
            final_conf = 0.1
            source = "VALIDATOR"

        # If confidence is too low, skip predicting (treat as OTHER).
        if final_conf < 0.35:
            final_label = "OTHER"
            source = "LOWCONF"

        # Tiny placeholder fragments are structural noise, not meaningful fields.
        if final_label not in {"EMAIL", "PHONE", "WEBSITE"} and _is_placeholder_fragment(text):
            final_label = "OTHER"
            final_conf = min(final_conf, 0.2)
            source = "PLACEHOLDER"

        out_text = text
        if final_label in {"EMAIL", "WEBSITE"}:
            out_text = normalize_contact_candidate(text)

        item = {
            "text": out_text,
            "label": final_label,
            "confidence": round(float(final_conf), 3),
            "source": source,
            "x": det.get("x", 0),
            "y": det.get("y", 0),
            "width": det.get("width", det.get("w", 0)),
            "height": det.get("height", det.get("h", 0)),
        }
        out.append(item)

    out = _resolve_conflicts(out, protect_annotation=has_annotations)

    fields = {"NAME": [], "COMPANY": [], "DESIGNATION": [], "ADDRESS": [], "PHONE": [], "EMAIL": [], "WEBSITE": []}
    main_allowed = {"ANNOTATION_IOU", "ML", "ML_PRIME", "LAYOUT", "SIZE", "VALIDATOR", "KEYWORD", "ML_FORCE", "ADDR_GEOM"}
    contact_allowed = {"ANNOTATION_IOU", "REGEX", "CONTACT_REGEX", "ML", "LAYOUT", "SIZE", "VALIDATOR", "KEYWORD", "ML_FORCE"}

    for it in out:
        lbl = it["label"]
        src = it.get("source", "")
        if lbl in {"PHONE", "EMAIL", "WEBSITE"}:
            if has_annotations and expected_labels and lbl not in expected_labels and src != "ANNOTATION_IOU":
                continue
            if src in contact_allowed:
                fields[lbl].append(it["text"])
        elif lbl in {"NAME", "COMPANY", "DESIGNATION", "ADDRESS"}:
            if has_annotations and expected_labels and lbl not in expected_labels and src != "ANNOTATION_IOU":
                continue
            if src in main_allowed:
                fields[lbl].append(it["text"])

    # Recover mixed contact fragments from any OCR line before we finalize fields.
    for it in out:
        txt = str(it.get("text", "")).strip()
        if not txt:
            continue
        phone_val = _normalize_phone_candidate(txt)
        if phone_val:
            if phone_val not in fields["PHONE"]:
                fields["PHONE"].append(phone_val)
        email_match = re.search(r"[A-Za-z][A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", txt)
        if email_match:
            email_val = _normalize_email_candidate(email_match.group(0))
            if email_val and email_val not in fields["EMAIL"]:
                fields["EMAIL"].append(email_val)
        website_match = re.search(r"(?:https?://\S+|www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?|\b[a-zA-Z0-9-]+\.(?:com|in|org|net|co\.in|biz|info|me|edu|gov)\b)", txt, re.I)
        if website_match:
            web_val = normalize_contact_candidate(website_match.group(0))
            if web_val and web_val not in fields["WEBSITE"]:
                fields["WEBSITE"].append(web_val)

    # If annotation has ADDRESS boxes, pull any OCR line whose center falls inside that box (for multi-line addresses).
    if task_rects:
        addr_boxes = [(x, y, w, h) for lbl, x, y, w, h in task_rects if lbl.upper() == "ADDRESS"]
        if addr_boxes:
            for det in merged_detections:
                cx = (det.get("x", 0) + det.get("width", det.get("w", 0)) / 2) / max(1.0, image_w)
                cy = (det.get("y", 0) + det.get("height", det.get("h", 0)) / 2) / max(1.0, image_h)
                for x, y, w, h in addr_boxes:
                    if (x <= cx <= x + w) and (y <= cy <= y + h):
                        txt = str(det.get("text", "")).strip()
                        if txt and txt not in fields["ADDRESS"]:
                            fields["ADDRESS"].append(txt)
                            out.append(
                                {
                                    "text": txt,
                                    "label": "ADDRESS",
                                    "confidence": 0.55,
                                    "source": "ADDR_GEOM",
                                    "x": det.get("x", 0),
                                    "y": det.get("y", 0),
                                    "width": det.get("width", det.get("w", 0)),
                                    "height": det.get("height", det.get("h", 0)),
                                }
                            )
                        break

        def _best_text_for_rect(label: str, rect: Tuple[str, float, float, float, float]) -> str:
            _, x, y, w, h = rect
            pad_x = max(0.010, w * 0.10)
            pad_y = max(0.010, h * 0.14)
            bx1 = max(0.0, x - pad_x)
            by1 = max(0.0, y - pad_y)
            bx2 = min(1.0, x + w + pad_x)
            by2 = min(1.0, y + h + pad_y)
            best_txt = ""
            best_score = -1.0
            for det in merged_detections:
                txt = str(det.get("text", "")).strip()
                if not txt:
                    continue
                dx1 = det.get("x", 0) / max(1.0, image_w)
                dy1 = det.get("y", 0) / max(1.0, image_h)
                dw = det.get("width", det.get("w", 0)) / max(1.0, image_w)
                dh = det.get("height", det.get("h", 0)) / max(1.0, image_h)
                dx2 = dx1 + dw
                dy2 = dy1 + dh
                cx = dx1 + (dw / 2.0)
                cy = dy1 + (dh / 2.0)
                inside = (bx1 <= cx <= bx2) and (by1 <= cy <= by2)
                iou_val = _iou((dx1, dy1, dx2, dy2), (bx1, by1, bx2, by2))
                dist = abs(cx - (x + (w / 2.0))) + abs(cy - (y + (h / 2.0)))
                bonus = 0.0
                contact_label, _ = _strict_contact_label(txt)
                if label in {"EMAIL", "PHONE", "WEBSITE"} and contact_label == label:
                    bonus += 0.4
                if label == "NAME" and _looks_like_person(txt):
                    bonus += 0.2
                if label == "COMPANY" and _looks_like_company_text(txt):
                    bonus += 0.2
                if label == "DESIGNATION" and _looks_like_designation_text(txt):
                    bonus += 0.2
                score = (1.0 if inside else 0.0) + (iou_val * 1.5) + bonus - (dist * 0.10)
                if score > best_score:
                    best_score = score
                    best_txt = txt
            return best_txt if best_score >= 0.20 else ""

        if expected_labels:
            for lbl, x, y, w, h in task_rects:
                lbl = lbl.upper()
                if lbl not in fields or fields[lbl]:
                    continue
                best_txt = _best_text_for_rect(lbl, (lbl, x, y, w, h))
                if best_txt and best_txt not in fields[lbl]:
                    fields[lbl].append(best_txt)

    if not has_annotations:
        _promote_missing(fields, out)

    # Run semantic re-homing before primary fields are truncated, otherwise a
    # second NAME line like "Title" never gets a chance to become DESIGNATION.
    for key in list(fields.keys()):
        kept: List[str] = []
        for val in fields[key]:
            contact_label, contact_text = _strict_contact_label(val)
            if contact_label:
                contact_val = contact_text if contact_label in {"EMAIL", "WEBSITE"} else val
                if contact_val not in fields[contact_label]:
                    fields[contact_label].append(contact_val)
                if key == contact_label:
                    kept.append(contact_val)
            elif key == "NAME" and _is_generic_title_text(val):
                if val not in fields["DESIGNATION"]:
                    fields["DESIGNATION"].append(val)
            elif key == "NAME" and _looks_like_company_text(val):
                if val not in fields["COMPANY"]:
                    fields["COMPANY"].append(val)
            elif key in {"ADDRESS", "DESIGNATION"} and _looks_like_company_text(val) and not _looks_like_address_text(val):
                if val not in fields["COMPANY"]:
                    fields["COMPANY"].append(val)
            elif key == "ADDRESS" and not _looks_like_address_text(val):
                if _looks_like_company_text(val):
                    if val not in fields["COMPANY"]:
                        fields["COMPANY"].append(val)
                elif val.isalpha() and len(val.split()) <= 3:
                    continue
            else:
                kept.append(val)
        fields[key] = list(dict.fromkeys(kept))

    # Keep only the first value for primary identity fields; keep all for contact and address.
    for k, vals in fields.items():
        if not vals:
            continue
        if k in {"ADDRESS", "PHONE", "EMAIL", "WEBSITE"}:
            continue
        # If there was a single annotated box that spans multiple OCR lines (centers inside), keep all of those lines.
        if has_annotations:
            fields[k] = vals  # annotation-driven cards: do not truncate multi-line labels
        else:
            fields[k] = [vals[0]]

    for key, vals in list(fields.items()):
        cleaned: List[str] = []
        for val in vals:
            out_val = _clean_output_piece(key, val)
            if key == "DESIGNATION" and out_val and (_is_noisy_designation(out_val) or _looks_like_degree_credential(out_val)):
                continue
            if out_val and out_val not in cleaned:
                cleaned.append(out_val)
        fields[key] = cleaned

    # Some fields are content-defined. Re-home values that geometry/ML placed in
    # plausible-looking but semantically wrong buckets.
    for key in list(fields.keys()):
        kept: List[str] = []
        for val in fields[key]:
            contact_label, contact_text = _strict_contact_label(val)
            if contact_label:
                contact_val = contact_text if contact_label in {"EMAIL", "WEBSITE"} else val
                if contact_val not in fields[contact_label]:
                    fields[contact_label].append(contact_val)
                if key == contact_label:
                    kept.append(contact_val)
            elif key == "NAME" and _is_generic_title_text(val):
                if val not in fields["DESIGNATION"]:
                    fields["DESIGNATION"].append(val)
            elif key == "NAME" and _looks_like_company_text(val):
                if val not in fields["COMPANY"]:
                    fields["COMPANY"].append(val)
            elif key == "NAME" and _looks_like_website_text(val):
                if val not in fields["WEBSITE"]:
                    fields["WEBSITE"].append(val)
            elif key == "COMPANY" and _looks_like_website_text(val):
                if val not in fields["WEBSITE"]:
                    fields["WEBSITE"].append(val)
            elif key == "COMPANY" and _is_generic_title_text(val):
                if val not in fields["DESIGNATION"]:
                    fields["DESIGNATION"].append(val)
            elif key in {"ADDRESS", "DESIGNATION"} and _looks_like_company_text(val) and not _looks_like_address_text(val):
                if val not in fields["COMPANY"]:
                    fields["COMPANY"].append(val)
            else:
                kept.append(val)
        fields[key] = list(dict.fromkeys(kept))

    # Split merged OCR lines that contain both a person name and a job title.
    for key in ["NAME", "COMPANY", "DESIGNATION"]:
        kept: List[str] = []
        for val in fields[key]:
            name_part, desig_part = _split_name_designation_line(val)
            if name_part and desig_part:
                if name_part not in fields["NAME"]:
                    fields["NAME"].append(name_part)
                if desig_part not in fields["DESIGNATION"]:
                    fields["DESIGNATION"].append(desig_part)
                continue
            kept.append(val)
        fields[key] = list(dict.fromkeys(kept))

    fields["EMAIL"] = [v for v in fields["EMAIL"] if _validate_field("EMAIL", v)]
    fields["WEBSITE"] = [v for v in fields["WEBSITE"] if "@" not in v and _validate_field("WEBSITE", v)]
    fields["PHONE"] = [v for v in fields["PHONE"] if _validate_field("PHONE", v)]

    if len(fields["COMPANY"]) > 1:
        strong_company = [v for v in fields["COMPANY"] if not _looks_like_designation_text(v) and not _is_generic_title_text(v)]
        if strong_company:
            fields["COMPANY"] = strong_company

    if fields["WEBSITE"]:
        preferred_sites: List[str] = []
        scored_sites: List[Tuple[float, str]] = []
        website_pool: List[str] = list(dict.fromkeys(fields["WEBSITE"]))
        for it in merged_detections:
            txt = str(it.get("text", "")).strip()
            if not txt:
                continue
            if _looks_like_website_text(txt):
                site = normalize_contact_candidate(txt)
                if site and site not in website_pool:
                    website_pool.append(site)
        email_site = ""
        for email in fields["EMAIL"]:
            email_site = _email_domain_to_website(email)
            if email_site:
                break
        email_root = re.sub(r"[^a-z0-9]+", "", re.sub(r"^www\.", "", email_site.lower()).split(".", 1)[0]) if email_site else ""
        for site in website_pool:
            low = site.lower().strip()
            if len(re.sub(r"[^a-z]", "", low)) < 8:
                continue
            if low.startswith("www.") and low.count(".") == 1 and len(low.split(".", 1)[1]) <= 4:
                continue
            root = re.sub(r"[^a-z0-9]+", "", re.sub(r"^www\.", "", low).split(".", 1)[0])
            score = 0.0
            if low.startswith("www."):
                score += 2.0
            if re.search(r"\.[a-z]{2,}(?:\.[a-z]{2,})?$", low):
                score += 2.0
            if len(root) >= 6:
                score += 1.0
            if root in {"email", "mail", "website", "example", "yourcompany", "companyname"}:
                score -= 4.0
            for prefix in ("hello", "mail", "email", "contact", "info", "support", "sales", "admin", "web"):
                if root.startswith(prefix) and len(root) > len(prefix) + 3:
                    remainder = root[len(prefix):]
                    if any(common in remainder for common in {"email", "mail", "website", "example", "yourcompany", "companyname"}):
                        score -= 5.0
                    else:
                        score -= 2.5
                    break
            if email_root and root == email_root:
                score += 4.0
            elif email_root and (root.endswith(email_root) or email_root.endswith(root)):
                score += 2.0
            scored_sites.append((score, site))
        scored_sites.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
        preferred_sites = [site for _, site in scored_sites[:1]]
        fields["WEBSITE"] = list(dict.fromkeys(preferred_sites))
    elif fields["EMAIL"]:
        raw_sites: List[str] = []
        for it in merged_detections:
            txt = str(it.get("text", "")).strip()
            if not txt:
                continue
            if _looks_like_website_text(txt):
                site = normalize_contact_candidate(txt)
                if site and site not in raw_sites:
                    raw_sites.append(site)
        if raw_sites:
            scored_raw_sites: List[Tuple[float, str]] = []
            for site in raw_sites:
                low = site.lower().strip()
                root = re.sub(r"[^a-z0-9]+", "", re.sub(r"^www\.", "", low).split(".", 1)[0])
                score = 0.0
                if low.startswith("www."):
                    score += 2.0
                if re.search(r"\.[a-z]{2,}(?:\.[a-z]{2,})?$", low):
                    score += 2.0
                if len(root) >= 6:
                    score += 1.0
                if root in {"email", "mail", "website", "example", "yourcompany", "companyname"}:
                    score -= 4.0
                scored_raw_sites.append((score, site))
            scored_raw_sites.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
            if scored_raw_sites:
                fields["WEBSITE"] = [scored_raw_sites[0][1]]
        elif not fields["WEBSITE"]:
            inferred_site = ""
            for email in fields["EMAIL"]:
                inferred_site = _email_domain_to_website(email)
                if inferred_site:
                    break
            if inferred_site and _validate_field("WEBSITE", inferred_site):
                fields["WEBSITE"] = [inferred_site]


    cleaned_address: List[str] = []
    if task_rects:
        addr_boxes = [(x, y, w, h) for lbl, x, y, w, h in task_rects if lbl.upper() == "ADDRESS"]
        if addr_boxes:
            addr_candidates: List[Tuple[float, float, str]] = []
            for det in merged_detections:
                txt = str(det.get("text", "")).strip()
                if not txt:
                    continue
                cx = (det.get("x", 0) + det.get("width", det.get("w", 0)) / 2) / max(1.0, image_w)
                cy = (det.get("y", 0) + det.get("height", det.get("h", 0)) / 2) / max(1.0, image_h)
                for x, y, w, h in addr_boxes:
                    if (x <= cx <= x + w) and (y <= cy <= y + h):
                        addr_candidates.append((cy, cx, txt))
                        break
            addr_candidates.sort(key=lambda it: (it[0], it[1]))
            cleaned_address = [txt for _, _, txt in addr_candidates]
            for val in fields["ADDRESS"]:
                if val not in cleaned_address:
                    cleaned_address.append(val)

    if not cleaned_address:
        for val in fields["ADDRESS"]:
            if _looks_like_company_text(val) and not _looks_like_address_text(val):
                if val not in fields["COMPANY"]:
                    fields["COMPANY"].append(val)
                continue
            if not _looks_like_address_text(val):
                token_count = len(val.split())
                has_digits = bool(re.search(r"\d", val))
                if token_count <= 1 and not has_digits:
                    continue
                if token_count <= 2 and not has_digits and not any(ch.isupper() for ch in val):
                    continue
            if val not in cleaned_address:
                cleaned_address.append(val)

    fields["ADDRESS"] = _finalize_address_lines(cleaned_address)

    # Final safeguard:
    # If designation is missing and address begins with a designation token,
    # move the first segment to DESIGNATION.
    if not fields["DESIGNATION"] and fields["ADDRESS"]:
        first_addr = fields["ADDRESS"][0]
        segments = [s.strip() for s in re.split(r"[|,;]", first_addr) if s.strip()]
        if segments and _looks_like_designation_text(segments[0]):
            fields["DESIGNATION"] = [segments[0]]
            remaining = ", ".join(segments[1:]).strip()
            if remaining:
                fields["ADDRESS"][0] = remaining

    # Optional semantic fallback:
    # even if annotation missed DESIGNATION, recover obvious role words from OCR lines.
    if not fields["DESIGNATION"]:
        det_role = _extract_designation_fallback(merged_detections)
        if det_role:
            fields["DESIGNATION"] = [det_role]
            # Remove that role text if it accidentally appears in address.
            fields["ADDRESS"] = [a for a in fields["ADDRESS"] if det_role.lower() not in a.lower()]

    _merge_field_fragments(fields)

    expected_labels = {lbl.upper() for lbl, *_ in task_rects} if has_annotations and task_rects else set()
    if expected_labels:
        for key in list(fields.keys()):
            if key not in expected_labels:
                retained = [val for val in fields[key] if _retain_semantic_value_without_annotation(key, val)]
                fields[key] = retained

    for key, vals in list(fields.items()):
        filtered: List[str] = []
        for val in vals:
            cleaned_val = _clean_output_piece(key, val)
            if not cleaned_val:
                continue
            if has_annotations and key in {"NAME", "COMPANY", "DESIGNATION", "ADDRESS"}:
                if re.fullmatch(r"[\W_]+", cleaned_val):
                    continue
                # Even with geometry hints, keep semantic sanity checks for key identity fields.
                if key == "DESIGNATION" and _should_drop_field_value("DESIGNATION", cleaned_val):
                    continue
                if key == "NAME" and _should_drop_field_value("NAME", cleaned_val):
                    continue
                if key == "COMPANY" and _should_drop_field_value("COMPANY", cleaned_val):
                    continue
                if cleaned_val not in filtered:
                    filtered.append(cleaned_val)
                continue
            if _should_drop_field_value(key, cleaned_val):
                continue
            if cleaned_val not in filtered:
                filtered.append(cleaned_val)
        fields[key] = filtered

    if not has_annotations:
        # Rebuild COMPANY from the strongest semantic candidate if the current value
        # looks like a placeholder, email artifact, or otherwise weak fragment.
        company_candidates = _best_company_candidates(out, fields)
        if company_candidates:
            best_company = company_candidates[0]
            current_company = fields["COMPANY"][0] if fields["COMPANY"] else ""
            current_score = _company_candidate_score(current_company)
            if not current_company or current_score < 1.5 or _looks_like_placeholder_company(current_company) or re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", current_company):
                fields["COMPANY"] = company_candidates

        domain_company = ""
        # Only infer company from email domains. Website domains often repeat the brand
        # or are generic placeholders, so they should stay in WEBSITE unless another
        # field provides a real company name.
        for contact_value in fields["EMAIL"]:
            domain_company = _domain_to_company_name(contact_value)
            if domain_company:
                break

        if domain_company:
            current_company = fields["COMPANY"][0] if fields["COMPANY"] else ""
            normalized_current = re.sub(r"[^a-z]", "", _normalize_company_name(current_company).lower())
            normalized_domain = re.sub(r"[^a-z]", "", _normalize_company_name(domain_company).lower())
            alpha_only = re.sub(r"[^A-Za-z]", "", current_company)
            has_noise = bool(re.search(r"[^A-Za-z\s&.-]", current_company))
            stylized_fragment = bool(re.search(r"\b[A-Za-z]\b(?:\s+\b[A-Za-z]\b)+", current_company))
            suspicious_company = (
                not current_company
                or len(alpha_only) <= 3
                or (has_noise and len(alpha_only) <= 10)
                or stylized_fragment
                or (normalized_current and normalized_current in normalized_domain and len(normalized_domain) > len(normalized_current) + 3)
            )
            if suspicious_company:
                fields["COMPANY"] = [_normalize_company_name(domain_company)]

        source_name_values = list(fields["NAME"])
        best_name = _best_name_candidate(out, fields)
        if best_name:
            fields["NAME"] = [best_name]
            for value in source_name_values:
                if value == best_name:
                    continue
                if _looks_like_company_fragment(value) and value not in fields["COMPANY"]:
                    fields["COMPANY"].insert(0, value)

        if fields["COMPANY"]:
            fields["COMPANY"] = [v for v in fields["COMPANY"] if not _looks_like_slogan_text(v)]
            _merge_field_fragments(fields)

    if has_annotations and out:
        # Annotated cards often contain OCR/model hints that are better than the
        # geometry-only path above. Refill any still-empty primary label from the
        # model output before we finalize the summary.
        for label in ["NAME", "COMPANY", "DESIGNATION", "ADDRESS", "PHONE", "EMAIL", "WEBSITE"]:
            if expected_labels and label not in expected_labels:
                continue
            if fields[label]:
                continue
            for det in out:
                if det.get("label") != label:
                    continue
                txt = str(det.get("text", "")).strip()
                if not txt:
                    continue
                if label in {"EMAIL", "PHONE", "WEBSITE"} and not _validate_field(label, txt):
                    continue
                if label == "DESIGNATION":
                    if _looks_like_degree_credential(txt) or _is_noisy_designation(txt) or _looks_like_address_text(txt):
                        continue
                fields[label] = [txt]
                break

    if has_annotations and expected_labels:
        if "DESIGNATION" in expected_labels and not fields["DESIGNATION"]:
            recovered_designation = _recover_expected_designation(out + merged_detections)
            if recovered_designation:
                fields["DESIGNATION"] = [recovered_designation]
        if "EMAIL" in expected_labels and not fields["EMAIL"]:
            recovered_email = _recover_expected_email(out + merged_detections)
            if recovered_email:
                fields["EMAIL"] = [recovered_email]
        if "WEBSITE" in expected_labels and not fields["WEBSITE"]:
            recovered_website = _recover_expected_website(out + merged_detections, fields["EMAIL"])
            if recovered_website:
                fields["WEBSITE"] = [recovered_website]

    best_name = _best_name_candidate(out, fields)
    if best_name:
        current_name = fields["NAME"][0] if fields["NAME"] else ""
        if not current_name or _name_candidate_score(best_name) > _name_candidate_score(current_name) or len(fields["NAME"]) > 1:
            fields["NAME"] = [best_name]
    elif fields["NAME"] and _name_candidate_score(fields["NAME"][0]) <= 0:
        fields["NAME"] = []

    best_designation = _best_designation_candidate(out, fields)
    if best_designation:
        current_designation = fields["DESIGNATION"][0] if fields["DESIGNATION"] else ""
        if not current_designation or _should_drop_field_value("DESIGNATION", current_designation):
            fields["DESIGNATION"] = [best_designation]
    elif fields["DESIGNATION"] and _should_drop_field_value("DESIGNATION", fields["DESIGNATION"][0]):
        fields["DESIGNATION"] = []

    best_companies = _best_company_candidates(out, fields)
    if best_companies:
        current_company = fields["COMPANY"][0] if fields["COMPANY"] else ""
        current_score = _company_candidate_score(current_company)
        best_score = _company_candidate_score(best_companies[0])
        if not current_company or current_score < 2.0 or len(fields["COMPANY"]) != 1 or best_score > current_score:
            fields["COMPANY"] = best_companies
        else:
            fields["COMPANY"] = [_strip_company_address_suffix(current_company)]
    elif not fields["COMPANY"] and fields["EMAIL"]:
        inferred_company = _domain_to_company_name(fields["EMAIL"][0])
        if inferred_company and _company_candidate_score(inferred_company) > 0:
            fields["COMPANY"] = [_normalize_company_name(inferred_company)]

    current_company = fields["COMPANY"][0] if fields["COMPANY"] else ""
    if fields["EMAIL"]:
        inferred_company = _domain_to_company_name(fields["EMAIL"][0])
        address_blob = ", ".join(fields.get("ADDRESS") or [])
        weak_current_company = (
            not current_company
            or _looks_like_address_text(current_company)
            or _looks_like_location_name(current_company)
            or _looks_like_placeholder_company(current_company)
            or _looks_like_generic_company_name(current_company)
            or ("," in current_company and not _looks_like_company_text(current_company))
            or (address_blob and current_company and current_company.lower() in address_blob.lower())
        )
        if inferred_company and weak_current_company and _company_candidate_score(inferred_company) > 0:
            fields["COMPANY"] = [_normalize_company_name(inferred_company)]
    elif not fields["COMPANY"] and fields["WEBSITE"]:
        inferred_company = _domain_to_company_name(fields["WEBSITE"][0])
        if inferred_company and _company_candidate_score(inferred_company) > 0:
            fields["COMPANY"] = [_normalize_company_name(inferred_company)]

    if fields["COMPANY"]:
        address_blob = ", ".join(fields.get("ADDRESS") or [])
        scrubbed_companies: List[str] = []
        for value in fields["COMPANY"]:
            low_value = value.lower().strip()
            if not value:
                continue
            if _looks_like_cta_text(value):
                continue
            if address_blob and low_value and low_value in address_blob.lower():
                continue
            if _looks_like_address_text(value) and not _looks_like_company_text(value):
                continue
            scrubbed_companies.append(value)
        fields["COMPANY"] = scrubbed_companies

    if fields["COMPANY"]:
        cleaned_companies: List[str] = []
        for value in fields["COMPANY"]:
            cleaned_value = _strip_company_address_suffix(value)
            if not cleaned_value or _looks_like_slogan_text(cleaned_value) or _looks_like_catalog_text(cleaned_value):
                continue
            if _company_candidate_score(cleaned_value) <= 0:
                continue
            if cleaned_value not in cleaned_companies:
                cleaned_companies.append(cleaned_value)
        strong_brands = [v for v in cleaned_companies if not _is_weak_company_fragment(v) and len(v.split()) >= 2]
        if strong_brands:
            cleaned_companies = [v for v in cleaned_companies if not _is_weak_company_fragment(v)]
        fields["COMPANY"] = cleaned_companies
        _merge_field_fragments(fields)
    if not fields["COMPANY"]:
        fallback_contacts = list(fields.get("EMAIL") or []) + list(fields.get("WEBSITE") or [])
        for contact_value in fallback_contacts:
            inferred_company = _domain_to_company_name(contact_value)
            if inferred_company and _company_candidate_score(inferred_company) > 0:
                fields["COMPANY"] = [_normalize_company_name(inferred_company)]
                break

    annotation_company = _annotation_company_fallback(out)
    current_company = fields["COMPANY"][0] if fields["COMPANY"] else ""
    if annotation_company:
        weak_current_company = (
            not current_company
            or _company_candidate_score(current_company) <= 0
            or _looks_like_ocr_gibberish(current_company)
            or (not _looks_like_company_text(current_company) and not _looks_like_company_fragment(current_company))
        )
        annotation_words = len(re.findall(r"[A-Za-z]+", annotation_company))
        current_words = len(re.findall(r"[A-Za-z]+", current_company))
        stronger_annotation = (
            annotation_words >= 2
            and (
                current_words < annotation_words
                or current_company.lower() in annotation_company.lower()
                or annotation_company.lower().endswith(current_company.lower())
            )
        )
        if weak_current_company or stronger_annotation:
            fields["COMPANY"] = [annotation_company]

    if not fields["NAME"] and fields["COMPANY"]:
        fallback_name = fields["COMPANY"][0]
        if (
            fallback_name
            and (_looks_like_person(fallback_name) or _looks_like_titled_person(fallback_name))
            and not _looks_like_placeholder_company(fallback_name)
            and not _looks_like_address_text(fallback_name)
            and not _looks_like_location_name(fallback_name)
            and not any(token in fallback_name.lower() for token in {"virginia", "california", "usa", "city", "state"})
        ):
            fields["NAME"] = [fallback_name]
    elif fields["NAME"] and fields["COMPANY"]:
        current_name = fields["NAME"][0]
        generic_name_tokens = {
            "enterprise",
            "enterprises",
            "company",
            "group",
            "services",
            "solutions",
            "furniture",
            "industries",
            "agency",
            "studio",
        }
        if (
            len(current_name.split()) == 1
            and current_name.lower() in generic_name_tokens
            and fields["COMPANY"][0]
        ):
            fields["NAME"] = [fields["COMPANY"][0]]
        elif (
            len(current_name.split()) == 1
            and current_name.isupper()
            and len(current_name) <= 5
            and not _looks_like_titled_person(current_name)
            and fields["COMPANY"][0]
        ):
            fields["NAME"] = [fields["COMPANY"][0]]

    if not fields["DESIGNATION"] and fields["ADDRESS"]:
        cleaned_addresses: List[str] = []
        for addr in fields["ADDRESS"]:
            paren_match = re.match(r"^\(([^)]+)\)\s*(.*)$", addr)
            if paren_match and not fields["DESIGNATION"]:
                possible_designation = paren_match.group(1).strip()
                remainder = paren_match.group(2).strip(" ,;:-")
                if _looks_like_designation_text(possible_designation):
                    fields["DESIGNATION"] = [possible_designation]
                    if remainder and len(re.findall(r"[A-Za-z]", remainder)) >= 6 and not _looks_like_ocr_gibberish(remainder):
                        cleaned_addresses.append(remainder)
                    continue
            cleaned_addresses.append(addr)
        fields["ADDRESS"] = cleaned_addresses

    if fields["NAME"]:
        current_name = fields["NAME"][0]
        if not (_looks_like_person(current_name) or _looks_like_titled_person(current_name)):
            if _looks_like_company_text(current_name) or _looks_like_company_fragment(current_name):
                if not fields["COMPANY"] or _company_candidate_score(current_name) > _company_candidate_score(fields["COMPANY"][0]):
                    fields["COMPANY"] = [_normalize_company_name(current_name)]
                fields["NAME"] = []

    if not fields["COMPANY"] or _company_candidate_score(fields["COMPANY"][0]) <= 0:
        fallback_contacts = list(fields.get("EMAIL") or []) + list(fields.get("WEBSITE") or [])
        for contact_value in fallback_contacts:
            inferred_company = _domain_to_company_name(contact_value)
            if inferred_company and _company_candidate_score(inferred_company) > 0:
                fields["COMPANY"] = [_normalize_company_name(inferred_company)]
                break

    summary = {
        "name": ", ".join(fields["NAME"]) if fields["NAME"] else "UNREADABLE",
        "company": ", ".join(fields["COMPANY"]) if fields["COMPANY"] else "UNREADABLE",
        "designation": ", ".join(fields["DESIGNATION"]) if fields["DESIGNATION"] else "UNREADABLE",
        "address": ", ".join(fields["ADDRESS"]) if fields["ADDRESS"] else "UNREADABLE",
        "phone": ", ".join(fields["PHONE"]) if fields["PHONE"] else "UNREADABLE",
        "email": ", ".join(fields["EMAIL"]) if fields["EMAIL"] else "UNREADABLE",
        "website": ", ".join(fields["WEBSITE"]) if fields["WEBSITE"] else "UNREADABLE",
    }

    return {
        "line_labels": out,
        "summary": summary,
        "fields": fields,
        "model_used": bool(model_bundle is not None),
    }
