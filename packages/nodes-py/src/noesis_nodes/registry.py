"""Reads the shared parameter registry (packages/registry/data/registry.json).

The same file drives the TypeScript validator and the forms in the app, so a default or a range
is defined in exactly one place.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any


def _registry_path() -> Path:
    override = os.environ.get("NOESIS_REGISTRY")
    if override:
        return Path(override)
    # src/noesis_nodes/registry.py -> packages/nodes-py/src/noesis_nodes -> packages/registry/data
    return Path(__file__).resolve().parents[3] / "registry" / "data" / "registry.json"


@lru_cache(maxsize=1)
def load_registry() -> dict[str, Any]:
    with open(_registry_path(), encoding="utf-8") as handle:
        return json.load(handle)


def algorithms_for(task: str) -> list[str]:
    return [name for name, spec in load_registry()["algorithms"].items() if task in spec["tasks"]]


def param_specs(node_type: str, algorithm: str | None = None, task: str | None = None) -> dict[str, dict]:
    """Settings a step accepts. For a model: its common settings plus the chosen algorithm's."""
    registry = load_registry()
    specs = dict(registry["nodes"][node_type]["params"])
    if node_type != "model":
        return specs
    chosen = registry["algorithms"].get(algorithm) if isinstance(algorithm, str) else None
    if chosen and (task is None or task in chosen["tasks"]):
        specs.update(chosen["params"])
    return specs


def _is_active(spec: dict, value_of) -> bool:
    cond = spec.get("when")
    if not cond:
        return True
    actual = value_of(cond["param"])
    if "equals" in cond:
        return actual == cond["equals"]
    if "in" in cond:
        return actual in cond["in"]
    if "notIn" in cond:
        return actual not in cond["notIn"]
    return True


def resolve_params(node: dict, task: str | None = None) -> dict[str, Any]:
    """Effective settings of a pipeline step: the given value, else the default.

    Settings whose `when` condition is false are left out. `None` means "not in use".
    """
    given = {name: p.get("value") for name, p in (node.get("params") or {}).items()}
    algorithm = given.get("algorithm")
    specs = param_specs(node["type"], algorithm, task)

    def value_of(name: str) -> Any:
        return given[name] if name in given else specs.get(name, {}).get("default")

    return {name: value_of(name) for name, spec in specs.items() if _is_active(spec, value_of)}
