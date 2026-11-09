"""Training loops that report what is happening while a model learns.

Each loop trains exactly like a normal fit of the same settings (the tests check this) but in
small steps, so that it can emit events, and so that it can stop at a step boundary when the user
presses Stop. scikit-learn's own neural-network loop swallows the interrupt, so every loop here
checks the cancel flag itself. See docs/design/training-events.md.
"""

from __future__ import annotations

import time
import warnings
from typing import Any

import numpy as np
import pandas as pd
from sklearn import metrics as skm
from xgboost.callback import TrainingCallback

from .context import Ctx

LIVE_ALGORITHMS = {"mlp", "random_forest", "gradient_boosting", "logistic_regression", "linear_regression", "ridge"}
WEIGHT_CAP = 16  # the weight matrices sent for the picture are at most this wide and tall
TREE_DEPTH_CAP = 6
TREES_WITH_DETAIL = 3
TREE_NODE_CAP = 200


def _round(value: Any, digits: int = 5) -> float | None:
    number = float(value)
    return None if not np.isfinite(number) else round(number, digits)


def _score(classification: bool, y_true: Any, predicted: Any) -> float | None:
    try:
        if classification:
            return _round(skm.accuracy_score(y_true, predicted))
        return _round(skm.r2_score(y_true, predicted))
    except ValueError:
        return None


def _shrink(matrix: np.ndarray, cap: int = WEIGHT_CAP) -> list[list[float]]:
    rows = np.linspace(0, matrix.shape[0] - 1, min(matrix.shape[0], cap)).astype(int)
    cols = np.linspace(0, matrix.shape[1] - 1, min(matrix.shape[1], cap)).astype(int)
    return np.round(matrix[np.ix_(rows, cols)], 3).tolist()


# --- neural network ----------------------------------------------------------------------------
def _mlp_loss(est: Any, classification: bool, x: Any, y: Any, labels: np.ndarray | None) -> float | None:
    try:
        if classification:
            return _round(skm.log_loss(y, est.predict_proba(x), labels=labels))
        return _round(0.5 * skm.mean_squared_error(y, est.predict(x)))
    except ValueError:
        return None


def fit_mlp(est: Any, x: pd.DataFrame, y: Any, vx: pd.DataFrame | None, vy: Any, p: dict[str, Any], ctx: Ctx, node: str) -> dict[str, Any]:
    """Train a neural network one epoch at a time, with the validation rows kept out of training."""
    classification = ctx.task == "classification"
    labels = np.unique(y) if classification else None
    epochs = int(p["epochs"])
    patience = int(p.get("patience") or 10) if p["early_stopping"] else None
    est.set_params(early_stopping=False, max_iter=epochs)
    have_val = vx is not None and len(vx) > 0
    sizes = [x.shape[1], *est.hidden_layer_sizes, 1 if not classification else max(2, len(labels))]
    ctx.emit("model_structure", {
        "node": node, "algorithm": "mlp", "inputUnits": sizes[0], "outputUnits": sizes[-1],
        "layers": [{"units": u, "activation": p["activation"]} for u in sizes[1:-1]],
        "paramCount": int(sum(a * b + b for a, b in zip(sizes[:-1], sizes[1:]))),
    })
    best: tuple[float, list[np.ndarray], list[np.ndarray], int] | None = None
    train_curve: list[float | None] = []
    val_curve: list[float | None] = []
    stopped = "max_epochs"
    last_snapshot = 0.0
    sample = x.sample(min(len(x), 4000), random_state=ctx.seed) if len(x) > 4000 else x
    sample_y = y[sample.index.map(x.index.get_loc)] if len(x) > 4000 else y
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for epoch in range(1, epochs + 1):
            ctx.check_cancel()
            started = time.perf_counter()
            try:
                if classification:
                    est.partial_fit(x, y, classes=labels)
                else:
                    est.partial_fit(x, y)
            except ValueError as error:  # scikit-learn refuses to go on once the weights are not finite
                if "non-finite" not in str(error):
                    raise
                ctx.emit("training_diverged", {"node": node, "epoch": epoch, "loss": None})
                raise ValueError("E_NAN_LOSS: The loss became invalid. Try a lower learning rate, or scale the number columns first") from error
            train_loss = _round(est.loss_)
            val_loss = _mlp_loss(est, classification, vx, vy, labels) if have_val else train_loss
            if train_loss is None or (val_loss is None and have_val):
                ctx.emit("training_diverged", {"node": node, "epoch": epoch, "loss": None})
                raise ValueError("E_NAN_LOSS: The loss became invalid. Try a lower learning rate, or scale the number columns first")
            train_curve.append(train_loss)
            val_curve.append(val_loss)
            data: dict[str, Any] = {
                "node": node, "epoch": epoch, "totalEpochs": epochs, "trainLoss": train_loss, "valLoss": val_loss,
                "lr": float(p["learning_rate"]), "durationMs": round((time.perf_counter() - started) * 1000, 1),
            }
            if ctx.viz != "off":
                data["trainMetric"] = _score(classification, sample_y, est.predict(sample))
                data["valMetric"] = _score(classification, vy, est.predict(vx)) if have_val else None
            ctx.emit("epoch_end", data)
            now = time.perf_counter()
            if ctx.viz == "full" and now - last_snapshot >= 0.25:
                last_snapshot = now
                ctx.emit("weights_snapshot", {
                    "node": node, "epoch": epoch,
                    "layers": [
                        {"meanAbs": _round(np.abs(w).mean()), "std": _round(w.std()), "min": _round(w.min()), "max": _round(w.max()), "matrix": _shrink(w)}
                        for w in est.coefs_
                    ],
                })
            watched = val_loss if val_loss is not None else train_loss
            if best is None or watched < best[0] - 1e-9:
                best = (watched, [w.copy() for w in est.coefs_], [b.copy() for b in est.intercepts_], epoch)
            elif patience is not None and epoch - best[3] >= patience:
                stopped = "early_stop"
                ctx.emit("early_stop", {"node": node, "epoch": epoch, "bestEpoch": best[3], "reason": f"No improvement for {patience} epochs"})
                break
    if best is not None and stopped == "early_stop":
        est.coefs_, est.intercepts_ = best[1], best[2]
    return {"epochs": len(train_curve), "stopped": stopped, "trainLoss": train_curve, "valLoss": val_curve, "bestEpoch": best[3] if best else None}


