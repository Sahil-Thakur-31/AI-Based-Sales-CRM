from __future__ import annotations

import argparse
from collections import Counter, deque
import json
import math
import os
from pathlib import Path
import re
import socket
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from functools import lru_cache
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from urllib.robotparser import RobotFileParser
import xml.etree.ElementTree as ET

import requests
from bson import ObjectId
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


def env_value(name: str, fallback: str = "") -> str:
    return os.getenv(name, BACKEND_ENV.get(name, fallback)).strip()


def parse_database_name(mongo_uri: str) -> str:
    parsed = urlparse(mongo_uri)
    path = parsed.path.strip("/")
    if not path:
        return ""
    return path.split("/", 1)[0]


BASE_DIR = Path(__file__).resolve().parent
BACKEND_ENV = load_env_file(BASE_DIR.parent / ".env")
DEFAULT_MONGO_URI = "mongodb://localhost:27017/"
MONGO_URI = env_value("SCRAPER_CONN", env_value("CONN", DEFAULT_MONGO_URI))
DATABASE_NAME = env_value("SCRAPER_DB_NAME", parse_database_name(MONGO_URI) or "event_intelligence")
COLLECTION_NAME = env_value("SCRAPER_COLLECTION_NAME", "scraped_events")
CRM_EVENTS_COLLECTION_NAME = env_value("SCRAPER_TARGET_COLLECTION_NAME", "events")
PREDICTHQ_API_KEY = env_value("PREDICTHQ_API_KEY", env_value("SCRAPER_PREDICTHQ_API_KEY", ""))

JSON_LD_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)

EVENT_LINK_KEYWORDS = (
    "event",
    "events",
    "expo",
    "exhibition",
    "summit",
    "conference",
    "trade-show",
    "tradeshow",
    "tradefair",
    "fair",
    "show",
    "webinar",
    "tickets",
)

CRAWL_LINK_KEYWORDS = (
    "event",
    "events",
    "calendar",
    "conference",
    "expo",
    "exhibition",
    "summit",
    "trade-show",
    "tradeshow",
    "tradefair",
    "show",
    "webinar",
    "upcoming",
    "industry",
    "category",
)

BLOCKED_LINK_KEYWORDS = (
    "blog",
    "signin",
    "signup",
    "login",
    "checkpoint",
    "password-reset",
    "request-password-reset",
    "support",
    "help",
    "about",
    "contact",
    "privacy",
    "terms",
    "organizer",
    "ads",
    "business",
    "features",
    "mytickets",
    "create",
)

SOURCE_DEFINITIONS = {
    "predicthq": {
        "label": "PredictHQ",
        "mode": "api",
        "prefer_listing": True,
    },
    "meetup": {
        "label": "Meetup",
        "mode": "scrape",
        "prefer_listing": True,
    },
    "eventbrite": {
        "label": "Eventbrite",
        "mode": "scrape",
        "prefer_listing": True,
    },
    "mccia": {
        "label": "MCCIA",
        "mode": "scrape",
        "fallback_url": "https://mcciapune.com/events/events-landing-page/",
        "prefer_listing": True,
    },
    "nasscom": {
        "label": "NASSCOM",
        "mode": "scrape",
        "fallback_url": "https://nasscom.in/events",
        "prefer_listing": True,
    },
    "mea": {
        "label": "MEA",
        "mode": "scrape",
        "fallback_url": "https://www.meainternationalexpo.com/",
    },
}

MIN_EVENT_LEAD_DAYS = 10
DEFAULT_TARGET_RADIUS_KM = 500
ORGANIZATION_COLLECTION_NAME = env_value("SCRAPER_ORGANIZATION_COLLECTION_NAME", "organization")
LOCATION_COLLECTION_NAME = env_value("SCRAPER_LOCATION_COLLECTION_NAME", "location")
INDUSTRY_COLLECTION_NAME = env_value("SCRAPER_INDUSTRY_COLLECTION_NAME", "industries")
GEOCODE_ENDPOINT = env_value("SCRAPER_GEOCODE_ENDPOINT", "https://nominatim.openstreetmap.org/search")
LOCAL_ML_MAX_TRAINING_EVENTS = 2000
LOCAL_ML_MIN_POSITIVE_EVENTS = 5
LOCAL_ML_MIN_NEGATIVE_EVENTS = 8
LOCAL_ML_NEGATIVE_EVENT_AGE_DAYS = 21
LOCAL_ML_MAX_BLEND_WEIGHT = 0.35
LOCAL_ML_MIN_FEATURES = 3
ROI_BENCHMARK_MIN_ROWS = 3
ROI_BENCHMARK_MIN_GROUP_COUNT = 2
ROI_BENCHMARK_MAX_CONFIDENCE = 90
ML_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "into",
    "your",
    "this",
    "that",
    "will",
    "are",
    "you",
    "our",
    "their",
    "about",
    "event",
    "events",
    "expo",
    "conference",
    "summit",
    "show",
    "meetup",
}


def clean_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", unescape(value or "")).strip()


def parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, dict) and "$date" in value:
        return parse_datetime(value["$date"])
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        pass
    try:
        return parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None


def parse_float(value: Any) -> float | None:
    if value in {None, ""}:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def slug_tokens(*parts: str) -> set[str]:
    text = " ".join(part.lower() for part in parts if part)
    return set(re.findall(r"[a-z0-9]+", text))


def ml_tokens(*parts: str) -> set[str]:
    text = " ".join(str(part or "").lower() for part in parts if part)
    tokens = set(re.findall(r"[a-z0-9][a-z0-9+#-]{1,30}", text))
    return {
        token
        for token in tokens
        if token not in ML_STOPWORDS and not token.isdigit()
    }


def logistic(value: float) -> float:
    clipped = max(min(value, 12.0), -12.0)
    return 1.0 / (1.0 + math.exp(-clipped))


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


def country_display_name(value: str | None) -> str:
    code = clean_text(value).upper()
    mapping = {
        "IN": "India",
        "US": "United States",
        "CA": "Canada",
        "GB": "United Kingdom",
        "AU": "Australia",
    }
    return mapping.get(code, clean_text(value))


def slugify_fragment(value: str) -> str:
    lowered = clean_text(value).lower()
    return re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")


def country_search_code(value: str | None) -> str:
    normalized = clean_text(value).lower()
    mapping = {
        "india": "IN",
        "ind": "IN",
        "in": "IN",
        "united states": "US",
        "usa": "US",
        "us": "US",
        "canada": "CA",
        "ca": "CA",
        "australia": "AU",
        "au": "AU",
        "united kingdom": "GB",
        "uk": "GB",
        "gb": "GB",
    }
    return mapping.get(normalized, clean_text(value).upper()[:2] if len(clean_text(value)) == 2 else "")


@dataclass
class TargetLocationContext:
    address: str = ""
    area: str = ""
    city: str = ""
    district: str = ""
    state: str = ""
    country: str = ""
    pincode: str = ""
    latitude: float | None = None
    longitude: float | None = None
    radius_km: int = DEFAULT_TARGET_RADIUS_KM
    location_id: str | None = None

    def search_query(self) -> str:
        parts = [self.area, self.city, self.district, self.state, self.country, self.pincode]
        return ", ".join(part for part in dict.fromkeys(clean_text(part) for part in parts) if part)

    def within_param(self) -> str:
        if self.latitude is None or self.longitude is None:
            return ""
        return f"{self.radius_km}km@{self.latitude},{self.longitude}"

    def locality_aliases(self) -> set[str]:
        values = {
            clean_text(self.area).lower(),
            clean_text(self.city).lower(),
            clean_text(self.district).lower(),
            clean_text(self.state).lower(),
            clean_text(self.country).lower(),
            clean_text(self.pincode).lower(),
        }
        return {value for value in values if value}

    def is_configured(self) -> bool:
        return any(
            clean_text(value)
            for value in (self.address, self.area, self.city, self.district, self.state, self.country, self.pincode)
        )

    def location_match_level(self, address: str) -> str:
        lowered = clean_text(address).lower()
        if not lowered:
            return ""
        aliases = self.locality_aliases()
        locality_candidates = [alias for alias in aliases if alias not in {clean_text(self.country).lower(), clean_text(self.state).lower()}]
        if any(alias and alias in lowered for alias in locality_candidates):
            return "local"
        if self.state and clean_text(self.state).lower() in lowered:
            return "state"
        if self.country and clean_text(self.country).lower() in lowered:
            return "country"
        return ""


@lru_cache(maxsize=512)
def _geocode_location(query: str) -> tuple[float | None, float | None]:
    cleaned = clean_text(query)
    if not cleaned:
        return None, None
    try:
        response = requests.get(
            GEOCODE_ENDPOINT,
            params={"q": cleaned, "format": "jsonv2", "limit": 1},
            headers={"User-Agent": "AIBasedSalesCRM-EventScraper/1.0"},
            timeout=20,
        )
        response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list) or not rows:
            return None, None
        latitude = float(rows[0].get("lat")) if rows[0].get("lat") is not None else None
        longitude = float(rows[0].get("lon")) if rows[0].get("lon") is not None else None
        return latitude, longitude
    except (requests.RequestException, TypeError, ValueError, json.JSONDecodeError):
        return None, None


def haversine_distance_km(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    earth_radius_km = 6371.0
    lat1 = math.radians(latitude_a)
    lon1 = math.radians(longitude_a)
    lat2 = math.radians(latitude_b)
    lon2 = math.radians(longitude_b)
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    haversine = (
        math.sin(delta_lat / 2.0) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2.0) ** 2
    )
    return 2.0 * earth_radius_km * math.asin(math.sqrt(max(0.0, min(1.0, haversine))))


def _resolve_target_location_context() -> TargetLocationContext:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    try:
        database = client[DATABASE_NAME]
        organization = database[ORGANIZATION_COLLECTION_NAME].find_one(
            {"is_deleted": {"$ne": True}},
            sort=[("updatedAt", -1), ("createdAt", -1)],
        )
        if not organization:
            return TargetLocationContext()

        city = clean_text(organization.get("city"))
        district = clean_text(organization.get("district"))
        state = clean_text(organization.get("state"))
        country = clean_text(organization.get("country"))
        pincode = clean_text(organization.get("pincode"))
        area = clean_text(organization.get("area"))
        address = clean_text(organization.get("address"))
        latitude = parse_float(organization.get("latitude"))
        longitude = parse_float(organization.get("longitude"))

        location_collection = database[LOCATION_COLLECTION_NAME]
        location_document = None
        location_filters: list[dict[str, Any]] = []
        if pincode:
            location_filters.append({"pincode": pincode})
        if city:
            city_regex = {"$regex": f"^{re.escape(city)}$", "$options": "i"}
            filter_doc: dict[str, Any] = {"city": city_regex}
            if state:
                filter_doc["$or"] = [
                    {"state": {"$regex": f"^{re.escape(state)}$", "$options": "i"}},
                    {"State": {"$regex": f"^{re.escape(state)}$", "$options": "i"}},
                ]
            location_filters.append(filter_doc)
        for filter_doc in location_filters:
            location_document = location_collection.find_one(filter_doc)
            if location_document:
                break

        city = city or clean_text(location_document.get("city") if location_document else "")
        district = district or clean_text(location_document.get("district") if location_document else "")
        state = state or clean_text(
            (location_document.get("state") or location_document.get("State")) if location_document else ""
        )
        country = country or clean_text(location_document.get("country") if location_document else "")
        area = area or clean_text((location_document.get("area") or location_document.get("zone")) if location_document else "")

        if latitude is None or longitude is None:
            geocode_queries = [
                ", ".join(part for part in [address, area, city, district, state, pincode, country] if part),
                ", ".join(part for part in [area, city, state, pincode, country] if part),
                ", ".join(part for part in [city, state, country] if part),
                ", ".join(part for part in [pincode, country] if part),
            ]
            latitude = longitude = None
            for query in geocode_queries:
                latitude, longitude = _geocode_location(query)
                if latitude is not None and longitude is not None:
                    break

        radius_km = DEFAULT_TARGET_RADIUS_KM
        configured_radius = clean_text(env_value("SCRAPER_TARGET_RADIUS_KM", str(DEFAULT_TARGET_RADIUS_KM)))
        try:
            if configured_radius:
                radius_km = max(25, int(float(configured_radius)))
        except ValueError:
            radius_km = DEFAULT_TARGET_RADIUS_KM

        return TargetLocationContext(
            address=address,
            area=area,
            city=city,
            district=district,
            state=state,
            country=country_display_name(country),
            pincode=pincode,
            latitude=latitude,
            longitude=longitude,
            radius_km=radius_km,
            location_id=str(location_document["_id"]) if location_document and location_document.get("_id") else None,
        )
    except Exception:
        return TargetLocationContext()
    finally:
        client.close()


TARGET_LOCATION_CONTEXT = _resolve_target_location_context()


def _industry_slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", clean_text(value).lower()).strip("_")


def _description_terms(value: str) -> list[str]:
    cleaned = clean_text(value).lower()
    if not cleaned:
        return []
    if cleaned.startswith("imported from scraper sync on"):
        return []
    stopwords = {"imported", "from", "scraper", "sync", "events", "event", "industry", "at", "on", "for"}
    phrase_chunks = [clean_text(part).lower() for part in re.split(r"[|,;/]+", cleaned) if clean_text(part)]
    tokens = [
        token
        for token in re.findall(r"[a-z0-9][a-z0-9+#-]{1,30}", cleaned)
        if len(token) >= 3 and token not in stopwords
    ]
    terms: list[str] = []
    seen: set[str] = set()
    for item in [*phrase_chunks, *tokens]:
        normalized = clean_text(item).lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        terms.append(normalized)
    return terms


@lru_cache(maxsize=1)
def _industry_profiles_cached() -> dict[str, dict[str, Any]]:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    try:
        database = client[DATABASE_NAME]
        rows = list(
            database[INDUSTRY_COLLECTION_NAME].find(
                {"is_deleted": {"$ne": True}},
                {"name": 1, "description": 1},
            )
        )
    except Exception:
        return {}
    finally:
        client.close()

    profiles: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = clean_text(row.get("name"))
        if not name:
            continue
        slug = _industry_slug(name)
        if not slug:
            continue
        keywords = [name.lower(), *_description_terms(str(row.get("description") or ""))]
        tokenized_name = [token for token in re.findall(r"[a-z0-9][a-z0-9+#-]{1,30}", name.lower()) if len(token) >= 2]
        keywords.extend(tokenized_name)
        deduped_keywords: list[str] = []
        seen_keywords: set[str] = set()
        for keyword in keywords:
            normalized_keyword = clean_text(keyword).lower()
            if not normalized_keyword or normalized_keyword in seen_keywords:
                continue
            seen_keywords.add(normalized_keyword)
            deduped_keywords.append(normalized_keyword)
        profiles[slug] = {
            "id": str(row.get("_id")),
            "name": name,
            "keywords": deduped_keywords,
        }
    return profiles


def _industry_profiles() -> dict[str, dict[str, Any]]:
    profiles = _industry_profiles_cached()
    if profiles:
        return profiles
    _industry_profiles_cached.cache_clear()
    return _industry_profiles_cached()


def industry_search_terms() -> tuple[str, ...]:
    profiles = _industry_profiles()
    if not profiles:
        return tuple()
    seen: set[str] = set()
    ordered: list[str] = []
    for profile in profiles.values():
        primary = clean_text(profile.get("name", "")).lower()
        if primary and primary not in seen:
            seen.add(primary)
            ordered.append(primary)
        for keyword in profile.get("keywords", []):
            normalized_keyword = clean_text(keyword).lower()
            if len(normalized_keyword) < 4 or normalized_keyword in seen:
                continue
            if " " not in normalized_keyword:
                continue
            seen.add(normalized_keyword)
            ordered.append(normalized_keyword)
            if len(ordered) >= 20:
                return tuple(ordered)
    return tuple(ordered)


def industry_id_values() -> set[str]:
    return {str(profile.get("id")) for profile in _industry_profiles().values() if profile.get("id")}


def get_source_definition(source: str) -> dict[str, Any]:
    normalized = source.strip().lower()
    if normalized not in SOURCE_DEFINITIONS:
        available = ", ".join(SOURCE_DEFINITIONS)
        raise RuntimeError(f"Unknown source '{source}'. Available sources: {available}")
    return SOURCE_DEFINITIONS[normalized]


