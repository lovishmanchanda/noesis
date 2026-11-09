import json

import numpy as np
import pandas as pd
import pytest
from helpers import HOUSING_COLUMNS, make_pipeline
from noesis_nodes import profile, session


def column(result, name):
    return next(c for c in result["columns"] if c["name"] == name)


def test_describes_every_column(housing):
    result = profile(housing, "price")
    assert result["rows"] == 600 and result["columnCount"] == 9
    assert [c["dtype"] for c in result["columns"] if c["name"] in ("id", "area", "city", "moved_in")] == ["int", "float", "category", "datetime"]


def test_missing_values_are_counted(housing):
    age = column(profile(housing), "age")
    assert age["missing"] == housing["age"].isna().sum()
    assert age["missingPct"] == pytest.approx(age["missing"] / 600)


def test_identifier_columns_are_recognised(housing):
    result = profile(housing)
    assert column(result, "id")["idLike"] is True
    assert column(result, "city")["idLike"] is False


def test_constant_columns_are_recognised():
    result = profile(pd.DataFrame({"a": [1, 1, 1], "b": [1, 2, 3]}))
    assert column(result, "a")["constant"] is True and column(result, "b")["constant"] is False


def test_numbers_stored_as_text_are_noticed():
    result = profile(pd.DataFrame({"x": ["1", "2", "3", "4.5", "6"], "y": list("abcde")}))
    assert column(result, "x")["numberLike"] is True and column(result, "y")["numberLike"] is False


def test_numeric_columns_have_stats_and_a_histogram(housing):
    income = column(profile(housing), "income")
    assert income["outliers"] >= 6 and income["skew"] > 1
    assert sum(income["histogram"]["counts"]) == housing["income"].notna().sum()


def test_target_profile_reports_class_balance(housing):
    target = profile(housing, "expensive")["target"]
    assert target["unique"] == 2 and 0.4 < target["minorityShare"] <= 0.5


def test_duplicates_are_counted():
    frame = pd.DataFrame({"a": [1, 1, 2], "b": [1, 1, 3]})
    assert profile(frame)["duplicates"] == 1


def test_the_profile_is_plain_json(housing):
    text = json.dumps(profile(housing, "price"), allow_nan=False)
    assert "NaN" not in text and "Infinity" not in text


def test_empty_and_all_missing_columns_do_not_break_it():
    frame = pd.DataFrame({"a": [np.nan, np.nan], "b": [None, None]})
    result = profile(frame)
    assert column(result, "a")["missing"] == 2
    assert profile(frame.iloc[0:0])["rows"] == 0


def test_session_opens_a_file_and_runs_to_the_split(housing):
    text = housing.to_csv(index=False).encode()
    opened = json.loads(session.open_csv(text, json.dumps({"delimiter": ","})))
    assert opened["rows"] == 600
    pipeline = make_pipeline([("split", {"strategy": "stratified", "stratifyColumn": "expensive"})])
    out = json.loads(session.run_early(json.dumps(pipeline)))
    assert sum(out["rows"].values()) == 600
    assert out["trainProfile"]["rows"] == out["rows"]["train"]
    assert out["trainProfile"]["target"]["name"] == "price"


def test_session_needs_a_file_first():
    session.reset()
    with pytest.raises(ValueError, match="No file"):
        session.profile_current()


def test_numeric_columns_report_how_they_relate_to_the_target():
    rng = np.random.default_rng(0)
    x = rng.normal(size=200)
    frame = pd.DataFrame({"x": x, "copy": x * 2 + 1, "noise": rng.normal(size=200), "y": x * 3})
    columns = {c["name"]: c for c in profile(frame, "y")["columns"]}
    assert columns["copy"]["targetCorr"] > 0.999
    assert abs(columns["noise"]["targetCorr"]) < 0.3
    assert "targetCorr" not in columns["y"]


def test_a_two_class_text_target_is_correlated_as_zero_and_one():
    frame = pd.DataFrame({"score": list(range(40)), "label": ["no"] * 20 + ["yes"] * 20})
    columns = {c["name"]: c for c in profile(frame, "label")["columns"]}
    assert columns["score"]["targetCorr"] > 0.8


def test_a_target_with_many_classes_has_no_correlations():
    frame = pd.DataFrame({"a": range(30), "label": list("abc") * 10})
    assert "targetCorr" not in profile(frame, "label")["columns"][0]


def test_date_columns_report_a_trend_against_the_target():
    days = pd.date_range("2024-01-01", periods=60).astype(str)
    frame = pd.DataFrame({"day": days, "y": np.arange(60, dtype=float)})
    columns = {c["name"]: c for c in profile(frame, "y")["columns"]}
    assert columns["day"]["dtype"] == "datetime"
    assert columns["day"]["targetTrend"] > 0.99
