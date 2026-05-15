import re
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List

import cv2
import numpy as np


def patch_bidi_for_easyocr():
    try:
        import bidi  # type: ignore
        if hasattr(bidi, "get_display"):
            return
        from bidi.algorithm import get_display as bidi_get_display  # type: ignore
        bidi.get_display = bidi_get_display
    except Exception:
        pass


@dataclass
class OcrCandidate:
    text: str
    confidence: float
    bbox_pct: Dict[str, float]
    engine: str
    variant: str = "original"


DATE_PATTERN = re.compile(
    r"\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b"
    r"|\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b"
    r"|\b\d{1,2}[-./ ](?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[-./ ]\d{2,4}\b",
    re.IGNORECASE,
)
AMOUNT_PATTERN = re.compile(r"(?<!\d)(\d[\d,]*\.?\d{0,2})(?!\d)")
PAYMENT_SCREENSHOT_TERMS = (
    "upi",
    "transaction",
    "debited",
    "credited",
    "paid to",
    "received from",
    "payment",
    "bank",
    "utr",
    "ref no",
    "reference",
    "txn",
    "transferred",
    "google pay",
    "gpay",
    "phonepe",
    "paytm",
    "beneficiary",
)

_EASYOCR_READER = None
OCR_TARGET_MIN_DIM = 1000
OCR_TARGET_MAX_DIM = 1600
OCR_PREFERRED_DIM = 1400
OCR_EARLY_STOP_MIN_LINES = 6
OCR_EARLY_STOP_MIN_AVG_CONFIDENCE = 35.0


def clean_text(text: str) -> str:
    text = str(text or "").replace("\n", " ").replace("\r", " ").strip()
    text = re.sub(r"\s+", " ", text)
    return text


def normalize_for_match(text: str) -> str:
    text = clean_text(text).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def bbox_to_pct(left: float, top: float, width: float, height: float, image_width: float, image_height: float) -> Dict[str, float]:
    if image_width <= 0 or image_height <= 0:
        return {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0, "x2": 0.0, "y2": 0.0}
    x = max(0.0, min(100.0, (left / image_width) * 100.0))
    y = max(0.0, min(100.0, (top / image_height) * 100.0))
    w = max(0.0, min(100.0 - x, (width / image_width) * 100.0))
    h = max(0.0, min(100.0 - y, (height / image_height) * 100.0))
    return {
        "x": round(x, 4),
        "y": round(y, 4),
        "width": round(w, 4),
        "height": round(h, 4),
        "x2": round(x + w, 4),
        "y2": round(y + h, 4),
    }


def looks_like_payment_screenshot(text_blob: str) -> bool:
    lowered = clean_text(text_blob).lower()
    return any(term in lowered for term in PAYMENT_SCREENSHOT_TERMS)


def build_image_variants(image_path: Path) -> List[tuple[str, Path]]:
    image = cv2.imread(str(image_path))
    if image is None:
        return [("original", image_path)]

    height, width = image.shape[:2]
    max_dim = max(width, height)
    min_dim = min(width, height)
    scale = 1.0
    if max_dim < OCR_PREFERRED_DIM and max_dim > 0:
        scale = min(1.55, OCR_PREFERRED_DIM / max_dim)
    if max_dim < OCR_TARGET_MIN_DIM and max_dim > 0:
        scale = max(scale, OCR_TARGET_MIN_DIM / max_dim)
    elif max_dim > OCR_TARGET_MAX_DIM:
        scale = OCR_TARGET_MAX_DIM / max_dim
    elif min_dim < 900 and min_dim > 0:
        scale = max(scale, 900 / min_dim)

    if abs(scale - 1.0) > 0.02:
        enlarged = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    else:
        enlarged = image.copy()

    temp_root = Path(__file__).resolve().parent / "_tmp"
    temp_root.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", image_path.stem)
    temp_dir = temp_root / safe_name
    temp_dir.mkdir(parents=True, exist_ok=True)
    path = temp_dir / "original.png"
    cv2.imwrite(str(path), enlarged)
    return [("original", path)]