# --- random forest -----------------------------------------------------------------------------
def _tree_events(est: Any, columns: list[str], ctx: Ctx, node: str, tree_id: int) -> None:
    """Replays how a fitted tree was built, node by node in the order scikit-learn created them."""
    tree = est.tree_
    ctx.emit("tree_started", {"node": node, "treeId": tree_id, "source": "replay"})
    depth = np.zeros(tree.node_count, dtype=int)
    parent = np.full(tree.node_count, -1)
    side = [""] * tree.node_count
    for i in range(tree.node_count):
        for child, name in ((tree.children_left[i], "left"), (tree.children_right[i], "right")):
            if child != -1:
                depth[child], parent[child], side[child] = depth[i] + 1, i, name
    sent = 0
    for i in range(tree.node_count):
        if depth[i] > TREE_DEPTH_CAP or sent >= TREE_NODE_CAP:
            continue
        leaf = tree.children_left[i] == -1
        ctx.emit("tree_node_added", {
            "node": node, "treeId": tree_id, "nodeId": int(i), "parentId": None if parent[i] < 0 else int(parent[i]),
            "side": side[i] or None, "feature": None if leaf else columns[int(tree.feature[i])],
            "threshold": None if leaf else _round(tree.threshold[i]), "samples": int(tree.n_node_samples[i]),
            "impurity": _round(tree.impurity[i]), "value": np.round(tree.value[i].ravel(), 4).tolist(), "isLeaf": bool(leaf),
            "depth": int(depth[i]), "source": "replay",
        })
        sent += 1
    ctx.emit("tree_finished", {
        "node": node, "treeId": tree_id, "nodes": int(tree.node_count), "depth": int(tree.max_depth),
        "leaves": int((tree.children_left == -1).sum()), "source": "replay",
    })