def source_seed_urls(source: str) -> list[str]:
    config = get_source_definition(source)
    urls: list[str] = []
    search_terms = [term for term in industry_search_terms() if term][:5]
    primary_search_term = search_terms[0] if search_terms else ""
    if source == "meetup":
        params: dict[str, str] = {}
        if primary_search_term:
            params["keywords"] = primary_search_term
        location_query = TARGET_LOCATION_CONTEXT.search_query()
        if location_query:
            params["location"] = location_query
        if params:
            urls.append(f"https://www.meetup.com/find/?{urlencode(params)}")
        else:
            urls.append("https://www.meetup.com/find/")
    elif source == "eventbrite":
        city_slug = slugify_fragment(TARGET_LOCATION_CONTEXT.city)
        country_slug = slugify_fragment(TARGET_LOCATION_CONTEXT.country)
        if city_slug and country_slug:
            urls.append(f"https://www.eventbrite.com/d/{country_slug}--{city_slug}/events/")
        elif country_slug:
            urls.append(f"https://www.eventbrite.com/d/{country_slug}/events/")
        query: dict[str, str] = {}
        if primary_search_term:
            query["q"] = primary_search_term
        location_query = TARGET_LOCATION_CONTEXT.search_query()
        if location_query:
            query["loc"] = location_query
        urls.append(f"https://www.eventbrite.com/d/?{urlencode(query)}" if query else "https://www.eventbrite.com/d/")
    configured_urls = [str(item).strip() for item in config.get("fallback_urls", []) if str(item).strip()]
    for item in configured_urls:
        if item not in urls:
            urls.append(item)
    fallback = str(config.get("fallback_url", "")).strip()
    if fallback and fallback not in urls:
        urls.insert(0, fallback)
    return urls


class AnchorParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._current_href = ""
        self._current_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        attr_map = dict(attrs)
        self._current_href = attr_map.get("href") or ""
        self._current_text = []

    def handle_data(self, data: str) -> None:
        if self._current_href:
            self._current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or not self._current_href:
            return
        self.links.append((self._current_href, clean_text(" ".join(self._current_text))))
        self._current_href = ""
        self._current_text = []


