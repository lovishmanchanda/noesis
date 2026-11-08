HOUSING_COLUMNS = [
    {"name": "id", "dtype": "int", "role": "exclude"},
    {"name": "area", "dtype": "float", "role": "feature"},
    {"name": "rooms", "dtype": "float", "role": "feature"},
    {"name": "age", "dtype": "float", "role": "feature"},
    {"name": "income", "dtype": "float", "role": "feature"},
    {"name": "city", "dtype": "category", "role": "feature"},
    {"name": "price", "dtype": "float", "role": "target"},
    {"name": "expensive", "dtype": "int", "role": "exclude"},
    {"name": "moved_in", "dtype": "string", "role": "exclude"},
]

LEARNING_STEPS = ("impute", "handle_outliers", "encode", "scale", "select_features", "reduce_dimensions")


def param(value, source="user"):
    return {"value": value, "source": source}


def make_pipeline(steps, task="regression", columns=None, seed=42):
    """steps: list of (type, params-dict). Builds a straight chain starting with load_csv."""
    nodes = [{"id": "n0", "type": "load_csv", "params": {}}]
    for i, (type_, params) in enumerate(steps, start=1):
        node = {"id": f"n{i}", "type": type_, "inputs": [f"n{i - 1}"], "params": {k: param(v) for k, v in params.items()}}
        if type_ in LEARNING_STEPS:
            node["fit_on"] = "train"
        nodes.append(node)
    return {
        "schemaVersion": "0.1",
        "project": {"name": "test", "seed": seed, "mode": "guided"},
        "dataset": {"source": {"kind": "local-file", "name": "x.csv"}, "columns": columns or HOUSING_COLUMNS},
        "task": {"type": task, "primaryMetric": "rmse"},
        "nodes": nodes,
    }