def fit_forest(est: Any, x: pd.DataFrame, y: Any, vx: pd.DataFrame | None, vy: Any, p: dict[str, Any], ctx: Ctx, node: str) -> dict[str, Any]:
    """Grow the forest in chunks of trees (warm start), which gives the same forest as growing it at once."""
    classification = ctx.task == "classification"
    total = int(p["n_estimators"])
    chunk = max(1, total // 20)
    est.set_params(warm_start=True)
    have_val = vx is not None and len(vx) > 0
    sample = x.sample(min(len(x), 3000), random_state=ctx.seed) if len(x) > 3000 else x
    sample_y = y[sample.index.map(x.index.get_loc)] if len(x) > 3000 else y
    ctx.emit("model_structure", {"node": node, "algorithm": "random_forest", "totalTrees": total, "features": x.shape[1]})
    curve: list[dict[str, Any]] = []
    done = 0
    while done < total:
        ctx.check_cancel()
        done = min(total, done + chunk)
        est.set_params(n_estimators=done)
        est.fit(x, y)
        row = {
            "node": node, "done": done, "total": total,
            "trainMetric": _score(classification, sample_y, est.predict(sample)),
            "valMetric": _score(classification, vy, est.predict(vx)) if have_val else None,
        }
        curve.append({k: row[k] for k in ("done", "trainMetric", "valMetric")})
        ctx.emit("ensemble_progress", row)
    est.set_params(warm_start=False)
    if ctx.viz != "off":
        for i in range(min(TREES_WITH_DETAIL, len(est.estimators_))):
            _tree_events(est.estimators_[i], list(x.columns), ctx, node, i)
        order = np.argsort(est.feature_importances_)[::-1][:30]
        ctx.emit("feature_importance", {"node": node, "importances": [{"feature": x.columns[i], "value": _round(est.feature_importances_[i])} for i in order]})
    return {"trees": total, "curve": curve}


# --- gradient boosting (XGBoost) ---------------------------------------------------------------
class _Rounds(TrainingCallback):
    """Reports each boosting round and stops at the next round when asked."""

    def __init__(self, ctx: Ctx, node: str, learning_rate: float, total: int) -> None:
        self.ctx, self.node, self.lr, self.total = ctx, node, learning_rate, total
        self.curve: list[dict[str, Any]] = []

    def after_iteration(self, model: Any, epoch: int, evals_log: dict) -> bool:
        def last(name: str) -> float | None:
            series = evals_log.get(name)
            return _round(next(iter(series.values()))[-1]) if series else None

        row = {"round": epoch + 1, "trainLoss": last("validation_0"), "valLoss": last("validation_1") or last("validation_0")}
        self.curve.append(row)
        self.ctx.emit("boost_round", {"node": self.node, "totalRounds": self.total, "learningRate": self.lr, **row})
        return bool(self.ctx.cancelled())


def fit_boosting(est: Any, x: pd.DataFrame, y: Any, vx: pd.DataFrame | None, vy: Any, p: dict[str, Any], ctx: Ctx, node: str) -> dict[str, Any]:
    from .context import Cancelled

    have_val = vx is not None and len(vx) > 0
    callback = _Rounds(ctx, node, float(p["learning_rate"]), int(p["n_estimators"]))
    est.set_params(callbacks=[callback])
    ctx.emit("model_structure", {"node": node, "algorithm": "gradient_boosting", "totalRounds": int(p["n_estimators"]), "features": x.shape[1]})
    eval_set = [(x, y)] + ([(vx, vy)] if have_val else [])
    est.fit(x, y, eval_set=eval_set, verbose=False)
    ctx.check_cancel()  # a stop requested in the last round still ends the run as cancelled
    if ctx.cancelled():
        raise Cancelled()
    if ctx.viz != "off":
        values = np.asarray(est.feature_importances_)
        order = np.argsort(values)[::-1][:30]
        ctx.emit("feature_importance", {"node": node, "importances": [{"feature": x.columns[i], "value": _round(values[i])} for i in order]})
    return {"rounds": len(callback.curve), "curve": callback.curve, "bestIteration": getattr(est, "best_iteration", None)}


# --- linear models -----------------------------------------------------------------------------
def fit_linear(est: Any, x: pd.DataFrame, y: Any, vx: pd.DataFrame | None, vy: Any, p: dict[str, Any], ctx: Ctx, node: str) -> dict[str, Any]:
    algorithm = p["algorithm"]
    ctx.emit("model_structure", {"node": node, "algorithm": algorithm, "features": x.shape[1]})
    ctx.check_cancel()
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        est.fit(x, y)
    iterations = getattr(est, "n_iter_", None)
    if iterations is not None:
        iters = int(np.max(iterations))
        ctx.emit("fit_progress", {
            "node": node, "iter": iters, "totalIter": int(p.get("max_iter") or iters), "loss": None,
            "converged": not any("converge" in str(w.message).lower() for w in caught),
        })
    coefficients = np.atleast_2d(est.coef_)
    strength = np.abs(coefficients).max(axis=0)
    order = np.argsort(strength)[::-1][:50]
    ctx.emit("coef_update", {
        "node": node, "source": "replay" if iterations is None else "live",
        "coefficients": [{"feature": x.columns[i], "value": _round(coefficients[np.abs(coefficients[:, i]).argmax(), i], 6)} for i in order],
        "intercept": _round(np.ravel(est.intercept_)[0]),
    })
    return {"iterations": None if iterations is None else int(np.max(iterations))}


TRAINERS = {
    "mlp": fit_mlp,
    "random_forest": fit_forest,
    "gradient_boosting": fit_boosting,
    "logistic_regression": fit_linear,
    "linear_regression": fit_linear,
    "ridge": fit_linear,
}
