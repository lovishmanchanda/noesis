"""Runs a pipeline: resolves each step's settings from the registry and calls the step functions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import pandas as pd

from . import steps_data, steps_prepare
from .context import Ctx, Data
from .registry import resolve_params

STEPS: dict[str, Callable[..., Data]] = {
    "drop_columns": steps_data.drop_columns,
    "drop_duplicates": steps_data.drop_duplicates,
    "filter_rows": steps_data.filter_rows,
    "split": steps_data.split,
    "impute": steps_prepare.impute,
    "handle_outliers": steps_prepare.handle_outliers,
    "encode": steps_prepare.encode,
    "scale": steps_prepare.scale,
    "select_features": steps_prepare.select_features,
    "reduce_dimensions": steps_prepare.reduce_dimensions,
    "derive_feature": steps_prepare.derive_feature,
}


@dataclass
class RunResult:
    outputs: dict[str, Data]
    ctx: Ctx
    order: list[str]


def topological_order(nodes: list[dict]) -> list[str]:
    waiting = {n["id"]: len(n.get("inputs", [])) for n in nodes}
    readers: dict[str, list[str]] = {}
    for n in nodes:
        for i in n.get("inputs", []):
            readers.setdefault(i, []).append(n["id"])
    queue = [n["id"] for n in nodes if not n.get("inputs")]
    order: list[str] = []
    while queue:
        node_id = queue.pop(0)
        order.append(node_id)
        for reader in readers.get(node_id, []):
            waiting[reader] -= 1
            if waiting[reader] == 0:
                queue.append(reader)
    if len(order) != len(nodes):
        raise ValueError("The steps form a loop")
    return order


def run_pipeline(
    pipeline: dict,
    source: Any = None,
    *,
    emit: Callable[[str, dict], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
) -> RunResult:
    """Execute the data and preparation steps. `source` is a DataFrame, a path or a file object."""
    kwargs: dict[str, Any] = {}
    if emit:
        kwargs["emit"] = emit
    if cancelled:
        kwargs["cancelled"] = cancelled
    ctx = Ctx.from_pipeline(pipeline, **kwargs)
    nodes = {n["id"]: n for n in pipeline["nodes"]}
    order = topological_order(pipeline["nodes"])
    outputs: dict[str, Data] = {}

    for node_id in order:
        ctx.check_cancel()
        node = nodes[node_id]
        params = resolve_params(node, ctx.task)
        ctx.emit("node_started", {"node": node_id, "type": node["type"]})
        if node["type"] == "load_csv":
            if source is None:
                raise ValueError("load_csv needs a data source")
            frame = source if isinstance(source, pd.DataFrame) else steps_data.load_csv(source, params)
            outputs[node_id] = Data.single(frame)
        elif node["type"] in STEPS:
            incoming = outputs[node["inputs"][0]]
            outputs[node_id] = STEPS[node["type"]](incoming, params, ctx, node_id)
        else:
            raise NotImplementedError(f"The step type '{node['type']}' is not implemented yet")
        ctx.emit("node_finished", {"node": node_id})
    return RunResult(outputs, ctx, order)
