import numpy as np
import pandas as pd
import pytest
from helpers import LEARNING_STEPS, make_pipeline
from noesis_nodes import LeakageError, run_pipeline

SPLIT = ("split", {})


def run(housing, *steps, **kwargs):
    result = run_pipeline(make_pipeline(list(steps), **kwargs), housing)
    last = f"n{len(steps)}"
    return result.outputs[last].parts, result


@pytest.mark.parametrize("step", LEARNING_STEPS)
def test_learning_steps_refuse_to_run_before_the_split(housing, step):
    params = {
        "impute": {"columns": ["age"]},
        "handle_outliers": {"columns": ["income"]},
        "encode": {"columns": ["city"]},
        "scale": {},
        "select_features": {},
        "reduce_dimensions": {},
    }[step]
    with pytest.raises(LeakageError):
        run_pipeline(make_pipeline([(step, params)]), housing)


# --- impute -----------------------------------------------------------------------------------
def test_impute_learns_the_median_from_training_rows_only(housing):
    parts, _ = run(housing, SPLIT, ("impute", {"columns": ["age"], "strategy": "median"}))
    raw, _ = run(housing, SPLIT)
    train_median = raw["train"]["age"].median()
    filled = raw["test"]["age"].isna()
    assert (parts["test"].loc[filled, "age"] == train_median).all()
    assert train_median != housing["age"].median()
    assert parts["train"]["age"].notna().all() and parts["test"]["age"].notna().all()


@pytest.mark.parametrize("strategy,extra", [("mean", {}), ("most_frequent", {}), ("constant", {"fillValue": -1}), ("knn", {"knnNeighbors": 3})])
def test_impute_strategies_remove_the_gaps(housing, strategy, extra):
    parts, _ = run(housing, SPLIT, ("impute", {"columns": ["age"], "strategy": strategy, **extra}))
    assert all(p["age"].notna().all() for p in parts.values())


def test_impute_can_add_a_was_missing_column(housing):
    parts, _ = run(housing, SPLIT, ("impute", {"columns": ["age"], "addMissingIndicator": True}))
    assert parts["train"]["age_was_missing"].sum() > 0


def test_mean_needs_numbers(housing):
    with pytest.raises(ValueError, match="needs numbers"):
        run(housing, SPLIT, ("impute", {"columns": ["city"], "strategy": "mean"}))


def test_cannot_touch_the_target_or_excluded_columns(housing):
    with pytest.raises(ValueError, match="target"):
        run(housing, SPLIT, ("impute", {"columns": ["price"]}))
    with pytest.raises(ValueError, match="excluded"):
        run(housing, SPLIT, ("impute", {"columns": ["id"]}))


# --- outliers ---------------------------------------------------------------------------------
def test_outliers_are_clipped_to_limits_learned_on_train(housing):
    parts, result = run(housing, SPLIT, ("handle_outliers", {"columns": ["income"], "action": "clip"}))
    low, high = result.ctx.fitted["n2"].bounds["income"]
    assert parts["test"]["income"].between(low, high).all()
    assert parts["train"]["income"].max() <= high


def test_removing_outliers_only_drops_training_rows(housing):
    raw, _ = run(housing, SPLIT)
    parts, _ = run(housing, SPLIT, ("handle_outliers", {"columns": ["income"], "action": "remove"}))
    assert len(parts["train"]) < len(raw["train"])
    assert len(parts["validation"]) == len(raw["validation"]) and len(parts["test"]) == len(raw["test"])


def test_flagging_adds_a_marker_column(housing):
    parts, _ = run(housing, SPLIT, ("handle_outliers", {"columns": ["income"], "action": "flag"}))
    assert parts["train"]["income_outlier"].sum() > 0


# --- encode -----------------------------------------------------------------------------------
def test_onehot_makes_one_column_per_city(housing):
    parts, _ = run(housing, SPLIT, ("encode", {"columns": ["city"]}))
    cols = [c for c in parts["train"].columns if c.startswith("city=")]
    assert sorted(cols) == ["city=Bath", "city=Hull", "city=Leeds", "city=York"]
    assert "city" not in parts["train"].columns
    assert (parts["train"][cols].sum(axis=1) <= 1).all()


def test_onehot_can_drop_the_first_value(housing):
    parts, _ = run(housing, SPLIT, ("encode", {"columns": ["city"], "dropFirst": True}))
    assert len([c for c in parts["train"].columns if c.startswith("city=")]) == 3


def test_ordinal_frequency_and_binary(housing):
    for method, expected in (("ordinal", ["city"]), ("frequency", ["city"]), ("binary", ["city_b0", "city_b1", "city_b2"])):
        parts, _ = run(housing, SPLIT, ("encode", {"columns": ["city"], "method": method}))
        assert all(c in parts["train"].columns for c in expected), method


def test_rare_values_are_grouped_as_other(housing):
    parts, _ = run(housing, SPLIT, ("encode", {"columns": ["city"], "maxCategories": 2}))
    assert "city=__other__" in parts["train"].columns


