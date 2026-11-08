"""Summarises a pipeline run in a form that can be compared across runtimes.

Used by the contract test: the same pipeline runs natively and in the browser engine (Pyodide),
and the two summaries are compared. Also usable as a command:

    python -m noesis_nodes.contract pipeline.json data.csv
"""

from __future__ import annotations

import hashlib
import io
import json
import sys
from typing import Any

import pandas as pd

from .runner import run_pipeline


def _round(value: Any, places: int = 6) -> Any:
    if isinstance(value, float):
        return round(value, places)
    if isinstance(value, dict):
        return {k: _round(v, places) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_round(v, places) for v in value]
    return value


def frame_hash(frame: pd.DataFrame) -> str:
    return hashlib.md5(frame.round(5).to_csv(index=False).encode()).hexdigest()


def summarize(pipeline_json: str, csv_text: str) -> dict[str, Any]:
    pipeline = json.loads(pipeline_json)
    result = run_pipeline(pipeline, io.StringIO(csv_text))
    last_data = None
    for node_id in result.order:
        node = next(n for n in pipeline["nodes"] if n["id"] == node_id)
        if node["type"] in ("model", "validate", "test", "stability_check", "export_model"):
            break
        last_data = result.outputs[node_id]
    parts = last_data.parts if last_data else {}
    return {
        "rows": {name: len(frame) for name, frame in parts.items()},
        "columns": list(parts["train"].columns) if "train" in parts else [],
        "frameHash": frame_hash(parts["train"]) if "train" in parts else None,
        "results": _round(result.ctx.results, 8),
    }


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as p, open(sys.argv[2], encoding="utf-8") as d:
        print(json.dumps(summarize(p.read(), d.read())))
