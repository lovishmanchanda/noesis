"""Models, validation, the final test and the stability check."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd
from sklearn import metrics as skm
from sklearn.base import clone
from sklearn.cluster import DBSCAN, AgglomerativeClustering, KMeans
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import Lasso, LinearRegression, LogisticRegression, Ridge
from sklearn.model_selection import KFold, RepeatedKFold, StratifiedKFold, TimeSeriesSplit
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.preprocessing import LabelEncoder
from sklearn.svm import SVC, SVR
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from xgboost import XGBClassifier, XGBRegressor

from .context import Ctx, Data
from .training import TRAINERS

NAN_SAFE = {"decision_tree", "random_forest", "gradient_boosting"}
CLUSTERING = {"kmeans", "dbscan", "hierarchical"}
DEFAULT_METRICS = {
    "regression": ["rmse", "mae", "r2"],
    "forecasting": ["rmse", "mae", "r2"],
    "classification": ["accuracy", "f1", "roc_auc"],
    "clustering": ["silhouette", "davies_bouldin"],
}


def build_estimator(algorithm: str, p: dict[str, Any], ctx: Ctx, early_stopping: bool = True) -> Any:
    """A fresh, unfitted estimator from the step's settings."""
    clf = ctx.task == "classification"
    seed, jobs = ctx.seed, ctx.n_jobs
    pick = lambda a, b: a if clf else b  # noqa: E731
    if algorithm == "linear_regression":
        return LinearRegression(fit_intercept=p["fit_intercept"])
    if algorithm == "ridge":
        return Ridge(alpha=p["alpha"])
    if algorithm == "lasso":
        return Lasso(alpha=p["alpha"], max_iter=p["max_iter"])
    if algorithm == "logistic_regression":
        penalty = p["penalty"]
        extra: dict[str, Any] = {"class_weight": p["class_weight"]}
        if penalty == "l1":
            extra.update(l1_ratio=1.0, solver="saga")
        elif penalty == "none":
            extra.update(C=np.inf)
        return LogisticRegression(**{"C": p["C"], "max_iter": p["max_iter"], **extra})
    if algorithm == "decision_tree":
        criterion = p["criterion"] or pick("gini", "squared_error")
        return pick(DecisionTreeClassifier, DecisionTreeRegressor)(
            max_depth=p["max_depth"], min_samples_split=p["min_samples_split"],
            min_samples_leaf=p["min_samples_leaf"], criterion=criterion, random_state=seed,
        )
    if algorithm == "random_forest":
        kwargs: dict[str, Any] = {"class_weight": p["class_weight"]} if clf else {}
        return pick(RandomForestClassifier, RandomForestRegressor)(
            n_estimators=p["n_estimators"], max_depth=p["max_depth"], min_samples_leaf=p["min_samples_leaf"],
            max_features=None if p["max_features"] == "all" else p["max_features"], bootstrap=p["bootstrap"],
            n_jobs=jobs, random_state=seed, **kwargs,
        )
    if algorithm == "gradient_boosting":
        stop = p["early_stopping_rounds"] if early_stopping else None
        return pick(XGBClassifier, XGBRegressor)(
            n_estimators=p["n_estimators"], learning_rate=p["learning_rate"], max_depth=p["max_depth"],
            subsample=p["subsample"], tree_method="hist", n_jobs=jobs, random_state=seed, early_stopping_rounds=stop,
        )
    if algorithm == "knn":
        return pick(KNeighborsClassifier, KNeighborsRegressor)(
            n_neighbors=p["n_neighbors"], weights=p["weights"], metric=p["metric"], n_jobs=jobs
        )
    if algorithm == "svm":
        gamma = p["gamma"]
        kwargs = {"degree": p["degree"]} if p["kernel"] == "poly" else {}
        return pick(SVC, SVR)(C=p["C"], kernel=p["kernel"], gamma=gamma, **kwargs)
    if algorithm == "naive_bayes":
        return GaussianNB(var_smoothing=p["var_smoothing"])
    if algorithm == "mlp":
        return pick(MLPClassifier, MLPRegressor)(
            hidden_layer_sizes=tuple(p["hidden_layers"]), activation=p["activation"], solver=p["optimizer"],
            learning_rate_init=p["learning_rate"], batch_size=p["batch_size"], max_iter=p["epochs"], alpha=p["l2"],
            early_stopping=p["early_stopping"], n_iter_no_change=p.get("patience") or 10, random_state=seed,
        )
    if algorithm == "kmeans":
        return KMeans(n_clusters=p["n_clusters"], init=p["init"], max_iter=p["max_iter"], n_init=p["n_init"],
                      random_state=seed, algorithm="lloyd")
    if algorithm == "dbscan":
        return DBSCAN(eps=p["eps"], min_samples=p["min_samples"], n_jobs=jobs)
    if algorithm == "hierarchical":
        return AgglomerativeClustering(n_clusters=p["n_clusters"], linkage=p["linkage"])
    raise ValueError(f"Unknown algorithm {algorithm!r}")


