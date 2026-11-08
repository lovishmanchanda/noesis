"""Steps that read and reshape data without learning from it, and the split."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .context import Ctx, Data


def load_csv(source: Any, p: dict[str, Any]) -> pd.DataFrame:
    """Read a CSV file (path or file object) with the step's settings."""
    return pd.read_csv(
        source,
        sep=p["delimiter"],
        header=0 if p["header"] else None,
        encoding=p["encoding"],
        na_values=p["missingMarkers"],
        keep_default_na=False,
        nrows=p["sampleRows"],
        parse_dates=p["dateColumns"] or False,
    )


def _require(frame: pd.DataFrame, names: list[str], step: str) -> None:
    missing = [n for n in names if n not in frame.columns]
    if missing:
        raise KeyError(f"{step}: no such column {', '.join(repr(m) for m in missing)}")


def drop_columns(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    names = p["columns"]
    return data.map(lambda _, f: (_require(f, names, "drop_columns"), f.drop(columns=names))[1])


def drop_duplicates(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    keep = False if p["keep"] == "none" else p["keep"]
    subset = p["subset"]
    return data.map(lambda _, f: f.drop_duplicates(subset=subset, keep=keep).reset_index(drop=True))


def _mask(series: pd.Series, operator: str, value: Any) -> pd.Series:
    if operator == "is_null":
        return series.isna()
    if operator == "not_null":
        return series.notna()
    if operator == "in":
        return series.isin(value)
    if operator == "not_in":
        return ~series.isin(value)
    compare = {
        "==": lambda s: s == value,
        "!=": lambda s: s != value,
        ">": lambda s: s > value,
        ">=": lambda s: s >= value,
        "<": lambda s: s < value,
        "<=": lambda s: s <= value,
    }
    return compare[operator](series).fillna(False)


def filter_rows(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    column = p["column"]

    def keep(_: str, frame: pd.DataFrame) -> pd.DataFrame:
        _require(frame, [column], "filter_rows")
        return frame[_mask(frame[column], p["operator"], p.get("value"))].reset_index(drop=True)

    return data.map(keep)


def _sizes(n: int, ratios: list[float]) -> tuple[int, int, int]:
    train = int(round(n * ratios[0]))
    validation = int(round(n * ratios[1]))
    validation = min(validation, n - train)
    return train, validation, n - train - validation


def _take(frame: pd.DataFrame, order: np.ndarray, ratios: list[float]) -> dict[str, pd.DataFrame]:
    a, b, _ = _sizes(len(order), ratios)
    cuts = {"train": order[:a], "validation": order[a : a + b], "test": order[a + b :]}
    return {name: frame.iloc[idx].reset_index(drop=True) for name, idx in cuts.items()}


def split(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    if data.is_split:
        raise ValueError("The data is already split")
    frame = data.parts["all"]
    strategy, ratios = p["strategy"], p["ratios"]
    rng = np.random.default_rng(ctx.seed)

    if strategy == "none":
        empty = frame.iloc[0:0]
        return Data({"train": frame.reset_index(drop=True), "validation": empty, "test": empty})

    if strategy in ("random", "time"):
        if strategy == "time":
            order = np.argsort(frame[p["timeColumn"]].to_numpy(), kind="stable")
        else:
            order = rng.permutation(len(frame)) if p["shuffle"] else np.arange(len(frame))
        parts = _take(frame, order, ratios)

    elif strategy == "stratified":
        column = p["stratifyColumn"] or ctx.target
        if column is None:
            raise ValueError("A stratified split needs a target or a column to keep shares of")
        buckets: dict[str, list[np.ndarray]] = {"train": [], "validation": [], "test": []}
        for _, rows in frame.groupby(column, sort=True, dropna=False).indices.items():
            rows = rng.permutation(rows) if p["shuffle"] else rows
            a, b, _ = _sizes(len(rows), ratios)
            buckets["train"].append(rows[:a])
            buckets["validation"].append(rows[a : a + b])
            buckets["test"].append(rows[a + b :])
        parts = {
            name: frame.iloc[np.sort(np.concatenate(chunks))].reset_index(drop=True)
            for name, chunks in buckets.items()
        }

    elif strategy == "group":
        groups = frame[p["groupColumn"]]
        unique = rng.permutation(groups.dropna().unique())
        counts = groups.value_counts()
        n = len(frame)
        a, b, _ = _sizes(n, ratios)
        assignment: dict[Any, str] = {}
        seen = 0
        for g in unique:
            name = "train" if seen < a else "validation" if seen < a + b else "test"
            assignment[g] = name
            seen += int(counts[g])
        label = groups.map(assignment).fillna("test")
        parts = {name: frame[label == name].reset_index(drop=True) for name in ("train", "validation", "test")}

    else:
        raise ValueError(f"Unknown split strategy {strategy!r}")

    if len(parts["train"]) == 0 or len(parts["test"]) == 0:
        raise ValueError("The split left the training or the test part empty. Use more rows or other ratios.")
    for name, part in parts.items():
        ctx.emit("split_part", {"part": name, "rows": len(part)})
    return Data(parts)