@dataclass
class EventScraper:
    source: str
    request_delay_seconds: float = 0.35
    timeout_seconds: int = 25
    scraper_user_agent: str = "EventResearchBot/1.0"
    session: requests.Session = field(init=False)
    robots_parsers: dict[str, RobotFileParser | None] = field(init=False, default_factory=dict)

    def __post_init__(self) -> None:
        self.session = requests.Session()
        retry = Retry(
            total=3,
            connect=3,
            read=3,
            backoff_factor=0.8,
            status_forcelist=(403, 408, 429, 500, 502, 503, 504),
            allowed_methods=("GET",),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                "Accept": (
                    "text/html,application/xhtml+xml,application/xml;q=0.9,"
                    "image/avif,image/webp,*/*;q=0.8"
                ),
                "Accept-Language": "en-US,en;q=0.9",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "Upgrade-Insecure-Requests": "1",
            }
        )

    def fetch_html(self, url: str) -> str:
        request_url = self._prepare_request_url(url)
        if not self.can_fetch(request_url):
            raise RuntimeError(f"Fetching is disallowed by robots.txt for {url}")
        referer = self._referer_for(request_url)
        try:
            response = self.session.get(
                request_url,
                timeout=self.timeout_seconds,
                allow_redirects=True,
                headers={
                    "Referer": referer,
                    "Sec-Fetch-Site": "same-origin" if referer else "none",
                    "Sec-Fetch-Mode": "navigate",
                    "Sec-Fetch-Dest": "document",
                },
            )
            time.sleep(self.request_delay_seconds)
            if response.status_code == 403:
                raise RuntimeError(
                    f"{self.source} blocked the request with HTTP 403 for {url}. "
                    "This site likely blocks basic bot traffic."
                )
            if response.status_code >= 400:
                raise RuntimeError(f"Failed to fetch {url}: HTTP {response.status_code}")
            response.encoding = response.encoding or "utf-8"
            if self._looks_like_human_verification(response.text):
                raise RuntimeError(
                    f"{self.source} is serving a human-verification page for {url}. "
                    "Use API credentials for this source or skip the scrape fallback."
                )
            return response.text
        except requests.Timeout as exc:
            raise RuntimeError(f"Failed to fetch {url}: request timed out") from exc
        except (requests.ConnectionError, requests.RequestException, socket.timeout, TimeoutError) as exc:
            raise RuntimeError(f"Failed to fetch {url}: {exc}") from exc

    @staticmethod
    def _looks_like_human_verification(html: str) -> bool:
        lowered = html.lower()
        title_match = re.search(r"<title>(.*?)</title>", html, re.I | re.S)
        title = clean_text(title_match.group(1)).lower() if title_match else ""
        return (
            title == "human verification"
            or "verify you are human" in lowered
            or "captcha-container" in lowered
            or "awswafintegration" in lowered
            or "challenge.js" in lowered and "awswaf" in lowered
        )

    def scrape_url(self, url: str) -> dict[str, Any]:
        return self.scrape_html(self.fetch_html(url), url=url)

    def discover_event_links(self, html: str, base_url: str, limit: int = 25) -> list[str]:
        parser = AnchorParser()
        parser.feed(html)
        base_host = urlparse(base_url).netloc.lower()
        discovered: list[tuple[int, str]] = []
        seen: set[str] = set()
        for href, text in parser.links:
            absolute_url = self._normalize_url(href, base_url)
            if not absolute_url or absolute_url in seen:
                continue
            parsed = urlparse(absolute_url)
            if parsed.scheme not in {"http", "https"}:
                continue
            if base_host and parsed.netloc.lower() != base_host:
                continue
            score = self._score_candidate_link(absolute_url, text)
            if score <= 0:
                continue
            seen.add(absolute_url)
            discovered.append((score, absolute_url))
        discovered.sort(key=lambda item: (-item[0], item[1]))
        return [item[1] for item in discovered[:limit]]

    def crawl_site(self, seed_url: str, max_pages: int = 30, max_depth: int = 2, max_event_links: int = 100) -> dict[str, Any]:
        page_limit = max_pages if max_pages > 0 else 1_000_000
        depth_limit = max_depth if max_depth > 0 else 1_000_000
        event_limit = max_event_links if max_event_links > 0 else 1_000_000
        queue: deque[tuple[str, int]] = deque([(self._canonicalize_url(seed_url), 0)])
        visited_pages: set[str] = set()
        queued_pages: set[str] = {self._canonicalize_url(seed_url)}
        event_candidates: list[tuple[int, str]] = []
        seen_event_links: set[str] = set()
        discovered_from_sitemap: list[str] = []

        while queue and len(visited_pages) < page_limit and len(event_candidates) < event_limit:
            page_url, depth = queue.popleft()
            if page_url in visited_pages:
                continue
            try:
                html = self.fetch_html(page_url)
            except RuntimeError:
                visited_pages.add(page_url)
                continue
            visited_pages.add(page_url)

            for link in self.discover_event_links(html, base_url=page_url, limit=event_limit * 3):
                canonical_link = self._canonicalize_url(link)
                if canonical_link in seen_event_links:
                    continue
                seen_event_links.add(canonical_link)
                event_candidates.append((self._score_candidate_link(canonical_link, ""), canonical_link))
                if len(event_candidates) >= event_limit:
                    break

            if depth >= depth_limit:
                continue

            crawl_links = self.discover_crawl_links(html, base_url=page_url, limit=page_limit * 4)
            for crawl_url in crawl_links:
                canonical_crawl_url = self._canonicalize_url(crawl_url)
                if canonical_crawl_url in visited_pages or canonical_crawl_url in queued_pages:
                    continue
                queued_pages.add(canonical_crawl_url)
                queue.append((canonical_crawl_url, depth + 1))

        if not event_candidates:
            discovered_from_sitemap = self.discover_sitemap_links(seed_url, limit=event_limit)
            for sitemap_url in discovered_from_sitemap:
                if sitemap_url not in seen_event_links:
                    seen_event_links.add(sitemap_url)
                    event_candidates.append((self._score_candidate_link(sitemap_url, ""), sitemap_url))

        event_candidates.sort(key=lambda item: (-item[0], item[1]))
        return {
            "candidateLinks": [url for _, url in event_candidates[:event_limit]],
            "pagesVisited": sorted(visited_pages),
            "sitemapLinks": discovered_from_sitemap,
        }

    def discover_crawl_links(self, html: str, base_url: str, limit: int = 50) -> list[str]:
        parser = AnchorParser()
        parser.feed(html)
        base_host = urlparse(base_url).netloc.lower()
        discovered: list[tuple[int, str]] = []
        seen: set[str] = set()
        for href, text in parser.links:
            absolute_url = self._normalize_url(href, base_url)
            if not absolute_url or absolute_url in seen:
                continue
            parsed = urlparse(absolute_url)
            if parsed.scheme not in {"http", "https"}:
                continue
            if base_host and parsed.netloc.lower() != base_host:
                continue
            score = self._score_crawl_link(absolute_url, text)
            if score <= 0:
                continue
            seen.add(absolute_url)
            discovered.append((score, absolute_url))
        discovered.sort(key=lambda item: (-item[0], item[1]))
        return [url for _, url in discovered[:limit]]

    def discover_sitemap_links(self, seed_url: str, limit: int = 100) -> list[str]:
        sitemap_urls = self._sitemap_locations(seed_url)
        discovered: list[str] = []
        seen: set[str] = set()
        queue: deque[str] = deque(sitemap_urls)
        while queue and len(discovered) < limit:
            sitemap_url = queue.popleft()
            if sitemap_url in seen or not self.can_fetch(sitemap_url):
                continue
            seen.add(sitemap_url)
            try:
                response_text = self.fetch_html(sitemap_url)
            except RuntimeError:
                continue
            try:
                root = ET.fromstring(response_text)
            except ET.ParseError:
                continue
            tag = root.tag.lower()
            if tag.endswith("sitemapindex"):
                for loc in root.findall(".//{*}loc"):
                    child_url = clean_text(loc.text)
                    if child_url and child_url not in seen:
                        queue.append(child_url)
                continue
            for loc in root.findall(".//{*}loc"):
                page_url = self._canonicalize_url(clean_text(loc.text))
                if not page_url:
                    continue
                if self._score_candidate_link(page_url, "") > 0 and page_url not in discovered:
                    discovered.append(page_url)
                if len(discovered) >= limit:
                    break
        return discovered[:limit]

    def scrape_html(self, html: str, url: str = "") -> dict[str, Any]:
        event = self._extract_source_specific_event(html, url)
        if not event:
            payload = self._extract_event_json(html) or self._extract_next_data_event_json(html) or {}
            plain_text = self._plain_text(html)
            registration_fee, registration_currency = self._extract_fee_info(payload)
            text_fee, text_currency = self._extract_fee_info_from_text(plain_text)
            if self.source == "eventbrite" and text_fee is not None:
                registration_fee = text_fee
                registration_currency = text_currency or registration_currency
            elif registration_fee is None and text_fee is not None:
                registration_fee = text_fee
                registration_currency = text_currency or registration_currency
            elif not registration_currency and text_currency:
                registration_currency = text_currency
            attendees_count = self._extract_int(payload, ("attendeesCount", "attendance", "maximumAttendeeCapacity"))
            if attendees_count is None:
                attendees_count = self._extract_attendees_count(html, plain_text)
            location = payload.get("location") or {}
            address = self._stringify_address(location.get("address")) if isinstance(location, dict) else ""
            venue_name = clean_text(location.get("name") if isinstance(location, dict) else "")
            attendance_mode = clean_text(str(payload.get("eventAttendanceMode", ""))).lower()
            location_type = clean_text(str(location.get("@type", ""))).lower() if isinstance(location, dict) else ""
            is_online = "online" in attendance_mode or location_type == "virtuallocation"
            if is_online and not venue_name:
                venue_name = "Online"
            if is_online and not address:
                address = "Online"
            event = {
                "source": self.source,
                "websiteUrl": url,
                "name": clean_text(payload.get("name")),
                "description": clean_text(payload.get("description")),
                "venue": venue_name,
                "address": clean_text(address),
                "startDate": parse_datetime(payload.get("startDate")),
                "endDate": parse_datetime(payload.get("endDate")),
                "registrationFee": registration_fee,
                "registrationCurrency": registration_currency,
                "attendeesCount": attendees_count,
                "exhibitorsCount": self._extract_int(payload, ("exhibitorsCount",)),
                "tags": self._extract_tags(payload),
                "sponsors": self._extract_sponsors(payload),
            }
        if not event["name"]:
            raise RuntimeError(
                f"No event data could be extracted for source={self.source} url={url}. "
                "The current scraper could not recognize a usable event structure on this page."
            )
        return event

    def _extract_source_specific_event(self, html: str, url: str) -> dict[str, Any] | None:
        if self.source == "mccia":
            return self._extract_mccia_event(html, url)
        if self.source == "nasscom":
            return self._extract_nasscom_event(html, url)
        if self.source == "mea":
            return self._extract_mea_event(html, url)
        return None

    def extract_listing_events(self, html: str, url: str, limit: int = 20) -> list[dict[str, Any]]:
        if self.source == "nasscom" and self._canonicalize_url(url).endswith("/events"):
            return self._extract_nasscom_listing_events(html, url, limit)
        return []

    def _extract_mccia_event(self, html: str, url: str) -> dict[str, Any] | None:
        if "label-value" not in html.lower():
            return None
        text = self._plain_text(html)
        values = [
            clean_text(re.sub(r"<[^>]+>", " ", value))
            for value in re.findall(r'label-value[^>]*>(.*?)</', html, re.I | re.S)
        ]
        date_text = values[0] if values else ""
        venue_text = values[2] if len(values) > 2 else ""
        name_match = re.search(
            r"([A-Z][A-Za-z0-9&(),/\\ -]{4,120}?)\s+(?:Register|MAHRATTA CHAMBER OF COMMERCE)",
            text,
        )
        event_name = clean_text(name_match.group(1)) if name_match else ""
        year_match = re.search(r"\b(20\d{2})\b", event_name)
        year = int(year_match.group(1)) if year_match else datetime.now(timezone.utc).year
        start_date, end_date = self._parse_month_day_range(date_text, year)
        if not event_name:
            return None
        registration_fee, registration_currency = self._extract_fee_info_from_text(text)
        return {
            "source": self.source,
            "websiteUrl": url,
            "name": event_name,
            "description": clean_text(f"MCCIA event at {venue_text}") if venue_text else "MCCIA event",
            "venue": clean_text(venue_text.removeprefix("at ").strip()),
            "address": clean_text(venue_text.removeprefix("at ").strip()),
            "startDate": start_date,
            "endDate": end_date,
            "registrationFee": registration_fee,
            "registrationCurrency": registration_currency,
            "attendeesCount": None,
            "exhibitorsCount": None,
            "tags": [tag for tag in ("expo", "mccia", "business") if tag in text.lower()],
            "sponsors": [],
        }

    def _extract_nasscom_event(self, html: str, url: str) -> dict[str, Any] | None:
        if "nasscom" not in html.lower():
            return None
        text = self._plain_text(html)
        name = (
            self._extract_meta_content(html, "property", "og:title")
            or self._extract_first_match(html, r"<h1[^>]*>(.*?)</h1>")
            or self._extract_first_match(html, r"<title>(.*?)</title>")
        )
        cleaned_name = clean_text(name.replace("| nasscom", "")) if name else ""
        canonical_url = EventScraper._canonicalize_url(url)
        if canonical_url.endswith("/events") or cleaned_name.lower() == "events & awards":
            return None
        description = self._extract_meta_content(html, "name", "description")
        date_matches = re.findall(
            r"(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Za-z]+)\s+(\d{1,2})\s*(?:st|nd|rd|th)?\s*,?\s*(20\d{2})",
            text,
            re.I,
        )
        start_date = end_date = None
        if date_matches:
            parsed = []
            for _, month, day, year in date_matches[:2]:
                parsed_date = self._parse_text_date(f"{month} {day} {year}")
                if parsed_date:
                    parsed.append(parsed_date)
            if parsed:
                start_date = parsed[0]
                end_date = parsed[-1]
        venue = ""
        address = ""
        venue_after_date = re.search(
            r"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Za-z]+\s+\d{1,2}\s*(?:st|nd|rd|th)?\s*,?\s*20\d{2}\s+([A-Z][A-Za-z0-9&().,\- ]+?)(?:\s+This\b|\s+The\b|\s+Membership\b|\s+Login\b)",
            text,
            re.I,
        )
        if venue_after_date:
            venue = self._clean_nasscom_venue(venue_after_date.group(1))
            address = venue
        if not venue:
            city_patterns = [
                re.escape(clean_text(TARGET_LOCATION_CONTEXT.city)),
                re.escape(clean_text(TARGET_LOCATION_CONTEXT.district)),
                re.escape(clean_text(TARGET_LOCATION_CONTEXT.state)),
            ]
            city_patterns = [item for item in city_patterns if item]
            venue_pattern = (
                r"\b([A-Z][A-Za-z&.\- ]+, (?:"
                + "|".join(city_patterns)
                + r"|[A-Z][A-Za-z.\- ]{2,40}))\b"
            ) if city_patterns else r"\b([A-Z][A-Za-z&.\- ]+, [A-Z][A-Za-z.\- ]{2,40})\b"
            venue_match = re.search(venue_pattern, text)
            venue = self._clean_nasscom_venue(venue_match.group(1)) if venue_match else ""
            address = venue
        registration_fee, registration_currency = self._extract_fee_info_from_text(text)
        return {
            "source": self.source,
            "websiteUrl": url,
            "name": cleaned_name,
            "description": clean_text(description),
            "venue": venue,
            "address": address,
            "startDate": start_date,
            "endDate": end_date,
            "registrationFee": registration_fee,
            "registrationCurrency": registration_currency,
            "attendeesCount": self._first_int_in_text(description),
            "exhibitorsCount": None,
            "tags": ["nasscom", "technology", "leadership"],
            "sponsors": [],
        }

    @staticmethod
    def _clean_nasscom_venue(value: str) -> str:
        cleaned = clean_text(value)
        cleaned = re.split(
            r"\b(?:This|During|Membership|Login|Register|Nasscom is hosting|As part of|The India AI Impact)\b",
            cleaned,
            maxsplit=1,
        )[0]
        return cleaned.strip(" ,.-")

    def _extract_nasscom_listing_events(self, html: str, url: str, limit: int) -> list[dict[str, Any]]:
        pattern = re.compile(
            r'<div class="perspectives_card">.*?<a href="(?P<url>https://nasscom\.in/[^"]+)"[^>]*>.*?'
            r'<h3 class="job_title">\s*<a [^>]*>(?P<title>.*?)</a>\s*</h3>.*?'
            r'<p class="job_desc">\s*(?P<desc>.*?)\s*</p>.*?'
            r'<div class="postdate">\s*(?P<date>.*?)\s*</div>.*?'
            r'<div class="city">\s*(?P<city>.*?)\s*</div>',
            re.I | re.S,
        )
        results: list[dict[str, Any]] = []
        seen: set[str] = set()
        for match in pattern.finditer(html):
            event_url = self._normalize_url(match.group("url"), url)
            if not event_url or event_url in seen:
                continue
            title = clean_text(re.sub(r"<[^>]+>", " ", match.group("title")))
            description = clean_text(re.sub(r"<[^>]+>", " ", match.group("desc")))
            city = clean_text(re.sub(r"<[^>]+>", " ", match.group("city")))
            start_date = self._parse_text_date(clean_text(match.group("date")))
            if not title or not start_date:
                continue
            registration_fee, registration_currency = self._extract_fee_info_from_text(description)
            seen.add(event_url)
            results.append(
                {
                    "source": self.source,
                    "websiteUrl": event_url,
                    "name": title,
                    "description": description,
                    "venue": city,
                    "address": city,
                    "startDate": start_date,
                    "endDate": start_date,
                    "registrationFee": registration_fee,
                    "registrationCurrency": registration_currency,
                    "attendeesCount": self._first_int_in_text(description),
                    "exhibitorsCount": None,
                    "tags": ["nasscom", "technology", "leadership"],
                    "sponsors": [],
                }
            )
            if len(results) >= limit:
                break
        return results

    def _extract_mea_event(self, html: str, url: str) -> dict[str, Any] | None:
        text = self._plain_text(html)
        if "mea international business expo" not in text.lower():
            return None
        name = self._extract_first_match(html, r"<title>(.*?)</title>")
        description_match = re.search(
            r"(MEA INTERNATIONAL BUSINESS EXPO 20\d{2}.*?global markets, investors and opportunities\.)",
            text,
            re.I,
        )
        location_match = re.search(r"Location\s+(.+?(?:India|\d{6}))", text, re.I)
        address = clean_text(location_match.group(1)) if location_match else ""
        registration_fee, registration_currency = self._extract_fee_info_from_text(text)
        start_date, end_date = self._extract_mea_date_range(text)
        return {
            "source": self.source,
            "websiteUrl": url,
            "name": clean_text(name),
            "description": clean_text(description_match.group(1) if description_match else "MEA international business expo"),
            "venue": "Vikram Monarch" if "Vikram Monarch" in text else "",
            "address": address,
            "startDate": start_date,
            "endDate": end_date,
            "registrationFee": registration_fee,
            "registrationCurrency": registration_currency,
            "attendeesCount": None,
            "exhibitorsCount": None,
            "tags": ["expo", "business", "mea"],
            "sponsors": [],
        }

    @staticmethod
    def _extract_mea_date_range(text: str) -> tuple[datetime | None, datetime | None]:
        cleaned = clean_text(text.replace(",", " "))
        patterns = [
            r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(?:to|-)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(20\d{2})",
            r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(?:to|-)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(20\d{2})",
            r"([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\s+(?:to|-)\s+([A-Za-z]{3,9}\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(20\d{2})",
        ]
        for pattern in patterns:
            match = re.search(pattern, cleaned, re.I)
            if not match:
                continue
            if len(match.groups()) == 5 and match.group(1).isdigit():
                start_day, start_month, end_day, end_month_or_year, maybe_year = match.groups()
                if end_month_or_year.isdigit():
                    end_month = start_month
                    year = end_month_or_year
                else:
                    end_month = end_month_or_year
                    year = maybe_year
                start = EventScraper._parse_text_date(f"{start_day} {start_month} {year}")
                end = EventScraper._parse_text_date(f"{end_day} {end_month} {year}")
                if start:
                    return start, end or start
            elif len(match.groups()) == 5:
                start_month, start_day, end_month, end_day, year = match.groups()
                resolved_end_month = clean_text(end_month or start_month)
                start = EventScraper._parse_text_date(f"{start_month} {start_day} {year}")
                end = EventScraper._parse_text_date(f"{resolved_end_month} {end_day} {year}")
                if start:
                    return start, end or start
        for year in re.findall(r"\b(20\d{2})\b", cleaned):
            single = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})", cleaned, re.I)
            if single:
                start = EventScraper._parse_text_date(f"{single.group(1)} {single.group(2)} {year}")
                if start:
                    return start, start
            single = re.search(r"([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?", cleaned, re.I)
            if single:
                start = EventScraper._parse_text_date(f"{single.group(1)} {single.group(2)} {year}")
                if start:
                    return start, start
        return None, None

    @staticmethod
    def _extract_meta_content(html: str, attr_name: str, attr_value: str) -> str:
        pattern = rf'<meta[^>]+{attr_name}=["\']{re.escape(attr_value)}["\'][^>]+content=["\']([^"\']+)["\']'
        match = re.search(pattern, html, re.I | re.S)
        return clean_text(match.group(1)) if match else ""

    @staticmethod
    def _extract_first_match(html: str, pattern: str) -> str:
        match = re.search(pattern, html, re.I | re.S)
        if not match:
            return ""
        return clean_text(re.sub(r"<[^>]+>", " ", match.group(1)))

    @staticmethod
    def _plain_text(html: str) -> str:
        text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", html, flags=re.I | re.S)
        text = re.sub(r"<[^>]+>", " ", text)
        return clean_text(text)

    @staticmethod
    def _first_int_in_text(text: str) -> int | None:
        match = re.search(r"\b(\d{3,6})\+?\b", text)
        return int(match.group(1)) if match else None

    @staticmethod
    def _parse_month_day_range(text: str, year: int) -> tuple[datetime | None, datetime | None]:
        cleaned = clean_text(text.replace(",", " "))
        match = re.search(r"([A-Za-z]{3,9})\s+(\d{1,2})\s+to\s+([A-Za-z]{3,9}\s+)?(\d{1,2})", cleaned, re.I)
        if not match:
            single = re.search(r"([A-Za-z]{3,9})\s+(\d{1,2})", cleaned, re.I)
            if not single:
                return None, None
            start = EventScraper._parse_text_date(f"{single.group(1)} {single.group(2)} {year}")
            return start, start
        start_month = match.group(1)
        start_day = match.group(2)
        end_month = clean_text(match.group(3) or start_month)
        end_day = match.group(4)
        start = EventScraper._parse_text_date(f"{start_month} {start_day} {year}")
        end = EventScraper._parse_text_date(f"{end_month} {end_day} {year}")
        return start, end

    @staticmethod
    def _parse_text_date(value: str) -> datetime | None:
        cleaned = clean_text(value).replace(",", "")
        for pattern in ("%b %d %Y", "%B %d %Y", "%d %b %Y", "%d %B %Y"):
            try:
                return datetime.strptime(cleaned, pattern).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
        return parse_datetime(cleaned)

    @staticmethod
    def _normalize_url(href: str, base_url: str) -> str:
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            return ""
        return EventScraper._canonicalize_url(urljoin(base_url, href))

    @staticmethod
    def _canonicalize_url(url: str) -> str:
        if not url:
            return ""
        parsed = urlparse(url)
        query_items = []
        for key, value in parse_qsl(parsed.query, keep_blank_values=True):
            lowered = key.lower()
            if lowered.startswith("utm_") or lowered in {"aff", "ref", "trk", "fbclid", "gclid", "session_redirect"}:
                continue
            query_items.append((key, value))
        cleaned_query = urlencode(query_items)
        cleaned = parsed._replace(fragment="", params="", query=cleaned_query)
        return urlunparse(cleaned).rstrip("/")

    def _prepare_request_url(self, url: str) -> str:
        parsed = urlparse(url)
        if self.source == "eventbrite" and parsed.path.startswith("/e/"):
            return urlunparse(parsed._replace(query=""))
        return url

    @staticmethod
    def _referer_for(url: str) -> str:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return ""
        return f"{parsed.scheme}://{parsed.netloc}/"

    def _score_candidate_link(self, absolute_url: str, anchor_text: str) -> int:
        lowered_url = absolute_url.lower()
        lowered_text = anchor_text.lower()
        haystack = f"{lowered_url} {lowered_text}"
        if any(keyword in haystack for keyword in BLOCKED_LINK_KEYWORDS):
            return 0
        if self.source == "eventbrite":
            return self._score_eventbrite_link(lowered_url, lowered_text)
        score = 0
        for keyword in EVENT_LINK_KEYWORDS:
            if keyword in lowered_url:
                score += 3
            if keyword in lowered_text:
                score += 1
        return score

    def _score_crawl_link(self, absolute_url: str, anchor_text: str) -> int:
        lowered_url = absolute_url.lower()
        lowered_text = anchor_text.lower()
        haystack = f"{lowered_url} {lowered_text}"
        if any(keyword in haystack for keyword in BLOCKED_LINK_KEYWORDS):
            return 0
        score = 0
        for keyword in CRAWL_LINK_KEYWORDS:
            if keyword in lowered_url:
                score += 2
            if keyword in lowered_text:
                score += 1
        return score

    @staticmethod
    def _score_eventbrite_link(lowered_url: str, lowered_text: str) -> int:
        if "/e/" not in lowered_url:
            return 0
        score = 8
        if "tickets-" in lowered_url:
            score += 6
        if "registration-" in lowered_url:
            score += 6
        if "/d/" in lowered_url:
            score -= 4
        if any(word in lowered_text for word in ("summit", "conference", "expo", "workshop", "event")):
            score += 2
        return max(score, 0)

    def _extract_event_json(self, html: str) -> dict[str, Any] | None:
        for match in JSON_LD_RE.finditer(html):
            try:
                parsed = json.loads(match.group(1).strip())
            except json.JSONDecodeError:
                continue
            found = self._find_event(parsed)
            if found:
                return found
        return None

    def can_fetch(self, url: str) -> bool:
        parsed = urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        if base not in self.robots_parsers:
            self.robots_parsers[base] = self._load_robots_parser(base)
        parser = self.robots_parsers[base]
        if parser is None:
            return True
        try:
            return parser.can_fetch(self.scraper_user_agent, url)
        except Exception:  # noqa: BLE001
            return True

    def _load_robots_parser(self, base_url: str) -> RobotFileParser | None:
        robots_url = f"{base_url}/robots.txt"
        parser = RobotFileParser()
        try:
            response = self.session.get(robots_url, timeout=10, allow_redirects=True)
            if response.status_code >= 400:
                return None
            parser.parse(response.text.splitlines())
            return parser
        except requests.RequestException:
            return None

    def _sitemap_locations(self, seed_url: str) -> list[str]:
        parsed = urlparse(seed_url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        default = f"{base}/sitemap.xml"
        parser = self.robots_parsers.get(base)
        if parser is None:
            parser = self._load_robots_parser(base)
            self.robots_parsers[base] = parser
        if parser is None:
            return [default]
        try:
            sites = parser.site_maps() or []
        except Exception:  # noqa: BLE001
            sites = []
        return list(dict.fromkeys([*sites, default]))

    def _find_event(self, payload: Any) -> dict[str, Any] | None:
        if isinstance(payload, list):
            for item in payload:
                found = self._find_event(item)
                if found:
                    return found
            return None
        if not isinstance(payload, dict):
            return None
        type_name = payload.get("@type")
        if self._is_event_type(type_name):
            return payload
        if "@graph" in payload:
            return self._find_event(payload["@graph"])
        return None

    @staticmethod
    def _is_event_type(type_name: Any) -> bool:
        if isinstance(type_name, list):
            return any(EventScraper._is_event_type(item) for item in type_name)
        normalized = str(type_name or "").strip().lower()
        if not normalized or normalized in {"webpage", "breadcrumblist"}:
            return False
        return normalized == "event" or normalized.endswith("event")

    def _extract_next_data_event_json(self, html: str) -> dict[str, Any] | None:
        match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
        if not match:
            return None
        try:
            payload = json.loads(match.group(1))
        except json.JSONDecodeError:
            return None
        basic_info = (
            payload.get("props", {})
            .get("pageProps", {})
            .get("context", {})
            .get("basicInfo", {})
        )
        if not isinstance(basic_info, dict) or not basic_info.get("name"):
            return None
        venue = basic_info.get("venue") or {}
        venue_address = venue.get("address") or {}
        offer_payload = []
        if basic_info.get("isFree") is False:
            minimum = (
                basic_info.get("ticketPrice", {}).get("minimumTicketPrice", {}).get("majorValue")
                if isinstance(basic_info.get("ticketPrice"), dict)
                else None
            )
            if minimum is not None:
                offer_payload.append({"price": minimum})
        return {
            "@type": "BusinessEvent",
            "name": basic_info.get("name", ""),
            "description": basic_info.get("summary", ""),
            "startDate": (
                basic_info.get("startDate", {}).get("utc")
                if isinstance(basic_info.get("startDate"), dict)
                else basic_info.get("startDate")
            ),
            "endDate": (
                basic_info.get("endDate", {}).get("utc")
                if isinstance(basic_info.get("endDate"), dict)
                else basic_info.get("endDate")
            ),
            "location": {
                "@type": "Place",
                "name": venue.get("name", ""),
                "address": {
                    "streetAddress": ", ".join(venue_address.get("localizedMultiLineAddressDisplay", [])[:-1]),
                    "addressLocality": venue_address.get("city", ""),
                    "addressRegion": venue_address.get("region", ""),
                    "addressCountry": venue_address.get("country", ""),
                },
            },
            "keywords": basic_info.get("tags", []) if isinstance(basic_info.get("tags"), list) else [],
            "offers": offer_payload,
            "organizer": basic_info.get("organizer", {}),
        }

    @staticmethod
    def _stringify_address(value: Any) -> str:
        if isinstance(value, str):
            return value
        if isinstance(value, dict):
            parts = [
                value.get("streetAddress"),
                value.get("addressLocality"),
                value.get("addressRegion"),
                value.get("addressCountry"),
            ]
            return ", ".join(str(part).strip() for part in parts if part)
        return ""

    @staticmethod
    def _extract_fee_info(payload: dict[str, Any]) -> tuple[float | None, str]:
        offers = payload.get("offers")
        offer_items: list[dict[str, Any]] = []
        if isinstance(offers, dict):
            offer_items = [offers]
        elif isinstance(offers, list):
            offer_items = [item for item in offers if isinstance(item, dict)]

        for offer in offer_items:
            amount, currency = EventScraper._extract_fee_from_offer_container(offer)
            if amount is not None:
                return amount, currency
            price_spec = offer.get("priceSpecification")
            if isinstance(price_spec, dict):
                amount, currency = EventScraper._extract_fee_from_offer_container(price_spec, fallback_currency=currency)
                if amount is not None:
                    return amount, currency
            elif isinstance(price_spec, list):
                for item in price_spec:
                    if not isinstance(item, dict):
                        continue
                    amount, currency = EventScraper._extract_fee_from_offer_container(item, fallback_currency=currency)
                    if amount is not None:
                        return amount, currency
        return None, ""

    @staticmethod
    def _extract_fee_from_offer_container(container: dict[str, Any], fallback_currency: str = "") -> tuple[float | None, str]:
        currency = EventScraper._normalize_currency(
            container.get("priceCurrency") or container.get("currency") or fallback_currency
        )
        for key in ("price", "lowPrice", "highPrice"):
            try:
                value = container.get(key)
                if value is not None:
                    return float(value), currency
            except (TypeError, ValueError):
                continue
        return None, currency

    @staticmethod
    def _normalize_currency(value: Any) -> str:
        token = clean_text(str(value)).upper()
        if not token:
            return ""
        mapping = {
            "₹": "INR",
            "Â‚¹": "INR",
            "INR": "INR",
            "RS": "INR",
            "RS.": "INR",
            "RUPEES": "INR",
            "$": "USD",
            "US$": "USD",
            "USD": "USD",
            "€": "EUR",
            "EUR": "EUR",
            "£": "GBP",
            "GBP": "GBP",
        }
        return mapping.get(token, token if len(token) <= 5 else "")

    @staticmethod
    def _extract_fee_info_from_text(text: str) -> tuple[float | None, str]:
        cleaned = clean_text(text)
        if not cleaned:
            return None, ""
        free_patterns = [
            r"\bfree entry\b",
            r"\bfree registration\b",
            r"\bno registration fee\b",
            r"\bentry free\b",
            r"\bthis meetup is free\b",
            r"\bfree to attend\b",
            r"\bcomplimentary\s+(?:entry|registration|pass|ticket)\b",
        ]
        if any(re.search(pattern, cleaned, re.I) for pattern in free_patterns):
            return 0.0, ""

        inr_token = r"(?<![a-zA-Z])(?:rs\.?|inr|₹|â‚¹)(?![a-zA-Z])"
        usd_token = r"(?<![a-zA-Z])(?:us\$|usd|\$)(?![a-zA-Z])"
        eur_token = r"(?<![a-zA-Z])(?:€|eur)(?![a-zA-Z])"
        gbp_token = r"(?<![a-zA-Z])(?:£|gbp)(?![a-zA-Z])"

        prioritized_patterns = [
            (rf"discounts?\s+applied\s*{usd_token}\s*([\d,]+(?:\.\d{{1,2}})?)", "USD"),
            (rf"discounts?\s+applied\s*{inr_token}\s*([\d,]+(?:\.\d{{1,2}})?)", "INR"),
        ]
        for pattern, currency in prioritized_patterns:
            match = re.search(pattern, cleaned, re.I)
            if not match:
                continue
            try:
                return float(match.group(1).replace(",", "")), currency
            except ValueError:
                continue

        money_patterns = [
            (rf"{usd_token}\s*([\d,]+(?:\.\d{{1,2}})?)", "USD"),
            (r"([\d,]+(?:\.\d{1,2})?)\s*(?:usd)", "USD"),
            (rf"{inr_token}\s*([\d,]+(?:\.\d{{1,2}})?)", "INR"),
            (rf"([\d,]+(?:\.\d{{1,2}})?)\s*{inr_token}", "INR"),
            (rf"{eur_token}\s*([\d,]+(?:\.\d{{1,2}})?)", "EUR"),
            (r"([\d,]+(?:\.\d{1,2})?)\s*(?:eur)", "EUR"),
            (rf"{gbp_token}\s*([\d,]+(?:\.\d{{1,2}})?)", "GBP"),
            (r"([\d,]+(?:\.\d{1,2})?)\s*(?:gbp)", "GBP"),
        ]
        for pattern, currency in money_patterns:
            match = re.search(pattern, cleaned, re.I)
            if not match:
                continue
            try:
                return float(match.group(1).replace(",", "")), currency
            except ValueError:
                continue
        return None, ""

    def _extract_attendees_count(self, html: str, plain_text: str) -> int | None:
        if self.source == "meetup":
            meetup_count = self._extract_meetup_going_count(html)
            if meetup_count is not None:
                return meetup_count
        return self._extract_attendees_from_text(plain_text)

    @staticmethod
    def _extract_meetup_going_count(html: str) -> int | None:
        match = re.search(r'"goingCount"\s*:\s*\{[^{}]*"totalCount"\s*:\s*(\d+)', html, re.I | re.S)
        if match:
            return int(match.group(1))
        return None

    @staticmethod
    def _extract_attendees_from_text(text: str) -> int | None:
        cleaned = clean_text(text)
        if not cleaned:
            return None
        patterns = [
            r"\b([\d,]+)\s+(?:people\s+are\s+going|people\s+going|going)\b",
            r"\b([\d,]+)\s+(?:attendees|attending|guests|participants|registrations)\b",
            r"\bjoin\s+([\d,]+)\b",
        ]
        for pattern in patterns:
            match = re.search(pattern, cleaned, re.I)
            if not match:
                continue
            try:
                return int(match.group(1).replace(",", ""))
            except ValueError:
                continue
        return None

    @staticmethod
    def _extract_int(payload: dict[str, Any], keys: tuple[str, ...]) -> int | None:
        for key in keys:
            value = payload.get(key)
            if value is None:
                continue
            cleaned = re.sub(r"[^\d]", "", str(value))
            if cleaned:
                return int(cleaned)
        return None

    @staticmethod
    def _extract_tags(payload: dict[str, Any]) -> list[str]:
        keywords = payload.get("keywords")
        if isinstance(keywords, list):
            return [clean_text(str(item)) for item in keywords if clean_text(str(item))]
        if isinstance(keywords, str):
            return [clean_text(part) for part in keywords.split(",") if clean_text(part)]
        return []

    @staticmethod
    def _extract_sponsors(payload: dict[str, Any]) -> list[str]:
        sponsors = payload.get("sponsor")
        if isinstance(sponsors, list):
            return [clean_text(item.get("name") if isinstance(item, dict) else str(item)) for item in sponsors]
        if sponsors:
            if isinstance(sponsors, dict):
                return [clean_text(str(sponsors.get("name", "")))]
            return [clean_text(str(sponsors))]
        return []


@dataclass
class LocalEngagementMLScorer:
    mongo_uri: str = MONGO_URI
    database_name: str = DATABASE_NAME
    collection_name: str = CRM_EVENTS_COLLECTION_NAME
    max_training_events: int = LOCAL_ML_MAX_TRAINING_EVENTS
    _model: dict[str, Any] | None = field(default=None, init=False, repr=False)

    def score_event(self, event: dict[str, Any]) -> dict[str, Any]:
        model = self._load_model()
        features = self._feature_set(event)
        if not model["trained"] or len(features) < LOCAL_ML_MIN_FEATURES:
            return {
                "trained": False,
                "score": 50,
                "confidence": 0,
                "weight": 0.0,
                "signals": {"positive": [], "negative": []},
                "detail": model["detail"],
                "recommendation": "",
            }

        impacts: list[tuple[str, float]] = []
        logit = model["prior_logit"]
        for feature in features:
            impact = model["feature_impacts"].get(feature, 0.0)
            if impact:
                impacts.append((feature, impact))
                logit += impact

        normalized_logit = logit / max(1.0, math.sqrt(len(features)))
        probability = logistic(normalized_logit)
        score = int(round(probability * 100))
        confidence = self._confidence(model, normalized_logit)
        weight = self._blend_weight(model, confidence)
        positive_signals = self._dedupe_signal_labels(
            [self._humanize_feature(name) for name, value in sorted(impacts, key=lambda item: item[1], reverse=True)[:5] if value > 0]
        )[:3]
        negative_signals = self._dedupe_signal_labels(
            [self._humanize_feature(name) for name, value in sorted(impacts, key=lambda item: item[1])[:4] if value < 0]
        )[:2]
        return {
            "trained": True,
            "score": score,
            "confidence": confidence,
            "weight": weight,
            "signals": {"positive": positive_signals, "negative": negative_signals},
            "detail": f"trained_on={model['positive_examples']} positive/{model['negative_examples']} negative events",
            "recommendation": self._build_recommendation(score, confidence, positive_signals, negative_signals),
        }

    def _load_model(self) -> dict[str, Any]:
        if self._model is not None:
            return self._model

        client = MongoClient(self.mongo_uri)
        try:
            collection = client[self.database_name][self.collection_name]
            projection = {
                "name": 1,
                "description": 1,
                "venue": 1,
                "address": 1,
                "industry": 1,
                "registrationFee": 1,
                "registrationCurrency": 1,
                "attendeesCount": 1,
                "exhibitorsCount": 1,
                "websiteUrl": 1,
                "startDate": 1,
                "endDate": 1,
                "registeredBy": 1,
                "attendedBy": 1,
                "interested": 1,
                "registrations": 1,
                "aiRelevanceScore": 1,
                "priorityTag": 1,
                "is_deleted": 1,
                "updatedAt": 1,
            }
            documents = list(
                collection.find({"is_deleted": {"$ne": True}}, projection)
                .sort("updatedAt", -1)
                .limit(self.max_training_events)
            )
            positive_counts: Counter[str] = Counter()
            negative_counts: Counter[str] = Counter()
            positive_examples = 0
            negative_examples = 0
            real_positive_examples = 0
            real_negative_examples = 0
            bootstrap_positive_examples = 0
            bootstrap_negative_examples = 0
            negative_cutoff = datetime.now(timezone.utc) - timedelta(days=LOCAL_ML_NEGATIVE_EVENT_AGE_DAYS)
            unlabeled_documents: list[dict[str, Any]] = []
            for document in documents:
                label = self._label_training_event(document, negative_cutoff)
                if label is None:
                    unlabeled_documents.append(document)
                    continue
                features = self._feature_set(document)
                if len(features) < LOCAL_ML_MIN_FEATURES:
                    continue
                if label:
                    positive_counts.update(features)
                    positive_examples += 1
                    real_positive_examples += 1
                else:
                    negative_counts.update(features)
                    negative_examples += 1
                    real_negative_examples += 1

            if positive_examples < LOCAL_ML_MIN_POSITIVE_EVENTS or negative_examples < LOCAL_ML_MIN_NEGATIVE_EVENTS:
                for document in unlabeled_documents:
                    label = self._bootstrap_label(document, negative_cutoff)
                    if label is None:
                        continue
                    features = self._feature_set(document)
                    if len(features) < LOCAL_ML_MIN_FEATURES:
                        continue
                    if label:
                        positive_counts.update(features)
                        positive_examples += 1
                        bootstrap_positive_examples += 1
                    else:
                        negative_counts.update(features)
                        negative_examples += 1
                        bootstrap_negative_examples += 1
        finally:
            client.close()

        trained = (
            positive_examples >= LOCAL_ML_MIN_POSITIVE_EVENTS
            and negative_examples >= LOCAL_ML_MIN_NEGATIVE_EVENTS
        )
        if not trained:
            self._model = {
                "trained": False,
                "feature_impacts": {},
                "prior_logit": 0.0,
                "positive_examples": positive_examples,
                "negative_examples": negative_examples,
                "total_examples": positive_examples + negative_examples,
                "real_positive_examples": real_positive_examples,
                "real_negative_examples": real_negative_examples,
                "bootstrap_positive_examples": bootstrap_positive_examples,
                "bootstrap_negative_examples": bootstrap_negative_examples,
                "detail": "not enough local event engagement history yet",
            }
            return self._model

        pos_prior = (positive_examples + 1) / (positive_examples + negative_examples + 2)
        neg_prior = 1.0 - pos_prior
        feature_impacts: dict[str, float] = {}
        vocabulary = set(positive_counts) | set(negative_counts)
        for feature in vocabulary:
            pos_rate = (positive_counts[feature] + 1) / (positive_examples + 2)
            neg_rate = (negative_counts[feature] + 1) / (negative_examples + 2)
            feature_impacts[feature] = math.log(pos_rate / neg_rate)

        self._model = {
            "trained": True,
            "feature_impacts": feature_impacts,
            "prior_logit": math.log(pos_prior / max(neg_prior, 1e-9)),
            "positive_examples": positive_examples,
            "negative_examples": negative_examples,
            "total_examples": positive_examples + negative_examples,
            "real_positive_examples": real_positive_examples,
            "real_negative_examples": real_negative_examples,
            "bootstrap_positive_examples": bootstrap_positive_examples,
            "bootstrap_negative_examples": bootstrap_negative_examples,
            "detail": (
                f"trained on {positive_examples + negative_examples} local events "
                f"({real_positive_examples} real positives, {bootstrap_positive_examples} bootstrap positives)"
            ),
        }
        return self._model

    def _feature_set(self, event: dict[str, Any]) -> set[str]:
        features = {f"kw:{token}" for token in ml_tokens(
            event.get("name", ""),
            event.get("description", ""),
            event.get("venue", ""),
            event.get("address", ""),
        )}
        tags = event.get("tags") if isinstance(event.get("tags"), list) else []
        for tag in tags:
            features.update(f"tag:{token}" for token in ml_tokens(str(tag)))

        industry_token = self._industry_token(event.get("industry"))
        if industry_token:
            features.add(f"industry:{industry_token}")

        location_token = self._location_token(event.get("address", ""))
        if location_token:
            features.add(f"location:{location_token}")

        fee_value = event.get("registrationFee")
        try:
            fee_number = float(fee_value) if fee_value is not None else None
        except (TypeError, ValueError):
            fee_number = None
        if fee_number is not None:
            if fee_number <= 0:
                features.add("fee:free")
            elif fee_number <= 1000:
                features.add("fee:low")
            elif fee_number <= 10000:
                features.add("fee:medium")
            else:
                features.add("fee:high")

        attendee_count = self._safe_int(event.get("attendeesCount"))
        if attendee_count is not None:
            if attendee_count >= 5000:
                features.add("attendance:mega")
            elif attendee_count >= 1000:
                features.add("attendance:large")
            elif attendee_count >= 200:
                features.add("attendance:medium")
            elif attendee_count > 0:
                features.add("attendance:small")

        exhibitor_count = self._safe_int(event.get("exhibitorsCount"))
        if exhibitor_count is not None:
            if exhibitor_count >= 150:
                features.add("exhibitors:large")
            elif exhibitor_count >= 25:
                features.add("exhibitors:medium")
            elif exhibitor_count > 0:
                features.add("exhibitors:small")

        if clean_text(str(event.get("websiteUrl", ""))):
            features.add("has:website")
        if clean_text(str(event.get("description", ""))):
            features.add("has:description")
        if clean_text(str(event.get("venue", ""))):
            features.add("has:venue")
        return features

    @staticmethod
    def _safe_int(value: Any) -> int | None:
        try:
            if value is None or value == "":
                return None
            return int(float(value))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _label_training_event(event: dict[str, Any], negative_cutoff: datetime) -> bool | None:
        if LocalEngagementMLScorer._engagement_strength(event) > 0:
            return True
        event_end = parse_datetime(event.get("endDate")) or parse_datetime(event.get("startDate"))
        if event_end and event_end.tzinfo is None:
            event_end = event_end.replace(tzinfo=timezone.utc)
        if event_end and event_end.astimezone(timezone.utc) <= negative_cutoff:
            return False
        return None

    @staticmethod
    def _bootstrap_label(event: dict[str, Any], negative_cutoff: datetime) -> bool | None:
        event_end = parse_datetime(event.get("endDate")) or parse_datetime(event.get("startDate"))
        if event_end and event_end.tzinfo is None:
            event_end = event_end.replace(tzinfo=timezone.utc)
        score = LocalEngagementMLScorer._safe_int(event.get("aiRelevanceScore"))
        priority = clean_text(str(event.get("priorityTag", ""))).lower()
        if score is not None and score >= 72:
            return True
        if priority in {"high", "strategic"} and score is not None and score >= 60:
            return True
        if score is not None and score <= 60:
            return False
        if event_end and event_end.astimezone(timezone.utc) <= negative_cutoff and score is not None and score <= 65:
            return False
        return None

    @staticmethod
    def _engagement_strength(event: dict[str, Any]) -> int:
        registration_rows = event.get("registrations") if isinstance(event.get("registrations"), list) else []
        attendee_users = 0
        for registration in registration_rows:
            if isinstance(registration, dict):
                attendee_users += len(registration.get("attendeeUsers") or [])
        return (
            len(event.get("registeredBy") or [])
            + (2 * len(event.get("attendedBy") or []))
            + len(event.get("interested") or [])
            + len(registration_rows)
            + attendee_users
        )

    @staticmethod
    def _industry_token(value: Any) -> str:
        token = clean_text(str(value))
        if not token:
            return ""
        lowered = token.lower()
        for slug, profile in _industry_profiles().items():
            profile_id = clean_text(str(profile.get("id", "")))
            profile_name = clean_text(str(profile.get("name", ""))).lower()
            if token == profile_id or lowered == profile_name or lowered == slug.replace("_", " "):
                return slug
        return re.sub(r"[^a-z0-9]+", "_", token.lower()).strip("_")

    @staticmethod
    def _location_token(address: str) -> str:
        match_level = TARGET_LOCATION_CONTEXT.location_match_level(address)
        if match_level == "local":
            return slugify_fragment(TARGET_LOCATION_CONTEXT.city or TARGET_LOCATION_CONTEXT.district or TARGET_LOCATION_CONTEXT.area)
        if match_level == "state":
            return slugify_fragment(TARGET_LOCATION_CONTEXT.state)
        if match_level == "country":
            return slugify_fragment(TARGET_LOCATION_CONTEXT.country)
        lowered = clean_text(address).lower()
        if "india" in lowered:
            return "india"
        return ""

    @staticmethod
    def _confidence(model: dict[str, Any], normalized_logit: float) -> int:
        sample_factor = min(1.0, model["total_examples"] / 120.0)
        signal_factor = min(1.0, abs(normalized_logit) / 2.5)
        return int(round(100 * ((sample_factor * 0.6) + (signal_factor * 0.4))))

    @staticmethod
    def _blend_weight(model: dict[str, Any], confidence: int) -> float:
        sample_balance = min(model["positive_examples"], model["negative_examples"])
        base_weight = min(1.0, sample_balance / 25.0) * LOCAL_ML_MAX_BLEND_WEIGHT
        if model.get("real_positive_examples", 0) == 0:
            base_weight *= 0.6
        confidence_factor = 0.5 + (confidence / 200.0)
        return round(base_weight * confidence_factor, 3)

    @staticmethod
    def _humanize_feature(feature: str) -> str:
        prefix, _, value = feature.partition(":")
        value = value.replace("_", " ").replace("-", " ").strip()
        labels = {
            "industry": value.title(),
            "location": value.title(),
            "fee": f"{value} fee".strip(),
            "attendance": f"{value} attendance".strip(),
            "exhibitors": f"{value} exhibitor presence".strip(),
            "has": value.replace("has", "").strip() or value,
            "tag": value,
            "kw": value,
        }
        return labels.get(prefix, value or feature)

    @staticmethod
    def _dedupe_signal_labels(values: list[str]) -> list[str]:
        deduped: list[str] = []
        seen: set[str] = set()
        for value in values:
            key = value.casefold()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(value)
        return deduped

    @staticmethod
    def _build_recommendation(score: int, confidence: int, positive: list[str], negative: list[str]) -> str:
        if score >= 75:
            lead = "Local ML sees strong similarity to previously engaged events"
        elif score >= 60:
            lead = "Local ML sees moderate similarity to previously engaged events"
        elif score <= 40:
            lead = "Local ML sees weaker historical engagement for similar events"
        else:
            lead = "Local ML sees mixed engagement signals"

        details: list[str] = []
        if positive:
            details.append(f"positive signals: {', '.join(positive)}")
        if negative and score < 60:
            details.append(f"watch-outs: {', '.join(negative)}")
        details.append(f"confidence {confidence}%")
        return f"{lead} ({'; '.join(details)})."


@dataclass
class LocalROIPredictor:
    mongo_uri: str = MONGO_URI
    database_name: str = DATABASE_NAME
    events_collection_name: str = CRM_EVENTS_COLLECTION_NAME
    target_location: TargetLocationContext = field(default_factory=lambda: TARGET_LOCATION_CONTEXT)
    _benchmark: dict[str, Any] | None = field(default=None, init=False, repr=False)

    def predict_event(self, event: dict[str, Any]) -> dict[str, Any]:
        benchmark = self._load_benchmark()
        if not benchmark["trained"]:
            return {
                "trained": False,
                "predictedROI": None,
                "confidence": 0,
                "expectedROIRange": "",
                "detail": benchmark["detail"],
                "estimatedRole": "",
                "estimatedDistanceKm": None,
                "rolePredictions": {},
                "recommendedRole": "",
                "decisionSummary": "",
                "inferredRole": "",
            }

        feature_map = self._prediction_feature_map(event)
        prediction = self._predict_from_benchmark(benchmark, feature_map)
        inferred_role = self._infer_role(event)
        role_predictions, recommended_role, decision_summary = self._derive_role_predictions(
            event=event,
            benchmark=benchmark,
            prediction=prediction,
            inferred_role=inferred_role,
        )
        recommended_payload = (
            role_predictions.get(recommended_role)
            or role_predictions.get("Visitor")
            or role_predictions.get("Exhibitor")
            or {}
        )
        return {
            "trained": True,
            "predictedROI": recommended_payload.get("predictedROI", prediction.get("predictedROI")),
            "confidence": int(recommended_payload.get("confidence", prediction.get("confidence", 0))),
            "expectedROIRange": recommended_payload.get("expectedROIRange", prediction.get("expectedROIRange", "")),
            "detail": prediction.get("detail", ""),
            "estimatedRole": "",
            "estimatedDistanceKm": prediction.get("estimatedDistanceKm", feature_map.get("distance_km")),
            "rolePredictions": role_predictions,
            "recommendedRole": recommended_role,
            "decisionSummary": decision_summary,
            "inferredRole": inferred_role,
        }

    def _load_benchmark(self) -> dict[str, Any]:
        if self._benchmark is not None:
            return self._benchmark
        self._benchmark = self._build_benchmark_from_db()
        return self._benchmark

    def _build_benchmark_from_db(self) -> dict[str, Any]:
        client = MongoClient(self.mongo_uri)
        try:
            database = client[self.database_name]
            events_collection = database[self.events_collection_name]
            expenses_collection = database["expenses"]
            leads_collection = database["leads"]
            deals_collection = database["deals"]
            clients_collection = database["client"]
            industries_collection = database["industries"]

            industry_name_map = {
                str(document.get("_id")): clean_text(document.get("name"))
                for document in industries_collection.find({}, {"name": 1})
            }
            now_utc = datetime.now(timezone.utc)
            completed_events = list(
                events_collection.find(
                    {
                        "is_deleted": {"$ne": True},
                        "startDate": {"$ne": None},
                        "$or": [
                            {"status": "completed"},
                            {"endDate": {"$lt": now_utc}},
                            {"startDate": {"$lt": now_utc}},
                        ],
                    },
                    {
                        "name": 1,
                        "industry": 1,
                        "venue": 1,
                        "address": 1,
                        "location": 1,
                        "startDate": 1,
                        "endDate": 1,
                        "registrationFee": 1,
                        "registrationCurrency": 1,
                        "attendeesCount": 1,
                        "exhibitorsCount": 1,
                        "websiteUrl": 1,
                        "description": 1,
                    },
                )
            )
            if not completed_events:
                return {
                    "trained": False,
                    "detail": "no completed CRM events are available for ROI benchmarking yet",
                }

            event_ids = [document["_id"] for document in completed_events]
            expense_rows = list(
                expenses_collection.find(
                    {
                        "is_deleted": {"$ne": True},
                        "referenceType": "Event",
                        "referenceId": {"$in": event_ids},
                    },
                    {"referenceId": 1, "totalAmount": 1, "amount": 1},
                )
            )
            lead_rows = list(
                leads_collection.find(
                    {
                        "is_deleted": {"$ne": True},
                        "expo_event_id": {"$in": event_ids},
                    },
                    {
                        "_id": 1,
                        "expo_event_id": 1,
                        "converted_deal_id": 1,
                        "converted_to_deal": 1,
                        "deal_value_estimate": 1,
                        "status": 1,
                    },
                )
            )
            client_rows = list(
                clients_collection.find(
                    {
                        "is_deleted": {"$ne": True},
                        "expo_event_id": {"$in": event_ids},
                    },
                    {"_id": 1, "expo_event_id": 1},
                )
            )
            deal_rows = list(
                deals_collection.find(
                    {"is_deleted": {"$ne": True}},
                    {"_id": 1, "lead_id": 1, "client_id": 1, "status": 1, "dealValue": 1},
                )
            )

            expense_by_event: dict[str, float] = {}
            for row in expense_rows:
                event_id = str(row.get("referenceId"))
                amount = parse_float(row.get("totalAmount"))
                if amount is None:
                    amount = parse_float(row.get("amount"))
                if amount is None:
                    continue
                expense_by_event[event_id] = expense_by_event.get(event_id, 0.0) + amount

            lead_ids_by_event: dict[str, list[str]] = {}
            estimated_revenue_by_event: dict[str, float] = {}
            for row in lead_rows:
                event_id = row.get("expo_event_id")
                lead_id = row.get("_id")
                if event_id is None or lead_id is None:
                    continue
                event_key = str(event_id)
                lead_ids_by_event.setdefault(event_key, []).append(str(lead_id))
                if bool(row.get("converted_to_deal")) or clean_text(str(row.get("status"))).lower() == "converted":
                    estimate = parse_float(row.get("deal_value_estimate"))
                    if estimate is not None and estimate > 0:
                        estimated_revenue_by_event[event_key] = estimated_revenue_by_event.get(event_key, 0.0) + estimate

            client_ids_by_event: dict[str, list[str]] = {}
            for row in client_rows:
                event_id = row.get("expo_event_id")
                client_id = row.get("_id")
                if event_id is None or client_id is None:
                    continue
                client_ids_by_event.setdefault(str(event_id), []).append(str(client_id))

            deals_by_lead: dict[str, list[dict[str, Any]]] = {}
            deals_by_client: dict[str, list[dict[str, Any]]] = {}
            for row in deal_rows:
                if row.get("lead_id") is not None:
                    deals_by_lead.setdefault(str(row.get("lead_id")), []).append(row)
                if row.get("client_id") is not None:
                    deals_by_client.setdefault(str(row.get("client_id")), []).append(row)

            aggregates: dict[str, dict[tuple[str, ...], dict[str, float]]] = {name: {} for name, _ in self._aggregate_specs()}
            roi_values: list[float] = []
            source_rows = 0

            for event in completed_events:
                event_id = str(event["_id"])
                expense = expense_by_event.get(event_id, 0.0)
                if expense <= 0:
                    continue

                revenue = estimated_revenue_by_event.get(event_id, 0.0)
                for lead_id in lead_ids_by_event.get(event_id, []):
                    for deal in deals_by_lead.get(lead_id, []):
                        if clean_text(str(deal.get("status"))).lower() == "won":
                            revenue += max(0.0, parse_float(deal.get("dealValue")) or 0.0)
                for client_id in client_ids_by_event.get(event_id, []):
                    for deal in deals_by_client.get(client_id, []):
                        if clean_text(str(deal.get("status"))).lower() == "won":
                            revenue += max(0.0, parse_float(deal.get("dealValue")) or 0.0)

                if revenue <= 0:
                    continue

                roi_value = (revenue - expense) / max(expense, 1e-9)
                roi_values.append(roi_value)
                source_rows += 1

                event_payload = dict(event)
                event_payload["industry"] = industry_name_map.get(str(event.get("industry")), clean_text(str(event.get("industry"))))
                feature_map = self._prediction_feature_map(event_payload)
                if not feature_map.get("industry"):
                    continue
                log_roi = self._safe_log_roi(roi_value)
                for name, fields in self._aggregate_specs():
                    key = tuple(str(feature_map[field]) for field in fields)
                    if any(not key_part for key_part in key):
                        continue
                    entry = aggregates[name].setdefault(key, {"count": 0.0, "sum_log_roi": 0.0, "sum_log_roi_sq": 0.0})
                    entry["count"] += 1.0
                    entry["sum_log_roi"] += log_roi
                    entry["sum_log_roi_sq"] += log_roi * log_roi

            if source_rows < ROI_BENCHMARK_MIN_ROWS:
                return {
                    "trained": False,
                    "detail": f"only {source_rows} completed events have both expense and attributed revenue in CRM",
                }

            global_mean_log_roi = sum(self._safe_log_roi(value) for value in roi_values) / max(source_rows, 1)
            global_variance = max(
                0.0,
                sum((self._safe_log_roi(value) - global_mean_log_roi) ** 2 for value in roi_values) / max(source_rows, 1),
            )
            global_std_log_roi = math.sqrt(global_variance)
            quantiles = self._roi_quantiles(roi_values)
            compact_aggregates: dict[str, dict[tuple[str, ...], dict[str, float]]] = {}
            for name, values in aggregates.items():
                compact_aggregates[name] = {
                    key: {
                        "count": int(entry["count"]),
                        "mean_log_roi": entry["sum_log_roi"] / max(entry["count"], 1.0),
                        "std_log_roi": math.sqrt(
                            max(
                                0.0,
                                (entry["sum_log_roi_sq"] / max(entry["count"], 1.0))
                                - ((entry["sum_log_roi"] / max(entry["count"], 1.0)) ** 2),
                            )
                        ),
                    }
                    for key, entry in values.items()
                }

            return {
                "trained": True,
                "rows": source_rows,
                "global_mean_log_roi": global_mean_log_roi,
                "global_std_log_roi": global_std_log_roi,
                "quantiles": quantiles,
                "aggregates": compact_aggregates,
                "detail": f"built live ROI benchmark from {source_rows} CRM event outcomes at {now_utc.isoformat()}",
            }
        finally:
            client.close()

    def _prediction_feature_map(self, event: dict[str, Any]) -> dict[str, Any]:
        city, state, country = self._location_parts(event)
        estimated_distance = self._estimate_distance_km(event, city, state, country)
        fee_value = parse_float(event.get("registrationFee"))
        attendees_count = LocalEngagementMLScorer._safe_int(event.get("attendeesCount"))
        exhibitors_count = LocalEngagementMLScorer._safe_int(event.get("exhibitorsCount"))
        return {
            "industry": LocalEngagementMLScorer._industry_token(event.get("industry")),
            "city": city.lower(),
            "state": state.lower(),
            "distance": self._distance_bucket(estimated_distance),
            "distance_km": estimated_distance,
            "duration": self._duration_bucket(self._event_duration_days(event)),
            "fee_band": self._fee_bucket(fee_value),
            "attendance_band": self._attendance_bucket(attendees_count),
            "exhibitor_band": self._exhibitor_bucket(exhibitors_count),
        }

    def _derive_role_predictions(
        self,
        event: dict[str, Any],
        benchmark: dict[str, Any],
        prediction: dict[str, Any],
        inferred_role: str,
    ) -> tuple[dict[str, dict[str, Any]], str, str]:
        base_roi = parse_float(prediction.get("predictedROI"))
        base_confidence_value = parse_float(prediction.get("confidence"))
        base_confidence = int(base_confidence_value) if base_confidence_value is not None else 0
        if base_roi is None:
            return {}, "", prediction.get("detail", "")

        visitor_multiplier = self._roi_role_multiplier("Visitor", event, inferred_role)
        exhibitor_multiplier = self._roi_role_multiplier("Exhibitor", event, inferred_role)
        visitor_roi = round(base_roi * visitor_multiplier, 3)
        exhibitor_roi = round(base_roi * exhibitor_multiplier, 3)
        visitor_conf = max(
            12,
            min(ROI_BENCHMARK_MAX_CONFIDENCE, base_confidence + self._role_confidence_adjustment("Visitor", event, inferred_role)),
        )
        exhibitor_conf = max(
            12,
            min(ROI_BENCHMARK_MAX_CONFIDENCE, base_confidence + self._role_confidence_adjustment("Exhibitor", event, inferred_role)),
        )
        visitor_range = self._roi_range_label(visitor_roi, benchmark["quantiles"])
        exhibitor_range = self._roi_range_label(exhibitor_roi, benchmark["quantiles"])

        role_predictions = {
            "Visitor": {
                "predictedROI": visitor_roi,
                "confidence": int(visitor_conf),
                "expectedROIRange": visitor_range,
            },
            "Exhibitor": {
                "predictedROI": exhibitor_roi,
                "confidence": int(exhibitor_conf),
                "expectedROIRange": exhibitor_range,
            },
        }
        recommended_role = "Visitor" if visitor_roi >= exhibitor_roi else "Exhibitor"
        recommended_roi = role_predictions[recommended_role]["predictedROI"]
        alternate_role = "Exhibitor" if recommended_role == "Visitor" else "Visitor"
        alternate_roi = role_predictions[alternate_role]["predictedROI"]

        uplift_pct = 0.0
        if abs(alternate_roi) > 1e-9:
            uplift_pct = ((recommended_roi - alternate_roi) / abs(alternate_roi)) * 100.0
        decision_summary = (
            f"{recommended_role.lower()} is the stronger participation mode, "
            f"with expected roi {int(round(abs(uplift_pct)))}% higher than {alternate_role.lower()}"
        )
        return role_predictions, recommended_role, decision_summary

    def _predict_from_benchmark(self, benchmark: dict[str, Any], feature_map: dict[str, Any]) -> dict[str, Any]:
        candidate_matches: list[dict[str, Any]] = []
        global_std = max(float(benchmark.get("global_std_log_roi", 0.0) or 0.0), 0.25)

        for name, fields in self._aggregate_specs():
            if any(not feature_map.get(field) for field in fields):
                continue
            key = tuple(str(feature_map[field]) for field in fields)
            stat = benchmark["aggregates"].get(name, {}).get(key)
            if not stat:
                continue
            min_count = self._minimum_support(name)
            if stat["count"] < min_count:
                continue
            prior_strength = max(6, 4 * len(fields))
            smoothed_log_roi = (
                (stat["mean_log_roi"] * stat["count"]) + (benchmark["global_mean_log_roi"] * prior_strength)
            ) / (stat["count"] + prior_strength)
            support = min(1.0, stat["count"] / max(min_count, 1))
            specificity = 0.46 + (0.12 * len(fields))
            std_log_roi = max(0.0, float(stat.get("std_log_roi", global_std)))
            stability = max(0.45, 1.15 - min(0.7, std_log_roi / max(global_std, 1e-9)))
            weight = specificity * support * stability
            candidate_matches.append(
                {
                    "name": name,
                    "count": stat["count"],
                    "mean_log_roi": smoothed_log_roi,
                    "std_log_roi": std_log_roi,
                    "weight": weight,
                    "stability": stability,
                }
            )

        if not candidate_matches:
            return self._fallback_prediction(benchmark, feature_map)

        total_weight = sum(item["weight"] for item in candidate_matches)
        weighted_log_roi = sum(item["mean_log_roi"] * item["weight"] for item in candidate_matches) / max(total_weight, 1e-9)
        disagreement = math.sqrt(
            max(
                0.0,
                sum(item["weight"] * ((item["mean_log_roi"] - weighted_log_roi) ** 2) for item in candidate_matches)
                / max(total_weight, 1e-9),
            )
        )
        agreement = max(0.45, 1.1 - min(0.65, disagreement / max(global_std, 1e-9)))
        predicted_roi = self._roi_from_log(weighted_log_roi)
        best_match = max(candidate_matches, key=lambda item: (item["weight"], item["count"]))
        confidence = min(
            ROI_BENCHMARK_MAX_CONFIDENCE,
            int(
                round(
                    25
                    + min(30, best_match["count"] * 6)
                    + min(18, len(candidate_matches) * 4)
                    + int(round(agreement * 12))
                )
            ),
        )
        expected_range = self._roi_range_label(predicted_roi, benchmark["quantiles"])
        detail = (
            f"organization ROI benchmark from {best_match['name']} "
            f"(support={best_match['count']}, distance~{int(round(feature_map['distance_km'])) if feature_map.get('distance_km') is not None else 'n/a'}km)"
        )
        return {
            "predictedROI": predicted_roi,
            "confidence": confidence,
            "expectedROIRange": expected_range,
            "detail": detail,
            "estimatedDistanceKm": feature_map.get("distance_km"),
        }

    def _fallback_prediction(self, benchmark: dict[str, Any], feature_map: dict[str, Any]) -> dict[str, Any]:
        predicted_roi = self._roi_from_log(benchmark["global_mean_log_roi"])
        expected_range = self._roi_range_label(predicted_roi, benchmark["quantiles"])
        return {
            "predictedROI": predicted_roi,
            "confidence": 20,
            "expectedROIRange": expected_range,
            "detail": f"organization-wide ROI fallback from {benchmark['rows']} completed CRM event outcomes",
            "estimatedDistanceKm": feature_map.get("distance_km"),
        }

    @staticmethod
    def _aggregate_specs() -> tuple[tuple[str, tuple[str, ...]], ...]:
        return (
            ("industry_state_distance_duration_fee_attendance", ("industry", "state", "distance", "duration", "fee_band", "attendance_band")),
            ("industry_state_attendance_exhibitor", ("industry", "state", "attendance_band", "exhibitor_band")),
            ("industry_city_distance_duration", ("industry", "city", "distance", "duration")),
            ("industry_state_distance_duration", ("industry", "state", "distance", "duration")),
            ("industry_state_distance_fee", ("industry", "state", "distance", "fee_band")),
            ("industry_state_distance_attendance", ("industry", "state", "distance", "attendance_band")),
            ("industry_city_distance", ("industry", "city", "distance")),
            ("industry_state_distance", ("industry", "state", "distance")),
            ("industry_distance_duration", ("industry", "distance", "duration")),
            ("industry_state_fee", ("industry", "state", "fee_band")),
            ("industry_state_attendance", ("industry", "state", "attendance_band")),
            ("industry_fee_attendance", ("industry", "fee_band", "attendance_band")),
            ("industry_state", ("industry", "state")),
            ("industry", ("industry",)),
            ("state", ("state",)),
        )

    @staticmethod
    def _minimum_support(bucket_name: str) -> int:
        if bucket_name.count("_") >= 5:
            return 1
        return ROI_BENCHMARK_MIN_GROUP_COUNT

    @staticmethod
    def _safe_log_roi(value: float) -> float:
        return math.log1p(max(value, -0.999))

    @staticmethod
    def _roi_from_log(value: float) -> float:
        return round(max(-0.95, math.expm1(value)), 3)

    @staticmethod
    def _roi_quantiles(values: list[float]) -> dict[str, float]:
        ordered = sorted(values)

        def pick(percentile: float) -> float:
            index = min(len(ordered) - 1, max(0, int(percentile * (len(ordered) - 1))))
            return ordered[index]

        return {
            "p25": pick(0.25),
            "p50": pick(0.50),
            "p75": pick(0.75),
            "p90": pick(0.90),
        }

    @staticmethod
    def _roi_range_label(predicted_roi: float, quantiles: dict[str, float]) -> str:
        if predicted_roi <= quantiles["p25"]:
            return "Low"
        if predicted_roi <= quantiles["p50"]:
            return "Moderate"
        if predicted_roi <= quantiles["p75"]:
            return "Strong"
        if predicted_roi <= quantiles["p90"]:
            return "High"
        return "Exceptional"

    @staticmethod
    def _distance_bucket(distance_km: float | None) -> str:
        if distance_km is None:
            return ""
        if distance_km <= 50:
            return "0-50"
        if distance_km <= 150:
            return "51-150"
        if distance_km <= 400:
            return "151-400"
        if distance_km <= 800:
            return "401-800"
        return "801+"

    @staticmethod
    def _fee_bucket(fee_value: float | None) -> str:
        if fee_value is None:
            return ""
        if fee_value <= 0:
            return "free"
        if fee_value <= 500:
            return "low"
        if fee_value <= 3000:
            return "medium"
        return "high"

    @staticmethod
    def _attendance_bucket(attendees_count: int | None) -> str:
        if attendees_count is None:
            return ""
        if attendees_count >= 5000:
            return "mega"
        if attendees_count >= 1000:
            return "large"
        if attendees_count >= 200:
            return "medium"
        if attendees_count > 0:
            return "small"
        return "none"

    @staticmethod
    def _exhibitor_bucket(exhibitors_count: int | None) -> str:
        if exhibitors_count is None:
            return ""
        if exhibitors_count >= 150:
            return "large"
        if exhibitors_count >= 40:
            return "medium"
        if exhibitors_count > 0:
            return "small"
        return "none"

    @staticmethod
    def _roi_role_multiplier(role: str, event: dict[str, Any], inferred_role: str) -> float:
        attendees_count = LocalEngagementMLScorer._safe_int(event.get("attendeesCount"))
        exhibitors_count = LocalEngagementMLScorer._safe_int(event.get("exhibitorsCount"))
        fee_value = parse_float(event.get("registrationFee"))
        text = " ".join(
            [
                clean_text(str(event.get("name", ""))),
                clean_text(str(event.get("description", ""))),
                " ".join(clean_text(str(tag)) for tag in (event.get("tags") or []) if clean_text(str(tag))),
            ]
        ).lower()
        exhibitor_cues = (
            "exhibitor",
            "expo",
            "trade fair",
            "booth",
            "stall",
            "sponsorship",
            "sponsor",
        )

        multiplier = 1.0
        if role == "Visitor":
            if attendees_count is not None:
                if attendees_count >= 1000:
                    multiplier += 0.10
                elif attendees_count >= 250:
                    multiplier += 0.06
                elif attendees_count > 0:
                    multiplier += 0.02
            if exhibitors_count is not None and exhibitors_count >= 80:
                multiplier += 0.03
            if fee_value is not None:
                if fee_value <= 0:
                    multiplier += 0.04
                elif fee_value > 5000:
                    multiplier -= 0.08
                elif fee_value > 2000:
                    multiplier -= 0.04
            if inferred_role == "Visitor":
                multiplier += 0.06
            if any(cue in text for cue in exhibitor_cues):
                multiplier -= 0.04
        else:
            multiplier -= 0.02
            if exhibitors_count is None:
                multiplier -= 0.05
            elif exhibitors_count >= 150:
                multiplier += 0.16
            elif exhibitors_count >= 50:
                multiplier += 0.10
            elif exhibitors_count > 0:
                multiplier += 0.05
            if attendees_count is not None:
                if attendees_count >= 1000:
                    multiplier += 0.05
                elif attendees_count >= 250:
                    multiplier += 0.03
            if fee_value is not None and fee_value > 1000:
                multiplier += 0.03
            if any(cue in text for cue in exhibitor_cues):
                multiplier += 0.10
            if inferred_role == "Exhibitor":
                multiplier += 0.06

        return max(0.55, min(1.65, multiplier))

    @staticmethod
    def _role_confidence_adjustment(role: str, event: dict[str, Any], inferred_role: str) -> int:
        adjustment = 0
        attendees_count = LocalEngagementMLScorer._safe_int(event.get("attendeesCount"))
        exhibitors_count = LocalEngagementMLScorer._safe_int(event.get("exhibitorsCount"))
        if attendees_count is not None:
            adjustment += 4 if attendees_count >= 200 else 2
        if exhibitors_count is not None:
            adjustment += 4 if exhibitors_count >= 25 else 2
        if role == inferred_role:
            adjustment += 4
        return adjustment

    @staticmethod
    def _duration_bucket(duration_days: int) -> str:
        if duration_days <= 1:
            return "1"
        if duration_days <= 3:
            return "2-3"
        return "4+"

    @staticmethod
    def _event_duration_days(event: dict[str, Any]) -> int:
        start_date = parse_datetime(event.get("startDate"))
        end_date = parse_datetime(event.get("endDate")) or start_date
        if not start_date or not end_date:
            return 1
        if start_date.tzinfo is None:
            start_date = start_date.replace(tzinfo=timezone.utc)
        if end_date.tzinfo is None:
            end_date = end_date.replace(tzinfo=timezone.utc)
        return max(1, (end_date.date() - start_date.date()).days + 1)

    @staticmethod
    def _extract_inline_coordinates(text: str) -> tuple[float | None, float | None]:
        match = re.search(r"(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)", clean_text(text))
        if not match:
            return None, None
        latitude = parse_float(match.group(1))
        longitude = parse_float(match.group(2))
        return latitude, longitude

    @staticmethod
    def _location_parts(event: dict[str, Any]) -> tuple[str, str, str]:
        venue = clean_text(str(event.get("venue", "")))
        address = clean_text(str(event.get("address", "")))
        country = ""
        state = ""
        city = ""

        cleaned_address = re.sub(r"(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)", "", address)
        parts = [clean_text(part) for part in re.split(r"[,\n|]+", cleaned_address) if clean_text(part)]
        if parts:
            last = parts[-1].lower()
            if last in {"india", "united states", "usa", "canada", "australia", "united kingdom"}:
                country = parts.pop()
        if not country and "india" in cleaned_address.lower():
            country = "India"
        if len(parts) >= 1:
            state = parts[-1]
        if len(parts) >= 2:
            city = parts[-2]

        venue_parts = [clean_text(part) for part in venue.split(",") if clean_text(part)]
        if not city and len(venue_parts) >= 1:
            city = venue_parts[0]
        if not state and len(venue_parts) >= 2:
            state = venue_parts[1]
        if not country:
            country = TARGET_LOCATION_CONTEXT.country or "India"
        return city, state, country

    def _estimate_distance_km(self, event: dict[str, Any], city: str, state: str, country: str) -> float | None:
        if self.target_location.latitude is None or self.target_location.longitude is None:
            return None
        latitude = parse_float(event.get("latitude"))
        longitude = parse_float(event.get("longitude"))
        if latitude is None or longitude is None:
            latitude, longitude = self._extract_inline_coordinates(str(event.get("address", "")))
        if latitude is None or longitude is None:
            geocode_query = ", ".join(part for part in [city, state, country] if clean_text(part))
            latitude, longitude = _geocode_location(geocode_query)
        if latitude is not None and longitude is not None:
            return round(
                haversine_distance_km(
                    self.target_location.latitude,
                    self.target_location.longitude,
                    latitude,
                    longitude,
                ),
                1,
            )
        match_level = self.target_location.location_match_level(str(event.get("address", "")))
        if match_level == "local":
            return 25.0
        if match_level == "state":
            return 180.0
        if match_level == "country":
            return 650.0
        return None

    @staticmethod
    def _infer_role(event: dict[str, Any]) -> str:
        text = " ".join(
            [
                clean_text(str(event.get("name", ""))),
                clean_text(str(event.get("description", ""))),
                " ".join(clean_text(str(tag)) for tag in (event.get("tags") or []) if clean_text(str(tag))),
            ]
        ).lower()
        exhibitor_patterns = (
            "exhibitor",
            "exhibit with us",
            "book your stall",
            "stall booking",
            "booth booking",
            "sponsorship opportunity",
            "sponsor opportunities",
        )
        return "Exhibitor" if any(pattern in text for pattern in exhibitor_patterns) else "Visitor"


@dataclass
class RuleEngine:
    ml_scorer: LocalEngagementMLScorer = field(default_factory=LocalEngagementMLScorer)
    roi_predictor: LocalROIPredictor = field(default_factory=LocalROIPredictor)
    target_location: TargetLocationContext = field(default_factory=lambda: TARGET_LOCATION_CONTEXT)

    def enrich_and_score(self, raw_event: dict[str, Any]) -> dict[str, Any]:
        event = dict(raw_event)
        event["industry"] = self._classify_industry(event)
        event["targetLocationMatchLevel"] = self._location_match_level(event.get("address", ""))
        event["location"] = self._normalize_location(event.get("address", ""))
        event["priorityTag"] = self._priority_tag(event)
        event["status"] = self._status(event.get("startDate"), event.get("endDate"))
        breakdown = {
            "industry_keywords": self._industry_score(event),
            "location": self._location_score(event),
            "historical_roi": self._historical_roi_score(event),
            "timing": self._timing_score(event),
            "completeness": self._completeness_score(event),
        }
        rule_score = sum(item["score"] for item in breakdown.values())
        ml_result = self.ml_scorer.score_event(event)
        roi_result = self.roi_predictor.predict_event(event)
        ml_weight = ml_result.get("weight", 0.0) if ml_result.get("trained") else 0.0
        if ml_weight > 0:
            breakdown["local_ml"] = {
                "weight": int(round(ml_weight * 100)),
                "score": int(round(ml_result["score"] * ml_weight)),
                "detail": ml_result["detail"],
            }
        if roi_result.get("trained") and roi_result.get("predictedROI") is not None:
            breakdown["predicted_roi"] = {
                "weight": roi_result["confidence"],
                "score": 0,
                "detail": (
                    f"predicted_roi={roi_result['predictedROI']}; "
                    f"range={roi_result['expectedROIRange']}; "
                    f"recommended_role={roi_result.get('recommendedRole', '')}; "
                    f"{roi_result['detail']}"
                ),
            }
        event["reason_breakdown"] = breakdown
        event["ruleScore"] = rule_score
        event["mlScore"] = ml_result["score"]
        event["mlConfidence"] = ml_result["confidence"]
        event["aiRecommendation"] = ml_result["recommendation"]
        event["predictedROI"] = roi_result.get("predictedROI")
        event["roiPredictionConfidence"] = roi_result.get("confidence", 0)
        event["expectedROIRange"] = roi_result.get("expectedROIRange", "")
        event["recommendedParticipationRole"] = roi_result.get("recommendedRole", "")
        event["roiDecisionSummary"] = roi_result.get("decisionSummary", "")
        role_predictions = roi_result.get("rolePredictions", {}) or {}
        event["roiRoleComparison"] = (
            {
                "recommendedRole": roi_result.get("recommendedRole", ""),
                "inferredRole": roi_result.get("inferredRole", ""),
                "decisionSummary": roi_result.get("decisionSummary", ""),
                "Visitor": role_predictions.get("Visitor"),
                "Exhibitor": role_predictions.get("Exhibitor"),
            }
            if role_predictions
            else None
        )
        event["roiPredictionBreakdown"] = {
            "trained": roi_result.get("trained", False),
            "confidence": roi_result.get("confidence", 0),
            "detail": roi_result.get("detail", ""),
            "estimatedRole": roi_result.get("estimatedRole", ""),
            "estimatedDistanceKm": roi_result.get("estimatedDistanceKm"),
            "recommendedRole": roi_result.get("recommendedRole", ""),
            "decisionSummary": roi_result.get("decisionSummary", ""),
            "rolePredictions": role_predictions,
            "inferredRole": roi_result.get("inferredRole", ""),
        }
        event["mlBreakdown"] = {
            "trained": ml_result["trained"],
            "weight": ml_weight,
            "detail": ml_result["detail"],
            "signals": ml_result["signals"],
        }
        event["finalScore"] = int(round((rule_score * (1.0 - ml_weight)) + (ml_result["score"] * ml_weight)))
        event["label"] = "hot" if event["finalScore"] >= 75 else "warm" if event["finalScore"] >= 50 else "cold"
        return event

    def _classify_industry(self, event: dict[str, Any]) -> str | None:
        text = " ".join([event.get("name", ""), event.get("description", ""), " ".join(event.get("tags", []))]).lower()
        profiles = _industry_profiles()
        if not profiles:
            return None
        best_profile_id = None
        best_hits = 0
        for profile in profiles.values():
            keywords = profile.get("keywords", [])
            hits = len(self._keyword_matches(text, keywords))
            if hits > best_hits:
                best_profile_id = clean_text(str(profile.get("id", "")))
                best_hits = hits
        if not best_profile_id or best_hits == 0:
            return None
        return best_profile_id

    def _location_match_level(self, address: str) -> str:
        return self.target_location.location_match_level(address)

    def _normalize_location(self, address: str) -> str | None:
        if self._location_match_level(address) == "local" and self.target_location.location_id:
            return self.target_location.location_id
        return None

    def _priority_tag(self, event: dict[str, Any]) -> str:
        score = 0
        if event.get("targetLocationMatchLevel") in {"local", "state"}:
            score += 1
        if (event.get("attendeesCount") or 0) >= 1000:
            score += 1
        if (event.get("exhibitorsCount") or 0) >= 100:
            score += 1
        if score >= 3:
            return "high"
        if score == 2:
            return "medium"
        return "low"

    @staticmethod
    def _status(start_date: datetime | None, end_date: datetime | None) -> str:
        today = datetime.now(timezone.utc).date()
        if end_date and end_date.date() < today:
            return "completed"
        if start_date and end_date and start_date.date() <= today <= end_date.date():
            return "ongoing"
        if start_date and start_date.date() > today:
            return "upcoming"
        return "upcoming"

    def _industry_score(self, event: dict[str, Any]) -> dict[str, Any]:
        text = " ".join([event.get("name", ""), event.get("description", ""), " ".join(event.get("tags", []))]).lower()
        profiles = _industry_profiles()
        matches = []
        for profile in profiles.values():
            keywords = profile.get("keywords", [])
            matches.extend(self._keyword_matches(text, keywords))
        unique_matches = sorted(set(matches))
        match_count = len(unique_matches)
        if match_count >= 4:
            score = 35
        elif match_count == 3:
            score = 28
        elif match_count == 2:
            score = 20
        elif match_count == 1:
            score = 10
        else:
            score = 0
        return {"weight": 35, "score": score, "detail": f"matched={unique_matches}"}

    def _location_score(self, event: dict[str, Any]) -> dict[str, Any]:
        match_level = event.get("targetLocationMatchLevel") or self._location_match_level(str(event.get("address", "")))
        if match_level == "local":
            score = 20
        elif match_level == "state":
            score = 15
        elif match_level == "country":
            score = 10
        else:
            score = 0
        return {"weight": 20, "score": score, "detail": f"address={event.get('address', '')}"}

    def _historical_roi_score(self, event: dict[str, Any]) -> dict[str, Any]:
        if clean_text(str(event.get("industry", ""))) in industry_id_values():
            return {"weight": 15, "score": 15, "detail": f"industry={event.get('industry')}"}
        trusted_source_score = self._trusted_source_roi_score(event)
        if trusted_source_score:
            return {
                "weight": 15,
                "score": trusted_source_score,
                "detail": f"trusted_source={event.get('source', '')}",
            }
        return {"weight": 15, "score": 0, "detail": f"industry={event.get('industry')}"}

    def _trusted_source_roi_score(self, event: dict[str, Any]) -> int:
        source = str(event.get("source", "")).lower()
        if source == "nasscom":
            return 10
        if source == "mccia":
            if self._location_match_level(str(event.get("address", ""))) in {"local", "state"}:
                return 8
        if source == "mea":
            return 8
        return 0

    @staticmethod
    def _timing_score(event: dict[str, Any]) -> dict[str, Any]:
        start_date = event.get("startDate")
        if start_date is None:
            return {"weight": 10, "score": 0, "detail": "missing startDate"}
        delta = (start_date.date() - datetime.now(timezone.utc).date()).days
        if 7 <= delta <= 45:
            score = 10
        elif 46 <= delta <= 90:
            score = 5
        elif 0 <= delta <= 6:
            score = 3
        else:
            score = 0
        return {"weight": 10, "score": score, "detail": f"days_until_start={delta}"}

    @staticmethod
    def _completeness_score(event: dict[str, Any]) -> dict[str, Any]:
        fields = [
            event.get("name"),
            event.get("description"),
            event.get("venue"),
            event.get("address"),
            event.get("startDate"),
            event.get("endDate"),
            event.get("registrationFee"),
            event.get("attendeesCount"),
            event.get("exhibitorsCount"),
            event.get("websiteUrl"),
        ]
        filled_count = 0
        for value in fields:
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            filled_count += 1
        score = min(20, filled_count * 2)
        return {"weight": 20, "score": score, "detail": f"filled_fields={filled_count}/10"}

    @staticmethod
    def _keyword_matches(text: str, keywords: list[str]) -> list[str]:
        tokens = slug_tokens(text)
        matches: list[str] = []
        for keyword in keywords:
            normalized = keyword.lower().strip()
            if " " in normalized:
                if normalized in text:
                    matches.append(normalized)
            elif normalized in tokens:
                matches.append(normalized)
        return matches


@dataclass
class MongoEventStore:
    mongo_uri: str = MONGO_URI
    database_name: str = DATABASE_NAME
    collection_name: str = COLLECTION_NAME

    def __post_init__(self) -> None:
        self.client = MongoClient(self.mongo_uri)
        self.collection = self.client[self.database_name][self.collection_name]

    def upsert_event(self, event: dict[str, Any]) -> tuple[ObjectId, bool]:
        document = self._to_mongo_document(event)
        existing = self.collection.find_one(self._existing_event_filter(document))
        now = datetime.now(timezone.utc)
        if existing:
            document["updatedAt"] = now
            self.collection.update_one({"_id": existing["_id"]}, {"$set": document})
            return existing["_id"], False
        document["attendedBy"] = []
        document["registeredBy"] = []
        document["interested"] = []
        document["is_deleted"] = False
        document["registrations"] = []
        document["createdAt"] = now
        document["updatedAt"] = now
        document["__v"] = 0
        return self.collection.insert_one(document).inserted_id, True

    @staticmethod
    def _to_mongo_document(event: dict[str, Any]) -> dict[str, Any]:
        normalized_url = MongoEventStore._normalize_website_url(event.get("websiteUrl", ""))
        return {
            "name": event.get("name", ""),
            "industry": ObjectId(event["industry"]) if event.get("industry") else None,
            "venue": event.get("venue", ""),
            "address": event.get("address", ""),
            "location": ObjectId(event["location"]) if event.get("location") else None,
            "startDate": event.get("startDate"),
            "endDate": event.get("endDate"),
            "registrationFee": event.get("registrationFee"),
            "registrationCurrency": event.get("registrationCurrency", ""),
            "attendeesCount": event.get("attendeesCount"),
            "exhibitorsCount": event.get("exhibitorsCount"),
            "latitude": parse_float(event.get("latitude")),
            "longitude": parse_float(event.get("longitude")),
            "priorityTag": event.get("priorityTag", "low"),
            "status": event.get("status", "upcoming"),
            "aiRecommendation": event.get("aiRecommendation", ""),
            "ruleScore": event.get("ruleScore", event.get("finalScore", 0)),
            "mlScore": event.get("mlScore"),
            "mlConfidence": event.get("mlConfidence"),
            "predictedROI": event.get("predictedROI"),
            "roiPredictionConfidence": event.get("roiPredictionConfidence"),
            "expectedROIRange": event.get("expectedROIRange", ""),
            "recommendedParticipationRole": event.get("recommendedParticipationRole", ""),
            "roiDecisionSummary": event.get("roiDecisionSummary", ""),
            "roiRoleComparison": event.get("roiRoleComparison"),
            "websiteUrl": event.get("websiteUrl", ""),
            "normalizedWebsiteUrl": normalized_url,
            "description": event.get("description", ""),
            "scoreMeta": {
                "finalScore": event.get("finalScore", 0),
                "ruleScore": event.get("ruleScore", event.get("finalScore", 0)),
                "mlScore": event.get("mlScore"),
                "mlConfidence": event.get("mlConfidence"),
                "label": event.get("label", "cold"),
                "reason_breakdown": event.get("reason_breakdown", {}),
                "mlBreakdown": event.get("mlBreakdown", {}),
                "roiPrediction": event.get("roiPredictionBreakdown", {}),
                "predictedROI": event.get("predictedROI"),
                "roiPredictionConfidence": event.get("roiPredictionConfidence"),
                "expectedROIRange": event.get("expectedROIRange", ""),
                "recommendedParticipationRole": event.get("recommendedParticipationRole", ""),
                "roiDecisionSummary": event.get("roiDecisionSummary", ""),
                "roiRoleComparison": event.get("roiRoleComparison"),
                "source": event.get("source", ""),
                "tags": event.get("tags", []),
                "sponsors": event.get("sponsors", []),
                "latitude": parse_float(event.get("latitude")),
                "longitude": parse_float(event.get("longitude")),
            },
        }

    @staticmethod
    def _existing_event_filter(document: dict[str, Any]) -> dict[str, Any]:
        source = document.get("scoreMeta", {}).get("source", "")
        filters: list[dict[str, Any]] = []
        if document.get("normalizedWebsiteUrl"):
            filters.append({"normalizedWebsiteUrl": document["normalizedWebsiteUrl"], "scoreMeta.source": source})
        filters.append(
            {
                "name": document.get("name", ""),
                "startDate": document.get("startDate"),
                "venue": document.get("venue", ""),
                "scoreMeta.source": source,
            }
        )
        return filters[0] if len(filters) == 1 else {"$or": filters}

    @staticmethod
    def _normalize_website_url(url: str) -> str:
        if not url:
            return ""
        parsed = urlparse(url.strip())
        return urlunparse(parsed._replace(query="", fragment="")).rstrip("/")

@dataclass
class ScraperApp:
    rule_engine: RuleEngine = field(default_factory=RuleEngine)
    store: MongoEventStore = field(default_factory=MongoEventStore)

    def process_source(
        self,
        source: str,
        min_score: int = 50,
        max_links: int = 20,
        max_pages: int = 30,
        max_depth: int = 2,
    ) -> dict[str, Any]:
        config = get_source_definition(source)
        normalized = source.strip().lower()
        requested_link_limit = max_links
        effective_max_links = max_links if max_links > 0 else 1_000_000
        api_error = ""
        if config["mode"] == "api":
            credential = self._api_credential(normalized)
            if credential:
                try:
                    raw_events = self._fetch_api_events(normalized, credential, max_links=effective_max_links)
                    if raw_events:
                        return self._score_and_store_many(
                            source=normalized,
                            seed_url="api",
                            raw_events=raw_events,
                            min_score=min_score,
                            pages_visited=[],
                            sitemap_links=[],
                        )
                    api_error = f"{normalized} API returned no events"
                except RuntimeError as exc:
                    api_error = str(exc)

        fallback_errors: list[str] = []
        fallback_results: list[dict[str, Any]] = []
        seen_urls: set[str] = set()
        fallback_limit = effective_max_links
        for fallback_url in source_seed_urls(normalized):
            try:
                result = self.process_url(
                    normalized,
                    fallback_url,
                    min_score=min_score,
                    max_links=fallback_limit,
                    max_pages=max_pages,
                    max_depth=max_depth,
                )
                fallback_results.append(result)
                for link in result.get("candidateLinks", []):
                    if link:
                        seen_urls.add(link)
                if requested_link_limit > 0 and len(seen_urls) >= requested_link_limit:
                    break
            except RuntimeError as exc:
                fallback_errors.append(str(exc))

        if fallback_results:
            return self._merge_results(normalized, fallback_results)

        if api_error:
            raise RuntimeError(api_error)
        if fallback_errors:
            raise RuntimeError(fallback_errors[-1])
        raise RuntimeError(f"{normalized} requires API credentials and no scrape fallback is configured.")

    def process_url(
        self,
        source: str,
        url: str,
        min_score: int = 50,
        max_links: int = 20,
        max_pages: int = 30,
        max_depth: int = 2,
    ) -> dict[str, Any]:
        normalized_source = source.strip().lower()
        effective_max_links = max_links if max_links > 0 else 1_000_000
        effective_max_pages = max_pages if max_pages > 0 else 1_000_000
        effective_max_depth = max_depth if max_depth > 0 else 1_000_000
        if normalized_source in {"predicthq"}:
            raise RuntimeError(
                f"{normalized_source} is API-only in main.py. Run it without a URL override."
            )
        scraper = EventScraper(normalized_source)
        config = get_source_definition(normalized_source)
        built_in_listings = {scraper._canonicalize_url(item) for item in source_seed_urls(normalized_source)}
        is_built_in_listing = (
            bool(config.get("prefer_listing"))
            and scraper._canonicalize_url(url) in built_in_listings
        )
        if not is_built_in_listing:
            try:
                raw_event = scraper.scrape_url(url)
                return self._score_and_store(raw_event)
            except RuntimeError as exc:
                if "No event data could be extracted" not in str(exc):
                    raise

        homepage_html = scraper.fetch_html(url)
        listing_events = scraper.extract_listing_events(homepage_html, url, limit=effective_max_links)
        if listing_events:
            return self._score_and_store_many(
                source=normalized_source,
                seed_url=url,
                raw_events=listing_events,
                min_score=min_score,
                pages_visited=[scraper._canonicalize_url(url)],
                sitemap_links=[],
            )
        direct_links = scraper.discover_event_links(homepage_html, base_url=url, limit=effective_max_links)
        if direct_links:
            crawl_result = {
                "candidateLinks": direct_links,
                "pagesVisited": [scraper._canonicalize_url(url)],
                "sitemapLinks": [],
            }
        else:
            crawl_result = scraper.crawl_site(
                url,
                max_pages=effective_max_pages,
                max_depth=effective_max_depth,
                max_event_links=effective_max_links,
            )
        event_links = crawl_result["candidateLinks"]
        if not event_links:
            raise RuntimeError(
                f"No event links were discovered on {url}. "
                "The site may not expose crawlable event detail pages or may be protected."
            )

        results: list[dict[str, Any]] = []
        skipped: list[dict[str, str]] = []
        inserted_count = 0
        updated_count = 0
        future_filtered_count = 0
        score_filtered_count = 0
        error_count = 0

        for event_url in event_links:
            try:
                raw_event = scraper.scrape_url(event_url)
                future_error = self._future_eligibility_error(raw_event)
                if future_error:
                    future_filtered_count += 1
                    skipped.append({"url": event_url, "reason": future_error})
                    continue
                scored_event = self.rule_engine.enrich_and_score(raw_event)
                if scored_event.get("finalScore", 0) < min_score:
                    score_filtered_count += 1
                    skipped.append({"url": event_url, "reason": f"score<{min_score}"})
                    continue
                inserted_id, is_new = self.store.upsert_event(scored_event)
                scored_event["_id"] = str(inserted_id)
                scored_event["persistenceAction"] = "inserted" if is_new else "updated"
                if is_new:
                    inserted_count += 1
                else:
                    updated_count += 1
                results.append(scored_event)
            except RuntimeError as exc:
                error_count += 1
                skipped.append({"url": event_url, "reason": str(exc)})

        return {
            "source": normalized_source,
            "seedUrl": url,
            "candidateLinks": event_links,
            "pagesVisited": crawl_result["pagesVisited"],
            "sitemapLinks": crawl_result["sitemapLinks"],
            "discoveredCount": len(event_links),
            "savedCount": inserted_count,
            "updatedCount": updated_count,
            "processedCount": len(results),
            "skippedCount": len(skipped),
            "futureFilteredCount": future_filtered_count,
            "belowThresholdCount": score_filtered_count,
            "errorCount": error_count,
            "events": results,
            "skipped": skipped,
        }

    def _merge_results(self, source: str, results: list[dict[str, Any]]) -> dict[str, Any]:
        candidate_links: list[str] = []
        pages_visited: list[str] = []
        sitemap_links: list[str] = []
        events: list[dict[str, Any]] = []
        skipped: list[dict[str, str]] = []
        seen_links: set[str] = set()
        seen_pages: set[str] = set()
        seen_sitemaps: set[str] = set()
        seen_events: set[str] = set()
        merged = {
            "source": source,
            "seedUrl": ", ".join(source_seed_urls(source)),
            "discoveredCount": 0,
            "savedCount": 0,
            "updatedCount": 0,
            "processedCount": 0,
            "skippedCount": 0,
            "futureFilteredCount": 0,
            "belowThresholdCount": 0,
            "errorCount": 0,
        }
        for result in results:
            merged["discoveredCount"] += int(result.get("discoveredCount", len(result.get("candidateLinks", []))))
            merged["savedCount"] += int(result.get("savedCount", 0))
            merged["updatedCount"] += int(result.get("updatedCount", 0))
            merged["processedCount"] += int(result.get("processedCount", 0))
            merged["skippedCount"] += int(result.get("skippedCount", 0))
            merged["futureFilteredCount"] += int(result.get("futureFilteredCount", 0))
            merged["belowThresholdCount"] += int(result.get("belowThresholdCount", 0))
            merged["errorCount"] += int(result.get("errorCount", 0))
            for link in result.get("candidateLinks", []):
                if link and link not in seen_links:
                    seen_links.add(link)
                    candidate_links.append(link)
            for page in result.get("pagesVisited", []):
                if page and page not in seen_pages:
                    seen_pages.add(page)
                    pages_visited.append(page)
            for page in result.get("sitemapLinks", []):
                if page and page not in seen_sitemaps:
                    seen_sitemaps.add(page)
                    sitemap_links.append(page)
            for event in result.get("events", []):
                key = event.get("_id") or event.get("websiteUrl") or event.get("name")
                if key and key not in seen_events:
                    seen_events.add(key)
                    events.append(event)
            skipped.extend(result.get("skipped", []))
        merged["candidateLinks"] = candidate_links
        merged["pagesVisited"] = pages_visited
        merged["sitemapLinks"] = sitemap_links
        merged["events"] = events
        merged["skipped"] = skipped
        return merged

    def _score_and_store_many(
        self,
        source: str,
        seed_url: str,
        raw_events: list[dict[str, Any]],
        min_score: int,
        pages_visited: list[str],
        sitemap_links: list[str],
    ) -> dict[str, Any]:
        results: list[dict[str, Any]] = []
        skipped: list[dict[str, str]] = []
        inserted_count = 0
        updated_count = 0
        candidate_links: list[str] = []
        future_filtered_count = 0
        score_filtered_count = 0

        for raw_event in raw_events:
            raw_event["source"] = source
            event_url = str(raw_event.get("websiteUrl", "")).strip()
            if event_url:
                candidate_links.append(event_url)
            future_error = self._future_eligibility_error(raw_event)
            if future_error:
                future_filtered_count += 1
                skipped.append({"url": event_url or raw_event.get("name", ""), "reason": future_error})
                continue
            scored_event = self.rule_engine.enrich_and_score(raw_event)
            if scored_event.get("finalScore", 0) < min_score:
                score_filtered_count += 1
                skipped.append({"url": event_url or scored_event.get("name", ""), "reason": f"score<{min_score}"})
                continue
            inserted_id, is_new = self.store.upsert_event(scored_event)
            scored_event["_id"] = str(inserted_id)
            scored_event["persistenceAction"] = "inserted" if is_new else "updated"
            if is_new:
                inserted_count += 1
            else:
                updated_count += 1
            results.append(scored_event)

        return {
            "source": source,
            "seedUrl": seed_url,
            "candidateLinks": candidate_links,
            "pagesVisited": pages_visited,
            "sitemapLinks": sitemap_links,
            "discoveredCount": len(raw_events),
            "savedCount": inserted_count,
            "updatedCount": updated_count,
            "processedCount": len(results),
            "skippedCount": len(skipped),
            "futureFilteredCount": future_filtered_count,
            "belowThresholdCount": score_filtered_count,
            "errorCount": 0,
            "events": results,
            "skipped": skipped,
        }

    def _score_and_store(self, raw_event: dict[str, Any]) -> dict[str, Any]:
        future_error = self._future_eligibility_error(raw_event)
        if future_error:
            raise RuntimeError(future_error)
        scored_event = self.rule_engine.enrich_and_score(raw_event)
        inserted_id, is_new = self.store.upsert_event(scored_event)
        scored_event["_id"] = str(inserted_id)
        scored_event["savedCount"] = 1 if is_new else 0
        scored_event["updatedCount"] = 0 if is_new else 1
        scored_event["processedCount"] = 1
        scored_event["persistenceAction"] = "inserted" if is_new else "updated"
        return scored_event

    @staticmethod
    def _future_eligibility_error(event: dict[str, Any]) -> str:
        start_date = event.get("startDate")
        if not isinstance(start_date, datetime):
            return f"missing startDate or not parseable; requires >= {MIN_EVENT_LEAD_DAYS} days lead"
        delta = (start_date.astimezone(timezone.utc).date() - datetime.now(timezone.utc).date()).days
        if delta < MIN_EVENT_LEAD_DAYS:
            return f"startDate<{MIN_EVENT_LEAD_DAYS}days"
        return ""

    @staticmethod
    def _api_credential(source: str) -> str:
        if source == "predicthq":
            return clean_text(PREDICTHQ_API_KEY)
        return ""

    def _fetch_api_events(self, source: str, credential: str, max_links: int) -> list[dict[str, Any]]:
        if source == "predicthq":
            return self._fetch_predicthq_events(credential, max_links=max_links)
        raise RuntimeError(f"No API integration is configured for {source}")

    def _fetch_predicthq_events(self, api_token: str, max_links: int) -> list[dict[str, Any]]:
        session = EventScraper("predicthq").session
        collected: list[dict[str, Any]] = []
        seen: set[str] = set()
        min_start = (datetime.now(timezone.utc) + timedelta(days=MIN_EVENT_LEAD_DAYS)).date().isoformat()
        link_limit = max_links if max_links > 0 else 1_000_000
        country_code = country_search_code(TARGET_LOCATION_CONTEXT.country)
        within_param = TARGET_LOCATION_CONTEXT.within_param()
        search_terms = list(industry_search_terms())[:12] or [""]
        for keyword in search_terms:
            offset = 0
            batch_size = min(link_limit, 100)
            while len(collected) < link_limit:
                query_params = {
                    "category": "conferences,expos",
                    "limit": batch_size,
                    "offset": offset,
                    "sort": "start",
                    "start.gte": min_start,
                }
                if keyword:
                    query_params["q"] = keyword
                if country_code:
                    query_params["country"] = country_code
                if within_param:
                    query_params["within"] = within_param
                response = session.get(
                    "https://api.predicthq.com/v1/events/",
                    headers={"Authorization": f"Bearer {api_token}"},
                    params=query_params,
                    timeout=25,
                )
                if response.status_code >= 400:
                    raise RuntimeError(f"predicthq API failed with HTTP {response.status_code}")
                payload = response.json()
                events = payload.get("results", [])
                if not events:
                    break
                for event in events:
                    url = clean_text(event.get("url"))
                    dedupe_key = url or clean_text(event.get("id"))
                    if dedupe_key and dedupe_key in seen:
                        continue
                    if dedupe_key:
                        seen.add(dedupe_key)
                    labels = [clean_text(label) for label in event.get("labels", []) if clean_text(label)]
                    category = clean_text(event.get("category"))
                    if category:
                        labels.insert(0, category)
                    geo = event.get("geo") or {}
                    geo_address = geo.get("address") or {}
                    location_value = event.get("location")
                    latitude = longitude = None
                    address_parts: list[str] = []
                    if isinstance(location_value, list) and len(location_value) >= 2:
                        longitude = location_value[0]
                        latitude = location_value[1]
                        if latitude is not None and longitude is not None:
                            address_parts.append(f"{latitude}, {longitude}")
                    formatted_address = clean_text(geo_address.get("formatted_address"))
                    country = country_display_name(event.get("country"))
                    if formatted_address:
                        address_parts = [formatted_address]
                    elif country:
                        address_parts.append(country)
                    address = clean_text(", ".join(address_parts))
                    locality = clean_text(geo_address.get("locality"))
                    region = clean_text(geo_address.get("region"))
                    venue = clean_text(", ".join(part for part in (locality, region) if part))
                    collected.append(
                        {
                            "source": "predicthq",
                            "websiteUrl": url,
                            "name": clean_text(event.get("title")),
                            "description": clean_text(event.get("description") or event.get("category")),
                            "venue": venue,
                            "address": address or clean_text(event.get("country") or ""),
                            "startDate": parse_datetime(event.get("start")),
                            "endDate": parse_datetime(event.get("end")),
                            "registrationFee": None,
                            "registrationCurrency": "",
                            "attendeesCount": event.get("phq_attendance"),
                            "exhibitorsCount": None,
                            "latitude": latitude,
                            "longitude": longitude,
                            "tags": labels,
                            "sponsors": [],
                        }
                    )
                    if len(collected) >= link_limit:
                        return collected[:link_limit]
                offset += len(events)
        return collected[:link_limit]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Single-file event scraper with scoring and MongoDB storage.")
    parser.add_argument("source", nargs="?", help="Source name: predicthq, meetup, eventbrite, mccia, nasscom, mea")
    parser.add_argument("url", nargs="?", help="Optional event or listing URL override. If omitted, the built-in source URL or API path is used.")
    parser.add_argument("--min-score", type=int, default=50, help="Minimum score required when crawling listing pages")
    parser.add_argument("--max-links", type=int, default=20, help="Maximum candidate event links to crawl from a listing page")
    parser.add_argument("--max-pages", type=int, default=30, help="Maximum pages to scan on the same site")
    parser.add_argument("--max-depth", type=int, default=2, help="Maximum crawl depth from the starting URL")
    parser.add_argument(
        "--backfill-roi-role-comparison",
        action="store_true",
        help="Recompute live CRM ROI fields for existing events missing them.",
    )
    parser.add_argument(
        "--backfill-limit",
        type=int,
        default=0,
        help="Optional limit when backfilling CRM ROI role comparison. 0 means all matching events.",
    )
    return parser


def backfill_crm_roi_role_comparison(limit: int = 0) -> dict[str, Any]:
    predictor = LocalROIPredictor()
    model = predictor._load_benchmark()
    if not model.get("trained"):
        return {
            "trained": False,
            "updatedCount": 0,
            "skippedCount": 0,
            "errorCount": 0,
            "detail": model.get("detail", "live crm roi benchmark is not available"),
        }

    client = MongoClient(MONGO_URI)
    try:
        database = client[DATABASE_NAME]
        events_collection = database[CRM_EVENTS_COLLECTION_NAME]
        industries_collection = database["industries"]
        industry_name_map = {
            str(document.get("_id")): clean_text(document.get("name"))
            for document in industries_collection.find({}, {"name": 1})
        }

        query: dict[str, Any] = {
            "is_deleted": {"$ne": True},
            "status": {"$ne": "completed"},
            "startDate": {"$ne": None},
        }
        cursor = events_collection.find(query).sort("updatedAt", -1)
        if limit > 0:
            cursor = cursor.limit(limit)

        updated_count = 0
        skipped_count = 0
        error_count = 0
        errors: list[dict[str, Any]] = []

        for document in cursor:
            try:
                industry_value = document.get("industry")
                event_payload = {
                    "name": clean_text(document.get("name")),
                    "description": clean_text(document.get("description")),
                    "venue": clean_text(document.get("venue")),
                    "address": clean_text(document.get("address")),
                    "startDate": parse_datetime(document.get("startDate")),
                    "endDate": parse_datetime(document.get("endDate")),
                    "registrationFee": document.get("registrationFee"),
                    "registrationCurrency": clean_text(document.get("registrationCurrency")),
                    "attendeesCount": document.get("attendeesCount"),
                    "exhibitorsCount": document.get("exhibitorsCount"),
                    "websiteUrl": clean_text(document.get("websiteUrl")),
                    "industry": industry_name_map.get(str(industry_value), clean_text(str(industry_value))),
                }
                roi_result = predictor.predict_event(event_payload)
                if not roi_result.get("trained") or roi_result.get("predictedROI") is None:
                    skipped_count += 1
                    continue

                role_predictions = roi_result.get("rolePredictions", {}) or {}
                update_data = {
                    "predictedROI": roi_result.get("predictedROI"),
                    "roiPredictionConfidence": roi_result.get("confidence", 0),
                    "expectedROIRange": roi_result.get("expectedROIRange", ""),
                    "recommendedParticipationRole": roi_result.get("recommendedRole", ""),
                    "roiDecisionSummary": roi_result.get("decisionSummary", ""),
                    "roiRoleComparison": (
                        {
                            "recommendedRole": roi_result.get("recommendedRole", ""),
                            "inferredRole": roi_result.get("inferredRole", ""),
                            "decisionSummary": roi_result.get("decisionSummary", ""),
                            "Visitor": role_predictions.get("Visitor"),
                            "Exhibitor": role_predictions.get("Exhibitor"),
                        }
                        if role_predictions
                        else None
                    ),
                    "updatedAt": datetime.now(timezone.utc),
                }
                events_collection.update_one({"_id": document["_id"]}, {"$set": update_data})
                updated_count += 1
            except Exception as exc:
                error_count += 1
                errors.append(
                    {
                        "eventId": str(document.get("_id")),
                        "name": clean_text(document.get("name")),
                        "error": str(exc),
                    }
                )

        return {
            "trained": True,
            "updatedCount": updated_count,
            "skippedCount": skipped_count,
            "errorCount": error_count,
            "errors": errors[:20],
            "detail": f"backfilled crm roi fields using {model.get('rows', 0)} completed CRM outcomes",
        }
    finally:
        client.close()


def main() -> None:
    args = build_parser().parse_args()
    if args.backfill_roi_role_comparison:
        result = backfill_crm_roi_role_comparison(limit=max(0, int(args.backfill_limit)))
        print(json.dumps(json_ready(result), indent=2))
        return

    if not args.source:
        raise SystemExit("A source is required unless you are using --backfill-roi-role-comparison.")
    app = ScraperApp()
    try:
        if args.url:
            result = app.process_url(
                args.source,
                args.url,
                min_score=args.min_score,
                max_links=args.max_links,
                max_pages=args.max_pages,
                max_depth=args.max_depth,
            )
        else:
            result = app.process_source(
                args.source,
                min_score=args.min_score,
                max_links=args.max_links,
                max_pages=args.max_pages,
                max_depth=args.max_depth,
            )
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps(json_ready(result), indent=2))


if __name__ == "__main__":
    main()
