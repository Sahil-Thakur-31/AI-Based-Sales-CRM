import json
import os
import shutil
import sys
from pathlib import Path

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


def load_payload():
    if len(sys.argv) < 2:
        raise ValueError("Missing payload")
    return json.loads(sys.argv[1])


def maybe_run_easyocr(image_paths):
    try:
        patch_bidi_for_easyocr()
        import easyocr  # type: ignore
    except Exception:
        return [{
            "engine": "easyocr",
            "available": False,
            "text": "",
            "confidence": 0,
            "error": "easyocr_not_installed",
        }]

    try:
        reader = easyocr.Reader(["en"], gpu=False)
        collected = []
        confidences = []
        for image_path in image_paths[:2]:
            results = reader.readtext(image_path, detail=1, paragraph=True)
            for item in results:
                collected.append(str(item[1]))
                confidences.append(float(item[2]))
        return [{
            "engine": "easyocr",
            "available": True,
            "text": "\n".join(collected),
            "confidence": round((sum(confidences) / len(confidences) * 100) if confidences else 0, 2),
        }]
    except Exception as exc:
        return [{
            "engine": "easyocr",
            "available": False,
            "text": "",
            "confidence": 0,
            "error": str(exc),
        }]


def get_tesseract_command() -> str | None:
    env_cmd = os.environ.get("TESSERACT_CMD") or os.environ.get("TESSERACT_PATH")
    if env_cmd:
        candidate = Path(env_cmd)
        if candidate.exists():
            return str(candidate)

    default_windows = Path("C:/Program Files/Tesseract-OCR/tesseract.exe")
    if default_windows.exists():
        return str(default_windows)

    return None


def maybe_run_pytesseract(image_paths):
    try:
        import pytesseract  # type: ignore
    except Exception:
        return [{
            "engine": "pytesseract",
            "available": False,
            "text": "",
            "confidence": 0,
            "error": "pytesseract_not_installed",
        }]

    tesseract_cmd = get_tesseract_command()
    if tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

    if not shutil.which("tesseract") and not tesseract_cmd:
        return [{
            "engine": "pytesseract",
            "available": False,
            "text": "",
            "confidence": 0,
            "error": "tesseract_binary_not_found",
        }]

    try:
        collected = []
        confidences = []
        for image_path in image_paths[:2]:
            data = pytesseract.image_to_data(str(image_path), output_type=pytesseract.Output.DICT, config="--psm 6")
            words = []
            for index, word in enumerate(data.get("text", [])):
                cleaned = str(word).strip()
                if not cleaned:
                    continue
                words.append(cleaned)
                try:
                    conf = float(data["conf"][index])
                    if conf >= 0:
                        confidences.append(conf)
                except Exception:
                    continue
            collected.append(" ".join(words))
        return [{
            "engine": "pytesseract",
            "available": True,
            "text": "\n".join(collected),
            "confidence": round(sum(confidences) / len(confidences), 2) if confidences else 0,
        }]
    except Exception as exc:
        return [{
            "engine": "pytesseract",
            "available": False,
            "text": "",
            "confidence": 0,
            "error": str(exc),
        }]


def apply_rotation(image, rotation):
    turns = int((rotation or 0) / 90) % 4
    if turns == 1:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if turns == 2:
        return cv2.rotate(image, cv2.ROTATE_180)
    if turns == 3:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return image


def apply_crop(image, crop_rect):
    if not crop_rect:
        return image
    height, width = image.shape[:2]
    x = max(0, min(width - 1, int((crop_rect.get("x", 0) / 100) * width)))
    y = max(0, min(height - 1, int((crop_rect.get("y", 0) / 100) * height)))
    w = max(1, int((crop_rect.get("width", 0) / 100) * width))
    h = max(1, int((crop_rect.get("height", 0) / 100) * height))
    x2 = min(width, x + w)
    y2 = min(height, y + h)
    return image[y:y2, x:x2]


def clamp_number(value, minimum, maximum, fallback):
    try:
        numeric = float(value)
    except Exception:
        return fallback
    return max(minimum, min(maximum, numeric))


def apply_tone_adjustments(image, brightness, contrast):
    normalized_brightness = clamp_number(brightness, 20, 300, 100) / 100.0
    normalized_contrast = clamp_number(contrast, 20, 300, 100) / 100.0

    adjusted = image.astype(np.float32) * normalized_brightness
    midpoint = 127.5
    adjusted = ((adjusted - midpoint) * normalized_contrast) + midpoint
    return np.clip(adjusted, 0, 255).astype(np.uint8)


def save_variant(target_dir: Path, label: str, image):
    target_path = target_dir / f"{label}.png"
    cv2.imwrite(str(target_path), image)
    return {"label": label, "path": str(target_path)}


def build_variants(base_image, work_dir: Path):
    variants = []

    enlarged = cv2.resize(base_image, None, fx=1.7, fy=1.7, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(enlarged, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    threshold = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    sharpen = cv2.addWeighted(blur, 1.7, cv2.GaussianBlur(blur, (0, 0), 3), -0.7, 0)

    variants.append(save_variant(work_dir, "original", enlarged))
    variants.append(save_variant(work_dir, "threshold", threshold))
    variants.append(save_variant(work_dir, "sharpen", sharpen))

    return variants


def main():
    payload = load_payload()
    image_path = Path(payload["imagePath"])
    work_dir = Path(payload["workDir"])
    work_dir.mkdir(parents=True, exist_ok=True)

    if image_path.suffix.lower() == ".pdf":
        print(json.dumps({
            "variants": [],
            "ocrResults": [],
            "warnings": ["PDF OCR preprocessing is not available in the current local Python environment."],
        }))
        return

    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError("Failed to read receipt image")

    image = apply_rotation(image, payload.get("rotation"))
    image = apply_crop(image, payload.get("cropRect"))
    image = apply_tone_adjustments(
        image,
        payload.get("brightness", 100),
        payload.get("contrast", 100),
    )

    variants = build_variants(image, work_dir)

    print(json.dumps({
        "variants": variants,
        "ocrResults": [],
        "warnings": [],
    }))


if __name__ == "__main__":
    main()
