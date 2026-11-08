import io

import pandas as pd
import pytest
from helpers import make_pipeline
from noesis_nodes import Cancelled, run_pipeline
from pandas.testing import assert_frame_equal

STEPS = [("split", {}), ("impute", {"columns": ["age"]}), ("encode", {"columns": ["city"]}), ("scale", {})]


def test_the_same_pipeline_gives_identical_results(housing):
    a = run_pipeline(make_pipeline(STEPS), housing).outputs["n4"].parts
    b = run_pipeline(make_pipeline(STEPS), housing).outputs["n4"].parts
    for name in a:
        assert_frame_equal(a[name], b[name])


def test_events_are_reported_in_order(housing):
    events = []
    run_pipeline(make_pipeline(STEPS), housing, emit=lambda event, data: events.append((event, data.get("node"))))
    started = [n for e, n in events if e == "node_started"]
    assert started == ["n0", "n1", "n2", "n3", "n4"]
    assert events.index(("node_started", "n2")) > events.index(("node_finished", "n1"))


def test_cancel_stops_the_run(housing):
    calls = {"n": 0}

    def cancelled():
        calls["n"] += 1
        return calls["n"] > 2

    with pytest.raises(Cancelled):
        run_pipeline(make_pipeline(STEPS), housing, cancelled=cancelled)


def test_load_csv_reads_from_a_file_object_with_its_settings():
    text = "a;b\n1;NA\n2;3\n"
    pipeline = make_pipeline([])
    pipeline["nodes"][0]["params"] = {"delimiter": {"value": ";", "source": "user"}}
    frame = run_pipeline(pipeline, io.StringIO(text)).outputs["n0"].parts["all"]
    assert list(frame.columns) == ["a", "b"] and frame["b"].isna().sum() == 1


def test_steps_without_an_implementation_say_so(housing):
    with pytest.raises(NotImplementedError, match="model"):
        run_pipeline(make_pipeline([("split", {}), ("model", {"algorithm": "ridge"})]), housing)


def test_fitted_transformers_can_be_reused_on_new_rows(housing):
    result = run_pipeline(make_pipeline(STEPS), housing)
    fresh = housing.sample(20, random_state=1).reset_index(drop=True)
    out = fresh
    for node_id in ("n2", "n3", "n4"):
        out = result.ctx.fitted[node_id].transform(out, "new")
    assert len(out) == 20 and out["age"].notna().all()
    assert set(result.outputs["n4"].parts["train"].columns) == set(out.columns)
