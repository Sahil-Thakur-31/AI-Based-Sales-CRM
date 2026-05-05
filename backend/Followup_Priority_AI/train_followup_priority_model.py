# importlibraries
import argparse
import json
from pathlib import Path

import joblib
import pandas as pd

from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer #handle missing values
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler



feature_columns = [
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

target_column = "label"

#text data
categorical_columns = [
    "record_type",
    "entity_type",
    "stage",
    "priority",
    "status",
]

#number
numeric_columns = [
    "days_since_last_contact",
    "days_until_event",
    "overdue_count",
    "related_count",
]

# output
target_labels = ["Low", "Medium", "High"]

target_normalization_map = {
    "low": "Low",
    "l": "Low",
    "0": "Low",
    "medium": "Medium",
    "med": "Medium",
    "m": "Medium",
    "1": "Medium",
    "high": "High",
    "h": "High",
    "2": "High",
}



def parse_args():
    parser = argparse.ArgumentParser(
        description="Train follow-up priority classifier"
    )

    parser.add_argument("--csv", required=True, help="Path to CSV file")
    
    # choose model
    parser.add_argument(
        "--model",
        choices=["random_forest", "logistic"],
        default="random_forest",
        help="Choose model type",
    )

    parser.add_argument(
        "--output-dir",
        default="model_artifacts",
        help="Directory to save model",
    )

    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--random-state", type=int, default=42)

    return parser.parse_args()


# data cleaning function
def normalize_target(value):
    if pd.isna(value):
        return None

    text = str(value).strip().lower()
    return target_normalization_map.get(text)


#lod dataset
def load_dataset(csv_path):
    df = pd.read_csv(csv_path)

    required_columns = feature_columns + [target_column]
    missing_columns = [col for col in required_columns if col not in df.columns]

    if missing_columns:
        raise ValueError(f"Missing columns: {', '.join(missing_columns)}")

    df = df.copy()

    # normalize
    df[target_column] = df[target_column].map(normalize_target)
    df = df[df[target_column].isin(target_labels)]

    if df.empty:
        raise ValueError("No valid data after cleaning")

    for col in numeric_columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    return df


#function prepare data for machine learning
def build_preprocessor():
    
    # fill catogrical data if missing
    categorical_pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("encoder", OneHotEncoder(handle_unknown="ignore")),
    ])

    # fill numeric data if missing
    numeric_pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ])

    # combine both
    return ColumnTransformer([
        ("categorical", categorical_pipeline, categorical_columns),
        ("numeric", numeric_pipeline, numeric_columns),
    ])


# choose ml model
def build_classifier(model_name, random_state):

    if model_name == "random_forest":
        return RandomForestClassifier(
            n_estimators=300,
            max_depth=10,
            min_samples_leaf=2,
            class_weight="balanced",
            random_state=random_state,
        )

    return LogisticRegression(
        max_iter=1000,
        class_weight="balanced",
        random_state=random_state,
    )


#how well the model performed
def build_metrics(y_true, y_pred, labels):
    report = classification_report(
        y_true,
        y_pred,
        labels=labels,
        output_dict=True,
        zero_division=0,
    )

    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=labels).tolist(),
        "classification_report": report,
    }
def main():
    args = parse_args()

    csv_path = Path(args.csv)
    output_dir = Path(args.output_dir)

    output_dir.mkdir(parents=True, exist_ok=True)

    df = load_dataset(csv_path)

    x = df[feature_columns]
    y = df[target_column]

    stratify = y if y.nunique() > 1 else None

    x_train, x_test, y_train, y_test = train_test_split(
        x,
        y,
        test_size=args.test_size,
        random_state=args.random_state,
        stratify=stratify,
    )

    pipeline = Pipeline([
        ("preprocessor", build_preprocessor()),
        ("classifier", build_classifier(args.model, args.random_state)),
    ])

    pipeline.fit(x_train, y_train)

    predictions = pipeline.predict(x_test)

    metrics = {
        "model_type": args.model,
        "dataset_path": str(csv_path.resolve()),
        "row_count": len(df),
        "train_rows": len(x_train),
        "test_rows": len(x_test),
        "target_labels": target_labels,
        "feature_columns": feature_columns,
        "target_column": target_column,
        **build_metrics(y_test, predictions, target_labels),
    }

    model_path = output_dir / f"followup_priority_{args.model}.joblib"
    metrics_path = output_dir / f"metrics_{args.model}.json"

    joblib.dump(pipeline, model_path)
    metrics_path.write_text(json.dumps(metrics, indent=2))

    print(f"model saved at: {model_path}")
    print(f"metrics saved at: {metrics_path}")
    print(f"accuracy: {metrics['accuracy']:.4f}")



if __name__ == "__main__":
    main()
