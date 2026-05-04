import argparse
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

BASE_DIR = Path(__file__).resolve().parent


# These are the columns used as ML inputs to predict deal win probability.
FEATURE_COLUMNS = [
    "deal_stage",
    "overdue_meeting_count",
    "expected_close_gap_days",
    "lead_to_deal_convert_days",
    "followup_count",
    "meeting_count",
    "overdue_followup_count",
    "last_contact_days",
]

# Keep deal_value outside the ML feature set so forecast revenue can still be derived
# from win probability without influencing the model input.
REVENUE_COLUMNS = [
    "deal_value",
]

# Text/categorical columns must be encoded before model training.
CATEGORICAL_COLUMNS = [
    "deal_stage",
]

# Numeric columns are imputed and scaled before they reach the classifier.
NUMERIC_COLUMNS = [
    "overdue_meeting_count",
    "expected_close_gap_days",
    "lead_to_deal_convert_days",
    "followup_count",
    "meeting_count",
    "overdue_followup_count",
    "last_contact_days",
]



def parse_args():
    # Read script inputs such as dataset path and model choice.
    parser = argparse.ArgumentParser(
        description="Train a baseline sales forecasting model from a CSV dataset."
    )
    parser.add_argument(
        "--csv",
        required=True,
        help="Path to the training CSV file.",
    )
    parser.add_argument(
        "--model",
        choices=["logistic", "random_forest"],
        default="logistic",
        help="Baseline classifier to train.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(BASE_DIR / "model_artifacts"),
        help="Directory where trained model files will be saved.",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.2,
        help="Fraction of data reserved for testing.",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed for reproducibility.",
    )
    return parser.parse_args()


def normalize_target(value):
    # Convert business outcome labels into ML labels: won=1, lost=0.
    if pd.isna(value):
        return None

    text = str(value).strip().lower()
    if text in {"1", "won", "win", "true"}:
        return 1
    if text in {"0", "lost", "loss", "false"}:
        return 0
    return None


def load_dataset(csv_path):
    # Load the dataset and validate that all required training columns exist.
    df = pd.read_csv(csv_path)
    required_columns = FEATURE_COLUMNS + REVENUE_COLUMNS + ["target"]
    missing_columns = [column for column in required_columns if column not in df.columns]
    if missing_columns:
        raise ValueError(f"Missing required columns: {', '.join(missing_columns)}")

    df = df.copy()
    df["target"] = df["target"].map(normalize_target)
    df = df[df["target"].isin([0, 1])].copy()
    if df.empty:
        raise ValueError("No valid training rows found after normalizing target values.")

    # Force numeric feature columns into numeric dtype for consistent preprocessing.
    for column in NUMERIC_COLUMNS:
        df[column] = pd.to_numeric(df[column], errors="coerce")

    return df


def build_preprocessor():
    # Fill missing categorical values, then one-hot encode text fields.
    categorical_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", OneHotEncoder(handle_unknown="ignore")),
        ]
    )

    # Fill missing numeric values, then scale numeric features.
    numeric_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )

    return ColumnTransformer(
        transformers=[
            ("categorical", categorical_pipeline, CATEGORICAL_COLUMNS),
            ("numeric", numeric_pipeline, NUMERIC_COLUMNS),
        ]
    )


def build_classifier(model_name, random_state):
    # Random Forest is a stronger nonlinear baseline; Logistic Regression is the simpler baseline.
    if model_name == "random_forest":
        return RandomForestClassifier(
            n_estimators=250,
            max_depth=8,
            min_samples_leaf=2,
            random_state=random_state,
        )

    return LogisticRegression(
        max_iter=1000,
        random_state=random_state,
    )


def main():
    args = parse_args()
    csv_path = Path(args.csv)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    df = load_dataset(csv_path)
    # X contains model inputs, y contains the final won/lost outcome.
    X = df[FEATURE_COLUMNS + REVENUE_COLUMNS]
    y = df["target"].astype(int)

    # Split data into training and testing sets so we can evaluate the model.
    stratify = y if y.nunique() > 1 else None
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=args.test_size,
        random_state=args.random_state,
        stratify=stratify,
    )

    # One pipeline keeps preprocessing and model prediction together in a single saved artifact.
    pipeline = Pipeline(
        steps=[
            #first clean data
            ("preprocessor", build_preprocessor()),
            
            #send preprocessed data to the algorithm
            ("classifier", build_classifier(args.model, args.random_state)),
        ]
    )
    #Where the algorithm is trained and used
    pipeline.fit(X_train, y_train)

    # Predict binary win/loss labels and deal-level win probabilities for the test set.
    predicted_labels = pipeline.predict(X_test)
    predicted_probabilities = pipeline.predict_proba(X_test)[:, 1]

    # Forecasting is derived from predicted probabilities, not predicted labels.
    deal_values = pd.to_numeric(X_test["deal_value"], errors="coerce").fillna(0)
    expected_win_rate = float(predicted_probabilities.mean())
    forecast_revenue = float((predicted_probabilities * deal_values).sum())

    # Save both ML evaluation metrics and business-facing forecast metrics.
    metrics = {
        "model_type": args.model,
        "dataset_path": str(csv_path.resolve()),
        "row_count": int(len(df)),
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "accuracy": float(accuracy_score(y_test, predicted_labels)),
        "roc_auc": float(roc_auc_score(y_test, predicted_probabilities)) if y_test.nunique() > 1 else None,
        "confusion_matrix": confusion_matrix(y_test, predicted_labels).tolist(),
        "classification_report": classification_report(y_test, predicted_labels, output_dict=True),
        "expected_win_rate_on_test": expected_win_rate,
        "forecast_revenue_on_test": forecast_revenue,
        "feature_columns": FEATURE_COLUMNS,
    }

    model_path = output_dir / f"sales_forecast_{args.model}.joblib"
    metrics_path = output_dir / f"sales_forecast_{args.model}_metrics.json"

    # Save the trained pipeline and the summary metrics for later use.
    joblib.dump(pipeline, model_path)
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    print(f"Saved model to: {model_path}")
    print(f"Saved metrics to: {metrics_path}")
    print(f"Accuracy: {metrics['accuracy']:.4f}")
    if metrics["roc_auc"] is not None:
        print(f"ROC-AUC: {metrics['roc_auc']:.4f}")
    print(f"Expected Win Rate (test set): {expected_win_rate:.4f}")
    print(f"Forecast Revenue (test set): {forecast_revenue:.2f}")


if __name__ == "__main__":
    main()
