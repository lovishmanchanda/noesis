import hashlib
import json

import numpy as np
import pandas as pd
import pytest
from helpers import make_pipeline
from noesis_nodes import run_pipeline, session
from noesis_nodes.cache import NodeCache
from noesis_nodes.context import Data
from pandas.testing import assert_frame_equal

STEPS = [("split", {}), ("impute", {"columns": ["age"]}), ("encode", {"columns": ["city"]}), ("scale", {})]


def hashes_of(pipeline, data="file"):
    """A stand-in for the app's hashing: a step's hash covers its settings and its input's hash."""
    out: dict[str, str] = {}
    for node in pipeline["nodes"]:
        inputs = [out[i] for i in node.get("inputs", [])]
        material = json.dumps([node["type"], {k: v["value"] for k, v in node["params"].items()}, inputs, data], sort_keys=True)
        out[node["id"]] = hashlib.sha256(material.encode()).hexdigest()
    return out


def test_every_kind_of_column_survives_the_cache():
    frame = pd.DataFrame(
        {
            "num": [1.5, np.nan, 3.0, 4.0],
            "count": [1, 2, 3, 4],
            "flag": [True, False, True, True],
            "kind": pd.Categorical(["a", "b", "a", None]),
            "text": ["x", "y", None, "z"],
            "when": pd.to_datetime(["2024-01-01", "2024-02-01", None, "2024-04-01"]),
        },
        index=[10, 11, 15, 20],
    )
    cache = NodeCache()
    assert cache.put("k", Data({"train": frame, "validation": frame.iloc[:0], "test": frame.iloc[:2]}))
    data, fitted = cache.get("k")
    assert fitted is None
    assert set(data.parts) == {"train", "validation", "test"}
    assert_frame_equal(data.parts["train"], frame)
    assert_frame_equal(data.parts["test"], frame.iloc[:2])
    assert len(data.parts["validation"]) == 0


def test_a_missing_key_is_a_miss():
    cache = NodeCache()
    assert cache.get("nope") is None
    assert cache.stats.misses == 1


def test_the_oldest_unused_entry_goes_first_when_the_budget_is_full():
    frame = pd.DataFrame({"a": np.random.default_rng(0).normal(size=20000)})
    one = NodeCache()
    one.put("x", Data.single(frame))
    size = one.stats.bytes
    cache = NodeCache(budget_bytes=int(size * 2.5))
    for key in ("a", "b"):
        cache.put(key, Data.single(frame))
    cache.get("a")  # "a" is now the most recently used
    cache.put("c", Data.single(frame))
    assert "b" not in cache and "a" in cache and "c" in cache
    assert cache.stats.evicted == 1
    assert cache.stats.bytes <= cache.budget_bytes


def test_an_output_bigger_than_the_whole_budget_is_not_stored():
    cache = NodeCache(budget_bytes=100)
    assert cache.put("big", Data.single(pd.DataFrame({"a": np.arange(10000.0)}))) is False
    assert "big" not in cache and cache.stats.bytes == 0


def test_a_second_run_loads_everything_and_gives_the_same_result(housing):
    pipeline = make_pipeline(STEPS)
    hashes, cache = hashes_of(pipeline), NodeCache()
    first = run_pipeline(pipeline, housing, hashes=hashes, cache=cache)
    assert first.reused == []
    second = run_pipeline(pipeline, housing, hashes=hashes, cache=cache)
    assert second.reused == ["n4"] and second.executed == []
    plain = run_pipeline(pipeline, housing)
    for name in plain.outputs["n4"].parts:
        assert_frame_equal(second.outputs["n4"].parts[name], plain.outputs["n4"].parts[name])


def test_editing_the_last_step_runs_only_that_step(housing):
    cache = NodeCache()
    before = make_pipeline(STEPS)
    run_pipeline(before, housing, hashes=hashes_of(before), cache=cache)
    after = make_pipeline(STEPS[:3] + [("scale", {"method": "minmax"})])
    result = run_pipeline(after, housing, hashes=hashes_of(after), cache=cache)
    assert result.executed == ["n4"] and result.reused == ["n3"]
    plain = run_pipeline(after, housing)
    assert_frame_equal(result.outputs["n4"].parts["train"], plain.outputs["n4"].parts["train"])