def maybe_run_easyocr_on_variant(image_path: Path, variant: str) -> List[OcrCandidate]:
    try:
        patch_bidi_for_easyocr()
        import easyocr  # type: ignore
        from PIL import Image
    except Exception:
        return []

    global _EASYOCR_READER
    image = Image.open(image_path)
    width, height = image.size
    if _EASYOCR_READER is None:
        _EASYOCR_READER = easyocr.Reader(["en"], gpu=False)
    results = _EASYOCR_READER.readtext(str(image_path), detail=1, paragraph=False)

    candidates: List[OcrCandidate] = []
    for points, text, confidence in results:
        text = clean_text(text)
        if not text:
            continue
        xs = [float(point[0]) for point in points]
        ys = [float(point[1]) for point in points]
        left = min(xs)
        top = min(ys)
        box_width = max(xs) - left
        box_height = max(ys) - top
        candidates.append(
            OcrCandidate(
                text=text,
                confidence=round(float(confidence) * 100.0, 2),
                bbox_pct=bbox_to_pct(left, top, box_width, box_height, width, height),
                engine="easyocr",
                variant=variant,
            )
        )
    return candidates


def maybe_run_tesseract_on_variant(image_path: Path, variant: str) -> List[OcrCandidate]:
    if variant != "original":
        return []
    try:
        import pytesseract
        from PIL import Image
        import os
        
        tess_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
        if os.path.exists(tess_path):
            pytesseract.pytesseract.tesseract_cmd = tess_path
            
        data = pytesseract.image_to_data(Image.open(image_path), output_type=pytesseract.Output.DICT, timeout=3)
        
        candidates: List[OcrCandidate] = []
        width, height = Image.open(image_path).size
        for i in range(len(data["text"])):
            text = clean_text(data["text"][i])
            if len(text) < 2:
                continue
            conf = float(data["conf"][i])
            if conf < 40.0:
                continue
            left = float(data["left"][i])
            top = float(data["top"][i])
            box_width = float(data["width"][i])
            box_height = float(data["height"][i])
            candidates.append(
                OcrCandidate(
                    text=text,
                    confidence=conf,
                    bbox_pct=bbox_to_pct(left, top, box_width, box_height, width, height),
                    engine="tesseract",
                    variant=variant,
                )
            )
        return candidates
    except Exception as e:
        print(f"Tesseract error: {e}")
        return []


def iou(a: Dict[str, float], b: Dict[str, float]) -> float:
    x_left = max(a["x"], b["x"])
    y_top = max(a["y"], b["y"])
    x_right = min(a["x2"], b["x2"])
    y_bottom = min(a["y2"], b["y2"])
    if x_right <= x_left or y_bottom <= y_top:
        return 0.0
    intersection = (x_right - x_left) * (y_bottom - y_top)
    area_a = a["width"] * a["height"]
    area_b = b["width"] * b["height"]
    union = area_a + area_b - intersection
    return intersection / union if union > 0 else 0.0


def text_similarity(a: str, b: str) -> float:
    a_tokens = set(normalize_for_match(a).split())
    b_tokens = set(normalize_for_match(b).split())
    if not a_tokens or not b_tokens:
        return 0.0
    return len(a_tokens & b_tokens) / len(a_tokens | b_tokens)


def merge_candidates(candidates: Iterable[OcrCandidate]) -> List[OcrCandidate]:
    merged: List[OcrCandidate] = []
    for candidate in sorted(candidates, key=lambda item: (item.confidence, len(item.text)), reverse=True):
        if len(normalize_for_match(candidate.text)) < 2:
            continue
        existing = None
        for current in merged:
            same_region = iou(candidate.bbox_pct, current.bbox_pct) >= 0.5
            same_text = text_similarity(candidate.text, current.text) >= 0.85
            if same_region or same_text:
                existing = current
                break
        if existing is None:
            merged.append(candidate)
            continue
        current_norm = normalize_for_match(existing.text)
        candidate_norm = normalize_for_match(candidate.text)
        current_score = existing.confidence + len(current_norm) * 0.25
        candidate_score = candidate.confidence + len(candidate_norm) * 0.25
        if candidate_score > current_score:
            existing.text = candidate.text
            existing.confidence = candidate.confidence
            existing.bbox_pct = candidate.bbox_pct
            existing.engine = candidate.engine
            existing.variant = candidate.variant
    return merged


def candidate_summary(candidates: List[OcrCandidate]) -> Dict[str, float]:
    if not candidates:
        return {"count": 0.0, "avg_confidence": 0.0, "long_count": 0.0}
    confidences = [candidate.confidence for candidate in candidates]
    long_count = sum(1 for candidate in candidates if len(clean_text(candidate.text)) >= 4)
    return {
        "count": float(len(candidates)),
        "avg_confidence": float(sum(confidences) / len(confidences)),
        "long_count": float(long_count),
    }


