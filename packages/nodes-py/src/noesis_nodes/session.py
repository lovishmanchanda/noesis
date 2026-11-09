"""A small stateful layer for the interactive app: open a file, profile it, run the early steps.

The browser engine and the local companion both call these functions. They take and return JSON
text, so the same calls work across the worker boundary.
"""

from __future__ import annotations

import io
import json
from typing import Any

import pandas as pd

from . import steps_data
from .context import Data
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
