"""Describes a table: what each column is, how complete it is, and what its values look like.

This is the profile the screens and the suggestion rules read (see docs/design/rule-engine.md).
Everything returned is plain JSON data: no NaN, no numpy types.
"""

from __future__ import annotations

import math
import re
from typing import Any

import numpy as np
import pandas as pd

DATE_PATTERNS = (
    re.compile(r"^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?"),
    re.compile(r"^\d{1,2}/\d{1,2}/\d{2,4}"),
    re.compile(r"^\d{1,2}\.\d{1,2}\.\d{2,4}"),
)
HISTOGRAM_BINS = 12


def _clean(value: Any) -> Any:
    """Turn numpy and pandas values into plain JSON values."""
    if value is None or value is pd.NaT:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return None if math.isnan(number) or math.isinf(number) else number
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    return value


def _looks_like_dates(values: pd.Series) -> bool:
    sample = values.dropna().astype(str).head(200)
    if sample.empty:
        return False
    hits = sum(any(p.match(v) for p in DATE_PATTERNS) for v in sample)
    return hits / len(sample) >= 0.95


def _number_share(values: pd.Series) -> float:
    sample = values.dropna().astype(str).head(500)
    if sample.empty:
        return 0.0
    return float(pd.to_numeric(sample.str.replace(",", "", regex=False), errors="coerce").notna().mean())


def infer_dtype(series: pd.Series) -> str:
    """One of int, float, bool, category, string, datetime."""
    if pd.api.types.is_bool_dtype(series):
        return "bool"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    if pd.api.types.is_integer_dtype(series):
        return "int"
    if pd.api.types.is_float_dtype(series):
        return "float"
    if _looks_like_dates(series):
        return "datetime"
    unique = series.nunique(dropna=True)
    count = max(1, series.notna().sum())
    return "category" if unique <= 50 or unique / count < 0.5 else "string"


def _numeric_stats(series: pd.Series) -> dict[str, Any]:
    values = series.dropna().astype(float)
    if values.empty:
        return {}
    q1, median, q3 = values.quantile([0.25, 0.5, 0.75]).tolist()
    spread = q3 - q1
    outliers = int(((values < q1 - 1.5 * spread) | (values > q3 + 1.5 * spread)).sum())
    counts, edges = np.histogram(values, bins=HISTOGRAM_BINS)
    return {
        "min": _clean(values.min()),
        "max": _clean(values.max()),
        "mean": _clean(values.mean()),
        "median": _clean(median),
        "std": _clean(values.std()),
        "skew": _clean(values.skew()),
        "q1": _clean(q1),
        "q3": _clean(q3),
        "outliers": outliers,
        "histogram": {"counts": [int(c) for c in counts], "min": _clean(edges[0]), "max": _clean(edges[-1])},
    }


def profile_column(series: pd.Series, name: str, rows: int) -> dict[str, Any]:
    dtype = infer_dtype(series)
    missing = int(series.isna().sum())
    unique = int(series.nunique(dropna=True))
    present = rows - missing
    info: dict[str, Any] = {
        "name": name,
        "dtype": dtype,
        "missing": missing,
        "missingPct": _clean(missing / rows) if rows else 0.0,
        "unique": unique,
        "uniquePct": _clean(unique / present) if present else 0.0,
        "constant": unique <= 1,
        "idLike": bool(unique > 0 and present > 0 and unique / present > 0.98 and dtype in ("int", "string", "category")),
    }
    if dtype in ("int", "float"):
        info.update(_numeric_stats(series))
    else:
        top = series.value_counts(dropna=True).head(5)
        info["top"] = [{"value": str(k), "count": int(v)} for k, v in top.items()]
        if dtype in ("string", "category"):
            info["numberLike"] = _number_share(series) >= 0.95
    if dtype == "datetime":
        parsed = pd.to_datetime(series, errors="coerce", format="mixed")
        info["min"], info["max"] = _clean(parsed.min()), _clean(parsed.max())
    return info


def profile_target(series: pd.Series) -> dict[str, Any]:
    out: dict[str, Any] = {"name": series.name, "missing": int(series.isna().sum()), "unique": int(series.nunique(dropna=True))}
    counts = series.value_counts(dropna=True)
    out["classes"] = [{"value": str(k), "count": int(v)} for k, v in counts.head(20).items()]
    if len(counts) > 0:
        out["minorityShare"] = _clean(counts.min() / counts.sum())
    if pd.api.types.is_numeric_dtype(series):
        out["skew"] = _clean(series.dropna().astype(float).skew())
    return out


def profile(frame: pd.DataFrame, target: str | None = None) -> dict[str, Any]:
    """The profile of a table. `target`, if given and present, adds a description of that column."""
    rows = len(frame)
    result: dict[str, Any] = {
        "rows": rows,
        "columnCount": frame.shape[1],
        "duplicates": int(frame.duplicated().sum()) if rows else 0,
        "memoryMB": _clean(frame.memory_usage(deep=True).sum() / 1e6),
        "columns": [profile_column(frame[c], str(c), rows) for c in frame.columns],
    }
    if target is not None and target in frame.columns:
        result["target"] = profile_target(frame[target])
    return result
