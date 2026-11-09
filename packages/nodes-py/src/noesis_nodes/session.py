"""A small stateful layer for the interactive app: open a file, profile it, run the early steps.

The browser engine and the local companion both call these functions. They take and return JSON
text, so the same calls work across the worker boundary.
"""

from __future__ import annotations

import io
import json
import time
from typing import Any, Callable

import pandas as pd

from . import steps_data
from .context import Cancelled, Data
from .cache import NodeCache
from .profile import profile
from .registry import resolve_params
from .runner import run_pipeline

_frame: pd.DataFrame | None = None
_cache = NodeCache()


def _dump(value: Any) -> str:
    return json.dumps(value, allow_nan=False)


def open_csv(source: Any, settings_json: str = "{}") -> str:
    """Read a CSV (path, text or bytes) with the given load settings and return its profile."""
    global _frame
    _cache.clear()
    node = {"type": "load_csv", "params": {k: {"value": v} for k, v in json.loads(settings_json).items()}}
    params = resolve_params(node)
    if isinstance(source, (bytes, bytearray)):
        source = io.BytesIO(source)
    _frame = steps_data.load_csv(source, params)
    return _dump(profile(_frame))


def profile_current(target: str | None = None) -> str:
    return _dump(profile(_require(), target))


def _require() -> pd.DataFrame:
    if _frame is None:
        raise ValueError("No file is open")
    return _frame


def run_early(pipeline_json: str, hashes_json: str = "{}") -> str:
    """Run a pipeline of data and preparation steps on the open file.

    `hashes_json` maps each step id to its hash. Steps whose result is cached under that hash are
    loaded instead of run. Returns the number of rows in each part, the profile of the training
    rows right after the split (the profile every later suggestion must use, so that no
    statistic includes the test rows), and the profile of the training rows as they leave the
    last step (what the model would see).
    """
    pipeline = json.loads(pipeline_json)
    hashes = json.loads(hashes_json)
    order = [n["id"] for n in pipeline["nodes"]]
    split_ids = [n["id"] for n in pipeline["nodes"] if n["type"] == "split"]
    leaves = {n["id"] for n in pipeline["nodes"]} - {i for n in pipeline["nodes"] for i in n.get("inputs", [])}
    result = run_pipeline(
        pipeline, _require(), hashes=hashes, cache=_cache, want=leaves | set(split_ids)
    )
    last = order[-1]
    final = result.outputs[last]
    target = result.ctx.target
    out: dict[str, Any] = {"rows": {name: len(part) for name, part in final.parts.items()}}
    if final.is_split:
        out["trainProfile"] = profile(result.outputs[split_ids[0]].parts["train"], target)
        if last != split_ids[0]:
            out["outputProfile"] = profile(final.parts["train"], target)
    else:
        out["profile"] = profile(final.parts["all"], target)
    out["ran"] = {"executed": result.executed, "reused": result.reused}
    out["cache"] = {"entries": _cache.stats.entries, "megabytes": round(_cache.stats.bytes / 1e6, 2), "format": _cache.format}
    return _dump(out)


def reset() -> None:
    global _frame
    _frame = None
    _cache.clear()


# --- training runs -----------------------------------------------------------------------------
#: Events the user can lose without harm when the screen is busy (docs/design/training-events.md).
DROPPABLE = {"batch_end", "weights_snapshot", "activation_sample", "sample_rows", "heartbeat"}
_cancel_flag: Any = None
_models: dict[str, Any] = {}


def set_cancel_flag(flag: Any) -> None:
    """A shared integer the page sets to 1 to stop the run at the next step boundary."""
    global _cancel_flag
    _cancel_flag = flag


def _is_cancelled() -> bool:
    return _cancel_flag is not None and int(_cancel_flag[0]) == 1


def clear_cancel() -> None:
    if _cancel_flag is not None:
        _cancel_flag[0] = 0


