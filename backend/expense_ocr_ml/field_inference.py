import re
from typing import Dict, List

from category_rules import normalize_standard_category, predict_standard_category
from field_helpers import (
    CATEGORY_MODEL_MIN_CONFIDENCE,
    DESCRIPTION_HINTS,
    DESCRIPTION_NEGATIVE_HINTS,
    FIELD_THRESHOLDS,
    MONTH_PATTERN,
    PAYMENT_VENDOR_LABELS,
    TARGET_FIELDS,
    TOTAL_NEGATIVE_HINTS,
    TOTAL_PRIORITY_HINTS,
    add_field_biases,
    amount_to_float,
    build_category_context,
    build_feature_row,
    clean_text,
    has_category_keywords,
    is_generic_vendor_heading,
    is_reasonable_total_amount,
    line_center_x,
    line_is_amount_only,
    looks_like_category_text,
    looks_like_description_text,
    looks_like_vendor_text,
    maybe_fix_payment_amount_text,
    normalize_amount_text,
    parse_normalized_date_text,
    normalize_date_text,
    normalize_ocr_text,
    normalize_vendor_text,
    score_rule_categories,
    strip_vendor_labels,
    vendor_quality_score,
    vendor_signal,
)


def choose_best_fields_from_candidates(model_bundle: dict, candidates: List[dict], document_style: str) -> Dict[str, dict]:
    model = model_bundle["model"]
    labels = list(model.classes_)
    features = [build_feature_row(candidate, document_style) for candidate in candidates]
    probabilities = model.predict_proba(features) if features else []

    best: Dict[str, dict] = {}
    for index, candidate in enumerate(candidates):
        text = normalize_ocr_text(candidate.get("text", ""))
        if len(text) < 2:
            continue
        row_probs = probabilities[index]
        score_map = {label: float(prob) for label, prob in zip(labels, row_probs)}
        for field in TARGET_FIELDS:
            if field not in score_map:
                continue
            adjusted_score = add_field_biases(field, candidate, document_style, score_map[field])
            if adjusted_score < FIELD_THRESHOLDS[field]:
                continue
            payload = {
                "text": text,
                "score": round(adjusted_score, 4),
                "ocr_confidence": float(candidate.get("confidence", 0.0)),
                "engine": candidate.get("engine", ""),
                "bbox_pct": candidate.get("bbox_pct", {}),
                "variant": candidate.get("variant", ""),
                "source": "ml_candidate",
            }
            current = best.get(field)
            if current is None or payload["score"] > current["score"]:
                best[field] = payload
    return best


def is_suspicious_total_text(text: str) -> bool:
    lowered = normalize_ocr_text(text).lower()
    if any(token in lowered for token in ("invoice", "inv", "vehicle", "bill no", "gstin", "mobile", "phone", "tel")):
        return True
    amount_like_parts = re.findall(r"\d[\d,]*(?:\.\d{1,2})?", lowered)
    if len(amount_like_parts) >= 3 and not any(token in lowered for token in ("total", "amount", "amt", "rs", "inr", "₹")):
        return True
    return False


