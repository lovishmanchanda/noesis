"""Records small golden event logs: the events a training run sends, for each live algorithm.

The web app's tests read these files, so the Python engine and the screens agree on the events.
Run from the repository root:  python fixtures/events/generate.py
"""

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages/nodes-py/src"))
sys.path.insert(0, str(ROOT / "packages/nodes-py/tests"))

import pandas as pd  # noqa: E402
from helpers import HOUSING_COLUMNS, make_pipeline  # noqa: E402
from noesis_nodes import session  # noqa: E402

PREP = [("split", {}), ("impute", {"columns": ["age"]}), ("encode", {"columns": ["city"]}), ("scale", {})]
CLASSIFICATION = [
    {**c, "role": "exclude" if c["name"] == "price" else "target" if c["name"] == "expensive" else c["role"]} for c in HOUSING_COLUMNS
]
CASES = {
    "mlp-regression": ("regression", {"algorithm": "mlp", "epochs": 8, "early_stopping": False, "hidden_layers": [8, 4]}),
    "forest-regression": ("regression", {"algorithm": "random_forest", "n_estimators": 20, "max_depth": 5}),
    "boosting-regression": ("regression", {"algorithm": "gradient_boosting", "n_estimators": 15, "max_depth": 3}),
    "logistic-classification": ("classification", {"algorithm": "logistic_regression"}),
    "ridge-regression": ("regression", {"algorithm": "ridge"}),
}


def hashes_of(pipeline):
    out = {}
    for node in pipeline["nodes"]:
        inputs = [out[i] for i in node.get("inputs", [])]
        material = json.dumps([node["type"], {k: v["value"] for k, v in node["params"].items()}, inputs], sort_keys=True)
        out[node["id"]] = hashlib.sha256(material.encode()).hexdigest()
    return out


def record(name, task, model):
    session.reset()
    frame = pd.read_csv(ROOT / "fixtures/data/housing_small.csv")
    session.open_csv(frame.to_csv(index=False).encode())
    steps = [("split", {"strategy": "stratified"}) if task == "classification" else PREP[0], *PREP[1:], ("model", model), ("validate", {"method": "holdout"})]
    pipeline = make_pipeline(steps, task=task, columns=CLASSIFICATION if task == "classification" else None)
    events: list[dict] = []
    outcome = json.loads(session.run_train(json.dumps(pipeline), json.dumps(hashes_of(pipeline)), f"golden_{name}", "full", lambda text: events.append(json.loads(text))))
    for event in events:  # timings differ from run to run; the logs keep only their order
        event["t"] = 0
    outcome.pop("durationMs", None)
    outcome.pop("timings", None)
    return {"name": name, "task": task, "events": events, "outcome": outcome}


if __name__ == "__main__":
    out = ROOT / "fixtures/events"
    for name, (task, model) in CASES.items():
        log = record(name, task, model)
        (out / f"{name}.json").write_text(json.dumps(log, separators=(",", ":")) + "\n")
        print(f"{name}: {len(log['events'])} events, status {log['outcome']['status']}")
