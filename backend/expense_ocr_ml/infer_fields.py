import argparse
import json
import pickle
from pathlib import Path

from field_helpers import (
    PAYMENT_SCREENSHOT_HINTS,
    clean_text,
    looks_like_description_text,
    looks_like_vendor_text,
    normalize_amount_text,
    normalize_date_text,
    normalize_vendor_text,
)
from field_inference import (
    choose_best_fields_from_candidates,
    combine_predictions,
    infer_category_from_lines,
    infer_date_from_lines,
    infer_description_from_lines,
    infer_total_from_lines,
    infer_vendor_from_lines,
    repair_total_field,
)
from ocr_ensemble import run_ocr_ensemble

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL_PATH = ROOT / "artifacts" / "field_model.pkl"
DEFAULT_CATEGORY_MODEL_PATH = ROOT / "artifacts" / "category_model.pkl"


def crop_image(image_path: Path, crop_rect: dict) -> Path:
    """Crop the image according to crop_rect and return the path to the cropped image."""
    img = cv2.imread(str(image_path))
    if img is None:
        raise SystemExit(f"Failed to load image: {image_path}")
    
    height, width = img.shape[:2]
    x = int(crop_rect['x'] / 100 * width)
    y = int(crop_rect['y'] / 100 * height)
    w = int(crop_rect['width'] / 100 * width)
    h = int(crop_rect['height'] / 100 * height)
    
    cropped = img[y:y+h, x:x+w]
    
    cropped_path = image_path.parent / f"{image_path.stem}_cropped{image_path.suffix}"
    cv2.imwrite(str(cropped_path), cropped)
    return cropped_path


def main():
    parser = argparse.ArgumentParser(description="Infer expense fields from a new image using OCR ensemble + ML.")
    parser.add_argument("--image", required=True, help="Path to the receipt or payment screenshot image")
    parser.add_argument("--model", default=str(DEFAULT_MODEL_PATH), help="Path to the trained model artifact")
    parser.add_argument(
        "--category-model",
        default=str(DEFAULT_CATEGORY_MODEL_PATH),
        help="Path to the trained category model artifact",
    )
    parser.add_argument(
        "--crop-rect",
        help="Cropping rectangle as JSON string with x,y,width,height percentages",
    )
    args = parser.parse_args()

    image_path = Path(args.image).resolve()
    model_path = Path(args.model).resolve()
    category_model_path = Path(args.category_model).resolve()
    
    crop_rect = None
    if args.crop_rect:
        try:
            crop_rect = json.loads(args.crop_rect)
        except json.JSONDecodeError:
            raise SystemExit(f"Invalid crop-rect JSON: {args.crop_rect}")
    
    if not image_path.exists():
        raise SystemExit(f"Image not found: {image_path}")
    if not model_path.exists():
        raise SystemExit(f"Model not found: {model_path}. Train first with train_field_model.py")

    with model_path.open("rb") as handle:
        model_bundle = pickle.load(handle)

    category_model_bundle = None
    if category_model_path.exists():
        with category_model_path.open("rb") as handle:
            category_model_bundle = pickle.load(handle)

    # Apply cropping if specified
    ocr_image_path = image_path
    if crop_rect:
        ocr_image_path = crop_image(image_path, crop_rect)
    
    ocr_payload = run_ocr_ensemble(ocr_image_path)
    candidates = list(ocr_payload.get("candidates", []))
    lines = list(ocr_payload.get("lines", []))
    document_style = str(ocr_payload.get("document_style", "receipt"))
    if document_style == "receipt":
        text_blob = " ".join(clean_text(line.get("text", "")) for line in lines).lower()
        if any(hint in text_blob for hint in PAYMENT_SCREENSHOT_HINTS):
            document_style = "payment_screenshot"

    ml_fields = choose_best_fields_from_candidates(model_bundle, candidates + lines, document_style)
    heuristic_fields = {
        "Vendor": infer_vendor_from_lines(lines, document_style),
        "Date": infer_date_from_lines(lines),
        "Total": infer_total_from_lines(lines, document_style),
        "Description": infer_description_from_lines(lines),
    }
    heuristic_fields = {key: value for key, value in heuristic_fields.items() if value}

    fields = combine_predictions(ml_fields, heuristic_fields)
    repaired_total = repair_total_field(fields.get("Total"), candidates + lines, document_style)
    if repaired_total:
        fields["Total"] = repaired_total

    predicted_category = infer_category_from_lines(lines, fields, category_model_bundle, document_style)
    if predicted_category:
        fields["Category"] = predicted_category

    output = {
        "image": str(image_path),
        "document_style": document_style,
        "engine_counts": ocr_payload.get("engines", {}),
        "ocr_line_count": len(lines),
        "fields": fields,
        "predicted_category": predicted_category["text"] if predicted_category else "Other",
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