def infer_vendor_from_lines(lines: List[dict], document_style: str) -> dict | None:
    labeled_pattern = re.compile(
        r"\b(?:merchant|vendor|seller|store|shop|billed by|paid to|pay to|received from|beneficiary|to)\s*[:.\-]?\s*([A-Za-z][A-Za-z0-9 &'.,/-]{2,})",
        re.IGNORECASE,
    )
    labeled_best = None
    for line in lines:
        text = normalize_ocr_text(line.get("text", ""))
        match = labeled_pattern.search(text)
        if not match:
            continue
        candidate_text = normalize_vendor_text(match.group(1))
        if not looks_like_vendor_text(candidate_text):
            continue
        payload = {
            "text": candidate_text,
            "score": round(0.95 if document_style == "payment_screenshot" else 0.9, 4),
            "ocr_confidence": float(line.get("confidence", 0.0)),
            "engine": line.get("engine", ""),
            "bbox_pct": line.get("bbox_pct", {}),
            "variant": line.get("variant", ""),
            "source": "label_heuristic",
        }
        if labeled_best is None or payload["score"] > labeled_best["score"]:
            labeled_best = payload
    if labeled_best is not None:
        return labeled_best

    if document_style == "payment_screenshot":
        for index, line in enumerate(lines):
            text = normalize_ocr_text(line.get("text", ""))
            lowered = text.lower()
            if any(label in lowered for label in ("paid to", "received from")):
                next_line = lines[index + 1] if index + 1 < len(lines) else None
                if next_line:
                    next_text = strip_vendor_labels(next_line.get("text", ""))
                    if looks_like_vendor_text(next_text):
                        return {
                            "text": normalize_vendor_text(next_text),
                            "score": 0.97,
                            "ocr_confidence": float(next_line.get("confidence", 0.0)),
                            "engine": next_line.get("engine", ""),
                            "bbox_pct": next_line.get("bbox_pct", {}),
                            "variant": next_line.get("variant", ""),
                            "source": "neighbor_heuristic",
                        }

        for line in lines:
            text = normalize_ocr_text(line.get("text", ""))
            lowered = text.lower()
            if any(label in lowered for label in PAYMENT_VENDOR_LABELS):
                cleaned = strip_vendor_labels(text)
                if looks_like_vendor_text(cleaned):
                    return {
                        "text": normalize_vendor_text(cleaned),
                        "score": 0.92,
                        "ocr_confidence": float(line.get("confidence", 0.0)),
                        "engine": line.get("engine", ""),
                        "bbox_pct": line.get("bbox_pct", {}),
                        "variant": line.get("variant", ""),
                        "source": "label_heuristic",
                    }

    receipt_top_lines = [line for line in lines if float(line.get("bbox_pct", {}).get("y", 100.0)) <= 38][:12]
    max_height = max((float(line.get("bbox_pct", {}).get("height", 0.0)) for line in receipt_top_lines), default=1.0)

    best = None
    upper_bound = min(len(lines), 14 if document_style == "payment_screenshot" else 12)
    for index, line in enumerate(lines[:upper_bound]):
        text = strip_vendor_labels(line.get("text", ""))
        bbox = line.get("bbox_pct", {})
        y = float(bbox.get("y", 0.0))
        height = float(bbox.get("height", 0.0))
        width = float(bbox.get("width", 0.0))
        center_x = line_center_x(line)
        if not looks_like_vendor_text(text):
            continue

        score = vendor_quality_score(text, y=y, document_style=document_style)
        if index <= 1:
            score += 0.12
        if is_generic_vendor_heading(text):
            score -= 0.40
        if document_style == "receipt":
            if y <= 20:
                score += 0.14
            elif y <= 30:
                score += 0.08
            if 18 <= center_x <= 82:
                score += 0.08
            if height >= max_height * 0.9:
                score += 0.22
            elif height >= max_height * 0.75:
                score += 0.12
            if width <= 70:
                score += 0.05
        payload = {
            "text": normalize_vendor_text(text),
            "score": round(score, 4),
            "ocr_confidence": float(line.get("confidence", 0.0)),
            "engine": line.get("engine", ""),
            "bbox_pct": bbox,
            "variant": line.get("variant", ""),
            "source": "line_heuristic",
        }
        if best is None or payload["score"] > best["score"]:
            best = payload
    return best


def infer_date_from_lines(lines: List[dict]) -> dict | None:
    best = None
    for line in lines:
        text = normalize_ocr_text(line.get("text", ""))
        date_text = parse_normalized_date_text(text)
        if not date_text:
            continue
        score = 0.75
        lowered = text.lower()
        if "date" in lowered or "dt" in lowered:
            score += 0.15
        if re.search(MONTH_PATTERN, lowered, re.IGNORECASE):
            score += 0.08
        if "." in text:
            score += 0.04
        if any(token in lowered for token in ("total", "amount", "amt", "paid", "rs", "inr", "$", "balance")) and "date" not in lowered:
            score -= 0.18
        payload = {
            "text": date_text,
            "score": round(score, 4),
            "ocr_confidence": float(line.get("confidence", 0.0)),
            "engine": line.get("engine", ""),
            "bbox_pct": line.get("bbox_pct", {}),
            "variant": line.get("variant", ""),
            "source": "line_heuristic",
        }
        if best is None or payload["score"] > best["score"]:
            best = payload
    return best