@dataclass
class FittedModel:
    algorithm: str
    params: dict[str, Any]
    estimator: Any
    columns: list[str]
    task: str
    labels: LabelEncoder | None = None
    centres: np.ndarray | None = None  # for clustering methods without their own predict

    def features(self, frame: pd.DataFrame) -> pd.DataFrame:
        return frame[self.columns]

    @property
    def classes(self) -> np.ndarray | None:
        return None if self.labels is None else self.labels.classes_

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        x = self.features(frame)
        if self.algorithm in CLUSTERING:
            if hasattr(self.estimator, "predict"):
                return self.estimator.predict(x)
            assert self.centres is not None
            distance = ((x.to_numpy()[:, None, :] - self.centres[None, :, :]) ** 2).sum(axis=2)
            return distance.argmin(axis=1)
        raw = self.estimator.predict(x)
        return self.labels.inverse_transform(np.asarray(raw).astype(int)) if self.labels is not None else raw

    def scores(self, frame: pd.DataFrame) -> np.ndarray | None:
        x = self.features(frame)
        if hasattr(self.estimator, "predict_proba"):
            return self.estimator.predict_proba(x)
        if hasattr(self.estimator, "decision_function"):
            return self.estimator.decision_function(x)
        return None


def _numeric_features(frame: pd.DataFrame, ctx: Ctx, algorithm: str) -> list[str]:
    columns = ctx.feature_columns(frame)
    bad = [c for c in columns if not pd.api.types.is_numeric_dtype(frame[c])]
    if bad:
        raise ValueError(f"model: these columns are not numbers yet: {bad}. Encode them, derive parts, or drop them first")
    if algorithm not in NAN_SAFE and frame[columns].isna().any().any():
        raise ValueError(f"model: {algorithm} cannot handle empty cells. Fill the missing values first")
    return columns


def _xy(model_frame: pd.DataFrame, columns: list[str], ctx: Ctx) -> tuple[pd.DataFrame, pd.Series]:
    if ctx.target is None:
        raise ValueError("model: this task needs a target column")
    return model_frame[columns], model_frame[ctx.target]


