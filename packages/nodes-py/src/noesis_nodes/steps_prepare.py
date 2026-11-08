"""Steps that clean and transform data. Those that learn from data are fitted on the training
rows only, and refuse to run before the split."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.feature_selection import SelectKBest, f_classif, f_regression
from sklearn.impute import KNNImputer
from sklearn.preprocessing import MaxAbsScaler, MinMaxScaler, RobustScaler, StandardScaler

from .context import Ctx, Data

OTHER = "__other__"


def _numeric(frame: pd.DataFrame, name: str) -> bool:
    return pd.api.types.is_numeric_dtype(frame[name])


def _check_columns(frame: pd.DataFrame, names: list[str], ctx: Ctx, step: str) -> None:
    missing = [n for n in names if n not in frame.columns]
    if missing:
        raise KeyError(f"{step}: no such column {', '.join(repr(m) for m in missing)}")
    protected = [n for n in names if n in ctx.special()]
    if protected:
        raise ValueError(f"{step}: {', '.join(repr(p) for p in protected)} is the target, a reference or an excluded column")


# --- impute ---------------------------------------------------------------------------------
class Imputer:
    def __init__(self, p: dict[str, Any]):
        self.p = p
        self.fill: dict[str, Any] = {}
        self.knn: KNNImputer | None = None

    def fit(self, train: pd.DataFrame) -> "Imputer":
        strategy, columns = self.p["strategy"], self.p["columns"]
        if strategy in ("mean", "median", "knn"):
            bad = [c for c in columns if not _numeric(train, c)]
            if bad:
                raise ValueError(f"impute: '{strategy}' needs numbers, but {bad} are not numeric")
        if strategy == "knn":
            self.knn = KNNImputer(n_neighbors=self.p["knnNeighbors"]).fit(train[columns])
            return self
        for c in columns:
            series = train[c]
            if strategy == "constant":
                self.fill[c] = self.p["fillValue"]
                continue
            if series.notna().sum() == 0:
                raise ValueError(f"impute: '{c}' has no values in the training rows to learn from")
            self.fill[c] = (
                series.mean() if strategy == "mean"
                else series.median() if strategy == "median"
                else series.mode(dropna=True).iloc[0]
            )
        return self

    def transform(self, frame: pd.DataFrame, part: str) -> pd.DataFrame:
        out = frame.copy()
        columns = self.p["columns"]
        if self.p["addMissingIndicator"]:
            for c in columns:
                out[f"{c}_was_missing"] = out[c].isna().astype("int8")
        if self.knn is not None:
            out[columns] = self.knn.transform(out[columns])
        else:
            for c in columns:
                out[c] = out[c].fillna(self.fill[c])
        return out


# --- outliers -------------------------------------------------------------------------------
class OutlierBounds:
    def __init__(self, p: dict[str, Any]):
        self.p = p
        self.bounds: dict[str, tuple[float, float]] = {}

    def fit(self, train: pd.DataFrame) -> "OutlierBounds":
        method, t = self.p["method"], self.p["threshold"]
        for c in self.p["columns"]:
            s = train[c].dropna()
            if method == "iqr":
                q1, q3 = s.quantile(0.25), s.quantile(0.75)
                spread = q3 - q1
                self.bounds[c] = (q1 - t * spread, q3 + t * spread)
            elif method == "zscore":
                self.bounds[c] = (s.mean() - t * s.std(), s.mean() + t * s.std())
            else:
                self.bounds[c] = (s.quantile(self.p["lowerPercentile"] / 100), s.quantile(self.p["upperPercentile"] / 100))
        return self

    def transform(self, frame: pd.DataFrame, part: str) -> pd.DataFrame:
        out = frame.copy()
        outside = pd.DataFrame({c: (out[c] < lo) | (out[c] > hi) for c, (lo, hi) in self.bounds.items()}, index=out.index)
        action = self.p["action"]
        if action == "clip":
            for c, (lo, hi) in self.bounds.items():
                out[c] = out[c].clip(lo, hi)
        elif action == "flag":
            for c in self.bounds:
                out[f"{c}_outlier"] = outside[c].astype("int8")
        elif part == "train":  # remove: only from the training rows, never from validation or test
            out = out[~outside.any(axis=1)].reset_index(drop=True)
        return out


# --- encode ---------------------------------------------------------------------------------
class Encoder:
    def __init__(self, p: dict[str, Any]):
        self.p = p
        self.kept: dict[str, list[Any]] = {}
        self.has_other: dict[str, bool] = {}
        self.freq: dict[str, dict[Any, float]] = {}

    def fit(self, train: pd.DataFrame) -> "Encoder":
        limit = self.p["maxCategories"]
        for c in self.p["columns"]:
            counts = train[c].value_counts(dropna=True)
            keep = list(counts.index[:limit]) if limit else list(counts.index)
            self.kept[c] = sorted(keep, key=str)
            self.has_other[c] = len(keep) < len(counts)
            self.freq[c] = (counts / counts.sum()).to_dict()
        return self

    def _mapped(self, series: pd.Series, c: str) -> pd.Series:
        known = set(self.kept[c])
        if self.p["handleUnknown"] == "error":
            unseen = set(series.dropna().unique()) - set(self.freq[c])
            if unseen:
                raise ValueError(f"encode: '{c}' has values not seen in the training rows: {sorted(map(str, unseen))[:5]}")
        return series.map(lambda v: v if pd.isna(v) or v in known else OTHER)

    def transform(self, frame: pd.DataFrame, part: str) -> pd.DataFrame:
        out = frame.copy()
        method = self.p["method"]
        for c in self.p["columns"]:
            mapped = self._mapped(out[c], c)
            cats = self.kept[c] + ([OTHER] if self.has_other[c] else [])
            new: dict[str, pd.Series] = {}
            if method == "onehot":
                for cat in cats[1:] if self.p["dropFirst"] else cats:
                    new[f"{c}={cat}"] = (mapped == cat).astype("float32")
            elif method == "ordinal":
                order = (self.p["ordinalOrder"] or {}).get(c) or [str(x) for x in cats]
                position = {str(v): i for i, v in enumerate(order)}
                new[c] = mapped.map(lambda v: position.get(str(v), -1)).astype("int64")
            elif method == "frequency":
                new[c] = mapped.map(lambda v: self.freq[c].get(v, 0.0)).astype("float64")
            else:  # binary
                position = {str(v): i + 1 for i, v in enumerate(cats)}
                codes = mapped.map(lambda v: position.get(str(v), 0)).astype("int64")
                for bit in range(max(1, math.ceil(math.log2(len(cats) + 1)))):
                    new[f"{c}_b{bit}"] = pd.Series((codes.to_numpy() >> bit) & 1, index=codes.index).astype("int8")
            out = out.drop(columns=[c]).assign(**new)
        return out


# --- scale ----------------------------------------------------------------------------------
class Scaler:
    def __init__(self, p: dict[str, Any], columns: list[str]):
        self.p, self.columns = p, columns
        method = p["method"]
        self.scaler = (
            StandardScaler() if method == "standard"
            else MinMaxScaler(feature_range=tuple(p["featureRange"])) if method == "minmax"
            else RobustScaler() if method == "robust"
            else MaxAbsScaler()
        )

    def fit(self, train: pd.DataFrame) -> "Scaler":
        self.scaler.fit(train[self.columns])
        return self

    def transform(self, frame: pd.DataFrame, part: str) -> pd.DataFrame:
        out = frame.copy()
        out[self.columns] = self.scaler.transform(out[self.columns]).astype("float64")
        return out


# --- feature selection and reduction ---------------------------------------------------------
class Selector:
    def __init__(self, p: dict[str, Any], ctx: Ctx):
        self.p, self.ctx = p, ctx
        self.drop: list[str] = []

    def fit(self, train: pd.DataFrame) -> "Selector":
        cols = self.ctx.feature_columns(train, numeric_only=True)
        method = self.p["method"]
        if method == "variance":
            variance = train[cols].var(ddof=0)
            self.drop = [c for c in cols if variance[c] <= self.p["varianceThreshold"]]
        elif method == "correlation":
            corr = train[cols].corr().abs()
            self.drop = [c for j, c in enumerate(cols) if (corr.iloc[:j, j] > self.p["correlationThreshold"]).any()]
        else:
            if self.ctx.target is None:
                raise ValueError("select_features: this method needs a target column")
            x = train[cols].fillna(train[cols].median())
            y = train[self.ctx.target]
            classification = self.ctx.task == "classification"
            if method == "kbest":
                chooser = SelectKBest(f_classif if classification else f_regression, k=min(self.p["k"], len(cols))).fit(x, y)
                keep = set(np.array(cols)[chooser.get_support()])
            else:
                forest = (RandomForestClassifier if classification else RandomForestRegressor)(
                    n_estimators=100, random_state=self.ctx.seed, n_jobs=1
                ).fit(x, y)
                limit = self.p["importanceThreshold"]
                limit = forest.feature_importances_.mean() if limit is None else limit
                keep = {c for c, imp in zip(cols, forest.feature_importances_) if imp >= limit}
            self.drop = [c for c in cols if c not in keep]
        return self

    def transform(self, frame: pd.DataFrame, part: str) -> pd.DataFrame:
        return frame.drop(columns=self.drop)


class Reducer:
    def __init__(self, p: dict[str, Any], ctx: Ctx):
        self.p, self.ctx = p, ctx
        self.columns: list[str] = []
        self.pca: PCA | None = None

    def fit(self, train: pd.DataFrame) -> "Reducer":
        self.columns = self.ctx.feature_columns(train, numeric_only=True)
        if train[self.columns].isna().any().any():
            raise ValueError("reduce_dimensions: fill missing values first")
        n = self.p["n_components"]
        n = int(n) if float(n).is_integer() and n >= 1 else float(n)
        self.pca = PCA(n_components=n, whiten=self.p["whiten"], svd_solver="full", random_state=self.ctx.seed)
        self.pca.fit(train[self.columns])
        return self

    def transform(self, frame: pd.DataFrame, part: str) -> pd.DataFrame:
        assert self.pca is not None
        parts = self.pca.transform(frame[self.columns])
        names = [f"pc{i + 1}" for i in range(parts.shape[1])]
        return frame.drop(columns=self.columns).assign(**{n: parts[:, i] for i, n in enumerate(names)})


# --- step functions ---------------------------------------------------------------------------
def _learned(data: Data, step: str, node_id: str, ctx: Ctx, transformer: Any) -> Data:
    transformer.fit(data.fit_frame(step))
    ctx.fitted[node_id] = transformer
    return data.map(lambda part, frame: transformer.transform(frame, part))


def impute(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    _check_columns(data.fit_frame("impute"), p["columns"], ctx, "impute")
    return _learned(data, "impute", node_id, ctx, Imputer(p))


def handle_outliers(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    frame = data.fit_frame("handle_outliers")
    _check_columns(frame, p["columns"], ctx, "handle_outliers")
    return _learned(data, "handle_outliers", node_id, ctx, OutlierBounds(p))


def encode(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    _check_columns(data.fit_frame("encode"), p["columns"], ctx, "encode")
    return _learned(data, "encode", node_id, ctx, Encoder(p))


def scale(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    train = data.fit_frame("scale")
    columns = p["columns"] or ctx.feature_columns(train, numeric_only=True)
    _check_columns(train, columns, ctx, "scale")
    return _learned(data, "scale", node_id, ctx, Scaler(p, columns))


def select_features(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    data.fit_frame("select_features")
    return _learned(data, "select_features", node_id, ctx, Selector(p, ctx))


def reduce_dimensions(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    data.fit_frame("reduce_dimensions")
    return _learned(data, "reduce_dimensions", node_id, ctx, Reducer(p, ctx))


def derive_feature(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    kind, name, sources = p["kind"], p["newName"], p["sourceColumns"]
    edges: np.ndarray | None = None
    if kind == "bin":  # the bin edges come from the training rows, so this kind needs the split first
        column = data.fit_frame("derive_feature (bin)")[sources[0]]
        edges = np.linspace(column.min(), column.max(), p["bins"] + 1)[1:-1]

    def build(_: str, frame: pd.DataFrame) -> pd.DataFrame:
        missing = [s for s in sources if s not in frame.columns]
        if missing:
            raise KeyError(f"derive_feature: no such column {', '.join(repr(m) for m in missing)}")
        a = frame[sources[0]]
        b = frame[sources[1]] if len(sources) > 1 else None
        if kind == "date_part":
            dates = pd.to_datetime(a)
            value = {"year": dates.dt.year, "month": dates.dt.month, "day": dates.dt.day,
                     "weekday": dates.dt.dayofweek, "hour": dates.dt.hour}[p["datePart"]]
        elif kind in ("ratio", "difference", "product"):
            if b is None:
                raise ValueError(f"derive_feature: '{kind}' needs two source columns")
            value = a / b.where(b != 0) if kind == "ratio" else a - b if kind == "difference" else a * b
        elif kind == "log":
            value = np.log(a.where(a > 0))
        elif kind == "polynomial":
            value = a ** p["degree"]
        else:
            value = pd.Series(np.digitize(a, edges), index=a.index).where(a.notna())
        return frame.assign(**{name: value.astype("float64")})

    return data.map(build)