class EventSink:
    """Wraps what the steps report in the common envelope and hands it on as JSON text."""

    def __init__(self, run_id: str, send: Callable[[str], None]) -> None:
        self.run_id, self.send, self.seq, self.started = run_id, send, 0, time.perf_counter()

    def __call__(self, event: str, data: dict) -> None:
        data = dict(data)
        self.seq += 1
        envelope = {
            "v": 1, "runId": self.run_id, "seq": self.seq, "t": round((time.perf_counter() - self.started) * 1000),
            "node": data.pop("node", None), "trial": None, "type": event, "source": data.pop("source", "live"), "data": data,
        }
        self.send(json.dumps(envelope, allow_nan=False))


def _explain(error: BaseException) -> dict[str, str]:
    """An error as a code, a plain message and one thing to do about it."""
    text = str(error).strip().splitlines()[0] if str(error).strip() else type(error).__name__
    code = "E_ENGINE"
    hint = "The details are in the log."
    if text.startswith("E_NAN_LOSS:"):
        code, text = "E_NAN_LOSS", text.split(":", 1)[1].strip()
        hint = "Lower the learning rate, or scale the number columns first."
    elif isinstance(error, MemoryError) or "out of memory" in text.lower():
        code, text = "E_OOM", "The browser ran out of memory."
        hint = "Use fewer rows or columns, or choose a lighter model."
    elif "not numbers yet" in text or "empty cells" in text:
        code, hint = "E_DATA_TYPE", "Go back to Missing values or Features and finish preparing the columns."
    elif "must be split" in text or "validation rows" in text:
        code, hint = "E_INVALID_PARAM", "Check the split: the validation share must be above 0 for this check."
    return {"code": code, "message": text, "hint": hint}


def run_train(pipeline_json: str, hashes_json: str, run_id: str, viz: str, send: Callable[[str], None]) -> str:
    """Run the whole pipeline to its last step, streaming events, and return the outcome as JSON.

    The prepared data comes from the cache when the steps before the model have not changed.
    """
    pipeline = json.loads(pipeline_json)
    hashes = json.loads(hashes_json)
    sink = EventSink(run_id, send)
    clear_cancel()
    nodes = [n["id"] for n in pipeline["nodes"]]
    leaves = set(nodes) - {i for n in pipeline["nodes"] for i in n.get("inputs", [])}
    started = time.perf_counter()
    sink("run_started", {"targetNode": nodes[-1], "nodes": nodes, "vizLevel": viz})

    def finish(status: str, **extra: Any) -> str:
        sink("run_finished", {"status": status, **({"error": extra["error"]} if "error" in extra else {})})
        return _dump({"status": status, "durationMs": round((time.perf_counter() - started) * 1000), **extra})

    try:
        result = run_pipeline(pipeline, _require(), emit=sink, cancelled=_is_cancelled, hashes=hashes, cache=_cache, want=leaves, viz=viz)
    except (Cancelled, KeyboardInterrupt):
        sink("node_failed", {"error": {"code": "E_CANCELLED", "message": "Stopped.", "hint": ""}})
        return finish("cancelled")
    except Exception as error:  # noqa: BLE001 - every failure is reported to the user, in words
        reason = _explain(error)
        sink("node_failed", {"error": reason})
        return finish("failed", error=reason)

    models = [n for n in result.order if n in result.ctx.models]
    model_id = models[-1] if models else None
    validate_id = next((n for n in reversed(result.order) if pipeline["nodes"][nodes.index(n)]["type"] == "validate"), None)
    record: dict[str, Any] = {"timings": result.timings, "ran": {"executed": result.executed, "reused": result.reused}}
    if model_id:
        trained = result.ctx.results[model_id]
        record.update(modelNode=model_id, algorithm=result.ctx.models[model_id].algorithm, fit=trained.get("fit"), train=trained.get("train"))
        _models[run_id] = result.ctx.models[model_id]
        while len(_models) > 5:
            _models.pop(next(iter(_models)))
    if validate_id:
        check = result.ctx.results[validate_id]
        record.update(validation=check.get("validation"), method=check.get("method"), spread=check.get("spread"), folds=check.get("folds"))
    return finish("succeeded", **record)
