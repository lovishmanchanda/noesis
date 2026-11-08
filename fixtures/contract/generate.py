"""Writes the contract cases: pipelines that run on the small seeded datasets.
Usage: python fixtures/contract/generate.py"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
P = lambda value: {"value": value, "source": "user"}  # noqa: E731
LEARN = {"impute", "handle_outliers", "encode", "scale", "select_features", "reduce_dimensions"}

HOUSING = [
    ("id", "int", "exclude"), ("area", "float", "feature"), ("rooms", "float", "feature"), ("age", "float", "feature"),
    ("income", "float", "feature"), ("city", "category", "feature"), ("price", "float", "target"),
    ("expensive", "int", "exclude"), ("moved_in", "string", "exclude"),
]
HOUSING_CLASSIFY = [(n, d, "exclude" if n == "price" else "target" if n == "expensive" else r) for n, d, r in HOUSING]
CUSTOMERS = [("customer_id", "int", "exclude"), ("age", "float", "feature"), ("income", "float", "feature"), ("spend", "float", "feature"), ("segment", "category", "reference")]


def pipeline(task, columns, steps):
    nodes = [{"id": "n0", "type": "load_csv", "params": {}}]
    for i, (kind, params) in enumerate(steps, start=1):
        node = {"id": f"n{i}", "type": kind, "inputs": [f"n{i - 1}"], "params": {k: P(v) for k, v in params.items()}}
        if kind in LEARN:
            node["fit_on"] = "train"
        nodes.append(node)
    return {
        "schemaVersion": "0.1", "project": {"name": "contract", "seed": 42, "mode": "guided"},
        "dataset": {"source": {"kind": "local-file", "name": "data.csv"}, "columns": [{"name": n, "dtype": d, "role": r} for n, d, r in columns]},
        "task": {"type": task, "primaryMetric": "rmse"}, "nodes": nodes,
    }


PREP = [("impute", {"columns": ["age"]}), ("encode", {"columns": ["city"]}), ("scale", {})]
REG = [("split", {})] + PREP
CLS = [("split", {"strategy": "stratified"})] + PREP
EVAL = [("validate", {"method": "kfold", "k": 4}), ("test", {})]
CLUSTER = [("split", {"strategy": "none", "ratios": [1, 0, 0]}), ("scale", {})]

# tolerance is the allowed relative difference in a score between the two runtimes
CASES = {
    "regression-ridge": ("housing_small.csv", 1e-6, pipeline("regression", HOUSING, REG + [("model", {"algorithm": "ridge"})] + EVAL)),
    "classification-logistic": ("housing_small.csv", 1e-4, pipeline("classification", HOUSING_CLASSIFY, CLS + [("model", {"algorithm": "logistic_regression"})] + EVAL)),
    "classification-knn": ("housing_small.csv", 1e-6, pipeline("classification", HOUSING_CLASSIFY, CLS + [("model", {"algorithm": "knn"})] + EVAL)),
    "regression-random-forest": ("housing_small.csv", 0.03, pipeline("regression", HOUSING, REG + [("model", {"algorithm": "random_forest", "n_estimators": 50})] + EVAL)),
    "classification-xgboost": ("housing_small.csv", 0.03, pipeline("classification", HOUSING_CLASSIFY, CLS + [("model", {"algorithm": "gradient_boosting", "n_estimators": 60})] + EVAL)),
    "clustering-kmeans": ("customers_small.csv", 0.05, pipeline("clustering", CUSTOMERS, CLUSTER + [("model", {"algorithm": "kmeans", "n_clusters": 4}), ("stability_check", {"runs": 4})])),
}

if __name__ == "__main__":
    (OUT / "pipelines").mkdir(exist_ok=True)
    manifest = []
    for name, (data, tolerance, spec) in CASES.items():
        (OUT / "pipelines" / f"{name}.json").write_text(json.dumps(spec, indent=2) + "\n")
        manifest.append({"name": name, "pipeline": f"pipelines/{name}.json", "data": f"../data/{data}", "tolerance": tolerance})
    (OUT / "cases.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {len(manifest)} contract cases")
