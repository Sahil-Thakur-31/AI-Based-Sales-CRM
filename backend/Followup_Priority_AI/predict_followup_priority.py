import argparse
import json
from pathlib import Path

import joblib
import pandas as pd

from train_followup_priority_model import (
    feature_columns,
    numeric_columns,
)


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL_PATH = BASE_DIR / "model_artifacts" / "current" / "followup_priority_random_forest.joblib"



def parse_args():
    parser = argparse.ArgumentParser(
        description="Run follow-up priority prediction from the command line."
    )
    parser.add_argument(
        "--model-path",
        default=str(DEFAULT_MODEL_PATH),
        help="Path to the trained .joblib model file.",
    )
    parser.add_argument(
        "--batch-json",
        help="Path to a JSON array of feature rows for batch prediction.",
    )
    parser.add_argument(
        "--record_type",
        required=False,
        help="Record type, for example followup or meeting.",
    )
    parser.add_argument(
        "--entity_type",
        required=False,
        help="Entity type, for example lead, deal, or client.",
    )
    parser.add_argument("--stage", required=False, help="Pipeline stage.")
    parser.add_argument(
        "--priority",
        required=False,
        help="Current priority value.",
    )
    parser.add_argument("--status", required=False, help="Current record status.")
    parser.add_argument(
        "--days_since_last_contact",
        required=False,
        help="Days since last contact.",
    )
    parser.add_argument(
        "--days_until_event",
        required=False,
        help="Days until due date or meeting date.",
    )
    parser.add_argument(
        "--overdue_count",
        required=False,
        help="Number of overdue follow-ups.",
    )
    parser.add_argument(
        "--related_count",
        required=False,
        help="Total related follow-up or meeting count.",
    )
    args = parser.parse_args()

    if not args.batch_json:
        required_single_fields = [
            "record_type",
            "entity_type",
            "stage",
            "priority",
            "status",
            "days_since_last_contact",
            "days_until_event",
            "overdue_count",
            "related_count",
        ]
        missing_fields = [
            field_name
            for field_name in required_single_fields
            if getattr(args, field_name) in (None, "")
        ]
        if missing_fields:
            parser.error(
                "Missing required arguments for single prediction: "
                + ", ".join(missing_fields)
            )

    return args


def build_input_row(args):
    row = {
        "record_type": args.record_type,
        "entity_type": args.entity_type,
        "stage": args.stage,
        "priority": args.priority,
        "status": args.status,
        "days_since_last_contact": args.days_since_last_contact,
        "days_until_event": args.days_until_event,
        "overdue_count": args.overdue_count,
        "related_count": args.related_count,
    }

    df = pd.DataFrame([row], columns=feature_columns)
    for column in numeric_columns:
        df[column] = pd.to_numeric(df[column], errors="coerce")
    return df


def normalize_input_frame(df):
    missing_columns = [column for column in feature_columns if column not in df.columns]
    if missing_columns:
        raise ValueError(
            "Missing feature columns: " + ", ".join(missing_columns)
        )

    normalized_df = df[feature_columns].copy()
    for column in numeric_columns:
        normalized_df[column] = pd.to_numeric(normalized_df[column], errors="coerce")
    return normalized_df


def build_batch_input(batch_json_path):
    payload = json.loads(Path(batch_json_path).read_text(encoding="utf-8"))
    if not isinstance(payload, list) or not payload:
        raise ValueError("Batch JSON must contain a non-empty array of feature rows")
    return normalize_input_frame(pd.DataFrame(payload))

# load the save train model from 
def load_model(model_path):
    resolved_path = Path(model_path)
    if not resolved_path.exists():
        raise FileNotFoundError(f"Model file not found: {resolved_path}")
    return joblib.load(resolved_path)


def predict_priority(model, followup_df):
    predicted_label = str(model.predict(followup_df)[0])

    probabilities = {}
    if hasattr(model, "predict_proba") and hasattr(model, "classes_"):
        probability_values = model.predict_proba(followup_df)[0]
        probabilities = {
            str(label): round(float(score), 6)
            for label, score in zip(model.classes_, probability_values)
        }

    return {
        "predicted_priority": predicted_label,
        "probabilities": probabilities,
    }


def predict_priority_batch(model, followup_df):
    predicted_labels = [str(label) for label in model.predict(followup_df)]

    probabilities_by_row = [{} for _ in range(len(followup_df))]
    if hasattr(model, "predict_proba") and hasattr(model, "classes_"):
        probability_values = model.predict_proba(followup_df)
        probabilities_by_row = [
            {
                str(label): round(float(score), 6)
                for label, score in zip(model.classes_, row_scores)
            }
            for row_scores in probability_values
        ]

    return [
        {
            "predicted_priority": predicted_label,
            "probabilities": probabilities,
        }
        for predicted_label, probabilities in zip(predicted_labels, probabilities_by_row)
    ]


def main():
    args = parse_args()
    model = load_model(args.model_path)
    if args.batch_json:
        followup_df = build_batch_input(args.batch_json)
        result = predict_priority_batch(model, followup_df)
    else:
        followup_df = build_input_row(args)
        result = predict_priority(model, followup_df)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