def model(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    if not data.is_split:
        raise ValueError("model: the data must be split before training")
    algorithm = p["algorithm"]
    train = data.parts["train"]
    columns = _numeric_features(train, ctx, algorithm)
    if len(columns) < (2 if algorithm in CLUSTERING else 1):
        raise ValueError("model: not enough numeric feature columns")

    estimator = build_estimator(algorithm, p, ctx)
    if algorithm not in TRAINERS:
        ctx.emit("model_structure", {"node": node_id, "algorithm": algorithm, "features": len(columns)})
    if algorithm in CLUSTERING:
        x = train[columns]
        estimator.fit(x)
        labels = estimator.labels_
        centres = None
        if not hasattr(estimator, "predict"):
            keep = labels >= 0
            centres = np.vstack([x.to_numpy()[labels == k].mean(axis=0) for k in np.unique(labels[keep])])
        fitted = FittedModel(algorithm, p, estimator, columns, ctx.task, None, centres)
        result = {"internal": cluster_metrics(x.to_numpy(), labels, estimator), "sizes": _sizes(labels)}
        ctx.emit("cluster_summary", {"node": node_id, **result})
    else:
        x, y = _xy(train, columns, ctx)
        encoder = LabelEncoder().fit(y) if ctx.task == "classification" else None
        target = encoder.transform(y) if encoder is not None else y
        fit_args: dict[str, Any] = {}
        validation = data.parts["validation"]
        if algorithm in TRAINERS:
            vx = vt = None
            if len(validation) > 0:
                vx, vy = _xy(validation, columns, ctx)
                known = vy.isin(encoder.classes_) if encoder is not None else pd.Series(True, index=vy.index)
                vx, vt = vx[known], (encoder.transform(vy[known]) if encoder is not None else vy[known])
            if algorithm == "gradient_boosting" and p["early_stopping_rounds"] and vx is None:
                estimator = build_estimator(algorithm, p, ctx, early_stopping=False)
            fit_info = TRAINERS[algorithm](estimator, x, target, vx, vt, p, ctx, node_id)
            fitted = FittedModel(algorithm, p, estimator, columns, ctx.task, encoder)
            result = {"train": compute_metrics(fitted, train, DEFAULT_METRICS[ctx.task], ctx), "fit": fit_info}
            ctx.models[node_id] = fitted
            ctx.results[node_id] = result
            return data
        if algorithm == "gradient_boosting" and p["early_stopping_rounds"] and len(validation) > 0:
            vx, vy = _xy(validation, columns, ctx)
            known = vy.isin(encoder.classes_) if encoder is not None else pd.Series(True, index=vy.index)
            vt = encoder.transform(vy[known]) if encoder is not None else vy
            fit_args = {"eval_set": [(vx[known], vt)], "verbose": False}
        else:
            estimator = build_estimator(algorithm, p, ctx, early_stopping=False)
        estimator.fit(x, target, **fit_args)
        fitted = FittedModel(algorithm, p, estimator, columns, ctx.task, encoder)
        result = {"train": compute_metrics(fitted, train, DEFAULT_METRICS[ctx.task], ctx)}
    ctx.models[node_id] = fitted
    ctx.results[node_id] = result
    return data


def _sizes(labels: np.ndarray) -> dict[str, int]:
    values, counts = np.unique(labels, return_counts=True)
    return {str(int(v)): int(c) for v, c in zip(values, counts)}


def cluster_metrics(x: np.ndarray, labels: np.ndarray, estimator: Any = None) -> dict[str, float | None]:
    keep = labels >= 0
    found = len(np.unique(labels[keep]))
    out: dict[str, float | None] = {"clusters": float(found), "noise": float((~keep).sum())}
    ok = found >= 2 and keep.sum() > found
    out["silhouette"] = float(skm.silhouette_score(x[keep], labels[keep])) if ok else None
    out["davies_bouldin"] = float(skm.davies_bouldin_score(x[keep], labels[keep])) if ok else None
    out["calinski_harabasz"] = float(skm.calinski_harabasz_score(x[keep], labels[keep])) if ok else None
    out["inertia"] = float(estimator.inertia_) if hasattr(estimator, "inertia_") else None
    return out


def compute_metrics(m: FittedModel, frame: pd.DataFrame, names: list[str], ctx: Ctx) -> dict[str, float | None]:
    """Scores of a fitted model on the rows of `frame`."""
    if m.task == "clustering" or m.algorithm in CLUSTERING:
        values = cluster_metrics(m.features(frame).to_numpy(), m.predict(frame), m.estimator)
        return {n: values.get(n) for n in names}
    y_true = frame[ctx.target]
    y_pred = m.predict(frame)
    out: dict[str, float | None] = {}
    for name in names:
        out[name] = _score(name, m, frame, y_true, y_pred)
    return out


def _score(name: str, m: FittedModel, frame: pd.DataFrame, y_true: pd.Series, y_pred: np.ndarray) -> float | None:
    try:
        if m.task != "classification":
            return float(
                {"rmse": lambda: np.sqrt(skm.mean_squared_error(y_true, y_pred)), "mae": lambda: skm.mean_absolute_error(y_true, y_pred),
                 "r2": lambda: skm.r2_score(y_true, y_pred), "mape": lambda: skm.mean_absolute_percentage_error(y_true, y_pred)}[name]()
            )
        classes = m.classes
        assert classes is not None
        binary = len(classes) == 2
        average = "binary" if binary else "macro"
        extra = {"pos_label": classes[1]} if binary else {}
        if name == "accuracy":
            return float(skm.accuracy_score(y_true, y_pred))
        if name in ("f1", "precision", "recall"):
            fn = {"f1": skm.f1_score, "precision": skm.precision_score, "recall": skm.recall_score}[name]
            return float(fn(y_true, y_pred, average=average, zero_division=0, **extra))
        scores = m.scores(frame)
        if scores is None:
            return None
        if name == "roc_auc":
            if binary:
                s = scores[:, 1] if scores.ndim == 2 else scores
                return float(skm.roc_auc_score(y_true == classes[1], s))
            return float(skm.roc_auc_score(y_true, scores, multi_class="ovr", labels=classes))
        if name == "pr_auc" and binary:
            s = scores[:, 1] if scores.ndim == 2 else scores
            return float(skm.average_precision_score(y_true == classes[1], s))
        if name == "log_loss":
            return float(skm.log_loss(y_true, scores, labels=classes))
    except (ValueError, KeyError):
        return None
    return None


def _model_for(ctx: Ctx, step: str) -> tuple[str, FittedModel]:
    if ctx.current_model is None or ctx.current_model not in ctx.models:
        raise ValueError(f"{step}: there is no trained model before this step")
    return ctx.current_model, ctx.models[ctx.current_model]


def _summary(rows: list[dict[str, float | None]]) -> dict[str, dict[str, float | None]]:
    out: dict[str, dict[str, float | None]] = {}
    for name in rows[0]:
        values = [r[name] for r in rows if r[name] is not None]
        out[name] = {"mean": float(np.mean(values)) if values else None, "std": float(np.std(values)) if values else None}
    return out


def validate(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    model_id, fitted = _model_for(ctx, "validate")
    method = p["method"]
    names = p["metrics"] or DEFAULT_METRICS[ctx.task]
    result: dict[str, Any] = {"method": method, "model": model_id}
    if method == "none":
        pass
    elif method == "holdout" or fitted.algorithm in CLUSTERING:
        part = "validation" if len(data.parts["validation"]) > 0 else "train"
        if part == "train" and ctx.task != "clustering":
            raise ValueError("validate: the split left no validation rows. Choose a cross-validation method or use a validation share above 0")
        result.update(partition=part, validation=compute_metrics(fitted, data.parts[part], names, ctx))
    elif method == "stability":
        raise ValueError("validate: use the stability_check step for stability")
    else:
        train = data.parts["train"]
        x, y = _xy(train, fitted.columns, ctx)
        encoder = fitted.labels
        target = pd.Series(encoder.transform(y), index=y.index) if encoder is not None else y
        seed, k = ctx.seed, p["k"]
        folds = (
            TimeSeriesSplit(n_splits=k) if method == "time_series_split"
            else StratifiedKFold(k, shuffle=p["shuffle"], random_state=seed if p["shuffle"] else None) if method == "stratified_kfold"
            else RepeatedKFold(n_splits=k, n_repeats=p["repeats"], random_state=seed) if method == "repeated_kfold"
            else KFold(k, shuffle=p["shuffle"], random_state=seed if p["shuffle"] else None)
        )
        rows = []
        for i, (fit_idx, test_idx) in enumerate(folds.split(x, target)):
            ctx.check_cancel()
            est = build_estimator(fitted.algorithm, fitted.params, ctx, early_stopping=False)
            est.fit(x.iloc[fit_idx], target.iloc[fit_idx])
            fold_model = FittedModel(fitted.algorithm, fitted.params, est, fitted.columns, ctx.task, encoder)
            rows.append(compute_metrics(fold_model, train.iloc[test_idx], names, ctx))
            ctx.emit("fold_finished", {"fold": i + 1, "scores": rows[-1]})
        result.update(partition="train", folds=rows, validation={n: s["mean"] for n, s in _summary(rows).items()}, spread=_summary(rows))
    ctx.results[node_id] = result
    ctx.emit("validation_result", {"node": node_id, "metrics": result.get("validation")})
    return data


def test(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    model_id, fitted = _model_for(ctx, "test")
    if ctx.task == "clustering":
        raise ValueError("test: clustering has no test set. Use stability_check")
    if model_id in ctx.test_used:
        raise ValueError("test: the test set was already used for this model. Unlocking it again needs a written reason")
    if len(data.parts["test"]) == 0:
        raise ValueError("test: there are no test rows")
    ctx.test_used.add(model_id)
    names = p["metrics"] or DEFAULT_METRICS[ctx.task]
    ctx.results[node_id] = {"model": model_id, "test": compute_metrics(fitted, data.parts["test"], names, ctx)}
    return data


def stability_check(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    model_id, fitted = _model_for(ctx, "stability_check")
    if fitted.algorithm not in CLUSTERING:
        raise ValueError("stability_check: only for clustering models")
    train = data.parts["train"]
    x = train[fitted.columns]
    main = fitted.predict(train)
    rng = np.random.default_rng(ctx.seed)
    compare = skm.adjusted_rand_score if p["metric"] == "adjusted_rand" else skm.adjusted_mutual_info_score
    scores = []
    for run in range(p["runs"]):
        ctx.check_cancel()
        rows = np.sort(rng.choice(len(x), size=max(2, int(len(x) * p["sampleFraction"])), replace=False))
        est = clone(fitted.estimator).fit(x.iloc[rows])
        scores.append(float(compare(main[rows], est.labels_)))
        ctx.emit("stability_run", {"run": run + 1, "totalRuns": p["runs"], "score": scores[-1]})
    ctx.results[node_id] = {"model": model_id, "metric": p["metric"], "mean": float(np.mean(scores)), "std": float(np.std(scores)), "runs": scores}
    return data


def export_model(data: Data, p: dict[str, Any], ctx: Ctx, node_id: str) -> Data:
    """Records the export settings. Building the files comes in Phase 4."""
    model_id, _ = _model_for(ctx, "export_model")
    ctx.results[node_id] = {"model": model_id, "format": p["format"], "built": False}
    return data


STEPS: dict[str, Callable[..., Data]] = {
    "model": model,
    "validate": validate,
    "test": test,
    "stability_check": stability_check,
    "export_model": export_model,
}
