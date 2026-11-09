"""Runs a pipeline: resolves each step's settings from the registry and calls the step functions."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

import pandas as pd

from . import steps_data
from .cache import NodeCache
from .context import Ctx, Data
from .registry import resolve_params

DATA_STEPS: dict[str, Callable[..., Data]] = {
    "drop_columns": steps_data.drop_columns,
    "drop_duplicates": steps_data.drop_duplicates,
    "filter_rows": steps_data.filter_rows,
    "split": steps_data.split,
}
PREPARE_STEPS = ("impute", "handle_outliers", "encode", "scale", "select_features", "reduce_dimensions", "derive_feature")
MODEL_STEPS = ("model", "validate", "test", "stability_check", "export_model")


def step_function(node_type: str) -> Callable[..., Data] | None:
    """The function for a step type. Modules that need scikit-learn load only when first used."""
    if node_type in DATA_STEPS:
        return DATA_STEPS[node_type]
    if node_type in PREPARE_STEPS:
        from . import steps_prepare

        return getattr(steps_prepare, node_type)
    if node_type in MODEL_STEPS:
        from . import steps_model

        return steps_model.STEPS[node_type]
    return None


@dataclass
class RunResult:
    outputs: dict[str, Data]
    ctx: Ctx
    order: list[str]
    executed: list[str] = field(default_factory=list)
    reused: list[str] = field(default_factory=list)


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


def _needed(nodes: dict[str, dict], want: set[str], hashes: dict[str, str], cache: NodeCache | None) -> set[str]:
    """The steps that must be loaded or run to produce the wanted outputs.

    A step whose result is in the cache is loaded and its own inputs are not needed, so editing the
    last step of a pipeline never re-runs the steps before it.
    """
    needed: set[str] = set()
    stack = list(want)
    while stack:
        node_id = stack.pop()
        if node_id in needed:
            continue
        needed.add(node_id)
        node = nodes[node_id]
        if node["type"] != "load_csv" and cache is not None and hashes.get(node_id) in cache:
            continue
        stack.extend(node.get("inputs", []))
    return needed


def run_pipeline(
    pipeline: dict,
    source: Any = None,
    *,
    emit: Callable[[str, dict], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
    hashes: dict[str, str] | None = None,
    cache: NodeCache | None = None,
    want: set[str] | None = None,
) -> RunResult:
    """Execute the data and preparation steps. `source` is a DataFrame, a path or a file object.

    With `hashes` (step id to hash) and a `cache`, steps whose result is already stored are loaded
    instead of run, and new results are stored. `want` names the outputs the caller needs; it
    defaults to every step that nothing else reads.
    """
    kwargs: dict[str, Any] = {}
    if emit:
        kwargs["emit"] = emit
    if cancelled:
        kwargs["cancelled"] = cancelled
    ctx = Ctx.from_pipeline(pipeline, **kwargs)
    nodes = {n["id"]: n for n in pipeline["nodes"]}
    order = topological_order(pipeline["nodes"])
    hashes = hashes or {}
    read = {i for n in pipeline["nodes"] for i in n.get("inputs", [])}
    wanted = want if want is not None else {n for n in nodes if n not in read}
    needed = _needed(nodes, wanted, hashes, cache if hashes else None)
    use_cache = cache if hashes else None

    outputs: dict[str, Data] = {}
    executed: list[str] = []
    reused: list[str] = []
    lineage: dict[str, str | None] = {}  # the latest model upstream of each step

    for node_id in order:
        if node_id not in needed:
            continue
        ctx.check_cancel()
        node = nodes[node_id]
        key = hashes.get(node_id)
        cacheable = use_cache is not None and key is not None and node["type"] != "load_csv"
        if cacheable:
            hit = use_cache.get(key)
            if hit is not None:
                outputs[node_id], fitted = hit
                if fitted is not None:
                    ctx.fitted[node_id] = fitted
                reused.append(node_id)
                lineage[node_id] = None
                ctx.emit("node_reused", {"node": node_id})
                continue
        params = resolve_params(node, ctx.task)
        ctx.emit("node_started", {"node": node_id, "type": node["type"]})
        if node["type"] == "load_csv":
            if source is None:
                raise ValueError("load_csv needs a data source")
            frame = source if isinstance(source, pd.DataFrame) else steps_data.load_csv(source, params)
            outputs[node_id] = Data.single(frame)
        else:
            function = step_function(node["type"])
            if function is None:
                raise NotImplementedError(f"The step type '{node['type']}' is not implemented yet")
            upstream = node["inputs"][0]
            ctx.current_model = node_id if node["type"] == "model" else lineage.get(upstream)
            outputs[node_id] = function(outputs[upstream], params, ctx, node_id)
            if cacheable and node["type"] not in MODEL_STEPS:
                use_cache.put(key, outputs[node_id], ctx.fitted.get(node_id))
        executed.append(node_id)
        lineage[node_id] = node_id if node["type"] == "model" else (lineage.get(node["inputs"][0]) if node.get("inputs") else None)
        ctx.emit("node_finished", {"node": node_id})
    return RunResult(outputs, ctx, order, executed, reused)
