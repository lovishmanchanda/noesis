import numpy as np
import pytest
from helpers import HOUSING_COLUMNS, make_pipeline
from noesis_nodes import Cancelled, run_pipeline

CLASSIFICATION_COLUMNS = [
    {**c, "role": "exclude" if c["name"] == "price" else "target" if c["name"] == "expensive" else c["role"]}
    for c in HOUSING_COLUMNS
]
CLUSTER_COLUMNS = [
    {"name": "customer_id", "dtype": "int", "role": "exclude"},
    {"name": "age", "dtype": "float", "role": "feature"},
    {"name": "income", "dtype": "float", "role": "feature"},
    {"name": "spend", "dtype": "float", "role": "feature"},
    {"name": "segment", "dtype": "category", "role": "reference"},
]

PREP = [
    ("split", {}),
    ("impute", {"columns": ["age"]}),
    ("encode", {"columns": ["city"]}),
    ("scale", {}),
]


def prepared(housing, model, extra=(), task="regression", columns=None, seed=42):
    steps = [*PREP, ("model", model), *extra]
    if task == "classification":
        steps = [("split", {"strategy": "stratified"}), *PREP[1:], ("model", model), *extra]
    return run_pipeline(make_pipeline(steps, task=task, columns=columns, seed=seed), housing)


REGRESSION = {
    "linear_regression": 0.85, "ridge": 0.85, "lasso": 0.85, "decision_tree": 0.6, "random_forest": 0.8,
    "gradient_boosting": 0.8, "knn": 0.7, "svm": -1.0, "mlp": 0.5,
}
CLASSIFICATION = {
    "logistic_regression": 0.8, "decision_tree": 0.75, "random_forest": 0.8, "gradient_boosting": 0.8,
    "knn": 0.75, "svm": 0.8, "naive_bayes": 0.7, "mlp": 0.75,
}


@pytest.mark.parametrize("algorithm,floor", REGRESSION.items())
def test_regression_models_learn(housing, algorithm, floor):
    extra = {"epochs": 60} if algorithm == "mlp" else {}
    result = prepared(housing, {"algorithm": algorithm, **extra}, [("validate", {})])
    score = result.ctx.results["n6"]["validation"]["r2"]
    assert score is not None and score > floor


@pytest.mark.parametrize("algorithm,floor", CLASSIFICATION.items())
def test_classification_models_learn(housing, algorithm, floor):
    extra = {"epochs": 80} if algorithm == "mlp" else {}
    result = prepared(housing, {"algorithm": algorithm, **extra}, [("validate", {})], task="classification", columns=CLASSIFICATION_COLUMNS)
    metrics = result.ctx.results["n6"]["validation"]
    assert metrics["accuracy"] > floor
    assert metrics["f1"] is not None


def test_train_scores_are_recorded_for_overfitting_checks(housing):
    result = prepared(housing, {"algorithm": "random_forest"})
    assert {"rmse", "mae", "r2"} <= set(result.ctx.results["n5"]["train"])


def test_models_refuse_text_columns(housing):
    with pytest.raises(ValueError, match="not numbers"):
        run_pipeline(make_pipeline([("split", {}), ("model", {"algorithm": "ridge"})]), housing)


def test_linear_models_refuse_empty_cells_but_forests_accept_them(housing):
    steps = [("split", {}), ("encode", {"columns": ["city"]})]
    with pytest.raises(ValueError, match="empty cells"):
        run_pipeline(make_pipeline([*steps, ("model", {"algorithm": "ridge"})]), housing)
    run_pipeline(make_pipeline([*steps, ("model", {"algorithm": "random_forest"})]), housing)


def test_early_stopping_uses_the_validation_rows(housing):
    result = prepared(housing, {"algorithm": "gradient_boosting", "n_estimators": 400, "early_stopping_rounds": 10})
    assert result.ctx.models["n5"].estimator.best_iteration < 399


def test_class_labels_can_be_text(housing):
    labelled = housing.assign(expensive=np.where(housing["expensive"] == 1, "yes", "no"))
    result = prepared(labelled, {"algorithm": "gradient_boosting"}, [("validate", {})], task="classification", columns=CLASSIFICATION_COLUMNS)
    assert result.ctx.results["n6"]["validation"]["accuracy"] > 0.8