def test_unseen_values_are_ignored_or_rejected(housing):
    changed = housing.copy()
    steps = [("split", {"strategy": "random"}), ("encode", {"columns": ["city"]})]
    parts = run_pipeline(make_pipeline(steps), changed).outputs["n2"].parts
    assert len(parts["test"]) > 0
    transformer = run_pipeline(make_pipeline(steps), changed).ctx.fitted["n2"]
    fresh = pd.DataFrame({"city": ["Atlantis"], "price": [1.0]})
    assert transformer.transform(fresh, "test").filter(like="city=").sum(axis=1).iloc[0] == 0
    strict = run_pipeline(make_pipeline([steps[0], ("encode", {"columns": ["city"], "handleUnknown": "error"})]), changed).ctx.fitted["n2"]
    with pytest.raises(ValueError, match="not seen"):
        strict.transform(fresh, "test")


# --- scale ------------------------------------------------------------------------------------
def test_standard_scaling_is_centred_on_the_training_rows(housing):
    parts, _ = run(housing, SPLIT, ("scale", {}))
    assert abs(parts["train"]["area"].mean()) < 1e-9
    assert abs(parts["test"]["area"].mean()) > 1e-6  # test rows use the training statistics
    assert parts["train"]["price"].equals(run(housing, SPLIT)[0]["train"]["price"])  # the target is untouched


@pytest.mark.parametrize("method", ["minmax", "robust", "maxabs"])
def test_other_scalers_run(housing, method):
    parts, _ = run(housing, SPLIT, ("scale", {"method": method}))
    assert np.isfinite(parts["train"]["area"]).all()


def test_minmax_uses_the_chosen_range(housing):
    parts, _ = run(housing, SPLIT, ("scale", {"method": "minmax", "featureRange": [0, 10]}))
    assert parts["train"]["area"].min() == pytest.approx(0) and parts["train"]["area"].max() == pytest.approx(10)


# --- derive -----------------------------------------------------------------------------------
def test_derive_ratio_date_part_log_polynomial(housing):
    cols = {"id", "area", "rooms", "age", "income", "city", "price", "expensive", "moved_in"}
    parts, _ = run(
        housing,
        ("derive_feature", {"newName": "area_per_room", "kind": "ratio", "sourceColumns": ["area", "rooms"]}),
        ("derive_feature", {"newName": "year", "kind": "date_part", "sourceColumns": ["moved_in"], "datePart": "year"}),
        ("derive_feature", {"newName": "log_income", "kind": "log", "sourceColumns": ["income"]}),
        ("derive_feature", {"newName": "area2", "kind": "polynomial", "sourceColumns": ["area"], "degree": 2}),
    )
    frame = parts["all"]
    assert {"area_per_room", "year", "log_income", "area2"} <= set(frame.columns) - cols
    assert frame["year"].between(2015, 2021).all()
    assert frame["area2"].iloc[0] == pytest.approx(housing["area"].iloc[0] ** 2)


def test_binning_needs_the_split_first(housing):
    step = ("derive_feature", {"newName": "area_bin", "kind": "bin", "sourceColumns": ["area"], "bins": 4})
    with pytest.raises(LeakageError):
        run(housing, step)
    parts, _ = run(housing, SPLIT, step)
    assert set(parts["train"]["area_bin"].dropna().unique()) <= {0.0, 1.0, 2.0, 3.0}


# --- select and reduce ------------------------------------------------------------------------
def test_variance_selection_drops_constant_columns(housing):
    flat = housing.assign(flat=1.0)
    columns = [*make_pipeline([])["dataset"]["columns"], {"name": "flat", "dtype": "float", "role": "feature"}]
    result = run_pipeline(make_pipeline([SPLIT, ("select_features", {"method": "variance"})], columns=columns), flat)
    assert "flat" not in result.outputs["n2"].parts["train"].columns


def test_correlation_selection_drops_one_of_a_pair(housing):
    twin = housing.assign(area_twin=housing["area"] * 2)
    columns = [*make_pipeline([])["dataset"]["columns"], {"name": "area_twin", "dtype": "float", "role": "feature"}]
    result = run_pipeline(make_pipeline([SPLIT, ("select_features", {"method": "correlation"})], columns=columns), twin)
    cols = set(result.outputs["n2"].parts["train"].columns)
    assert ("area" in cols) != ("area_twin" in cols)


def test_kbest_keeps_k_numeric_features(housing):
    filled = ("impute", {"columns": ["age"]})
    parts, _ = run(housing, SPLIT, filled, ("select_features", {"method": "kbest", "k": 2}))
    kept = [c for c in parts["train"].columns if c in {"area", "rooms", "age", "income"}]
    assert len(kept) == 2


def test_pca_replaces_numeric_features_with_components(housing):
    steps = [SPLIT, ("impute", {"columns": ["age"]}), ("reduce_dimensions", {"n_components": 2})]
    parts = run_pipeline(make_pipeline(steps), housing).outputs["n3"].parts
    assert {"pc1", "pc2"} <= set(parts["train"].columns) and "area" not in parts["train"].columns
    assert "price" in parts["train"].columns


# --- load, drop, filter -----------------------------------------------------------------------
def test_drop_filter_and_dedupe(housing):
    doubled = pd.concat([housing, housing.head(10)], ignore_index=True)
    parts, _ = run(doubled, ("drop_duplicates", {"subset": ["id"]}), ("filter_rows", {"column": "area", "operator": ">", "value": 90}), ("drop_columns", {"columns": ["moved_in"]}))
    frame = parts["all"]
    assert frame["id"].is_unique and (frame["area"] > 90).all() and "moved_in" not in frame.columns
