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
from .profile import profile
from .registry import resolve_params
from .runner import run_pipeline

_frame: pd.DataFrame | None = None


def _dump(value: Any) -> str:
    return json.dumps(value, allow_nan=False)


def open_csv(source: Any, settings_json: str = "{}") -> str:
    """Read a CSV (path, text or bytes) with the given load settings and return its profile."""
    global _frame
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


def run_early(pipeline_json: str) -> str:
    """Run a pipeline made of data steps up to its last step on the open file.

    Returns the number of rows in each part, and the profile of the training rows (the profile
    every later suggestion must use, so that no statistic includes the test rows).
    """
    pipeline = json.loads(pipeline_json)
    result = run_pipeline(pipeline, _require())
    final = result.outputs[result.order[-1]]
    target = result.ctx.target
    out: dict[str, Any] = {"rows": {name: len(part) for name, part in final.parts.items()}}
    if final.is_split:
        out["trainProfile"] = profile(final.parts["train"], target)
    else:
        out["profile"] = profile(final.parts["all"], target)
    return _dump(out)


def reset() -> None:
    global _frame
    _frame = None