def infer_total_from_lines(lines: List[dict], document_style: str) -> dict | None:
    best = None
    currency_tokens = ("total", "amount", "amt", "inr", "rs", "$", "₹", "paid")
    payment_tokens = ("paid to", "you paid", "money sent", "received from", "debited", "credited")
    max_height = max((float(line.get("bbox_pct", {}).get("height", 0.0)) for line in lines), default=1.0)

    for line in lines:
        text = normalize_ocr_text(line.get("text", ""))
        normalized_amount = normalize_amount_text(text)
        if not normalized_amount:
            continue

        bbox = line.get("bbox_pct", {})
        y = float(bbox.get("y", 0.0))
        x = float(bbox.get("x", 0.0))
        height = float(bbox.get("height", 0.0))
        center_x = line_center_x(line)
        is_largest_font = height >= max_height * 0.85
        amount = maybe_fix_payment_amount_text(text, normalized_amount, document_style, x, y, is_largest_font)
        if not is_reasonable_total_amount(amount):
            continue

        lowered = text.lower()
        score = 0.45 + min(amount_to_float(amount) / 10000.0, 0.2)
        if any(token in lowered for token in currency_tokens):
            score += 0.25
        if any(token in lowered for token in TOTAL_PRIORITY_HINTS):
            score += 0.35
        if line_is_amount_only(text):
            score += 0.20
        if any(token in lowered for token in ("gst", "including gst", "incl gst", "incl. gst")):
            score += 0.14
        if any(token in lowered for token in TOTAL_NEGATIVE_HINTS) and not any(token in lowered for token in TOTAL_PRIORITY_HINTS):
            score -= 0.28
        if document_style == "receipt":
            if y > 45:
                score += 0.08
            if y > 70:
                score += 0.08
            if 28 <= center_x <= 72:
                score += 0.14
            if height >= max_height * 0.9:
                score += 0.16
            elif height >= max_height * 0.75:
                score += 0.08
        if document_style == "payment_screenshot" and any(token in lowered for token in payment_tokens):
            score += 0.16
            score += 0.20
        if document_style == "payment_screenshot" and y < 40:
            score += 0.22
            score += 0.25
            if any(token in lowered for token in ("₹", "rs", "inr")):
                score += 0.30
        if document_style == "payment_screenshot" and 30 <= x <= 70:
            score += 0.08
        if document_style == "payment_screenshot" and len(re.sub(r"[^0-9]", "", amount)) <= 4:
            score += 0.08
        if "balance" in lowered:
            score -= 0.18
        if x > 35:
            score += 0.05
        payload = {
            "text": amount,
            "score": round(score, 4),
            "ocr_confidence": float(line.get("confidence", 0.0)),
            "engine": line.get("engine", ""),
            "bbox_pct": bbox,
            "variant": line.get("variant", ""),
            "source": "line_heuristic",
        }
        if best is None or payload["score"] > best["score"]:
            best = payload
    return best


def repair_total_field(current_total: dict | None, items: List[dict], document_style: str) -> dict | None:
    best = current_total
    for item in items:
        text = normalize_ocr_text(item.get("text", ""))
        lowered = text.lower()
        amount = normalize_amount_text(text)
        if not amount or not is_reasonable_total_amount(amount):
            continue

        score = 0.0
        if any(token in lowered for token in TOTAL_PRIORITY_HINTS):
            score += 0.75
        if any(token in lowered for token in ("total", "amount", "amt", "paid", "rs", "inr", "₹")):
            score += 0.28
        if line_is_amount_only(text):
            score += 0.14
        if any(token in lowered for token in ("gst", "including gst", "incl gst", "incl. gst")):
            score += 0.15
        if any(token in lowered for token in TOTAL_NEGATIVE_HINTS) and not any(token in lowered for token in TOTAL_PRIORITY_HINTS):
            score -= 0.35

        bbox = item.get("bbox_pct", {})
        y = float(bbox.get("y", 0.0))
        center_x = line_center_x(item)
        if document_style == "receipt" and y > 55:
            score += 0.08
        if document_style == "receipt" and 28 <= center_x <= 72:
            score += 0.10

        payload = {
            "text": amount,
            "score": round(score + float(item.get("confidence", 0.0)) / 200.0, 4),
            "ocr_confidence": float(item.get("confidence", 0.0)),
            "engine": item.get("engine", ""),
            "bbox_pct": bbox,
            "variant": item.get("variant", ""),
            "source": "total_repair",
        }
        if best is None or payload["score"] > best["score"]:
            best = payload
    return best