def group_candidates_into_lines(candidates: List[OcrCandidate]) -> List[OcrCandidate]:
    rows: List[List[OcrCandidate]] = []
    for candidate in sorted(candidates, key=lambda item: (item.bbox_pct["y"], item.bbox_pct["x"])):
        center_y = candidate.bbox_pct["y"] + candidate.bbox_pct["height"] / 2
        matched_row = None
        for row in rows:
            row_center = sum(item.bbox_pct["y"] + item.bbox_pct["height"] / 2 for item in row) / len(row)
            if abs(center_y - row_center) <= max(1.5, candidate.bbox_pct["height"] * 0.8):
                matched_row = row
                break
        if matched_row is None:
            rows.append([candidate])
        else:
            matched_row.append(candidate)

    lines: List[OcrCandidate] = []
    for row in rows:
        row.sort(key=lambda item: item.bbox_pct["x"])
        text = clean_text(" ".join(item.text for item in row))
        if not text:
            continue
        left = min(item.bbox_pct["x"] for item in row)
        top = min(item.bbox_pct["y"] for item in row)
        right = max(item.bbox_pct["x2"] for item in row)
        bottom = max(item.bbox_pct["y2"] for item in row)
        confidence = sum(item.confidence for item in row) / len(row)
        lines.append(
            OcrCandidate(
                text=text,
                confidence=round(confidence, 2),
                bbox_pct={
                    "x": round(left, 4),
                    "y": round(top, 4),
                    "width": round(right - left, 4),
                    "height": round(bottom - top, 4),
                    "x2": round(right, 4),
                    "y2": round(bottom, 4),
                },
                engine=row[0].engine,
                variant=row[0].variant,
            )
        )
    return lines


def should_stop_after_variant(merged_words: List[OcrCandidate], merged_lines: List[OcrCandidate], variant_index: int) -> bool:
    line_summary = candidate_summary(merged_lines)
    word_summary = candidate_summary(merged_words)
    enough_lines = line_summary["count"] >= OCR_EARLY_STOP_MIN_LINES
    enough_confidence = (
        line_summary["avg_confidence"] >= OCR_EARLY_STOP_MIN_AVG_CONFIDENCE
        or word_summary["avg_confidence"] >= (OCR_EARLY_STOP_MIN_AVG_CONFIDENCE + 6.0)
    )
    enough_content = line_summary["long_count"] >= max(7.0, OCR_EARLY_STOP_MIN_LINES - 1.0)
    return enough_lines and enough_confidence and enough_content


def run_ocr_ensemble(image_path: Path) -> Dict[str, object]:
    variants = build_image_variants(image_path)
    easy: List[OcrCandidate] = []
    tess: List[OcrCandidate] = []
    merged_words: List[OcrCandidate] = []
    merged_lines: List[OcrCandidate] = []

    for index, (variant_name, variant_path) in enumerate(variants):
        easy.extend(maybe_run_easyocr_on_variant(variant_path, variant_name))
        tess.extend(maybe_run_tesseract_on_variant(variant_path, variant_name))
        
        merged_words = merge_candidates([*easy, *tess])
        merged_lines = group_candidates_into_lines(merged_words)
        
        if should_stop_after_variant(merged_words, merged_lines, index):
            break

    if not merged_words:
        merged_words = merge_candidates([*easy, *tess])
    if not merged_lines:
        merged_lines = group_candidates_into_lines(merged_words)

    text_blob = "\n".join(candidate.text for candidate in merged_lines)
    return {
        "document_style": "payment_screenshot" if looks_like_payment_screenshot(text_blob) else "receipt",
        "candidates": [asdict(candidate) for candidate in merged_words],
        "lines": [asdict(candidate) for candidate in merged_lines],
        "engines": {
            "easyocr_count": len(easy),
            "tesseract_count": len(tess),
        },
    }


def text_has_date(text: str) -> bool:
    return bool(DATE_PATTERN.search(clean_text(text)))


def extract_date_value(text: str) -> str:
    match = DATE_PATTERN.search(clean_text(text))
    return match.group(0) if match else ""


def text_has_amount(text: str) -> bool:
    return bool(AMOUNT_PATTERN.search(clean_text(text)))


def extract_amount_values(text: str) -> List[str]:
    return [match.group(1) for match in AMOUNT_PATTERN.finditer(clean_text(text))]
