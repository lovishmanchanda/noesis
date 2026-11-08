from noesis_nodes.registry import algorithms_for, load_registry, resolve_params


def node(type_, **params):
    return {"id": "n1", "type": type_, "params": {k: {"value": v, "source": "user"} for k, v in params.items()}}


def test_defaults_come_from_the_registry():
    p = resolve_params(node("impute", columns=["age"]))
    assert p["strategy"] == "median"
    assert p["columns"] == ["age"]
    assert p["addMissingIndicator"] is False


def test_settings_that_do_not_apply_are_left_out():
    p = resolve_params(node("impute", columns=["age"], strategy="median", fillValue="x"))
    assert "fillValue" not in p and "knnNeighbors" not in p
    q = resolve_params(node("impute", columns=["age"], strategy="constant", fillValue=0))
    assert q["fillValue"] == 0


def test_null_means_not_in_use():
    p = resolve_params(node("load_csv", sampleRows=None))
    assert p["sampleRows"] is None


def test_model_settings_include_the_algorithm_settings():
    p = resolve_params(node("model", algorithm="random_forest"), task="classification")
    assert p["n_estimators"] == 100 and p["preset"] == "balanced"
    assert "n_clusters" not in p


def test_algorithms_follow_the_task():
    assert sorted(algorithms_for("clustering")) == ["dbscan", "hierarchical", "kmeans"]
    assert "ridge" in algorithms_for("regression") and "ridge" not in algorithms_for("classification")


def test_registry_has_every_node_the_typescript_side_knows():
    names = set(load_registry()["nodes"])
    for expected in ("load_csv", "split", "impute", "encode", "scale", "model", "validate", "test"):
        assert expected in names
