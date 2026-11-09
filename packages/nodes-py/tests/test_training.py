import json

import numpy as np
import pytest
from helpers import HOUSING_COLUMNS, make_pipeline
from noesis_nodes import Cancelled, run_pipeline
from noesis_nodes.steps_model import build_estimator

CLASSIFICATION_COLUMNS = [
    {**c, "role": "exclude" if c["name"] == "price" else "target" if c["name"] == "expensive" else c["role"]}
    for c in HOUSING_COLUMNS
]
PREP = [("split", {}), ("impute", {"columns": ["age"]}), ("encode", {"columns": ["city"]}), ("scale", {})]


def train(housing, model, *, task="regression", viz="full", cancel_after=None, extra=()):
    """Run the pipeline up to the model and collect the events."""
    columns = CLASSIFICATION_COLUMNS if task == "classification" else HOUSING_COLUMNS
    steps = [*PREP, ("model", model), *extra]
    events: list[tuple[str, dict]] = []
    seen = {"n": 0}

    def emit(event, data):
        json.dumps(data, allow_nan=False)  # every event must be plain JSON
        events.append((event, data))
        if event in ("epoch_end", "ensemble_progress", "boost_round"):
            seen["n"] += 1

    cancelled = (lambda: seen["n"] >= cancel_after) if cancel_after else None
    pipeline = make_pipeline(steps, task=task, columns=columns)
    result = run_pipeline(pipeline, housing, emit=emit, cancelled=cancelled, viz=viz)
    return result, events


def of(events, name):
    return [d for e, d in events if e == name]


# --- neural network ----------------------------------------------------------------------------
MLP = {"algorithm": "mlp", "epochs": 12, "early_stopping": False, "hidden_layers": [16, 8]}


def test_the_network_reports_every_epoch_with_both_losses(housing):
    result, events = train(housing, MLP)
    epochs = of(events, "epoch_end")
    assert [e["epoch"] for e in epochs] == list(range(1, 13))
    assert all(e["totalEpochs"] == 12 and e["valLoss"] is not None for e in epochs)
    assert epochs[-1]["trainLoss"] < epochs[0]["trainLoss"]
    structure = of(events, "model_structure")[0]
    assert structure["layers"] == [{"units": 16, "activation": "relu"}, {"units": 8, "activation": "relu"}]
    assert structure["paramCount"] > 0
    assert result.ctx.results["n5"]["fit"]["epochs"] == 12


def test_the_network_sends_downsampled_weights_only_at_full_detail(housing):
    _, full = train(housing, MLP)
    snapshots = of(full, "weights_snapshot")
    assert snapshots and all(len(m["matrix"]) <= 16 and len(m["matrix"][0]) <= 16 for s in snapshots for m in s["layers"])
    _, light = train(housing, MLP, viz="light")
    assert of(light, "weights_snapshot") == [] and of(light, "epoch_end")
    _, off = train(housing, MLP, viz="off")
    assert "trainMetric" not in of(off, "epoch_end")[0]


def test_the_network_stops_early_and_restores_the_best_weights(housing):
    result, events = train(housing, {"algorithm": "mlp", "epochs": 300, "early_stopping": True, "patience": 3, "learning_rate": 0.01})
    stop = of(events, "early_stop")
    assert stop and stop[0]["epoch"] - stop[0]["bestEpoch"] == 3
    assert result.ctx.results["n5"]["fit"]["stopped"] == "early_stop"
    assert len(of(events, "epoch_end")) < 300


def test_a_diverging_network_says_so_in_plain_words(housing):
    with pytest.raises(ValueError, match="E_NAN_LOSS"):
        train(housing, {"algorithm": "mlp", "epochs": 50, "early_stopping": False, "optimizer": "sgd", "learning_rate": 1e9})


def test_the_network_stops_at_an_epoch_boundary_when_asked(housing):
    with pytest.raises(Cancelled):
        train(housing, {**MLP, "epochs": 500}, cancel_after=3)


def test_a_classification_network_reports_accuracy(housing):
    _, events = train(housing, MLP, task="classification")
    last = of(events, "epoch_end")[-1]
    assert 0 <= last["valMetric"] <= 1 and 0 <= last["trainMetric"] <= 1


# --- random forest -----------------------------------------------------------------------------
FOREST = {"algorithm": "random_forest", "n_estimators": 40, "max_depth": 8}


