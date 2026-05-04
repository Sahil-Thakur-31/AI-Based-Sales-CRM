import argparse
import json
import sys #read input from tmn

from predict_sales_forecast import DEFAULT_MODEL_PATH, build_input_row, load_model, predict_deal


def parse_args():
    parser = argparse.ArgumentParser(
        description="Run batch sales forecast predictions from stdin JSON."
    )
    parser.add_argument(
        "--model-path",
        default=str(DEFAULT_MODEL_PATH),
        help="Path to the trained .joblib model file.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    #read json input
    payload = json.load(sys.stdin)
    rows = payload.get("deals", [])

    #load train model
    model = load_model(args.model_path)
    predictions = []
    for row in rows:
        namespace = argparse.Namespace(**row)
        deal_df = build_input_row(namespace)
        #predict one deal
        result = predict_deal(model, deal_df)
        result["dealId"] = row.get("dealId", "")
        predictions.append(result)

    print(
        json.dumps(
            {
                "model_name": "Random Forest",
                "predictions": predictions,
            }
        )
    )


if __name__ == "__main__":
    main()
