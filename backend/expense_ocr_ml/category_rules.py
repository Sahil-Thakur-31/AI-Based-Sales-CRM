import re


STANDARD_CATEGORIES = ["Travel", "Food", "Hotel", "Stationery", "Medical", "Other"]
RAW_TO_STANDARD_CATEGORY = {
    "Travel": "Travel",
    "Food": "Food",
    "Hotel": "Hotel",
    "Stationery": "Stationery",
    "Stationary": "Stationery",
    "Medical": "Medical",
    "Shopping": "Other",
    "Groceries": "Other",
    "Utilities": "Other",
    "Other": "Other",
}

CATEGORY_RULES = {
    "Travel": (
        "travel",
        "trip",
        "taxi",
        "cab",
        "uber",
        "ola",
        "bus",
        "train",
        "flight",
        "airline",
        "fuel",
        "petrol",
        "diesel",
        "parking",
        "toll",
        "metro",
        "irctc",
        "redbus",
        "indigo",
        "air india",
        "spicejet",
        "fastag",
        "rapido",
    ),
    "Food": (
        "food",
        "meal",
        "breakfast",
        "lunch",
        "dinner",
        "snack",
        "restaurant",
        "cafe",
        "coffee",
        "tea",
        "swiggy",
        "zomato",
        "mcdonalds",
        "kfc",
        "dominos",
        "subway",
        "starbucks",
        "bakery",
        "bakers",
        "pizza",
        "burger",
        "sweets",
        "juice",
        "kitchen",
        "dining",
        "dhaba",
        "biryani",
        "thali",
        "bhavan",
        "bhuvan",
    ),
    "Hotel": (
        "hotel",
        "stay",
        "room",
        "lodging",
        "resort",
        "inn",
        "guest house",
        "guesthouse",
        "accommodation",
        "oyo",
        "airbnb",
        "makemytrip",
        "agoda",
        "booking",
    ),
    "Stationery": (
        "stationary",
        "stationery",
        "office supply",
        "office supplies",
        "notebook",
        "pen",
        "pencil",
        "paper",
        "print",
        "xerox",
        "copy",
        "cartridge",
        "marker",
        "file folder",
        "blinkit",
        "zepto",
        "instamart",
    ),
    "Medical": (
        "medical",
        "doctor",
        "clinic",
        "hospital",
        "pharmacy",
        "medicine",
        "medicines",
        "diagnostic",
        "lab",
        "consultation",
        "health",
        "scan",
        "test",
        "apollo",
        "pharmeasy",
        "1mg",
        "netmeds",
        "practo",
    ),
}


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").lower()).strip()


def normalize_standard_category(category: str) -> str:
    cleaned = str(category or "").strip().title()
    return RAW_TO_STANDARD_CATEGORY.get(cleaned, "Other")


def predict_standard_category(*texts: str) -> str:
    haystack = " ".join(clean_text(text) for text in texts if text).strip()
    if not haystack:
        return "Other"

    scores = {category: 0 for category in STANDARD_CATEGORIES}
    for category, keywords in CATEGORY_RULES.items():
        for keyword in keywords:
            if keyword in haystack:
                scores[category] += max(1, len(keyword.split()))

    ranked = sorted(scores.items(), key=lambda item: (item[1], item[0] != "Other"), reverse=True)
    best_category, best_score = ranked[0]
    return best_category if best_score > 0 else "Other"