def test_the_forest_grows_in_steps_and_reports_progress(housing):
    _, events = train(housing, FOREST)
    done = [e["done"] for e in of(events, "ensemble_progress")]
    assert done == sorted(done) and done[-1] == 40 and len(done) >= 10
    assert of(events, "feature_importance")[0]["importances"]


def test_growing_in_steps_gives_the_same_forest_as_growing_at_once(housing):
    result, _ = train(housing, FOREST)
    fitted = result.ctx.models["n5"]
    test = result.outputs["n5"].parts["test"]
    plain = build_estimator("random_forest", {**result.ctx.models["n5"].params}, result.ctx)
    train_part = result.outputs["n5"].parts["train"]
    plain.fit(train_part[fitted.columns], train_part["price"])
    assert np.array_equal(plain.predict(test[fitted.columns]), fitted.estimator.predict(test[fitted.columns]))


def test_tree_replay_matches_the_fitted_tree(housing):
    result, events = train(housing, {**FOREST, "n_estimators": 10})
    tree = result.ctx.models["n5"].estimator.estimators_[0].tree_
    added = [d for d in of(events, "tree_node_added") if d["treeId"] == 0]
    finished = [d for d in of(events, "tree_finished") if d["treeId"] == 0][0]
    assert finished["nodes"] == tree.node_count and finished["leaves"] == int((tree.children_left == -1).sum())
    assert added and all(d["depth"] <= 6 for d in added) and all(d["source"] == "replay" for d in added)
    for d in added:
        assert d["samples"] == int(tree.n_node_samples[d["nodeId"]])
        if not d["isLeaf"]:
            assert d["threshold"] == pytest.approx(float(tree.threshold[d["nodeId"]]), abs=1e-4)
    ids = [d["nodeId"] for d in added]
    assert ids == sorted(ids)  # in the order the tree was created
    assert {d["treeId"] for d in of(events, "tree_node_added")} == {0, 1, 2}


def test_the_forest_stops_between_steps_when_asked(housing):
    with pytest.raises(Cancelled):
        train(housing, {**FOREST, "n_estimators": 200}, cancel_after=2)


# --- gradient boosting -------------------------------------------------------------------------
BOOST = {"algorithm": "gradient_boosting", "n_estimators": 30, "max_depth": 3}


def test_boosting_reports_each_round_and_matches_a_plain_fit(housing):
    result, events = train(housing, BOOST)
    rounds = of(events, "boost_round")
    assert [r["round"] for r in rounds] == list(range(1, 31))
    assert rounds[-1]["trainLoss"] < rounds[0]["trainLoss"] and all(r["valLoss"] is not None for r in rounds)
    fitted = result.ctx.models["n5"]
    part = result.outputs["n5"].parts
    plain = build_estimator("gradient_boosting", fitted.params, result.ctx, early_stopping=False)
    plain.fit(part["train"][fitted.columns], part["train"]["price"])
    assert np.allclose(plain.predict(part["test"][fitted.columns]), fitted.estimator.predict(part["test"][fitted.columns]))


def test_boosting_stops_at_the_next_round_when_asked(housing):
    with pytest.raises(Cancelled):
        train(housing, {**BOOST, "n_estimators": 500}, cancel_after=5)


def test_boosting_early_stopping_ends_before_the_last_round(housing):
    result, events = train(housing, {**BOOST, "n_estimators": 500, "learning_rate": 0.3, "early_stopping_rounds": 5})
    assert len(of(events, "boost_round")) < 500


# --- linear models -----------------------------------------------------------------------------
def test_logistic_regression_reports_its_iterations_and_coefficients(housing):
    _, events = train(housing, {"algorithm": "logistic_regression"}, task="classification")
    progress = of(events, "fit_progress")[0]
    assert progress["iter"] >= 1 and progress["converged"] in (True, False)
    coefficients = of(events, "coef_update")[0]
    assert coefficients["source"] == "live" and coefficients["coefficients"]


def test_a_closed_form_fit_is_labelled_a_replay(housing):
    for name in ("linear_regression", "ridge"):
        _, events = train(housing, {"algorithm": name})
        update = of(events, "coef_update")[0]
        assert update["source"] == "replay" and update["intercept"] is not None
        assert of(events, "fit_progress") == []