def infer_description_from_lines(lines: List[dict]) -> dict | None:
    best = None
    for line in lines:
        text = normalize_ocr_text(line.get("text", ""))
        if not looks_like_description_text(text):
            continue
        lowered = text.lower()
        score = 0.40
        chosen_text = text
        product_match = re.search(r"\b(petrol|diesel|fuel)\b", lowered)
        if product_match:
            chosen_text = product_match.group(1).upper()
            score += 0.35
        if any(hint in lowered for hint in DESCRIPTION_HINTS):
            score += 0.25
        if any(token in lowered for token in ("product", "item", "desc")):
            score += 0.15
        if len(chosen_text) > 80:
            score -= 0.18
        if any(token in lowered for token in ("invoice", "gst", "grand total", "total amount")):
            score -= 0.22
        if any(token in lowered for token in DESCRIPTION_NEGATIVE_HINTS):
            score -= 0.35
        payload = {
            "text": chosen_text,
            "score": round(score, 4),
            "ocr_confidence": float(line.get("confidence", 0.0)),
            "engine": line.get("engine", ""),
            "bbox_pct": line.get("bbox_pct", {}),
            "variant": line.get("variant", ""),
            "source": "line_heuristic",
        }
        if best is None or payload["score"] > best["score"]:
            best = payload
    return best


def predict_category_with_model(category_model_bundle: dict | None, category_context: str) -> tuple[str, float]:
    if not category_model_bundle or not category_context:
        return "Other", 0.0
    try:
        model = category_model_bundle["model"]
        predicted = clean_text(model.predict([category_context])[0]) or "Other"
        confidence = 0.0
        if hasattr(model, "predict_proba"):
            probabilities = model.predict_proba([category_context])[0]
            confidence = float(max(probabilities)) if len(probabilities) else 0.0
        return predicted, confidence
    except Exception:
        return "Other", 0.0


def infer_category_from_lines(
    lines: List[dict],
    known_fields: Dict[str, dict],
    category_model_bundle: dict | None = None,
    document_style: str = "receipt",
) -> dict | None:
    category_context = build_category_context(lines, known_fields)
    if document_style == "payment_screenshot" and not has_category_keywords(category_context):
        return {
            "text": "Other",
            "score": 0.95,
            "ocr_confidence": known_fields.get("Category", {}).get("ocr_confidence", 0.0),
            "engine": known_fields.get("Category", {}).get("engine", ""),
            "bbox_pct": known_fields.get("Category", {}).get("bbox_pct", {}),
            "variant": known_fields.get("Category", {}).get("variant", ""),
            "source": "payment_screenshot_default",
        }

    predicted_from_model, model_confidence = predict_category_with_model(category_model_bundle, category_context)
    rule_scores = score_rule_categories(category_context)
    best_rule_category, best_rule_score = max(rule_scores.items(), key=lambda item: item[1]) if rule_scores else ("Other", 0)

    if predicted_from_model != "Other" and (
        model_confidence >= CATEGORY_MODEL_MIN_CONFIDENCE or predicted_from_model == best_rule_category
    ):
        return {
            "text": normalize_standard_category(predicted_from_model),
            "score": round(max(0.80, model_confidence), 4),
            "ocr_confidence": known_fields.get("Category", {}).get("ocr_confidence", 0.0),
            "engine": known_fields.get("Category", {}).get("engine", ""),
            "bbox_pct": known_fields.get("Category", {}).get("bbox_pct", {}),
            "variant": known_fields.get("Category", {}).get("variant", ""),
            "source": "category_model_full_receipt",
        }

    if best_rule_score > 0:
        return {
            "text": normalize_standard_category(best_rule_category),
            "score": round(0.82 + min(best_rule_score / 20.0, 0.12), 4),
            "ocr_confidence": known_fields.get("Category", {}).get("ocr_confidence", 0.0),
            "engine": known_fields.get("Category", {}).get("engine", ""),
            "bbox_pct": known_fields.get("Category", {}).get("bbox_pct", {}),
            "variant": known_fields.get("Category", {}).get("variant", ""),
            "source": "category_rule_full_receipt",
        }

    predicted = predict_standard_category(
        known_fields.get("Description", {}).get("text", ""),
        known_fields.get("Vendor", {}).get("text", ""),
        category_context,
    )
    return {
        "text": normalize_standard_category(predicted),
        "score": 0.88 if predicted != "Other" else 0.7,
        "ocr_confidence": known_fields.get("Category", {}).get("ocr_confidence", 0.0),
        "engine": known_fields.get("Category", {}).get("engine", ""),
        "bbox_pct": known_fields.get("Category", {}).get("bbox_pct", {}),
        "variant": known_fields.get("Category", {}).get("variant", ""),
        "source": "category_rule" if predicted != "Other" else "category_default",
    }


