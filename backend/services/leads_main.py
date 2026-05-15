from __future__ import annotations

import argparse
import json
import math
import os
import random
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlparse, urlunparse

import requests
import scrapy
from bson import ObjectId
from playwright.sync_api import BrowserContext, sync_playwright
from pymongo import MongoClient
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent
ENV_VALUES = {
    **load_env_file(PROJECT_ROOT / ".env"),
    **load_env_file(BACKEND_DIR / ".env"),
    **load_env_file(SCRIPT_DIR / ".env"),
}


def env_value(name: str, fallback: str = "") -> str:
    return os.getenv(name, ENV_VALUES.get(name, fallback)).strip()


def parse_database_name(mongo_uri: str) -> str:
    parsed = urlparse(mongo_uri)
    path = parsed.path.strip("/")
    return path.split("/", 1)[0] if path else ""


DEFAULT_MONGO_URI = "mongodb://localhost:27017/"
MONGO_URI = env_value("LEAD_SCRAPER_CONN", env_value("SCRAPER_CONN", env_value("CONN", DEFAULT_MONGO_URI)))
DATABASE_NAME = env_value("LEAD_SCRAPER_DB_NAME", parse_database_name(MONGO_URI) or "event_intelligence")
COLLECTION_NAME = env_value("LEAD_SCRAPER_COLLECTION_NAME", "scraped_leads")
DEFAULT_COUNTRY = env_value("LEAD_SCRAPER_DEFAULT_COUNTRY", "India")
DEFAULT_SEARCH_QUERY = env_value("LEAD_SCRAPER_DEFAULT_QUERY", "company")
GOOGLE_RESULT_LIMIT = max(1, int(env_value("LEAD_SCRAPER_GOOGLE_RESULT_LIMIT", "5") or "5"))
MAX_EMPLOYEE_COUNT_HINT = max(1, int(env_value("LEAD_SCRAPER_MAX_EMPLOYEE_COUNT_HINT", "10000") or "10000"))
PLAYWRIGHT_HEADLESS = env_value("LEAD_SCRAPER_HEADLESS", "0").lower() not in {"0", "false", "no"}
PLAYWRIGHT_SLOW_MO_MS = 400 if not PLAYWRIGHT_HEADLESS else 0
SEARCH_BACKEND = env_value("LEAD_SCRAPER_SEARCH_BACKEND", "bing").lower() or "bing"
ENABLE_GOOGLE_SEARCH_ENRICHMENT = env_value("LEAD_SCRAPER_ENABLE_GOOGLE_SEARCH_ENRICHMENT", "1").lower() in {"1", "true", "yes"}
ENABLE_ZAUBA_SEARCH = env_value("LEAD_SCRAPER_ENABLE_ZAUBA_SEARCH", "1").lower() in {"1", "true", "yes"}
ENABLE_LINKEDIN_SEARCH = env_value("LEAD_SCRAPER_ENABLE_LINKEDIN_SEARCH", "1").lower() in {"1", "true", "yes"}
EXCLUDED_CATEGORY_TOKENS = tuple(
    token.strip().lower()
    for token in env_value(
        "LEAD_SCRAPER_EXCLUDED_CATEGORY_TOKENS",
        "software,saas,it company,technology,technologies,tech company,computer hardware company",
    ).split(",")
    if token.strip()
)
UNTRUSTED_WEBSITE_DOMAINS = {
    "justdial.com",
    "www.justdial.com",
    "falconebiz.com",
    "www.falconebiz.com",
    "indiamart.com",
    "www.indiamart.com",
    "tradeindia.com",
    "www.tradeindia.com",
    "sulekha.com",
    "www.sulekha.com",
    "crunchbase.com",
    "www.crunchbase.com",
}
UNTRUSTED_WEBSITE_PATH_TOKENS = (
    "/company/",
    "/pune/",
    "/search/",
    "/business/",
    "/profile/",
    "/listing/",
    "/directory/",
)

SOURCE_DEFINITIONS: dict[str, dict[str, str]] = {
    "indiamart": {"label": "IndiaMART", "type": "scrape"},
    "google_maps": {"label": "Google Maps", "type": "scrape"},
}

DEFAULT_SOURCE_ORDER = ("indiamart", "google_maps")

EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE_PATTERN = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")
CONTACT_HREF_PATTERN = re.compile(r'href=["\']([^"\']+)["\']', re.IGNORECASE)
EMPLOYEE_PATTERN = re.compile(r"(\d{2,5})\+?\s+(?:employees|employee|team members|people)", re.IGNORECASE)
EMPLOYEE_RANGE_PATTERN = re.compile(
    r"(\d{1,5}\s*(?:[-to]{1,3}\s*\d{1,5})?)\s+(?:employees|employee|people|team members)",
    re.IGNORECASE,
)
FOUNDED_PATTERN = re.compile(
    r"(?:founded|established|incorporated|started)\s*(?:in)?\s*(19\d{2}|20\d{2})",
    re.IGNORECASE,
)
TURNOVER_PATTERN = re.compile(
    r"(?:turnover|revenue|annual revenue|annual turnover)[^A-Za-z0-9]{0,20}([₹$]?\s?[0-9][0-9.,\s]*(?:crore|cr|lakh|lakhs|million|billion|m|bn)?)",
    re.IGNORECASE,
)
ZAUBA_CIN_PATTERN = re.compile(r"\b([A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b")
DIRECTOR_NAME_PATTERN = re.compile(r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})")
LINKEDIN_ROLE_PATTERN = re.compile(
    r"\b(founder|co-founder|ceo|cto|cfo|coo|director|owner|partner|head|vp|manager|president)\b",
    re.IGNORECASE,
)
SOCIAL_PLATFORM_HINTS = ("linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "youtube.com")
NON_HTML_PATH_SUFFIXES = (
    ".css",
    ".js",
    ".json",
    ".xml",
    ".txt",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".svg",
    ".webp",
    ".ico",
    ".pdf",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".map",
    ".zip",
)
GENERIC_EMAIL_PREFIXES = {
    "info",
    "contact",
    "sales",
    "support",
    "admin",
    "hello",
    "hr",
    "career",
    "careers",
    "enquiry",
    "enquiries",
    "office",
    "marketing",
}
NON_PERSON_NAME_TOKENS = {
    "contact",
    "office",
    "ofice",
    "address",
    "phone",
    "mobile",
    "email",
    "sales",
    "support",
    "service",
    "services",
    "no",
    "number",
    "call",
    "head office",
    "branch",
    "near",
    "theatre",
    "road",
    "rd",
    "street",
    "st",
    "lane",
    "nagar",
    "chowk",
    "floor",
    "building",
    "tower",
    "chambers",
    "capital",
    "markets",
    "linkedin",
    "cookie",
    "consent",
    "career",
    "opportunities",
    "quarter",
    "investor",
    "jewellery",
    "location",
    "company information",
    "glyphicons",
    "halflings",
    "icon",
    "icons",
    "information",
    "key managerial personnel",
    "managerial personnel",
}
GENERIC_CATEGORY_TOKENS = {
    "service",
    "services",
    "consultant",
    "consultancy",
    "company",
    "manufacturer",
    "supplier",
    "exporter",
    "business",
}
SENIOR_DECISION_ROLE_TOKENS = {
    "founder",
    "co-founder",
    "ceo",
    "cto",
    "cfo",
    "coo",
    "director",
    "owner",
    "partner",
    "head",
    "chairman",
    "managing director",
    "promoter",
}
COMPANY_NAME_STOP_WORDS = {
    "private",
    "pvt",
    "limited",
    "ltd",
    "llp",
    "inc",
    "llc",
    "co",
    "corporation",
    "corp",
    "india",
}


def create_session() -> requests.Session:
    session = requests.Session()
    retries = Retry(
        total=2,
        connect=2,
        read=2,
        status=2,
        backoff_factor=0.8,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retries)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )
        }
    )
    return session


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def parse_float(value: Any) -> float | None:
    if value in {None, ""}:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_int(value: Any) -> int | None:
    if value in {None, ""}:
        return None
    try:
        return int(float(str(value).replace(",", "")))
    except (TypeError, ValueError):
        return None


def sanitize_employee_count_hint(value: Any) -> int | None:
    count = parse_int(value)
    if count is None or count <= 0:
        return None
    # Scraped pages can concatenate unrelated numbers into fake headcounts.
    if count > MAX_EMPLOYEE_COUNT_HINT:
        return None
    return count


def sanitize_employee_range_hint(value: Any) -> str:
    text = clean_text(value)
    if not text:
        return ""
    numbers = [parse_int(item) for item in re.findall(r"\d+", text)]
    numbers = [item for item in numbers if item is not None]
    if not numbers:
        return ""
    if max(numbers) > MAX_EMPLOYEE_COUNT_HINT:
        return ""
    return text


def normalize_phone(value: Any) -> str:
    text = clean_text(value)
    if not text:
        return ""
    keep = re.sub(r"[^0-9+]", "", text)
    if keep.startswith("00"):
        keep = "+" + keep[2:]
    return keep


def normalize_url(value: Any) -> str:
    url = clean_text(value)
    if not url:
        return ""
    if url.startswith("//"):
        url = "https:" + url
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", url):
        url = "https://" + url
    parsed = urlparse(url)
    netloc = parsed.netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    return urlunparse(parsed._replace(netloc=netloc, query="", fragment="")).rstrip("/")


def domain_from_url(value: Any) -> str:
    parsed = urlparse(normalize_url(value))
    return parsed.netloc.lower()


def is_untrusted_website_domain(value: Any) -> bool:
    domain = domain_from_url(value)
    if not domain:
        return False
    if domain in UNTRUSTED_WEBSITE_DOMAINS:
        return True
    return any(domain.endswith("." + item) for item in UNTRUSTED_WEBSITE_DOMAINS)


def is_untrusted_website(value: Any) -> bool:
    normalized = normalize_url(value)
    if not normalized:
        return False
    if is_untrusted_website_domain(normalized):
        return True
    lowered = normalized.lower()
    return any(token in lowered for token in UNTRUSTED_WEBSITE_PATH_TOKENS)


def extract_email(text: str) -> str:
    match = EMAIL_PATTERN.search(clean_text(text))
    return clean_text(match.group(0)).lower() if match else ""


def extract_emails(text: str) -> list[str]:
    seen: list[str] = []
    for match in EMAIL_PATTERN.findall(clean_text(text)):
        email = clean_text(match).lower()
        if email and email not in seen:
            seen.append(email)
    return seen


def extract_phone(text: str) -> str:
    for match in PHONE_PATTERN.findall(clean_text(text)):
        phone = normalize_phone(match)
        digits = re.sub(r"\D", "", phone)
        if 8 <= len(digits) <= 13:
            return phone
    return ""


def extract_phones(text: str) -> list[str]:
    seen: list[str] = []
    for match in PHONE_PATTERN.findall(clean_text(text)):
        phone = normalize_phone(match)
        digits = re.sub(r"\D", "", phone)
        if 8 <= len(digits) <= 13 and phone not in seen:
            seen.append(phone)
    return seen


def is_generic_email(email: str) -> bool:
    cleaned = clean_text(email).lower()
    if "@" not in cleaned:
        return False
    prefix = cleaned.split("@", 1)[0]
    return prefix in GENERIC_EMAIL_PREFIXES


def normalize_name_key(value: str) -> str:
    return re.sub(r"[^a-z]", "", clean_text(value).lower())


