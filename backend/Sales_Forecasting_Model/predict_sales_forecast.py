import argparse
import json
from pathlib import Path

import joblib
import pandas as pd

from train_sales_forecast_model import FEATURE_COLUMNS, NUMERIC_COLUMNS, REVENUE_COLUMNS


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL_PATH = BASE_DIR / "model_artifacts" / "sales_forecast_random_forest.joblib"

# decide which fields come from the command line
def parse_args():
    parser = argparse.ArgumentParser(
        description="Run sales forecast predictions from the command line."
    )
    parser.add_argument(
        "--model-path",
        default=str(DEFAULT_MODEL_PATH),
        help="Path to the trained .joblib model file.",
    )
    
    # requir field
    parser.add_argument("--deal_stage", required=True, help="Current deal stage.")
    parser.add_argument("--deal_value", required=True, help="Deal value.")
    parser.add_argument(
        "--overdue_meeting_count",
        required=True,
        help="Count of overdue meetings for the deal.",
    )
    parser.add_argument(
        "--expected_close_gap_days",
        required=True,
        help="Gap between today and expected close date in days.",
    )
    parser.add_argument(
        "--lead_to_deal_convert_days",
        required=True,
        help="Lead-to-deal conversion duration in days.",
    )
    parser.add_argument("--followup_count", required=True, help="Follow-up count.")
    parser.add_argument("--meeting_count", required=True, help="Meeting count.")
    parser.add_argument(
        "--overdue_followup_count",
        required=True,
        help="Overdue follow-up count.",
    )
    parser.add_argument(
        "--last_contact_days",
        required=True,
        help="Days since last contact.",
    )
    return parser.parse_args()

# prepares input data in model format
def build_input_row(args):
    row = {
        "deal_stage": args.deal_stage,
        "deal_value": args.deal_value,
        "overdue_meeting_count": args.overdue_meeting_count,
        "expected_close_gap_days": args.expected_close_gap_days,
        "lead_to_deal_convert_days": args.lead_to_deal_convert_days,
        "followup_count": args.followup_count,
        "meeting_count": args.meeting_count,
        "overdue_followup_count": args.overdue_followup_count,
        "last_contact_days": args.last_contact_days,
    }

    # Keep deal_value on the row for revenue calculation, while the model only reads FEATURE_COLUMNS.
    df = pd.DataFrame([row])
    for column in NUMERIC_COLUMNS + REVENUE_COLUMNS:   #convert numeric-looking inputs into actual numeric value
        df[column] = pd.to_numeric(df[column], errors="coerce")
    return df

# load .joblib
def load_model(model_path):
    resolved_path = Path(model_path)
    if not resolved_path.exists():
        raise FileNotFoundError(f"Model file not found: {resolved_path}")
    return joblib.load(resolved_path)

# prediction logic
def predict_deal(model, deal_df):
    predicted_label = int(model.predict(deal_df)[0])
    predicted_probability = float(model.predict_proba(deal_df)[0][1])
    deal_value = float(pd.to_numeric(deal_df["deal_value"], errors="coerce").fillna(0).iloc[0])
    forecast_revenue_contribution = float(predicted_probability * deal_value)

    return {
        "predicted_label": predicted_label,
        "predicted_label_text": "won" if predicted_label == 1 else "lost",
        "win_probability": predicted_probability,
        "win_probability_percent": round(predicted_probability * 100, 2),
        "forecast_revenue_contribution": forecast_revenue_contribution,
    }


def main():
    args = parse_args()
    model = load_model(args.model_path)
    deal_df = build_input_row(args)
    result = predict_deal(model, deal_df)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