def combine_predictions(ml_fields: Dict[str, dict], heuristic_fields: Dict[str, dict]) -> Dict[str, dict]:
    final_fields: Dict[str, dict] = {}
    for field in TARGET_FIELDS:
        ml_value = ml_fields.get(field)
        heuristic_value = heuristic_fields.get(field)
        if ml_value and heuristic_value:
            heuristic_preferred = False
            if field == "Date":
                heuristic_preferred = bool(parse_normalized_date_text(heuristic_value["text"]))
            elif field == "Total":
                heuristic_amount = amount_to_float(heuristic_value["text"])
                ml_amount = amount_to_float(ml_value["text"])
                heuristic_lowered = normalize_ocr_text(heuristic_value["text"]).lower()
                heuristic_has_amount_signal = line_is_amount_only(heuristic_value["text"]) or any(
                    token in heuristic_lowered for token in ("total", "amount", "amt", "rs", "inr", "₹", "paid")
                )
                ml_is_suspicious = is_suspicious_total_text(ml_value["text"])
                heuristic_y = float(heuristic_value.get("bbox_pct", {}).get("y", 0.0))
                ml_y = float(ml_value.get("bbox_pct", {}).get("y", 0.0))
                heuristic_height = float(heuristic_value.get("bbox_pct", {}).get("height", 0.0))
                ml_height = float(ml_value.get("bbox_pct", {}).get("height", 0.0))
                heuristic_preferred = (
                    heuristic_amount > 0
                    and (ml_amount <= 0 or heuristic_amount >= (ml_amount * 0.75))
                    and heuristic_value["score"] >= ml_value["score"] - 0.02
                )
                if heuristic_has_amount_signal and ml_is_suspicious:
                    heuristic_preferred = True
                if heuristic_value["score"] >= 0.85:
                    heuristic_preferred = True
                if (
                    heuristic_amount > 0
                    and heuristic_y >= ml_y + 12
                    and heuristic_height >= max(ml_height * 1.2, ml_height + 1.0)
                    and heuristic_value["score"] >= 1.0
                ):
                    heuristic_preferred = True
            elif field == "Description":
                heuristic_preferred = heuristic_value["text"].upper() in {"PETROL", "DIESEL", "FUEL"}
            elif field == "Vendor":
                heuristic_preferred = heuristic_value.get("source") in {
                    "neighbor_heuristic",
                    "label_heuristic",
                    "line_heuristic",
                } and len(heuristic_value.get("text", "")) >= len(ml_value.get("text", ""))
            if heuristic_preferred or heuristic_value["score"] >= ml_value["score"] + 0.08:
                final_fields[field] = heuristic_value
            else:
                final_fields[field] = ml_value
        elif heuristic_value:
            final_fields[field] = heuristic_value
        elif ml_value:
            final_fields[field] = ml_value

    if "Date" in final_fields:
        normalized_date = parse_normalized_date_text(final_fields["Date"]["text"])
        if normalized_date:
            final_fields["Date"]["text"] = normalized_date
        else:
            final_fields.pop("Date", None)
    if "Total" in final_fields:
        normalized_amount = normalize_amount_text(final_fields["Total"]["text"])
        if normalized_amount and is_reasonable_total_amount(normalized_amount):
            final_fields["Total"]["text"] = normalized_amount
        else:
            final_fields.pop("Total", None)
    if "Vendor" in final_fields:
        final_fields["Vendor"]["text"] = normalize_vendor_text(final_fields["Vendor"]["text"])
        if not final_fields["Vendor"]["text"] or is_generic_vendor_heading(final_fields["Vendor"]["text"]):
            final_fields.pop("Vendor", None)
    if "Description" in final_fields:
        description_text = normalize_ocr_text(final_fields["Description"]["text"])
        if final_fields["Description"]["score"] < 0.72 or not looks_like_description_text(description_text):
            final_fields.pop("Description", None)
    return final_fields