def looks_like_person_name(value: str) -> bool:
    cleaned = clean_text(value)
    if not cleaned:
        return False
    lowered = cleaned.lower()
    if any(token in lowered for token in NON_PERSON_NAME_TOKENS):
        return False
    parts = cleaned.split()
    if len(parts) < 2 or len(parts) > 4:
        return False
    for part in parts:
        if not re.fullmatch(r"[A-Z][a-zA-Z]+", part):
            return False
    return True


def phone_digits(value: str) -> str:
    return re.sub(r"\D", "", clean_text(value))


def looks_like_company_phone(value: str) -> bool:
    digits = phone_digits(value)
    if not digits:
        return False
    if len(digits) < 10 or len(digits) > 12:
        return False
    if digits.startswith("91") and len(digits) == 12:
        return True
    if digits.startswith("0") and len(digits) in {10, 11, 12}:
        return True
    if len(digits) == 10:
        return True
    if digits.startswith("1800") and len(digits) in {10, 11, 12}:
        return True
    return False


def is_probable_html_page_url(value: Any) -> bool:
    normalized = normalize_url(value)
    if not normalized:
        return False
    parsed = urlparse(normalized)
    path = parsed.path.lower()
    if any(path.endswith(suffix) for suffix in NON_HTML_PATH_SUFFIXES):
        return False
    return True


def infer_business_category(*texts: str) -> str:
    combined = " ".join(clean_text(text).lower() for text in texts if clean_text(text))
    mappings = [
        (("construction chemical", "construction chemicals"), "Construction Chemicals"),
        (("automotive interior", "seating system", "ev component", "railway seating", "electric vehicle"), "Automotive / Mobility Components"),
        (("packaging", "pack"), "Packaging"),
        (("manufactur", "factory", "industrial", "engineering", "exporter"), "Manufacturing / Industrial"),
        (("software", "saas", "technology", "it service", "computer"), "Software / IT"),
        (("construction", "builder", "real estate", "infrastructure"), "Construction / Real Estate"),
        (("consult", "advisory", "professional"), "Consulting / Professional Services"),
        (("company formation", "company registration", "private limited company registration", "name change service", "corporate services", "gst", "roc", "compliance"), "Business Registration / Compliance"),
        (("marketing", "advertising", "media"), "Marketing / Media"),
        (("trading", "wholesale", "retail", "merchant"), "Trading / Commerce"),
        (("logistics", "transport", "shipping"), "Logistics / Transport"),
        (("health", "medical", "pharma", "hospital"), "Healthcare / Pharma"),
        (("education", "training", "school", "college"), "Education / Training"),
    ]
    for tokens, label in mappings:
        if any(token in combined for token in tokens):
            return label
    return ""


def is_generic_category_label(value: str) -> bool:
    cleaned = clean_text(deduplicate_repeated_phrase(value)).lower()
    if not cleaned:
        return True
    if cleaned in GENERIC_CATEGORY_TOKENS:
        return True
    parts = [part for part in re.split(r"[^a-z]+", cleaned) if part]
    if not parts:
        return True
    return all(part in GENERIC_CATEGORY_TOKENS for part in parts)


def normalize_category_label(source_category: str, zauba: dict[str, Any] | None = None, website_hint: str = "") -> str:
    zauba = zauba or {}
    normalized_source = clean_text(deduplicate_repeated_phrase(source_category))
    normalized_website_hint = clean_text(website_hint)
    if normalized_source and not is_generic_category_label(normalized_source):
        return normalized_source
    if normalized_website_hint:
        return normalized_website_hint
    if normalized_source:
        return normalized_source
    if clean_text(zauba.get("activity")):
        return clean_text(zauba.get("activity"))
    if clean_text(zauba.get("subCategory")):
        return clean_text(zauba.get("subCategory"))
    if clean_text(zauba.get("companyClass")):
        return clean_text(zauba.get("companyClass"))
    return "Uncategorized"


def deduplicate_repeated_phrase(value: str) -> str:
    cleaned = clean_text(value)
    if not cleaned:
        return ""
    parts = cleaned.split()
    half = len(parts) // 2
    if len(parts) >= 4 and len(parts) % 2 == 0 and parts[:half] == parts[half:]:
        return " ".join(parts[:half])
    return cleaned


def company_name_tokens(value: str) -> list[str]:
    tokens = [token for token in re.findall(r"[a-z]+", clean_text(value).lower()) if token and token not in COMPANY_NAME_STOP_WORDS]
    return tokens


def zauba_match_confident(company_name: str, candidate_text: str) -> bool:
    source_tokens = company_name_tokens(company_name)
    candidate_tokens = set(company_name_tokens(candidate_text))
    if not source_tokens or not candidate_tokens:
        return False
    shared = [token for token in source_tokens if token in candidate_tokens]
    coverage = len(shared) / len(source_tokens)
    return len(shared) >= min(2, len(source_tokens)) and coverage >= 0.75


def is_senior_decision_role(value: str) -> bool:
    lowered = clean_text(value).lower()
    return any(token in lowered for token in SENIOR_DECISION_ROLE_TOKENS)


def choose_website_category_hint(source_category: str, website_hint: str) -> str:
    source_clean = clean_text(deduplicate_repeated_phrase(source_category))
    hint_clean = clean_text(website_hint)
    if not hint_clean:
        return ""
    if not source_clean or is_generic_category_label(source_clean):
        return hint_clean
    return hint_clean if hint_clean.lower() in source_clean.lower() else ""


def extract_labeled_value(text: str, label: str, stop_labels: tuple[str, ...], max_chars: int = 120) -> str:
    cleaned = clean_text(text)
    if not cleaned:
        return ""
    label_pattern = re.escape(label)
    stop_pattern = "|".join(re.escape(item) for item in stop_labels)
    pattern = rf"{label_pattern}\s+(.{{1,{max_chars}}}?)(?=\s+(?:{stop_pattern})\b|$)"
    match = re.search(pattern, cleaned, re.IGNORECASE)
    if not match:
        return ""
    return clean_text(match.group(1))


def json_ready(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, list):
        return [json_ready(item) for item in value]
    if isinstance(value, dict):
        return {key: json_ready(item) for key, item in value.items()}
    return value


def score_label(value: float) -> str:
    if value >= 75:
        return "hot"
    if value >= 50:
        return "warm"
    return "cold"


def split_address_hint(address: str) -> tuple[str, str, str]:
    parts = [clean_text(part) for part in address.split(",") if clean_text(part)]
    if not parts:
        return "", "", ""
    if len(parts) == 1:
        return "", "", parts[0]
    if len(parts) == 2:
        return parts[0], "", parts[1]
    return parts[-3], parts[-2], parts[-1]


@dataclass
class LocationContext:
    city: str = ""
    state: str = ""
    country: str = DEFAULT_COUNTRY
    latitude: float | None = None
    longitude: float | None = None
    radius_km: int = 15

    def search_text(self) -> str:
        parts = [self.city, self.state, self.country]
        return ", ".join(part for part in parts if clean_text(part))


def geocode_location(search_text: str) -> tuple[float | None, float | None]:
    text = clean_text(search_text)
    if not text:
        return None, None
    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": text, "format": "jsonv2", "limit": 1},
            headers={"User-Agent": "LeadScraper/3.0"},
            timeout=20,
        )
        response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list) or not rows:
            return None, None
        return parse_float(rows[0].get("lat")), parse_float(rows[0].get("lon"))
    except (requests.RequestException, ValueError, TypeError, json.JSONDecodeError):
        return None, None


def reverse_geocode_location(latitude: float, longitude: float) -> dict[str, str]:
    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": latitude, "lon": longitude, "format": "jsonv2"},
            headers={"User-Agent": "LeadScraper/3.0"},
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
        address = payload.get("address", {}) if isinstance(payload, dict) else {}
        if not isinstance(address, dict):
            address = {}
        return {
            "city": clean_text(address.get("city") or address.get("town") or address.get("village") or address.get("county")),
            "state": clean_text(address.get("state")),
            "country": clean_text(address.get("country")),
        }
    except (requests.RequestException, ValueError, TypeError, json.JSONDecodeError):
        return {"city": "", "state": "", "country": ""}


def auto_location() -> dict[str, Any]:
    providers = (("https://ipapi.co/json/", "ipapi"), ("https://ipinfo.io/json", "ipinfo"))
    for endpoint, provider in providers:
        try:
            response = requests.get(endpoint, headers={"User-Agent": "LeadScraper/3.0"}, timeout=10)
            if response.status_code >= 400:
                continue
            payload = response.json() if response.content else {}
            if not isinstance(payload, dict):
                continue
            if provider == "ipapi":
                return {
                    "city": clean_text(payload.get("city")),
                    "state": clean_text(payload.get("region")),
                    "country": clean_text(payload.get("country_name") or payload.get("country")),
                    "latitude": parse_float(payload.get("latitude")),
                    "longitude": parse_float(payload.get("longitude")),
                }
            loc = clean_text(payload.get("loc"))
            latitude = longitude = None
            if "," in loc:
                raw_lat, raw_lon = loc.split(",", 1)
                latitude = parse_float(raw_lat)
                longitude = parse_float(raw_lon)
            return {
                "city": clean_text(payload.get("city")),
                "state": clean_text(payload.get("region")),
                "country": clean_text(payload.get("country")),
                "latitude": latitude,
                "longitude": longitude,
            }
        except (requests.RequestException, ValueError, TypeError, json.JSONDecodeError):
            continue
    return {"city": "", "state": "", "country": DEFAULT_COUNTRY, "latitude": None, "longitude": None}


def resolve_auto_location_context(radius_km: int) -> LocationContext:
    detected = auto_location()
    context = LocationContext(
        city=clean_text(detected.get("city")),
        state=clean_text(detected.get("state")),
        country=clean_text(detected.get("country")) or DEFAULT_COUNTRY,
        latitude=parse_float(detected.get("latitude")),
        longitude=parse_float(detected.get("longitude")),
        radius_km=max(1, int(radius_km or 15)),
    )
    if context.latitude is None or context.longitude is None:
        fallback_lat, fallback_lon = geocode_location(context.search_text() or DEFAULT_COUNTRY)
        context.latitude = context.latitude if context.latitude is not None else fallback_lat
        context.longitude = context.longitude if context.longitude is not None else fallback_lon
    return context


def resolve_location_context(
    radius_km: int,
    latitude: float | None = None,
    longitude: float | None = None,
    city: str = "",
    state: str = "",
    country: str = "",
) -> LocationContext:
    context = LocationContext(
        city=clean_text(city),
        state=clean_text(state),
        country=clean_text(country) or DEFAULT_COUNTRY,
        latitude=parse_float(latitude),
        longitude=parse_float(longitude),
        radius_km=max(1, int(radius_km or 15)),
    )
    if context.latitude is None or context.longitude is None:
        fallback_lat, fallback_lon = geocode_location(context.search_text() or DEFAULT_COUNTRY)
        context.latitude = context.latitude if context.latitude is not None else fallback_lat
        context.longitude = context.longitude if context.longitude is not None else fallback_lon
    elif not context.city or not context.state:
        reverse = reverse_geocode_location(context.latitude, context.longitude)
        context.city = context.city or clean_text(reverse.get("city"))
        context.state = context.state or clean_text(reverse.get("state"))
        context.country = context.country or clean_text(reverse.get("country")) or DEFAULT_COUNTRY
    return context


def haversine_distance_km(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    radius_km = 6371.0
    lat1 = math.radians(lat_a)
    lat2 = math.radians(lat_b)
    delta_lat = math.radians(lat_b - lat_a)
    delta_lon = math.radians(lon_b - lon_a)
    value = (
        math.sin(delta_lat / 2.0) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2.0) ** 2
    )
    return 2.0 * radius_km * math.asin(math.sqrt(max(0.0, min(1.0, value))))


