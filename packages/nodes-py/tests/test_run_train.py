import hashlib
import json

import pytest
from helpers import make_pipeline
from noesis_nodes import session

STEPS = [
    ("split", {}),
    ("impute", {"columns": ["age"]}),
    ("encode", {"columns": ["city"]}),
    ("scale", {}),
    ("model", {"algorithm": "random_forest", "n_estimators": 20, "max_depth": 6}),
    ("validate", {"method": "holdout"}),
]


def hashes_of(pipeline):
    out = {}
    for node in pipeline["nodes"]:
        inputs = [out[i] for i in node.get("inputs", [])]
        material = json.dumps([node["type"], {k: v["value"] for k, v in node["params"].items()}, inputs], sort_keys=True)
        out[node["id"]] = hashlib.sha256(material.encode()).hexdigest()
    return out


@pytest.fixture
def opened(housing):
    session.reset()
    session.open_csv(housing.to_csv(index=False).encode())
    yield
    session.set_cancel_flag(None)
    session.reset()


def go(steps=STEPS, run_id="run_1", viz="full"):
    pipeline = make_pipeline(steps)
    sent: list[dict] = []
    outcome = json.loads(session.run_train(json.dumps(pipeline), json.dumps(hashes_of(pipeline)), run_id, viz, lambda text: sent.append(json.loads(text))))
    return outcome, sent


def test_a_run_streams_numbered_events_from_start_to_finish(opened):
    outcome, events = go()
    assert outcome["status"] == "succeeded"
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert events[0]["type"] == "run_started" and events[-1]["type"] == "run_finished"
    assert events[-1]["data"]["status"] == "succeeded"
    assert all(e["v"] == 1 and e["runId"] == "run_1" for e in events)
    times = [e["t"] for e in events]
    assert times == sorted(times)
    assert {e["source"] for e in events} <= {"live", "replay"}


def test_each_step_starts_before_its_own_events_and_finishes_after(opened):
    _, events = go()
    started = {e["node"]: i for i, e in enumerate(events) if e["type"] == "node_started"}
    finished = {e["node"]: i for i, e in enumerate(events) if e["type"] == "node_finished"}
    for i, e in enumerate(events):
        if e["node"] and e["type"] not in ("node_started", "node_finished", "node_failed"):
            assert started[e["node"]] < i < finished[e["node"]], e["type"]


def test_the_outcome_has_scores_timings_and_what_was_reused(opened):
    outcome, _ = go()
    assert outcome["algorithm"] == "random_forest"
    assert outcome["train"]["r2"] > outcome["validation"]["r2"] > 0.5
    assert outcome["fit"]["trees"] == 20
    assert set(outcome["timings"]) >= {"n5"}
    assert outcome["durationMs"] >= 0


def test_the_second_run_reuses_the_prepared_data(opened):
    go()
    outcome, events = go(run_id="run_2")
    # Only the last prepared step is loaded; the steps before it are not needed at all.
    assert outcome["ran"]["reused"] == ["n4"] and outcome["ran"]["executed"] == ["n5", "n6"]
    hits = [e["node"] for e in events if e["type"] == "node_finished" and e["data"]["cacheHit"]]
    assert "n4" in hits


def test_stop_ends_the_run_as_cancelled_not_failed(opened):
    class Flag(list):
        pass

    flag = Flag([0])
    session.set_cancel_flag(flag)

    def stop_after_a_few(text, seen={"n": 0}):
        event = json.loads(text)
        if event["type"] == "ensemble_progress":
            seen["n"] += 1
            if seen["n"] == 3:
                flag[0] = 1

    pipeline = make_pipeline([*STEPS[:4], ("model", {"algorithm": "random_forest", "n_estimators": 200}), STEPS[5]])
    outcome = json.loads(session.run_train(json.dumps(pipeline), json.dumps(hashes_of(pipeline)), "run_3", "full", stop_after_a_few))
    assert outcome["status"] == "cancelled"
    flag[0] = 0
    again, _ = go(run_id="run_4")
    assert again["status"] == "succeeded"  # the flag is cleared at the start of a run


def test_a_failure_is_explained_in_words_with_a_code_and_a_hint(opened):
    steps = [("split", {}), ("model", {"algorithm": "random_forest"}), ("validate", {"method": "holdout"})]
    outcome, events = go(steps)
    assert outcome["status"] == "failed"
    error = outcome["error"]
    assert error["code"] == "E_DATA_TYPE" and "not numbers" in error["message"] and error["hint"]
    assert events[-1]["type"] == "run_finished" and events[-1]["data"]["status"] == "failed"
    assert any(e["type"] == "node_failed" for e in events)


def test_a_diverging_network_is_reported_with_its_own_code(opened):
    steps = [*STEPS[:4], ("model", {"algorithm": "mlp", "epochs": 30, "early_stopping": False, "optimizer": "sgd", "learning_rate": 1e9}), STEPS[5]]
    outcome, _ = go(steps)
    assert outcome["status"] == "failed" and outcome["error"]["code"] == "E_NAN_LOSS"
