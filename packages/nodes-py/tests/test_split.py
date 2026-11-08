import pandas as pd
import pytest
from helpers import make_pipeline
from noesis_nodes import run_pipeline


def split_parts(housing, **params):
    result = run_pipeline(make_pipeline([("split", params)]), housing)
    return result.outputs["n1"].parts


def test_sizes_follow_the_ratios(housing):
    parts = split_parts(housing, ratios=[0.7, 0.15, 0.15])
    n = len(housing)
    assert sum(len(p) for p in parts.values()) == n
    assert abs(len(parts["train"]) - 0.7 * n) <= 1
    assert abs(len(parts["validation"]) - 0.15 * n) <= 1


def test_parts_do_not_overlap(housing):
    parts = split_parts(housing)
    ids = [set(p["id"]) for p in parts.values()]
    assert not (ids[0] & ids[1]) and not (ids[0] & ids[2]) and not (ids[1] & ids[2])


def test_same_seed_same_split_and_other_seed_other_split(housing):
    a = run_pipeline(make_pipeline([("split", {})], seed=1), housing).outputs["n1"].parts["train"]["id"].tolist()
    b = run_pipeline(make_pipeline([("split", {})], seed=1), housing).outputs["n1"].parts["train"]["id"].tolist()
    c = run_pipeline(make_pipeline([("split", {})], seed=2), housing).outputs["n1"].parts["train"]["id"].tolist()
    assert a == b and a != c


def test_stratified_keeps_class_shares(housing):
    parts = split_parts(housing, strategy="stratified", stratifyColumn="expensive")
    overall = housing["expensive"].mean()
    for part in parts.values():
        assert abs(part["expensive"].mean() - overall) < 0.03


def test_group_split_keeps_each_group_in_one_part(housing):
    parts = split_parts(housing, strategy="group", groupColumn="city")
    seen = {}
    for name, part in parts.items():
        for city in part["city"].dropna().unique():
            assert seen.setdefault(city, name) == name


def test_time_split_puts_earlier_rows_first(housing):
    parts = split_parts(housing, strategy="time", timeColumn="moved_in")
    assert parts["train"]["moved_in"].max() <= parts["test"]["moved_in"].min()


def test_none_keeps_everything_in_train(housing):
    parts = split_parts(housing, strategy="none", ratios=[1, 0, 0])
    assert len(parts["train"]) == len(housing) and len(parts["test"]) == 0


def test_cannot_split_twice(housing):
    with pytest.raises(ValueError, match="already split"):
        run_pipeline(make_pipeline([("split", {}), ("split", {})]), housing)


def test_tiny_data_is_refused(housing):
    with pytest.raises(ValueError, match="empty"):
        run_pipeline(make_pipeline([("split", {})]), housing.head(1))