@dataclass
class LeadScorer:
    source_quality_map: dict[str, float] = field(default_factory=lambda: {"indiamart": 18.0, "google_maps": 14.0})

    def enrich(self, lead: dict[str, Any], location: LocationContext) -> dict[str, Any]:
        row = dict(lead)
        source = clean_text(row.get("source")).lower()
        website = normalize_url(row.get("website"))
        phone = normalize_phone(row.get("phone"))
        email = clean_text(row.get("email")).lower()
        company_size = row.get("companySizeSignals", {}) if isinstance(row.get("companySizeSignals"), dict) else {}
        zauba = row.get("zauba", {}) if isinstance(row.get("zauba"), dict) else {}
        linkedin_people = row.get("linkedinDecisionMakers", []) if isinstance(row.get("linkedinDecisionMakers"), list) else []
        company_details = row.get("companySearchResults", []) if isinstance(row.get("companySearchResults"), list) else []
        latitude = parse_float(row.get("latitude"))
        longitude = parse_float(row.get("longitude"))

        completeness_score = 0.0
        for key in ("name", "category", "address"):
            if clean_text(row.get(key)):
                completeness_score += 5.0
        if clean_text(row.get("description")):
            completeness_score += 3.0
        if parse_float(row.get("rating")) is not None:
            completeness_score += 4.0
        if website:
            completeness_score += 6.0
        if phone:
            completeness_score += 6.0
        if email:
            completeness_score += 6.0
        completeness_score = min(25.0, completeness_score)

        website_score = 0.0
        if company_size.get("hasTeamPage"):
            website_score += 6.0
        if company_size.get("hasCareersPage"):
            website_score += 6.0
        if company_size.get("hasClientPage"):
            website_score += 4.0
        if company_size.get("employeeCountHint"):
            website_score += 6.0
        if company_size.get("socialLinksCount", 0):
            website_score += min(4.0, float(company_size.get("socialLinksCount", 0)))
        website_score = min(20.0, website_score)

        validation_score = 0.0
        if zauba.get("matched"):
            validation_score += 10.0
        if zauba.get("cin"):
            validation_score += 5.0
        if zauba.get("directors"):
            validation_score += 5.0
        validation_score = min(20.0, validation_score)

        decision_maker_score = 0.0
        decision_contacts = row.get("decisionMakerContacts", []) if isinstance(row.get("decisionMakerContacts"), list) else []
        enriched_decision_contacts = [item for item in decision_contacts if item.get("email") or item.get("phone")]
        if linkedin_people:
            decision_maker_score += min(10.0, 3.0 * len(linkedin_people))
        if decision_contacts:
            decision_maker_score += min(8.0, 2.5 * len(decision_contacts))
        if enriched_decision_contacts:
            decision_maker_score += min(7.0, 3.5 * len(enriched_decision_contacts))
        if company_details:
            decision_maker_score += min(5.0, float(len(company_details)))
        decision_maker_score = min(20.0, decision_maker_score)

        distance_score = 0.0
        distance_km = None
        if (
            location.latitude is not None
            and location.longitude is not None
            and latitude is not None
            and longitude is not None
        ):
            distance_km = haversine_distance_km(location.latitude, location.longitude, latitude, longitude)
            if distance_km <= 5:
                distance_score = 15.0
            elif distance_km <= 15:
                distance_score = 12.0
            elif distance_km <= 30:
                distance_score = 8.0
            else:
                distance_score = 4.0

        source_score = self.source_quality_map.get(source, 8.0)
        final_score = round(
            completeness_score + website_score + validation_score + decision_maker_score + distance_score + source_score,
            1,
        )
        row["scoreMeta"] = {
            "source": source,
            "finalScore": final_score,
            "label": score_label(final_score),
            "distanceKm": round(distance_km, 2) if distance_km is not None else None,
            "components": {
                "completeness": round(completeness_score, 1),
                "websiteSignals": round(website_score, 1),
                "zaubaValidation": round(validation_score, 1),
                "decisionMakers": round(decision_maker_score, 1),
                "distance": round(distance_score, 1),
                "source": round(source_score, 1),
            },
        }
        return row


@dataclass
class MongoLeadStore:
    mongo_uri: str = MONGO_URI
    database_name: str = DATABASE_NAME
    collection_name: str = COLLECTION_NAME

    def __post_init__(self) -> None:
        self.client = MongoClient(self.mongo_uri)
        self.collection = self.client[self.database_name][self.collection_name]

    def upsert_lead(self, lead: dict[str, Any]) -> tuple[ObjectId, bool]:
        document = self._to_document(lead)
        existing = self.collection.find_one(self._existing_filter(document))
        now = datetime.now(timezone.utc)
        if existing:
            document["updatedAt"] = now
            self.collection.update_one({"_id": existing["_id"]}, {"$set": document})
            return existing["_id"], False
        document["createdAt"] = now
        document["updatedAt"] = now
        document["is_deleted"] = False
        document["__v"] = 0
        return self.collection.insert_one(document).inserted_id, True

    def list_leads(self, limit: int = 300) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 300), 2000))
        projection = {
            "name": 1,
            "category": 1,
            "sourceCategory": 1,
            "normalizedCategory": 1,
            "description": 1,
            "address": 1,
            "city": 1,
            "state": 1,
            "country": 1,
            "phone": 1,
            "email": 1,
            "website": 1,
            "mapsUrl": 1,
            "rating": 1,
            "reviewsCount": 1,
            "source": 1,
            "sourceLeadId": 1,
            "scoreMeta": 1,
            "latitude": 1,
            "longitude": 1,
            "zauba": 1,
            "companySizeSignals": 1,
            "linkedinDecisionMakers": 1,
            "decisionMakerContacts": 1,
            "companyContacts": 1,
            "companySearchResults": 1,
            "createdAt": 1,
            "updatedAt": 1,
        }
        cursor = self.collection.find({"is_deleted": {"$ne": True}}, projection).sort("updatedAt", -1).limit(safe_limit)
        return [json_ready(row) for row in cursor]

    def summary(self) -> dict[str, Any]:
        total = 0
        hot = 0
        warm = 0
        cold = 0
        sources: set[str] = set()
        for row in self.collection.find({"is_deleted": {"$ne": True}}, {"scoreMeta.label": 1, "scoreMeta.source": 1}):
            total += 1
            label = clean_text(row.get("scoreMeta", {}).get("label")).lower()
            source = clean_text(row.get("scoreMeta", {}).get("source")).lower()
            if source:
                sources.add(source)
            if label == "hot":
                hot += 1
            elif label == "warm":
                warm += 1
            else:
                cold += 1
        return {"total": total, "hot": hot, "warm": warm, "cold": cold, "sources": sorted(sources)}

    def delete_lead(self, lead_id: str) -> bool:
        try:
            object_id = ObjectId(lead_id)
        except Exception:
            return False
        result = self.collection.delete_one({"_id": object_id})
        return bool(result.deleted_count)

    @staticmethod
    def _to_document(lead: dict[str, Any]) -> dict[str, Any]:
        return {
            "name": clean_text(lead.get("name")),
            "category": clean_text(lead.get("category")),
            "sourceCategory": clean_text(lead.get("sourceCategory")),
            "normalizedCategory": clean_text(lead.get("normalizedCategory")),
            "description": clean_text(lead.get("description")),
            "address": clean_text(lead.get("address")),
            "city": clean_text(lead.get("city")),
            "state": clean_text(lead.get("state")),
            "country": clean_text(lead.get("country")),
            "pincode": clean_text(lead.get("pincode")),
            "latitude": parse_float(lead.get("latitude")),
            "longitude": parse_float(lead.get("longitude")),
            "phone": normalize_phone(lead.get("phone")),
            "email": clean_text(lead.get("email")).lower(),
            "website": normalize_url(lead.get("website")),
            "mapsUrl": clean_text(lead.get("mapsUrl")),
            "rating": parse_float(lead.get("rating")),
            "reviewsCount": parse_int(lead.get("reviewsCount")),
            "source": clean_text(lead.get("source")).lower(),
            "sourceLeadId": clean_text(lead.get("sourceLeadId")),
            "scoreMeta": lead.get("scoreMeta", {}),
            "zauba": lead.get("zauba", {}),
            "companySizeSignals": lead.get("companySizeSignals", {}),
            "linkedinDecisionMakers": lead.get("linkedinDecisionMakers", []),
            "decisionMakerContacts": lead.get("decisionMakerContacts", []),
            "companyContacts": lead.get("companyContacts", {}),
            "companySearchResults": lead.get("companySearchResults", []),
        }

    @staticmethod
    def _existing_filter(document: dict[str, Any]) -> dict[str, Any]:
        filters: list[dict[str, Any]] = []
        source = clean_text(document.get("source")).lower()
        source_lead_id = clean_text(document.get("sourceLeadId"))
        website = normalize_url(document.get("website"))
        phone = normalize_phone(document.get("phone"))
        name = clean_text(document.get("name"))
        address = clean_text(document.get("address"))
        if source and source_lead_id:
            filters.append({"source": source, "sourceLeadId": source_lead_id})
        if website:
            filters.append({"website": website})
        if phone:
            filters.append({"phone": phone})
        if name and address:
            filters.append({"name": name, "address": address})
        return {"$or": filters} if filters else {"_id": ObjectId()}