def test_editing_a_middle_step_runs_it_and_what_follows(housing):
    cache = NodeCache()
    before = make_pipeline(STEPS)
    run_pipeline(before, housing, hashes=hashes_of(before), cache=cache)
    after = make_pipeline([STEPS[0], ("impute", {"columns": ["age"], "strategy": "mean"}), *STEPS[2:]])
    result = run_pipeline(after, housing, hashes=hashes_of(after), cache=cache)
    assert result.executed == ["n2", "n3", "n4"] and result.reused == ["n1"]


def test_a_changed_file_misses_the_cache(housing):
    cache = NodeCache()
    pipeline = make_pipeline(STEPS)
    run_pipeline(pipeline, housing, hashes=hashes_of(pipeline, "a"), cache=cache)
    result = run_pipeline(pipeline, housing, hashes=hashes_of(pipeline, "b"), cache=cache)
    assert result.reused == []


def test_without_hashes_nothing_is_cached(housing):
    cache = NodeCache()
    run_pipeline(make_pipeline(STEPS), housing, cache=cache)
    assert cache.stats.entries == 0


def test_fitted_steps_come_back_with_their_cached_result(housing):
    steps = [("split", {}), ("impute", {"columns": ["age"]}), ("reduce_dimensions", {"n_components": 2})]
    pipeline = make_pipeline(steps)
    hashes, cache = hashes_of(pipeline), NodeCache()
    first = run_pipeline(pipeline, housing, hashes=hashes, cache=cache)
    second = run_pipeline(pipeline, housing, hashes=hashes, cache=cache)
    assert second.reused == ["n3"]
    assert "n3" in second.ctx.fitted and "n2" not in second.ctx.fitted
    # The restored step transforms like the original one.
    frame = first.outputs["n2"].parts["test"]
    assert_frame_equal(
        second.ctx.fitted["n3"].transform(frame, "test"), first.ctx.fitted["n3"].transform(frame, "test")
    )


@pytest.fixture
def open_housing(housing):
    session.reset()
    session.open_csv((housing.to_csv(index=False)).encode())
    yield
    session.reset()


def test_the_session_reports_what_it_reused_and_both_profiles(open_housing):
    pipeline = make_pipeline(STEPS)
    hashes = json.dumps(hashes_of(pipeline))
    first = json.loads(session.run_early(json.dumps(pipeline), hashes))
    assert first["ran"]["reused"] == [] and first["ran"]["executed"][0] == "n0"
    age_before = next(c for c in first["trainProfile"]["columns"] if c["name"] == "age")
    age_after = next(c for c in first["outputProfile"]["columns"] if c["name"] == "age")
    assert age_before["missing"] > 0 and age_after["missing"] == 0
    second = json.loads(session.run_early(json.dumps(pipeline), hashes))
    assert second["ran"]["executed"] == [] and "n4" in second["ran"]["reused"]
    # Memory use can differ a little after a round trip; everything else must match exactly.
    strip = lambda p: {k: v for k, v in p.items() if k != "memoryMB"}  # noqa: E731
    assert strip(second["trainProfile"]) == strip(first["trainProfile"])
    assert second["cache"]["entries"] >= 4


def test_opening_another_file_empties_the_cache(open_housing, housing):
    pipeline = make_pipeline(STEPS)
    session.run_early(json.dumps(pipeline), json.dumps(hashes_of(pipeline)))
    session.open_csv((housing.to_csv(index=False)).encode())
    again = json.loads(session.run_early(json.dumps(pipeline), json.dumps(hashes_of(pipeline))))
    assert again["ran"]["reused"] == []


def test_the_cache_still_works_without_pyarrow_and_reads_old_entries_after(monkeypatch):
    from noesis_nodes import cache as cache_module

    frame = pd.DataFrame({"a": [1.0, np.nan], "b": pd.Categorical(["x", "y"])}, index=[3, 7])
    store = NodeCache()
    with monkeypatch.context() as m:
        m.setattr(cache_module, "_arrow", lambda: None)
        assert store.format == "pickle-zlib"
        store.put("plain", Data.single(frame))
    store.put("arrow", Data.single(frame))
    for key in ("plain", "arrow"):
        data, _ = store.get(key)
        assert_frame_equal(data.parts["all"], frame)