# --- validation -------------------------------------------------------------------------------
def test_cross_validation_reports_each_fold(housing):
    result = prepared(housing, {"algorithm": "ridge"}, [("validate", {"method": "kfold", "k": 4})])
    r = result.ctx.results["n6"]
    assert len(r["folds"]) == 4 and r["partition"] == "train"
    assert r["validation"]["r2"] == pytest.approx(np.mean([f["r2"] for f in r["folds"]]))


@pytest.mark.parametrize("method", ["stratified_kfold", "repeated_kfold", "time_series_split"])
def test_other_validation_methods_run(housing, method):
    task = "classification" if method == "stratified_kfold" else "regression"
    columns = CLASSIFICATION_COLUMNS if task == "classification" else None
    model = {"algorithm": "logistic_regression" if task == "classification" else "ridge"}
    extra = {"k": 3, **({"repeats": 2} if method == "repeated_kfold" else {})}
    result = prepared(housing, model, [("validate", {"method": method, **extra})], task=task, columns=columns)
    assert result.ctx.results["n6"]["validation"]


def test_holdout_needs_validation_rows(housing):
    steps = [("split", {"ratios": [0.8, 0.0, 0.2]}), ("impute", {"columns": ["age"]}), ("encode", {"columns": ["city"]}), ("model", {"algorithm": "random_forest"}), ("validate", {})]
    with pytest.raises(ValueError, match="no validation rows"):
        run_pipeline(make_pipeline(steps), housing)


def test_cross_validation_can_be_cancelled(housing):
    calls = {"n": 0}

    def cancelled():
        calls["n"] += 1
        return calls["n"] > 9

    with pytest.raises(Cancelled):
        run_pipeline(make_pipeline([*PREP, ("model", {"algorithm": "ridge"}), ("validate", {"method": "kfold", "k": 5})]), housing, cancelled=cancelled)


# --- the test set -----------------------------------------------------------------------------
def test_the_test_set_is_scored_once_per_model(housing):
    result = prepared(housing, {"algorithm": "ridge"}, [("validate", {}), ("test", {})])
    assert result.ctx.results["n7"]["test"]["r2"] > 0.8
    with pytest.raises(ValueError, match="already used"):
        prepared(housing, {"algorithm": "ridge"}, [("validate", {}), ("test", {}), ("test", {})])


def test_a_model_is_needed_before_validating(housing):
    with pytest.raises(ValueError, match="no trained model"):
        run_pipeline(make_pipeline([("split", {}), ("validate", {})]), housing)


def test_same_seed_same_scores(housing):
    a = prepared(housing, {"algorithm": "random_forest"}, [("validate", {})]).ctx.results["n6"]["validation"]
    b = prepared(housing, {"algorithm": "random_forest"}, [("validate", {})]).ctx.results["n6"]["validation"]
    assert a == b


# --- clustering -------------------------------------------------------------------------------
def cluster(customers, algorithm="kmeans", **settings):
    steps = [("split", {"strategy": "none", "ratios": [1, 0, 0]}), ("scale", {}), ("model", {"algorithm": algorithm, **settings}), ("stability_check", {"runs": 5})]
    return run_pipeline(make_pipeline(steps, task="clustering", columns=CLUSTER_COLUMNS), customers)


def test_kmeans_finds_the_groups_and_they_are_stable(customers):
    result = cluster(customers, n_clusters=4)
    internal = result.ctx.results["n3"]["internal"]
    assert internal["silhouette"] > 0.3 and internal["clusters"] == 4
    assert result.ctx.results["n4"]["mean"] > 0.8
    labels = result.ctx.models["n3"].predict(result.outputs["n3"].parts["train"])
    from sklearn.metrics import adjusted_rand_score
    assert adjusted_rand_score(customers["segment"], labels) > 0.7


def test_dbscan_and_hierarchical_run_and_can_assign_new_rows(customers):
    hierarchical = cluster(customers, "hierarchical", n_clusters=4)
    frame = hierarchical.outputs["n3"].parts["train"].head(5)
    assert len(hierarchical.ctx.models["n3"].predict(frame)) == 5
    dbscan = cluster(customers, "dbscan", eps=0.5, min_samples=5)
    assert dbscan.ctx.results["n3"]["internal"]["clusters"] >= 1


def test_clustering_has_no_test_step(customers):
    steps = [("split", {"strategy": "none", "ratios": [1, 0, 0]}), ("scale", {}), ("model", {"algorithm": "kmeans", "n_clusters": 4}), ("test", {})]
    with pytest.raises(ValueError, match="no test set"):
        run_pipeline(make_pipeline(steps, task="clustering", columns=CLUSTER_COLUMNS), customers)