@dataclass
class LeadScraperApp:
    store: MongoLeadStore = field(default_factory=MongoLeadStore)
    scorer: LeadScorer = field(default_factory=LeadScorer)
    session: requests.Session = field(default_factory=create_session)
    default_query: str = DEFAULT_SEARCH_QUERY

    def _launch_browser(self, playwright: Any) -> Any:
        return playwright.chromium.launch(
            headless=PLAYWRIGHT_HEADLESS,
            slow_mo=PLAYWRIGHT_SLOW_MO_MS,
            args=["--disable-blink-features=AutomationControlled"],
        )

    def _start_browser_session(self, *, locale: str = "en-IN") -> dict[str, Any]:
        playwright = sync_playwright().start()
        browser = self._launch_browser(playwright)
        context = browser.new_context(
            ignore_https_errors=True,
            locale=locale,
            service_workers="block",
            user_agent=self.session.headers.get("User-Agent", ""),
            viewport={"width": 1366, "height": 900},
        )
        page = context.new_page()
        page.add_init_script(
            """
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            Object.defineProperty(navigator, 'languages', {get: () => ['en-IN', 'en']});
            Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});
            """
        )
        return {
            "playwright": playwright,
            "browser": browser,
            "context": context,
            "page": page,
        }

    def _close_browser_session(self, browser_session: dict[str, Any] | None) -> None:
        if not browser_session:
            return
        for key in ("page", "context", "browser"):
            target = browser_session.get(key)
            if target is None:
                continue
            try:
                target.close()
            except Exception:
                pass
        playwright = browser_session.get("playwright")
        if playwright is not None:
            try:
                playwright.stop()
            except Exception:
                pass

    def _human_pause(self, page: Any, minimum_ms: int = 900, maximum_ms: int = 2200) -> None:
        page.wait_for_timeout(random.randint(minimum_ms, maximum_ms))

    def process_sources(
        self,
        sources: list[str],
        location: LocationContext,
        limit: int = 30,
        min_score: int = 40,
    ) -> dict[str, Any]:
        runs: list[dict[str, Any]] = []
        for source in sources:
            normalized = clean_text(source).lower()
            if normalized not in SOURCE_DEFINITIONS:
                runs.append({"source": normalized, "ok": False, "error": "Unknown source"})
                continue
            try:
                result = self.process_source(normalized, location=location, limit=limit, min_score=min_score)
                runs.append({"source": normalized, "ok": True, "result": result})
            except Exception as exc:  # noqa: BLE001
                runs.append({"source": normalized, "ok": False, "error": str(exc)})
        return {"runs": runs}

    def process_source(
        self,
        source: str,
        location: LocationContext,
        limit: int = 30,
        min_score: int = 40,
    ) -> dict[str, Any]:
        browser_session: dict[str, Any] | None = None
        try:
            if source == "google_maps" or ENABLE_GOOGLE_SEARCH_ENRICHMENT or ENABLE_ZAUBA_SEARCH or ENABLE_LINKEDIN_SEARCH:
                browser_session = self._start_browser_session()
            raw_leads = self._fetch_source_leads(
                source,
                location=location,
                limit=max(1, int(limit or 30)),
                browser_page=(browser_session or {}).get("page"),
            )
            discovered_count = len(raw_leads)
            saved_count = 0
            updated_count = 0
            skipped_count = 0
            score_filtered_count = 0
            missing_contact_count = 0
            seen: set[str] = set()
            results: list[dict[str, Any]] = []

            for raw in raw_leads:
                lead = self._normalize_lead(raw, source=source, location=location)
                if self._is_excluded_lead(lead):
                    skipped_count += 1
                    continue
                lead = self._enrich_lead(lead, location=location, browser_page=(browser_session or {}).get("page"))
                run_key = self._run_key(lead)
                if run_key in seen:
                    skipped_count += 1
                    continue
                seen.add(run_key)

                if not self._has_reachable_signal(lead):
                    missing_contact_count += 1
                    continue

                scored = self.scorer.enrich(lead, location=location)
                final_score = parse_float(scored.get("scoreMeta", {}).get("finalScore")) or 0
                if final_score < min_score:
                    score_filtered_count += 1
                    continue
                inserted_id, is_new = self.store.upsert_lead(scored)
                scored.pop("_websiteDecisionContacts", None)
                scored["_id"] = str(inserted_id)
                scored["persistenceAction"] = "inserted" if is_new else "updated"
                if is_new:
                    saved_count += 1
                else:
                    updated_count += 1
                results.append(scored)

            return {
                "source": source,
                "location": json_ready(location.__dict__),
                "discoveredCount": discovered_count,
                "savedCount": saved_count,
                "updatedCount": updated_count,
                "processedCount": len(results),
                "scoreFilteredCount": score_filtered_count,
                "missingContactCount": missing_contact_count,
                "skippedCount": skipped_count,
                "leads": results,
            }
        finally:
            self._close_browser_session(browser_session)

    def _fetch_source_leads(self, source: str, location: LocationContext, limit: int, browser_page: Any | None = None) -> list[dict[str, Any]]:
        if source == "indiamart":
            return self._fetch_indiamart(location, limit, browser_page=browser_page)
        if source == "google_maps":
            return self._fetch_google_maps(location, limit, browser_page=browser_page)
        raise RuntimeError(f"Unsupported source '{source}'")

    def _normalize_lead(self, lead: dict[str, Any], source: str, location: LocationContext) -> dict[str, Any]:
        row = dict(lead)
        row["source"] = source
        row["name"] = clean_text(row.get("name"))
        row["category"] = clean_text(deduplicate_repeated_phrase(row.get("category")))
        row["sourceCategory"] = clean_text(deduplicate_repeated_phrase(row.get("sourceCategory") or row.get("category")))
        row["normalizedCategory"] = clean_text(row.get("normalizedCategory"))
        row["description"] = clean_text(row.get("description"))
        row["address"] = clean_text(row.get("address"))
        row["city"] = clean_text(row.get("city"))
        row["state"] = clean_text(row.get("state"))
        row["country"] = clean_text(row.get("country")) or location.country
        row["phone"] = normalize_phone(row.get("phone"))
        row["email"] = clean_text(row.get("email")).lower()
        row["website"] = normalize_url(row.get("website"))
        if is_untrusted_website(row["website"]):
            row["website"] = ""
        row["mapsUrl"] = clean_text(row.get("mapsUrl"))
        row["rating"] = parse_float(row.get("rating"))
        row["reviewsCount"] = parse_int(row.get("reviewsCount"))
        row["sourceLeadId"] = clean_text(row.get("sourceLeadId"))
        row["latitude"] = parse_float(row.get("latitude"))
        row["longitude"] = parse_float(row.get("longitude"))
        if not row["city"] or not row["state"] or not row["country"]:
            city_hint, state_hint, country_hint = split_address_hint(row["address"])
            row["city"] = row["city"] or city_hint or location.city
            row["state"] = row["state"] or state_hint or location.state
            row["country"] = row["country"] or country_hint or location.country
        return row

    def _run_key(self, lead: dict[str, Any]) -> str:
        return "|".join(
            [
                clean_text(lead.get("source")).lower(),
                clean_text(lead.get("sourceLeadId")).lower(),
                normalize_url(lead.get("website")).lower(),
                normalize_phone(lead.get("phone")).lower(),
                clean_text(lead.get("name")).lower(),
                clean_text(lead.get("address")).lower(),
            ]
        )

    def _has_reachable_signal(self, lead: dict[str, Any]) -> bool:
        if normalize_phone(lead.get("phone")) or clean_text(lead.get("email")).lower():
            return True
        if normalize_url(lead.get("website")):
            return True
        decision_makers = lead.get("linkedinDecisionMakers", [])
        return bool(decision_makers)

    def _is_excluded_lead(self, lead: dict[str, Any]) -> bool:
        haystack = " ".join(
            [
                clean_text(lead.get("category")).lower(),
                clean_text(lead.get("description")).lower(),
                clean_text(lead.get("name")).lower(),
            ]
        )
        return any(token in haystack for token in EXCLUDED_CATEGORY_TOKENS)

    def _enrich_lead(self, lead: dict[str, Any], location: LocationContext, browser_page: Any | None = None) -> dict[str, Any]:
        row = dict(lead)
        row = self._ensure_enrichment_shell(row)
        row["zauba"] = self._zauba_validation(row, browser_page=browser_page) if ENABLE_ZAUBA_SEARCH else {"matched": False, "query": "", "resultUrl": "", "cin": "", "directors": []}
        row["companySearchResults"] = self._find_company_search_results(row, location, browser_page=browser_page) if ENABLE_GOOGLE_SEARCH_ENRICHMENT else []
        row["companySizeSignals"]["linkedinCompanyUrl"] = row["companySizeSignals"].get("linkedinCompanyUrl") or self._infer_linkedin_company_url(row["companySearchResults"])
        row = self._enrich_from_linkedin_company(row)
        row["normalizedCategory"] = normalize_category_label(
            row.get("sourceCategory") or row.get("category"),
            row.get("zauba"),
            website_hint=(row.get("companySizeSignals", {}) or {}).get("websiteCategoryHint", ""),
        )
        row["linkedinDecisionMakers"] = self._find_linkedin_decision_makers(row, browser_page=browser_page) if ENABLE_LINKEDIN_SEARCH else []
        if row.get("zauba", {}).get("directors"):
            row = self._merge_zauba_directors_into_people(row)
        row["decisionMakerContacts"] = self._build_decision_maker_contacts(row)
        if ENABLE_GOOGLE_SEARCH_ENRICHMENT and not normalize_url(row.get("website")):
            inferred_website = self._infer_company_website(row["companySearchResults"])
            if inferred_website:
                row["website"] = inferred_website
        row = self._enrich_from_website(row, preserve_existing=True)
        row["category"] = clean_text(row.get("normalizedCategory") or row.get("sourceCategory") or row.get("category"))
        row["decisionMakerContacts"] = self._build_decision_maker_contacts(row)
        return row

    def _ensure_enrichment_shell(self, lead: dict[str, Any]) -> dict[str, Any]:
        row = dict(lead)
        row["companyContacts"] = {
            "phones": list((((row.get("companyContacts") or {}) if isinstance(row.get("companyContacts"), dict) else {}).get("phones") or [])),
            "emails": list((((row.get("companyContacts") or {}) if isinstance(row.get("companyContacts"), dict) else {}).get("emails") or [])),
            "personalEmails": list((((row.get("companyContacts") or {}) if isinstance(row.get("companyContacts"), dict) else {}).get("personalEmails") or [])),
            "personalPhones": list((((row.get("companyContacts") or {}) if isinstance(row.get("companyContacts"), dict) else {}).get("personalPhones") or [])),
        }
        existing_signals = row.get("companySizeSignals", {}) if isinstance(row.get("companySizeSignals"), dict) else {}
        row["companySizeSignals"] = {
            "employeeCountHint": existing_signals.get("employeeCountHint"),
            "employeeRangeHint": clean_text(existing_signals.get("employeeRangeHint")),
            "foundedYear": existing_signals.get("foundedYear"),
            "turnoverHint": clean_text(existing_signals.get("turnoverHint")),
            "websiteCategoryHint": clean_text(existing_signals.get("websiteCategoryHint")),
            "hasTeamPage": bool(existing_signals.get("hasTeamPage")),
            "hasCareersPage": bool(existing_signals.get("hasCareersPage")),
            "hasClientPage": bool(existing_signals.get("hasClientPage")),
            "socialLinksCount": parse_int(existing_signals.get("socialLinksCount")) or 0,
            "linkedinCompanyUrl": normalize_url(existing_signals.get("linkedinCompanyUrl")),
            "pagesChecked": list(existing_signals.get("pagesChecked") or []),
            "signalSummary": list(existing_signals.get("signalSummary") or []),
        }
        return row

    def _enrich_from_website(self, lead: dict[str, Any], preserve_existing: bool = False) -> dict[str, Any]:
        row = self._ensure_enrichment_shell(lead) if preserve_existing else dict(lead)
        website = normalize_url(row.get("website"))
        if is_untrusted_website(website):
            website = ""
            row["website"] = ""
        if not preserve_existing:
            row = self._ensure_enrichment_shell(row)
        if not website:
            return row

        pages_to_visit = [website]
        tried: set[str] = set()
        discovered_links: set[str] = set()
        texts: list[str] = []
        decision_candidates: list[dict[str, Any]] = []

        for url in list(pages_to_visit):
            if len(pages_to_visit) >= 5:
                break
            pages_to_visit.extend(self._candidate_company_pages(url))

        for url in pages_to_visit[:5]:
            normalized = normalize_url(url)
            if not normalized or normalized in tried:
                continue
            tried.add(normalized)
            try:
                response = self.session.get(normalized, timeout=20)
            except requests.RequestException:
                continue
            if response.status_code >= 400:
                continue
            html = response.text or ""
            selector = scrapy.Selector(text=html)
            page_text = clean_text(" ".join(selector.css("body *::text").getall()))
            texts.append(page_text)
            row["companySizeSignals"]["pagesChecked"].append(normalized)

            trusted_contacts = self._extract_trusted_company_contacts(selector=selector, page_url=normalized)
            page_phones = trusted_contacts["phones"]
            page_emails = trusted_contacts["emails"]
            decision_candidates.extend(
                self._extract_decision_contacts_from_page(
                    selector=selector,
                    page_text=page_text,
                    page_url=normalized,
                    company_name=clean_text(row.get("name")),
                )
            )

            for phone in page_phones:
                if phone not in row["companyContacts"]["phones"]:
                    row["companyContacts"]["phones"].append(phone)
            for email in page_emails:
                if is_generic_email(email):
                    if email not in row["companyContacts"]["emails"]:
                        row["companyContacts"]["emails"].append(email)
                else:
                    if email not in row["companyContacts"]["personalEmails"]:
                        row["companyContacts"]["personalEmails"].append(email)

            if not normalize_phone(row.get("phone")) and row["companyContacts"]["phones"]:
                row["phone"] = row["companyContacts"]["phones"][0]
            if not clean_text(row.get("email")).lower():
                preferred_email = (
                    row["companyContacts"]["personalEmails"][0]
                    if row["companyContacts"]["personalEmails"]
                    else (row["companyContacts"]["emails"][0] if row["companyContacts"]["emails"] else "")
                )
                if preferred_email:
                    row["email"] = preferred_email

            social_links = [
                href
                for href in selector.css("a::attr(href)").getall()
                if any(hint in href.lower() for hint in SOCIAL_PLATFORM_HINTS)
            ]
            discovered_links.update(social_links)
            if not row["companySizeSignals"]["linkedinCompanyUrl"]:
                for href in social_links:
                    if "linkedin.com/company/" in href.lower():
                        row["companySizeSignals"]["linkedinCompanyUrl"] = normalize_url(href)
                        break

            lowered = normalized.lower()
            if any(token in lowered for token in ("/team", "/about-us", "/about", "/leadership")):
                row["companySizeSignals"]["hasTeamPage"] = True
            if any(token in lowered for token in ("/career", "/jobs", "/join-us")):
                row["companySizeSignals"]["hasCareersPage"] = True
            if any(token in lowered for token in ("/clients", "/customers", "/case-studies")):
                row["companySizeSignals"]["hasClientPage"] = True

        combined_text = clean_text(" ".join(texts))
        employee_match = EMPLOYEE_PATTERN.search(combined_text)
        employee_range_match = EMPLOYEE_RANGE_PATTERN.search(combined_text)
        founded_match = FOUNDED_PATTERN.search(combined_text)
        turnover_match = TURNOVER_PATTERN.search(combined_text)
        row["companySizeSignals"]["employeeCountHint"] = sanitize_employee_count_hint(employee_match.group(1)) if employee_match else None
        row["companySizeSignals"]["employeeRangeHint"] = sanitize_employee_range_hint(employee_range_match.group(1)) if employee_range_match else ""
        row["companySizeSignals"]["foundedYear"] = parse_int(founded_match.group(1)) if founded_match else None
        row["companySizeSignals"]["turnoverHint"] = clean_text(turnover_match.group(1)) if turnover_match else ""
        row["companySizeSignals"]["websiteCategoryHint"] = choose_website_category_hint(
            row.get("sourceCategory") or row.get("category"),
            infer_business_category(combined_text),
        )
        row["companySizeSignals"]["socialLinksCount"] = len(discovered_links)

        linkedin_company_url = row["companySizeSignals"].get("linkedinCompanyUrl")
        if linkedin_company_url:
            linkedin_signals = self._fetch_public_linkedin_company_signals(linkedin_company_url)
            if linkedin_signals.get("employeeCountHint") and not row["companySizeSignals"]["employeeCountHint"]:
                row["companySizeSignals"]["employeeCountHint"] = linkedin_signals["employeeCountHint"]
            if linkedin_signals.get("employeeRangeHint") and not row["companySizeSignals"]["employeeRangeHint"]:
                row["companySizeSignals"]["employeeRangeHint"] = linkedin_signals["employeeRangeHint"]

        summaries: list[str] = []
        if row["companySizeSignals"]["employeeCountHint"]:
            summaries.append(f"employee hint {row['companySizeSignals']['employeeCountHint']}")
        if row["companySizeSignals"]["employeeRangeHint"]:
            summaries.append(f"employee range {row['companySizeSignals']['employeeRangeHint']}")
        if row["companySizeSignals"]["foundedYear"]:
            summaries.append(f"founded {row['companySizeSignals']['foundedYear']}")
        if row["companySizeSignals"]["turnoverHint"]:
            summaries.append(f"turnover {row['companySizeSignals']['turnoverHint']}")
        if row["companySizeSignals"]["websiteCategoryHint"]:
            summaries.append(f"website category {row['companySizeSignals']['websiteCategoryHint']}")
        if row["companySizeSignals"]["hasTeamPage"]:
            summaries.append("team page")
        if row["companySizeSignals"]["hasCareersPage"]:
            summaries.append("careers page")
        if row["companySizeSignals"]["hasClientPage"]:
            summaries.append("client page")
        if row["companySizeSignals"]["socialLinksCount"]:
            summaries.append(f"{row['companySizeSignals']['socialLinksCount']} social links")
        row["companySizeSignals"]["signalSummary"] = summaries
        row["_websiteDecisionContacts"] = self._merge_contact_rows(decision_candidates)
        row = self._finalize_company_contacts(row)
        return row

    def _candidate_company_pages(self, website: str) -> list[str]:
        try:
            response = self.session.get(website, timeout=20)
        except requests.RequestException:
            return []
        if response.status_code >= 400:
            return []
        selector = scrapy.Selector(text=response.text or "")
        candidates: list[str] = []
        for href in selector.css("a::attr(href)").getall():
            absolute = normalize_url(urljoin(website, href))
            if not absolute:
                continue
            if not is_probable_html_page_url(absolute):
                continue
            lowered = absolute.lower()
            if any(token in lowered for token in ("contact", "about", "team", "leadership", "career", "client", "customer")):
                candidates.append(absolute)
        return list(dict.fromkeys(candidates))[:4]

    def _extract_trusted_company_contacts(self, *, selector: scrapy.Selector, page_url: str) -> dict[str, list[str]]:
        primary_phones: list[str] = []
        fallback_phones: list[str] = []
        emails: list[str] = []
        for href in selector.css("a::attr(href)").getall():
            self._append_contact_from_href(clean_text(href), primary_phones, emails)

        for script_text in selector.css('script[type="application/ld+json"]::text').getall():
            self._extract_contacts_from_jsonld(script_text, primary_phones, emails)

        for meta_content in selector.css("meta::attr(content)").getall():
            for email in extract_emails(meta_content):
                if email not in emails:
                    emails.append(email)

        trusted_blocks = selector.css(
            "footer, address, .contact, .contact-us, #contact, [class*='contact'], [id*='contact'], [class*='footer'], [id*='footer']"
        )
        for block in trusted_blocks:
            text = clean_text(" ".join(block.css("*::text, ::text").getall()))
            for href in block.css("a::attr(href)").getall():
                self._append_contact_from_href(clean_text(href), primary_phones, emails)
            for phone in extract_phones(text):
                if looks_like_company_phone(phone) and phone not in primary_phones and phone not in fallback_phones:
                    fallback_phones.append(phone)
            for email in extract_emails(text):
                if email not in emails:
                    emails.append(email)
        phones = primary_phones[:]
        if not phones:
            phones = fallback_phones[:1]
        return {"phones": phones[:3], "emails": emails[:3]}

    def _append_contact_from_href(self, href: str, phones: list[str], emails: list[str]) -> None:
        value = clean_text(href)
        lower_value = value.lower()
        if lower_value.startswith("tel:") or lower_value.startswith("callto:"):
            raw_phone = value.split(":", 1)[1]
            phone = normalize_phone(raw_phone)
            if looks_like_company_phone(phone) and phone not in phones:
                phones.append(phone)
            return
        if lower_value.startswith("mailto:"):
            email = clean_text(value.split(":", 1)[1]).split("?", 1)[0].lower()
            if email and email not in emails:
                emails.append(email)
            return
        whatsapp_match = re.search(r"(?:wa\.me/|phone=)(\+?\d{10,14})", lower_value)
        if whatsapp_match:
            phone = normalize_phone(whatsapp_match.group(1))
            if looks_like_company_phone(phone) and phone not in phones:
                phones.append(phone)

    def _extract_contacts_from_jsonld(self, raw_json: str, phones: list[str], emails: list[str]) -> None:
        cleaned = clean_text(raw_json)
        if not cleaned:
            return
        try:
            payload = json.loads(raw_json)
        except Exception:
            return
        for phone, email in self._walk_jsonld_contacts(payload):
            if phone and looks_like_company_phone(phone) and phone not in phones:
                phones.append(phone)
            if email and email not in emails:
                emails.append(email)

    def _walk_jsonld_contacts(self, payload: Any) -> list[tuple[str, str]]:
        found: list[tuple[str, str]] = []
        if isinstance(payload, dict):
            phone = normalize_phone(payload.get("telephone") or payload.get("phone") or "")
            email = clean_text(payload.get("email") or "").lower()
            if phone or email:
                found.append((phone, email))
            for value in payload.values():
                found.extend(self._walk_jsonld_contacts(value))
        elif isinstance(payload, list):
            for item in payload:
                found.extend(self._walk_jsonld_contacts(item))
        return found

    def _finalize_company_contacts(self, lead: dict[str, Any]) -> dict[str, Any]:
        row = dict(lead)
        contacts = row.get("companyContacts", {}) if isinstance(row.get("companyContacts"), dict) else {}
        phones = [normalize_phone(item) for item in contacts.get("phones", []) if looks_like_company_phone(item)]
        emails = [clean_text(item).lower() for item in contacts.get("emails", []) if clean_text(item)]
        personal_emails = [clean_text(item).lower() for item in contacts.get("personalEmails", []) if clean_text(item)]

        primary_phone = normalize_phone(row.get("phone"))
        if primary_phone and looks_like_company_phone(primary_phone):
            phones = [primary_phone]
        elif phones:
            row["phone"] = phones[0]
            phones = [phones[0]]
        else:
            row["phone"] = ""

        primary_email = clean_text(row.get("email")).lower()
        if primary_email:
            if is_generic_email(primary_email):
                emails = [primary_email]
                personal_emails = []
            else:
                personal_emails = [primary_email]
                emails = []
        elif personal_emails:
            row["email"] = personal_emails[0]
            personal_emails = [personal_emails[0]]
            emails = []
        elif emails:
            row["email"] = emails[0]
            emails = [emails[0]]
        else:
            row["email"] = ""

        row["companyContacts"] = {
            "phones": phones[:1],
            "emails": emails[:1],
            "personalEmails": personal_emails[:1],
            "personalPhones": [],
        }
        return row

    def _fetch_public_linkedin_company_signals(self, linkedin_company_url: str) -> dict[str, Any]:
        try:
            response = self.session.get(linkedin_company_url, timeout=20)
        except requests.RequestException:
            return {"employeeCountHint": None, "employeeRangeHint": "", "foundedYear": None, "websiteCategoryHint": "", "turnoverHint": ""}
        if response.status_code >= 400:
            return {"employeeCountHint": None, "employeeRangeHint": "", "foundedYear": None, "websiteCategoryHint": "", "turnoverHint": ""}
        text = clean_text(" ".join(scrapy.Selector(text=response.text).css("body *::text").getall()))
        employee_match = EMPLOYEE_PATTERN.search(text)
        employee_range_match = EMPLOYEE_RANGE_PATTERN.search(text)
        founded_match = FOUNDED_PATTERN.search(text)
        turnover_match = TURNOVER_PATTERN.search(text)
        return {
            "employeeCountHint": sanitize_employee_count_hint(employee_match.group(1)) if employee_match else None,
            "employeeRangeHint": sanitize_employee_range_hint(employee_range_match.group(1)) if employee_range_match else "",
            "foundedYear": parse_int(founded_match.group(1)) if founded_match else None,
            "websiteCategoryHint": infer_business_category(text),
            "turnoverHint": clean_text(turnover_match.group(1)) if turnover_match else "",
        }

    def _enrich_from_linkedin_company(self, lead: dict[str, Any]) -> dict[str, Any]:
        row = self._ensure_enrichment_shell(lead)
        linkedin_company_url = normalize_url((row.get("companySizeSignals") or {}).get("linkedinCompanyUrl"))
        if not linkedin_company_url:
            return row
        signals = self._fetch_public_linkedin_company_signals(linkedin_company_url)
        if signals.get("employeeCountHint") and not row["companySizeSignals"]["employeeCountHint"]:
            row["companySizeSignals"]["employeeCountHint"] = signals["employeeCountHint"]
        if signals.get("employeeRangeHint") and not row["companySizeSignals"]["employeeRangeHint"]:
            row["companySizeSignals"]["employeeRangeHint"] = signals["employeeRangeHint"]
        if signals.get("foundedYear") and not row["companySizeSignals"]["foundedYear"]:
            row["companySizeSignals"]["foundedYear"] = signals["foundedYear"]
        if signals.get("turnoverHint") and not row["companySizeSignals"]["turnoverHint"]:
            row["companySizeSignals"]["turnoverHint"] = signals["turnoverHint"]
        if signals.get("websiteCategoryHint") and not row["companySizeSignals"]["websiteCategoryHint"]:
            row["companySizeSignals"]["websiteCategoryHint"] = choose_website_category_hint(
                row.get("sourceCategory") or row.get("category"),
                signals["websiteCategoryHint"],
            )
        return row

    def _zauba_validation(self, lead: dict[str, Any], browser_page: Any | None = None) -> dict[str, Any]:
        company_name = clean_text(lead.get("name"))
        if not company_name:
            return {
                "matched": False,
                "query": "",
                "resultUrl": "",
                "cin": "",
                "directors": [],
                "companyClass": "",
                "subCategory": "",
                "activity": "",
                "status": "",
                "authorizedCapital": "",
                "paidUpCapital": "",
            }
        query = f'site:zaubacorp.com "{company_name}" directors'
        results = self._google_search(query, limit=3, browser_page=browser_page)
        if not results:
            return {
                "matched": False,
                "query": query,
                "resultUrl": "",
                "cin": "",
                "directors": [],
                "companyClass": "",
                "subCategory": "",
                "activity": "",
                "status": "",
                "authorizedCapital": "",
                "paidUpCapital": "",
            }
        zauba_candidates = [row for row in results if "zaubacorp.com" in clean_text(row.get("url")).lower()]
        best = next(
            (
                row
                for row in zauba_candidates
                if zauba_match_confident(company_name, " ".join([row.get("title", ""), row.get("snippet", ""), row.get("url", "")]))
            ),
            None,
        )
        if not best:
            return {
                "matched": False,
                "query": query,
                "resultUrl": "",
                "cin": "",
                "directors": [],
                "companyClass": "",
                "subCategory": "",
                "activity": "",
                "status": "",
                "authorizedCapital": "",
                "paidUpCapital": "",
            }
        zauba = {
            "matched": True,
            "query": query,
            "resultUrl": best.get("url", ""),
            "cin": "",
            "directors": self._extract_directors_from_text(" ".join([best.get("title", ""), best.get("snippet", "")])),
            "companyClass": "",
            "subCategory": "",
            "activity": "",
            "status": "",
            "authorizedCapital": "",
            "paidUpCapital": "",
        }
        url = best.get("url", "")
        if url:
            try:
                response = self.session.get(url, timeout=20)
                if response.status_code < 400:
                    selector = scrapy.Selector(text=response.text)
                    page_identity = clean_text(
                        " ".join(
                            [
                                selector.css("title::text").get(default=""),
                                selector.css("h1::text").get(default=""),
                                selector.css('meta[property="og:title"]::attr(content)').get(default=""),
                            ]
                        )
                    )
                    if not zauba_match_confident(company_name, " ".join([best.get("title", ""), best.get("url", ""), page_identity])):
                        return {
                            "matched": False,
                            "query": query,
                            "resultUrl": "",
                            "cin": "",
                            "directors": [],
                            "companyClass": "",
                            "subCategory": "",
                            "activity": "",
                            "status": "",
                            "authorizedCapital": "",
                            "paidUpCapital": "",
                        }
                    text = clean_text(" ".join(selector.css("body *::text").getall()))
                    cin_match = ZAUBA_CIN_PATTERN.search(text)
                    if cin_match:
                        zauba["cin"] = cin_match.group(1)
                    stop_labels = (
                        "Company Sub Category",
                        "Company Status",
                        "Authorised Capital",
                        "Paid up capital",
                        "Date of Incorporation",
                        "Listing and Annual Compliance Details",
                        "Industrial Classification",
                        "Registration Number",
                        "ROC",
                        "Age of Company",
                    )
                    zauba["companyClass"] = extract_labeled_value(text, "Company Class", stop_labels, max_chars=80)
                    zauba["subCategory"] = extract_labeled_value(text, "Company Sub Category", stop_labels, max_chars=120)
                    zauba["activity"] = extract_labeled_value(text, "Industrial Classification", stop_labels, max_chars=140)
                    zauba["status"] = extract_labeled_value(text, "Company Status", stop_labels, max_chars=60)
                    zauba["authorizedCapital"] = extract_labeled_value(text, "Authorised Capital", stop_labels, max_chars=60)
                    zauba["paidUpCapital"] = extract_labeled_value(text, "Paid up capital", stop_labels, max_chars=60)
                    directors = self._extract_directors_from_text(text)
                    if directors:
                        zauba["directors"] = directors
            except requests.RequestException:
                pass
        zauba["directors"] = list(dict.fromkeys(zauba["directors"]))[:5]
        return zauba

    def _extract_directors_from_text(self, text: str) -> list[str]:
        cleaned = clean_text(text)
        if not cleaned:
            return []
        directors: list[str] = []
        snippets = re.split(r"(?:director|directors)[:\s-]*", cleaned, flags=re.IGNORECASE)
        for chunk in snippets[1:4]:
            for candidate in DIRECTOR_NAME_PATTERN.findall(chunk[:300]):
                candidate = clean_text(candidate)
                if looks_like_person_name(candidate):
                    directors.append(candidate)
        return list(dict.fromkeys(directors))[:5]

    def _extract_decision_contacts_from_page(
        self,
        *,
        selector: scrapy.Selector,
        page_text: str,
        page_url: str,
        company_name: str,
    ) -> list[dict[str, Any]]:
        lower_url = page_url.lower()
        is_leadership_page = any(token in lower_url for token in ("/about", "/team", "/leadership", "/management"))
        if not is_leadership_page:
            return []
        candidates: list[dict[str, Any]] = []
        blocks = selector.css("section, article, li, p, div")
        seen_blocks: set[str] = set()
        for block in blocks:
            text = clean_text(" ".join(block.css("*::text, ::text").getall()))
            if not text or len(text) < 20 or len(text) > 350:
                continue
            if text in seen_blocks:
                continue
            seen_blocks.add(text)
            role_match = LINKEDIN_ROLE_PATTERN.search(text)
            names = [
                clean_text(name)
                for name in DIRECTOR_NAME_PATTERN.findall(text)
                if looks_like_person_name(clean_text(name))
            ]
            emails = extract_emails(text)
            phones = extract_phones(text)
            if not names:
                continue
            if not role_match:
                continue
            if company_name and company_name.lower() not in page_text.lower():
                continue
            role = clean_text(role_match.group(1)) if role_match else ""
            for name in names[:2]:
                personal_email = self._pick_personal_email_for_name(name, emails)
                candidates.append(
                    {
                        "name": name,
                        "role": role,
                        "email": personal_email,
                        "phone": "",
                        "source": "website_page",
                        "pageUrl": page_url,
                    }
                )

        return candidates

    def _extract_named_roles_from_text(self, text: str) -> list[dict[str, Any]]:
        cleaned = clean_text(text)
        if not cleaned:
            return []
        rows: list[dict[str, Any]] = []
        for match in re.finditer(
            r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*[,|-]?\s*(Founder|Co-Founder|CEO|CTO|CFO|COO|Director|Owner|Partner|Head|VP|Manager|President)\b",
            cleaned,
            flags=re.IGNORECASE,
        ):
            rows.append(
                {
                    "name": clean_text(match.group(1)),
                    "role": clean_text(match.group(2)),
                    "email": "",
                    "phone": "",
                }
            )
        return [row for row in rows if looks_like_person_name(row["name"])][:5]

    def _pick_personal_email_for_name(self, name: str, emails: list[str]) -> str:
        tokens = [token.lower() for token in clean_text(name).split() if token]
        if not tokens:
            return ""
        for email in emails:
            if is_generic_email(email):
                continue
            local = email.split("@", 1)[0].lower()
            if any(token in local for token in tokens):
                return email
        return ""

    def _merge_contact_rows(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        merged: dict[str, dict[str, Any]] = {}
        for row in rows:
            name = clean_text(row.get("name"))
            key = normalize_name_key(name) or json.dumps(row, sort_keys=True)
            current = merged.get(
                key,
                {
                    "name": name,
                    "role": clean_text(row.get("role")),
                    "email": "",
                    "phone": "",
                    "linkedinUrl": "",
                    "source": clean_text(row.get("source")),
                    "pageUrl": clean_text(row.get("pageUrl")),
                },
            )
            if name and not looks_like_person_name(name):
                continue
            for field in ("role", "email", "phone", "linkedinUrl", "source", "pageUrl"):
                if not current.get(field) and clean_text(row.get(field)):
                    current[field] = clean_text(row.get(field))
            merged[key] = current
        return list(merged.values())[:8]

    def _build_decision_maker_contacts(self, lead: dict[str, Any]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for item in lead.get("_websiteDecisionContacts", []) if isinstance(lead.get("_websiteDecisionContacts"), list) else []:
            if clean_text(item.get("email")):
                rows.append(dict(item))
        for item in lead.get("linkedinDecisionMakers", []) if isinstance(lead.get("linkedinDecisionMakers"), list) else []:
            rows.append(
                {
                    "name": clean_text(item.get("name")),
                    "role": clean_text(item.get("role")),
                    "email": "",
                    "phone": "",
                    "linkedinUrl": clean_text(item.get("linkedinUrl")),
                    "source": clean_text(item.get("source")) or "google_linkedin",
                    "pageUrl": "",
                }
            )
        merged = self._merge_contact_rows(rows)
        return [self._hydrate_public_linkedin_profile(item) for item in merged]

    def _merge_zauba_directors_into_people(self, lead: dict[str, Any]) -> dict[str, Any]:
        row = dict(lead)
        existing = row.get("linkedinDecisionMakers", []) if isinstance(row.get("linkedinDecisionMakers"), list) else []
        seen = {normalize_name_key(item.get("name")) for item in existing if isinstance(item, dict)}
        for director in row.get("zauba", {}).get("directors", []) if isinstance(row.get("zauba", {}).get("directors"), list) else []:
            cleaned = clean_text(director)
            key = normalize_name_key(cleaned)
            if not cleaned or not looks_like_person_name(cleaned) or key in seen:
                continue
            existing.append({"name": cleaned, "role": "Director", "linkedinUrl": "", "source": "zauba"})
            seen.add(key)
        row["linkedinDecisionMakers"] = existing[:8]
        return row

    def _hydrate_public_linkedin_profile(self, person: dict[str, Any]) -> dict[str, Any]:
        row = dict(person)
        linkedin_url = clean_text(row.get("linkedinUrl"))
        if not linkedin_url:
            return row
        try:
            response = self.session.get(linkedin_url, timeout=20)
        except requests.RequestException:
            return row
        if response.status_code >= 400:
            return row
        text = clean_text(" ".join(scrapy.Selector(text=response.text).css("body *::text").getall()))
        if not row.get("email"):
            emails = extract_emails(text)
            row["email"] = self._pick_personal_email_for_name(clean_text(row.get("name")), emails)
        if not row.get("phone"):
            phones = [phone for phone in extract_phones(text) if looks_like_company_phone(phone)]
            row["phone"] = phones[0] if phones else ""
        return row

    def _find_linkedin_decision_makers(self, lead: dict[str, Any], browser_page: Any | None = None) -> list[dict[str, str]]:
        company_name = clean_text(lead.get("name"))
        if not company_name:
            return []
        query = (
            f'site:linkedin.com/in "{company_name}" '
            "(founder OR ceo OR director OR owner OR head OR manager)"
        )
        results = self._google_search(query, limit=GOOGLE_RESULT_LIMIT, browser_page=browser_page)
        people: list[dict[str, str]] = []
        for row in results:
            url = clean_text(row.get("url"))
            if "linkedin.com" not in url.lower() or "/in/" not in url.lower():
                continue
            title = clean_text(row.get("title"))
            snippet = clean_text(row.get("snippet"))
            joined = " ".join([title, snippet])
            if company_name.lower() not in joined.lower():
                continue
            role_match = LINKEDIN_ROLE_PATTERN.search(joined)
            if not role_match:
                continue
            role = clean_text(role_match.group(1)) if role_match else ""
            if not is_senior_decision_role(role):
                continue
            raw_name = clean_text(title.split(" - ", 1)[0] if " - " in title else title.split("|", 1)[0])
            name = re.sub(r"\b(linkedin|chief|director|ceo|cto|cfo|coo|founder|owner|partner|head|manager|president)\b", "", raw_name, flags=re.IGNORECASE)
            name = clean_text(name)
            if not name or company_name.lower() in name.lower() or not looks_like_person_name(name):
                continue
            people.append({"name": name, "role": role, "linkedinUrl": url, "source": "google_linkedin"})
        return list({json.dumps(item, sort_keys=True): item for item in people}.values())[:5]

    def _find_company_search_results(self, lead: dict[str, Any], location: LocationContext, browser_page: Any | None = None) -> list[dict[str, str]]:
        company_name = clean_text(lead.get("name"))
        if not company_name:
            return []
        query_parts = [f'"{company_name}"']
        if location.city:
            query_parts.append(location.city)
        results = self._google_search(" ".join(query_parts), limit=GOOGLE_RESULT_LIMIT, browser_page=browser_page)
        linkedin_results = self._google_search(
            f'site:linkedin.com/company "{company_name}"',
            limit=2,
            browser_page=browser_page,
        )
        merged_results = results + [item for item in linkedin_results if item not in results]
        normalized_website = domain_from_url(lead.get("website"))
        rows: list[dict[str, str]] = []
        for item in merged_results:
            url = clean_text(item.get("url"))
            title = clean_text(item.get("title"))
            snippet = clean_text(item.get("snippet"))
            if not url:
                continue
            row = {
                "title": title,
                "url": url,
                "snippet": snippet,
                "isLinkedIn": "linkedin.com" in url.lower(),
                "matchesWebsite": bool(normalized_website and normalized_website in domain_from_url(url)),
            }
            rows.append(row)
        return rows[:7]

    def _infer_linkedin_company_url(self, results: list[dict[str, Any]]) -> str:
        for item in results:
            url = normalize_url(item.get("url"))
            if not url:
                continue
            lowered = url.lower()
            if "linkedin.com/company/" in lowered:
                return url
        return ""

    def _infer_company_website(self, results: list[dict[str, Any]]) -> str:
        for item in results:
            url = normalize_url(item.get("url"))
            domain = domain_from_url(url)
            if not url or not domain:
                continue
            if "linkedin.com" in domain or "zaubacorp.com" in domain or is_untrusted_website(url):
                continue
            return url
        return ""

    def _google_search(self, query: str, limit: int = 5, browser_page: Any | None = None) -> list[dict[str, str]]:
        safe_limit = max(1, min(int(limit or 5), 10))
        results = self._search_web_results(query, safe_limit)
        if results:
            return results

        search_url = f"https://www.google.com/search?q={quote_plus(query)}&num={safe_limit}&hl=en"
        if browser_page is not None:
            self._goto_with_retry(browser_page, search_url, wait_until="domcontentloaded", timeout=60000)
            self._human_pause(browser_page, 2200, 3600)
            html = browser_page.content()
            if self._looks_like_google_block_page(html):
                return []
        else:
            with sync_playwright() as playwright:
                browser = self._launch_browser(playwright)
                context = browser.new_context(ignore_https_errors=True, user_agent=self.session.headers.get("User-Agent", ""))
                try:
                    page = context.new_page()
                    self._goto_with_retry(page, search_url, wait_until="domcontentloaded", timeout=60000)
                    self._human_pause(page, 2200, 3600)
                    html = page.content()
                    if self._looks_like_google_block_page(html):
                        return []
                finally:
                    context.close()
                    browser.close()
        return self._parse_google_results_html(html, safe_limit)

    def _search_web_results(self, query: str, limit: int) -> list[dict[str, str]]:
        backend = SEARCH_BACKEND
        providers = ["bing", "duckduckgo"] if backend == "bing" else ["duckduckgo", "bing"]
        for provider in providers:
            try:
                if provider == "bing":
                    results = self._search_bing(query, limit)
                else:
                    results = self._search_duckduckgo(query, limit)
            except requests.RequestException:
                results = []
            if results:
                return results
        return []

    def _search_bing(self, query: str, limit: int) -> list[dict[str, str]]:
        url = f"https://www.bing.com/search?q={quote_plus(query)}&count={max(limit, 5)}&setlang=en-IN"
        response = self.session.get(url, timeout=20)
        if response.status_code >= 400:
            return []
        selector = scrapy.Selector(text=response.text or "")
        rows: list[dict[str, str]] = []
        seen: set[str] = set()
        for node in selector.css("li.b_algo"):
            href = normalize_url(node.css("h2 a::attr(href)").get())
            title = clean_text(" ".join(node.css("h2 a *::text, h2 a::text").getall()))
            snippet = clean_text(" ".join(node.css(".b_caption *::text, p *::text, p::text").getall()))
            if not href or href in seen or not title:
                continue
            seen.add(href)
            rows.append({"title": title, "url": href, "snippet": snippet})
            if len(rows) >= limit:
                break
        return rows

    def _search_duckduckgo(self, query: str, limit: int) -> list[dict[str, str]]:
        url = "https://html.duckduckgo.com/html/"
        response = self.session.get(url, params={"q": query}, timeout=20)
        if response.status_code >= 400:
            return []
        selector = scrapy.Selector(text=response.text or "")
        rows: list[dict[str, str]] = []
        seen: set[str] = set()
        for node in selector.css("div.result, .result.results_links"):
            href = normalize_url(node.css("a.result__a::attr(href), h2 a::attr(href)").get())
            title = clean_text(" ".join(node.css("a.result__a *::text, h2 a *::text, h2 a::text").getall()))
            snippet = clean_text(" ".join(node.css(".result__snippet *::text, .result__snippet::text").getall()))
            if not href or href in seen or not title:
                continue
            seen.add(href)
            rows.append({"title": title, "url": href, "snippet": snippet})
            if len(rows) >= limit:
                break
        return rows

    def _looks_like_google_block_page(self, html: str) -> bool:
        text = clean_text(html).lower()
        return any(token in text for token in ("unusual traffic", "sorry", "detected unusual traffic", "not a robot", "captcha"))

    def _parse_google_results_html(self, html: str, limit: int) -> list[dict[str, str]]:
        selector = scrapy.Selector(text=html)
        results: list[dict[str, str]] = []
        seen: set[str] = set()
        for node in selector.css("div.g, div[data-snc]"):
            href = clean_text(node.css("a::attr(href)").get())
            url = self._decode_google_result_url(href)
            title = clean_text(" ".join(node.css("h3 *::text, h3::text").getall()))
            snippet = clean_text(" ".join(node.css("span::text, div[style] *::text").getall()))
            if not url or url in seen or not title:
                continue
            seen.add(url)
            results.append({"title": title, "url": url, "snippet": snippet})
            if len(results) >= limit:
                break
        return results

    def _fetch_html_via_requests(self, url: str, *, timeout: int = 30) -> str:
        response = self.session.get(url, timeout=timeout)
        response.raise_for_status()
        return response.text or ""

    def _goto_with_retry(self, page: Any, url: str, *, wait_until: str = "domcontentloaded", timeout: int = 60000) -> None:
        last_error: Exception | None = None
        for _ in range(2):
            try:
                page.goto(url, wait_until=wait_until, timeout=timeout)
                return
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                page.wait_for_timeout(1500)
        if last_error is not None:
            raise last_error

    def _decode_google_result_url(self, href: str) -> str:
        raw = clean_text(href)
        if not raw:
            return ""
        if raw.startswith("/url?"):
            parsed = urlparse("https://www.google.com" + raw)
            query = parse_qs(parsed.query)
            target = clean_text((query.get("q") or [""])[0])
            return normalize_url(unquote(target))
        if raw.startswith("http://") or raw.startswith("https://"):
            return normalize_url(unquote(raw))
        return ""

    def _fetch_indiamart(self, location: LocationContext, limit: int, browser_page: Any | None = None) -> list[dict[str, Any]]:
        query = self._discovery_query(location)
        search_url = f"https://dir.indiamart.com/search.mp?ss={quote_plus(query)}"
        html = ""
        try:
            html = self._fetch_html_via_requests(search_url)
        except requests.RequestException:
            html = ""

        leads = self._parse_indiamart_cards(html, location=location, limit=limit) if html else []
        if leads:
            return leads

        if browser_page is not None:
            try:
                self._goto_with_retry(browser_page, search_url, wait_until="domcontentloaded", timeout=60000)
            except Exception as exc:  # noqa: BLE001
                message = str(exc)
                if "ERR_INTERNET_DISCONNECTED" in message:
                    raise RuntimeError(
                        "IndiaMART browser session could not reach the internet. "
                        "The machine can reach the site over HTTP, but Chromium could not load the rendered results."
                    ) from exc
                raise
            self._human_pause(browser_page, 1800, 2800)
            html = browser_page.content()
        else:
            with sync_playwright() as playwright:
                browser = self._launch_browser(playwright)
                context = browser.new_context(ignore_https_errors=True, service_workers="block")
                try:
                    page = context.new_page()
                    try:
                        self._goto_with_retry(page, search_url, wait_until="domcontentloaded", timeout=60000)
                    except Exception as exc:  # noqa: BLE001
                        message = str(exc)
                        if "ERR_INTERNET_DISCONNECTED" in message:
                            raise RuntimeError(
                                "IndiaMART browser session could not reach the internet. "
                                "The machine can reach the site over HTTP, but Chromium could not load the rendered results."
                            ) from exc
                        raise
                    self._human_pause(page, 1800, 2800)
                    html = page.content()
                finally:
                    context.close()
                    browser.close()

        return self._parse_indiamart_cards(html, location=location, limit=limit)

    def _parse_indiamart_cards(self, html: str, *, location: LocationContext, limit: int) -> list[dict[str, Any]]:
        selector = scrapy.Selector(text=html or "")
        leads: list[dict[str, Any]] = []
        seen: set[str] = set()
        cards = selector.css("div.card[id^='LST']")
        for card in cards:
            name = clean_text(" ".join(card.css(".companyname a::text, .companyname *::text").getall()))
            company_href = clean_text(card.css(".companyname a::attr(href)").get())
            href = company_href or clean_text(card.css("a::attr(href)").get())
            website = ""
            phone = extract_phone(" ".join(card.css("*::text").getall()))
            locality = clean_text(" ".join(card.css(".newLocationUi *::text").getall()))
            address = ", ".join(part for part in [locality, location.city, location.state, location.country] if clean_text(part))
            category = clean_text(" ".join(card.css(".producttitle *::text, .stxt::text, .small::text").getall()))
            description = clean_text(" ".join(card.css(".producttitle *::text, p *::text, .desg *::text").getall()))
            rating = parse_float(card.attrib.get("data-rating"))
            source_lead_id = clean_text(href or f"indiamart:{name.lower()}")
            if not name or source_lead_id in seen:
                continue
            seen.add(source_lead_id)
            leads.append(
                {
                    "name": name,
                    "category": category or "IndiaMART listing",
                    "description": description,
                    "address": address,
                    "city": location.city,
                    "state": location.state,
                    "country": location.country,
                    "phone": phone,
                    "website": website,
                    "rating": rating,
                    "sourceLeadId": source_lead_id,
                }
            )
            if len(leads) >= limit:
                break
        return leads

    def _fetch_google_maps(self, location: LocationContext, limit: int, browser_page: Any | None = None) -> list[dict[str, Any]]:
        if browser_page is None:
            with sync_playwright() as playwright:
                browser = self._launch_browser(playwright)
                context = browser.new_context(ignore_https_errors=True, locale="en-IN", service_workers="block")
                try:
                    page = context.new_page()
                    return self._fetch_google_maps(location, limit, browser_page=page)
                finally:
                    context.close()
                    browser.close()

        page = browser_page
        search_url = f"https://www.google.com/maps/search/{quote_plus(self._nearby_search_text(location))}"
        try:
            self._goto_with_retry(page, search_url, wait_until="domcontentloaded", timeout=60000)
        except Exception as exc:  # noqa: BLE001
            message = str(exc)
            if "ERR_INTERNET_DISCONNECTED" in message:
                raise RuntimeError(
                    "Google Maps browser session could not reach the internet. "
                    "IndiaMART can still run, but Google Maps needs Chromium network access on this machine."
                ) from exc
            raise
        self._human_pause(page, 3500, 5200)
        self._scroll_google_maps(page, max_items=max(limit * 4, 40))
        html = page.content()
        selector = scrapy.Selector(text=html)
        leads: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        candidate_urls: list[str] = []
        for node in selector.css('a[href*="/maps/place/"], a[href*="/maps?cid="]'):
            if len(candidate_urls) >= max(limit * 4, 40):
                break
            href = clean_text(node.attrib.get("href"))
            maps_url = href if href.startswith("http") else urljoin("https://www.google.com", href)
            source_lead_id = maps_url or clean_text(" ".join(node.css("*::text").getall())).lower()
            if not source_lead_id or source_lead_id in seen_ids:
                continue
            seen_ids.add(source_lead_id)
            candidate_urls.append(maps_url)

        for maps_url in candidate_urls:
            if len(leads) >= limit:
                break
            lead = self._fetch_google_maps_detail(page, maps_url, location)
            if lead:
                lead["sourceLeadId"] = maps_url
                lead["mapsUrl"] = maps_url
                leads.append(lead)
        return leads

    def _scroll_google_maps(self, page: Any, max_items: int) -> None:
        for _ in range(max(6, min(max_items, 20))):
            page.mouse.wheel(0, 2500)
            page.wait_for_timeout(1200)

    def _fetch_google_maps_detail(
        self,
        page: Any,
        maps_url: str,
        location: LocationContext,
    ) -> dict[str, Any]:
        try:
            self._goto_with_retry(page, maps_url, wait_until="domcontentloaded", timeout=60000)
            self._human_pause(page, 1400, 2400)
            html = page.content()
        except Exception:  # noqa: BLE001
            return {}

        selector = scrapy.Selector(text=html)
        title = clean_text(" ".join(selector.css("h1 *::text, h1::text").getall()))
        main_selector = selector.css('div[role="main"]')
        body_text = clean_text(" ".join(main_selector.css("*::text").getall())) or clean_text(" ".join(selector.css("body *::text").getall()))
        website = self._extract_maps_website(selector)
        map_phones: list[str] = []
        phone_from_button = self._extract_maps_phone(selector)
        if phone_from_button:
            map_phones.append(phone_from_button)
        for href in selector.css('div[role="main"] a[href^="tel:"]::attr(href)').getall():
            phone = normalize_phone(clean_text(href)[4:])
            if looks_like_company_phone(phone) and phone not in map_phones:
                map_phones.append(phone)
        rating = None
        reviews = None
        rating_match = re.search(r"([0-5]\.?[0-9]?)\s*stars?", body_text, re.IGNORECASE)
        reviews_match = re.search(r"([0-9,]+)\s*reviews", body_text, re.IGNORECASE)
        if rating_match:
            rating = parse_float(rating_match.group(1))
        if reviews_match:
            reviews = parse_int(reviews_match.group(1))
        lat, lon = self._extract_coords_from_maps_url(maps_url)
        address = self._extract_maps_address(selector, body_text, location)
        return {
            "name": title,
            "category": self._extract_maps_category(selector, body_text),
            "description": "",
            "address": address,
            "city": location.city,
            "state": location.state,
            "country": location.country,
            "phone": map_phones[0] if map_phones else "",
            "website": website,
            "rating": rating,
            "reviewsCount": reviews,
            "latitude": lat,
            "longitude": lon,
        }

    def _extract_maps_website(self, selector: scrapy.Selector) -> str:
        for href in selector.css('div[role="main"] a[href^="http"]::attr(href), a[data-item-id="authority"]::attr(href)').getall():
            normalized = normalize_url(href)
            domain = domain_from_url(normalized)
            if not normalized or not domain:
                continue
            if "google." in domain or domain == "g.page" or domain.endswith(".g.page"):
                continue
            if not is_probable_html_page_url(normalized):
                continue
            return normalized
        return ""

    def _extract_maps_phone(self, selector: scrapy.Selector) -> str:
        for value in selector.css('button[data-item-id^="phone:"]::attr(data-item-id), div[role="main"] a[href^="tel:"]::attr(href)').getall():
            cleaned = clean_text(value)
            if cleaned.startswith("phone:tel:"):
                phone = normalize_phone(cleaned.split("phone:tel:", 1)[1])
            elif cleaned.lower().startswith("tel:"):
                phone = normalize_phone(cleaned[4:])
            else:
                phone = normalize_phone(cleaned)
            if looks_like_company_phone(phone):
                return phone
        return ""

    def _extract_coords_from_maps_url(self, maps_url: str) -> tuple[float | None, float | None]:
        match = re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", maps_url)
        if match:
            return parse_float(match.group(1)), parse_float(match.group(2))
        return None, None

    def _extract_maps_category(self, selector: scrapy.Selector, body_text: str) -> str:
        chips = [
            clean_text(item)
            for item in selector.css('div[role="main"] button *::text, div[role="main"] button::text').getall()
        ]
        for chip in chips:
            lowered = chip.lower()
            if lowered in {"overview", "about", "directions", "save", "nearby", "send to phone", "share"}:
                continue
            if 2 <= len(chip.split()) <= 6 and (
                lowered.endswith("company")
                or lowered.endswith("service")
                or lowered.endswith("agency")
                or lowered.endswith("manufacturer")
                or lowered.endswith("consultant")
            ):
                return chip
        category_match = re.search(r"(Software company|Manufacturer|Marketing agency|Consultant|Business center)", body_text, re.IGNORECASE)
        return clean_text(category_match.group(1)) if category_match else "Google Maps listing"

    def _extract_maps_address(self, selector: scrapy.Selector, body_text: str, location: LocationContext) -> str:
        for raw in selector.css('button[data-item-id="address"]::attr(aria-label), button[data-item-id="address"] *::text, button[data-item-id="address"]::text').getall():
            cleaned = clean_text(raw)
            cleaned = re.sub(r"^Address:\s*", "", cleaned, flags=re.IGNORECASE)
            if cleaned and cleaned.lower() not in {"india", location.country.lower()} and "google apps" not in cleaned.lower():
                return cleaned
        return self._extract_address_from_text(body_text, location)

    def _extract_address_from_text(self, body_text: str, location: LocationContext) -> str:
        address_match = re.search(r"Address:\s*(.{10,180}?)\s*$", body_text, flags=re.IGNORECASE)
        if address_match:
            address = clean_text(address_match.group(1))
            if address and "google apps" not in address.lower():
                return address
        match = re.search(
            r"Address\s+(.{10,180}?)(?:\s+(?:Hours|Open|Phone|Website|Directions|Suggest an edit)\b|$)",
            body_text,
            flags=re.IGNORECASE,
        )
        if match:
            address = clean_text(match.group(1))
            if address and address.lower() not in {"india", location.country.lower()} and "google apps" not in address.lower():
                return address
        return ", ".join(part for part in [location.city, location.state, location.country] if part)

    def _discovery_query(self, location: LocationContext) -> str:
        parts = [self.default_query]
        if location.city:
            parts.append(location.city)
        if location.state:
            parts.append(location.state)
        return " ".join(part for part in parts if clean_text(part))

    def _nearby_search_text(self, location: LocationContext) -> str:
        query = self.default_query
        if query.lower() == "company":
            query = "companies"
        return " ".join(part for part in [query, "near", location.search_text()] if clean_text(part))


def parse_sources(value: str) -> list[str]:
    sources = [clean_text(item).lower() for item in value.split(",") if clean_text(item)]
    return sources or list(DEFAULT_SOURCE_ORDER)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Lead generation scraper with IndiaMART, Google Maps, website, Zauba, and Google enrichment.")
    parser.add_argument("--radius-km", type=int, default=15, help="Search radius in kilometers")
    parser.add_argument("--sources", default=",".join(DEFAULT_SOURCE_ORDER), help="Comma-separated source keys")
    parser.add_argument("--limit", type=int, default=20, help="Maximum raw results per source")
    parser.add_argument("--min-score", type=int, default=40, help="Minimum quality score to keep a lead")
    parser.add_argument("--city", default="", help="Optional city override")
    parser.add_argument("--state", default="", help="Optional state override")
    parser.add_argument("--country", default=DEFAULT_COUNTRY, help="Optional country override")
    parser.add_argument("--latitude", type=float, default=None, help="Optional latitude override")
    parser.add_argument("--longitude", type=float, default=None, help="Optional longitude override")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    app = LeadScraperApp()
    if args.latitude is not None and args.longitude is not None:
        location = resolve_location_context(
            radius_km=args.radius_km,
            latitude=args.latitude,
            longitude=args.longitude,
            city=args.city,
            state=args.state,
            country=args.country,
        )
    elif clean_text(args.city) or clean_text(args.state):
        location = resolve_location_context(radius_km=args.radius_km, city=args.city, state=args.state, country=args.country)
    else:
        location = resolve_auto_location_context(radius_km=args.radius_km)
    result = app.process_sources(
        sources=parse_sources(args.sources),
        location=location,
        limit=max(1, int(args.limit)),
        min_score=max(0, int(args.min_score)),
    )
    print(json.dumps(json_ready(result), indent=2))


if __name__ == "__main__":
    main()
