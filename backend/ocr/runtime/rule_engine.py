import json
import re
from pathlib import Path
from typing import Dict, List, Tuple

DEFAULT_CONFIG = {
    "labels": ["NAME", "COMPANY", "DESIGNATION", "ADDRESS", "PHONE", "EMAIL", "WEBSITE", "OTHER"],
    "regex_patterns": {
        "EMAIL": [r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"],
        "PHONE": [r"(?:\+?\d[\d\s().-]{8,}\d)", r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b"],
        "WEBSITE": [r"(?:https?://\S+|www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?|\b[a-zA-Z0-9-]+\.(?:com|in|org|net|co\.in|biz|info|me|edu|gov)\b)"],
    },
    "keywords": {
        "DESIGNATION": [
            # C-Suite & Leadership (1-15)
            "ceo", "cto", "cfo", "coo", "cmo", "cio", "cro", "cpo", "chro", "president", "vp", "vice president", "chairman", "founder", "co-founder",
            # Senior Management (16-30)
            "director", "manager", "managing director", "md", "gm", "general manager", "executive", "head", "principal", "partner", "managing partner", "chief", "lead", "senior", "jr", "junior",
            # Technical & Engineering (31-50)
            "engineer", "developer", "architect", "scientist", "programmer", "analyst", "technician", "specialist", "coder", "fullstack", "frontend", "backend", "devops", "scrum master", "product owner", "administrator", "sysadmin", "consultant", "technical", "researcher",
            # Business, Sales & Marketing (51-70)
            "associate", "representative", "sales", "marketing", "accountant", "cpa", "officer", "proprietor", "owner", "solopreneur", "representative", "coordinator", "assistant", "executive", "clerk", "secretary", "receptionist", "broker", "agent", "advisor",
            # Professional & Academic (71-85)
            "dr", "doctor", "professor", "prof", "advocate", "lawyer", "attorney", "architect", "trainer", "coach", "lecturer", "educator", "instructor", "dean", "fellow"
        ],
        "ADDRESS": [
            # Standard & International (86-105)
            "road", "rd", "street", "st", "lane", "ln", "avenue", "ave", "boulevard", "blvd", "drive", "dr", "court", "ct", "square", "sq", "plaza", "building", "bldg", "apartment", "apt", "suite", "ste", "floor", "fl", "tower", "block", "sector", "zone",
            # Regional / Indian Specific (106-125)
            "nagar", "near", "opposite", "opp", "beside", "behind", "colony", "puram", "vihar", "chowk", "bazaar", "landmark", "dist", "district", "taluka", "tal", "city", "state", "india", "pin", "pincode", "zip", "plot", "survey", "gala", "industrial estate"
        ],
        "COMPANY": [
            # Legal Suffixes (126-145)
            "pvt", "ltd", "limited", "private", "llp", "inc", "corp", "corporation", "co", "company", "enterprise", "enterprises", "services", "solutions", "technologies", "tech", "exports", "imports", "group", "industries", "systems", "construction", "engineering", "builders", "contractors", "contractor", "realty", "automotive", "agency", "consultancy", "ventures", "associates", "global", "international", "trust", "foundation", "bank", "mfg", "manufacturing"
        ],
    },
    "fusion_priority": ["REGEX", "ML", "LAYOUT"],
    "iou_threshold": 0.15,
}


# DEFAULT_CONFIG = {
#     "labels": ["NAME", "COMPANY", "DESIGNATION", "ADDRESS", "PHONE", "EMAIL", "WEBSITE", "OTHER"],
#     "regex_patterns": {
#         "EMAIL": [r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"],
#         "PHONE": [r"(?:\+?\d[\d\s().-]{8,}\d)"],
#         "WEBSITE": [r"(?:https?://\S+|www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?|\b[a-zA-Z0-9-]+\.(?:com|in|org|net|co\.in)\b)"],
#     },
#     "keywords": {
#         "DESIGNATION": [
#             "manager",
#             "director",
#             "ceo",
#             "founder",
#             "proprietor",
#             "owner",
#             "executive",
#             "engineer",
#             "accountant",
#             "developer",
#             "consultant",
#             "officer",
#             "architect",
#             "analyst",
#         ],
#         "ADDRESS": ["road", "rd", "street", "st", "lane", "nagar", "near", "dist", "tal", "sector", "city", "india", "pin"],
#         "COMPANY": ["pvt", "ltd", "llp", "enterprises", "services", "solutions", "technologies", "exports"],
#     },
#     "fusion_priority": ["REGEX", "ML", "LAYOUT"],
#     "iou_threshold": 0.15,
# }


def _parse_simple_yaml(path: Path) -> Dict:
    # Minimal parser for this project's expected structure.
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if not path.exists():
        return cfg

    lines = path.read_text(encoding="utf-8").splitlines()
    section = None
    sub = None
    for raw in lines:
        line = raw.rstrip()
        if not line or line.strip().startswith("#"):
            continue

        indent = len(line) - len(line.lstrip(" "))
        stripped = line.strip()

        if indent == 0 and stripped.endswith(":"):
            section = stripped[:-1]
            sub = None
            continue

        if section == "labels" and stripped.startswith("- "):
            val = stripped[2:].strip().upper()
            if val and val not in cfg["labels"]:
                cfg["labels"].append(val)
            continue

        if section in {"regex_patterns", "keywords"} and indent == 2 and stripped.endswith(":"):
            sub = stripped[:-1].strip().upper()
            cfg[section].setdefault(sub, [])
            continue

        if section in {"regex_patterns", "keywords"} and sub and stripped.startswith("- "):
            item = stripped[2:].strip().strip("\"'")
            if item:
                cfg[section][sub].append(item)
            continue

        if section == "fusion_priority" and stripped.startswith("- "):
            cfg["fusion_priority"].append(stripped[2:].strip().upper())
            continue

        if section == "iou_threshold" and ":" in stripped:
            pass

        if indent == 0 and ":" in stripped and not stripped.endswith(":"):
            k, v = [x.strip() for x in stripped.split(":", 1)]
            if k == "iou_threshold":
                try:
                    cfg["iou_threshold"] = float(v)
                except Exception:
                    pass

    # clean duplicates
    cfg["labels"] = list(dict.fromkeys([x.upper() for x in cfg["labels"]]))
    cfg["fusion_priority"] = list(dict.fromkeys([x.upper() for x in cfg.get("fusion_priority", [])]))
    for k in ["regex_patterns", "keywords"]:
        for label, arr in list(cfg[k].items()):
            cfg[k][label] = list(dict.fromkeys([str(x) for x in arr if str(x).strip()]))

    return cfg




def normalize_contact_candidate(text: str) -> str:
    t = (text or "").strip()
    if not t:
        return ""

    t = t.lower()
    t = t.replace("(at)", "@").replace(" at ", "@")
    t = t.replace("(dot)", ".").replace(" dot ", ".")
    t = t.replace(",", ".")

    # normalize spaces around separators
    t = re.sub(r"\s*@\s*", "@", t)
    t = re.sub(r"\s*\.\s*", ".", t)

    # join split TLDs and common domain OCR breaks
    t = re.sub(r"\b([a-z0-9-]+)\s+(com|in|org|net|edu|gov)\b", r"\1.\2", t)
    t = re.sub(r"\bco\s+in\b", "co.in", t)
    t = t.replace("gmailcom", "gmail.com")
    t = t.replace("yahoocom", "yahoo.com")
    t = t.replace("hotmailcom", "hotmail.com")
    t = t.replace("outlookcom", "outlook.com")
    t = t.replace(" eom", ".com").replace(" com", ".com")

    # website fixes: wwwdomain.com -> www.domain.com
    if t.startswith("www") and not t.startswith("www."):
        t = t.replace("www", "www.", 1)

    t = t.replace(".c0m", ".com").replace(".corn", ".com")
    t = re.sub(r"\s+", "", t)

    # recover missing dot before common TLDs after compaction
    t = re.sub(r"(@[a-z0-9.-]+)(com|in|org|net|edu|gov)$", r"\1.\2", t)
    t = re.sub(r"(www\.[a-z0-9.-]+)(com|in|org|net|edu|gov)$", r"\1.\2", t)

    # cleanup repeated dot artifacts (e.g., gmail..com)
    t = re.sub(r"\.{2,}", ".", t)
    t = t.replace("@.", "@")
    t = t.replace(".com.com", ".com")

    return t

def load_label_config(config_path: Path) -> Dict:
    return _parse_simple_yaml(config_path)


def apply_regex_rules(text: str, config: Dict) -> Tuple[str, float, str]:
    t_raw = (text or "").strip()
    if not t_raw:
        return "OTHER", 0.0, "EMPTY"

    t_norm = normalize_contact_candidate(t_raw)

    # Strong built-in patterns to avoid YAML escaping issues.
    if re.search(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", t_norm):
        return "EMAIL", 0.99, "REGEX"
    # Normalize common OCR 'O' -> '0' for phone detection
    t_phone = re.sub(r"[oO]", "0", t_raw)
    if re.search(r"(?:\+?\d[\d\s().-]{8,}\d)", t_phone):
        return "PHONE", 0.99, "REGEX"
    if re.search(r"(?:https?://\S+|www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?|\b[a-zA-Z0-9-]+\.(?:com|in|org|net|co\.in)\b)", t_norm, flags=re.IGNORECASE):
        return "WEBSITE", 0.99, "REGEX"

    # Config-based patterns stay supported.
    for label in ["EMAIL", "PHONE", "WEBSITE"]:
        for pat in config.get("regex_patterns", {}).get(label, []):
            if re.search(pat, t_raw, flags=re.IGNORECASE) or re.search(pat, t_norm, flags=re.IGNORECASE):
                return label, 0.99, "REGEX"

    low = t_raw.lower()
    weak_designation_terms = {
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
        "lead",
        "head",
        "office",
        "branch",
        "department",
        "center",
        "centre",
    }
    def _kw_match(source: str, kw: str) -> bool:
        kw_low = kw.lower().strip()
        if not kw_low:
            return False
        pieces = [re.escape(part) for part in re.split(r"\s+", kw_low) if part]
        if not pieces:
            return False
        if len(pieces) == 1:
            pat = r"\b" + pieces[0] + r"\b"
        else:
            pat = r"\b" + r"\s+".join(pieces) + r"\b"
        return bool(re.search(pat, source, flags=re.IGNORECASE))

    for label, kws in config.get("keywords", {}).items():
        matched = False
        for kw in kws:
            kw_low = kw.lower().strip()
            if not _kw_match(low, kw_low):
                continue
            if label.upper() == "DESIGNATION" and kw_low == "head" and not re.search(r"\bhead\s+of\b", low):
                continue
            if label.upper() == "DESIGNATION" and kw_low in weak_designation_terms:
                # Generic descriptors should not become standalone designations.
                tokens = re.findall(r"[a-z]+", low)
                if len(tokens) <= 1:
                    continue
            matched = True
            break
        if matched:
            return label.upper(), 0.78, "KEYWORD"

    return "OTHER", 0.0, "NONE"
