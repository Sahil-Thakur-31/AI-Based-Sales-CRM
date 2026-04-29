import re
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

import cv2


@dataclass
class OCRResult:
    engine: str
    text: str
    score: float
    avg_conf: float
    line_count: int
    token_count: int
    detections: List[Dict[str, Any]]


def normalize_text(text: str) -> str:
    text = text.replace("\x0c", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def quality_score(text: str, avg_conf: float) -> float:
    if not text:
        return 0.0

    cleaned = normalize_text(text)
    if not cleaned:
        return 0.0

    total = len(cleaned)
    alnum = sum(ch.isalnum() for ch in cleaned)
    alpha = sum(ch.isalpha() for ch in cleaned)
    alnum_ratio = (alnum / total) if total else 0.0
    alpha_ratio = (alpha / total) if total else 0.0

    emails = len(re.findall(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", cleaned))
    phones = len(re.findall(r"(?:\+?\d[\d\s().-]{8,}\d)", cleaned))
    websites = len(re.findall(r"(?:https?://\S+|www\.\S+|\b[a-zA-Z0-9-]+\.(?:com|in|org|net)\b)", cleaned, re.IGNORECASE))

    length_term = min(18.0, (total ** 0.5) * 1.05)
    quality_term = (alnum_ratio * 12.0) + (alpha_ratio * 6.0)
    confidence_term = max(0.0, min(1.0, avg_conf)) * 30.0
    structure_bonus = min(20.0, (emails * 8.0) + (phones * 3.0) + (websites * 4.0))
    line_bonus = min(8.0, cleaned.count("\n") * 0.8)

    return length_term + quality_term + confidence_term + structure_bonus + line_bonus


def _iou_xywh(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    ax1, ay1 = float(a["x"]), float(a["y"])
    ax2, ay2 = ax1 + float(a["width"]), ay1 + float(a["height"])
    bx1, by1 = float(b["x"]), float(b["y"])
    bx2, by2 = bx1 + float(b["width"]), by1 + float(b["height"])
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    ua = (ax2 - ax1) * (ay2 - ay1)
    ub = (bx2 - bx1) * (by2 - by1)
    return inter / max(ua + ub - inter, 1e-9)


def _build_ocr_variants(image_bgr):
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    eq = cv2.equalizeHist(gray)
    blur = cv2.GaussianBlur(gray, (0, 0), 1.2)
    sharp = cv2.addWeighted(gray, 1.6, blur, -0.6, 0)
    adaptive = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
    )
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    upscale = cv2.resize(gray, None, fx=1.7, fy=1.7, interpolation=cv2.INTER_CUBIC)
    denoise = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
    return [image_bgr, gray, eq, sharp, adaptive, otsu, denoise, upscale]


def run_easyocr(image_bgr, reader, font_robust: bool = False) -> OCRResult:
    if reader is None:
        return OCRResult("easyocr", "", 0.0, 0.0, 0, 0, [])

    all_results = []
    if not font_robust:
        try:
            all_results = reader.readtext(image_bgr, detail=1, paragraph=False) or []
        except Exception:
            all_results = []
    else:
        variants = _build_ocr_variants(image_bgr)
        for variant in variants:
            try:
                results = reader.readtext(
                    variant,
                    detail=1,
                    paragraph=False,
                    decoder="beamsearch",
                    contrast_ths=0.1,
                    adjust_contrast=0.7,
                    text_threshold=0.65,
                    low_text=0.35,
                )
                all_results.extend(results or [])
            except Exception:
                continue

    if not all_results:
        return OCRResult("easyocr", "", 0.0, 0.0, 0, 0, [])

    detections: List[Dict[str, Any]] = []
    for box, text, conf in all_results:
        cleaned = (text or "").strip()
        if not cleaned:
            continue
        x_min = float(min(point[0] for point in box))
        y_min = float(min(point[1] for point in box))
        x_max = float(max(point[0] for point in box))
        y_max = float(max(point[1] for point in box))
        detections.append(
            {
                "text": cleaned,
                "x": int(round(x_min)),
                "y": int(round(y_min)),
                "width": int(round(max(1.0, x_max - x_min))),
                "height": int(round(max(1.0, y_max - y_min))),
                "confidence": round(float(conf), 3),
            }
        )

    if not detections:
        return OCRResult("easyocr", "", 0.0, 0.0, 0, 0, [])

    detections.sort(key=lambda item: float(item.get("confidence", 0.0)), reverse=True)
    merged: List[Dict[str, Any]] = []
    for det in detections:
        if font_robust:
            if len(det["text"]) <= 1 or float(det.get("confidence", 0.0)) < 0.28:
                continue
        duplicate = False
        det_text = det["text"].strip().lower()
        for keep in merged:
            keep_text = keep["text"].strip().lower()
            if (det_text == keep_text and _iou_xywh(det, keep) >= 0.6) or _iou_xywh(det, keep) >= 0.85:
                duplicate = True
                break
        if not duplicate:
            merged.append(det)

    rows: List[Tuple[float, float, str, float]] = []
    confs: List[float] = []
    for det in merged:
        rows.append((float(det["y"]), float(det["x"]), det["text"], float(det["confidence"])))
        confs.append(max(0.0, min(1.0, float(det["confidence"]))))

    rows.sort(key=lambda item: (item[0], item[1]))
    lines = [item[2] for item in rows]
    text = normalize_text("\n".join(lines))
    avg_conf = sum(confs) / len(confs) if confs else 0.0

    return OCRResult(
        engine="easyocr",
        text=text,
        score=round(quality_score(text, avg_conf), 3),
        avg_conf=round(avg_conf, 3),
        line_count=len(lines),
        token_count=len(re.findall(r"\S+", text)),
        detections=merged,
    )
