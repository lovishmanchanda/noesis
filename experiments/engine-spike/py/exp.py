"""Experiment code. Runs inside the Pyodide worker; e9() also runs natively for the same-code check.

`emit` is a callable (bridge.emit in the worker) or None.
"""
import hashlib
import json
import time

import numpy as np
import pandas as pd

import nodes

_state = {}


def _xy(task):
    if task not in _state:
        _state[task] = nodes.make_xy(_state["df"], task)
    return _state[task]


def warm_imports():
    """Import the heavy libraries once, so later timings and cancel tests do not include import cost."""
    t = time.perf_counter()
    import sklearn.cluster  # noqa: F401
    import sklearn.ensemble  # noqa: F401
    import sklearn.linear_model  # noqa: F401
    import sklearn.neighbors  # noqa: F401
    import sklearn.neural_network  # noqa: F401
    import xgboost  # noqa: F401
    return json.dumps({"import_s": round(time.perf_counter() - t, 3)})


def import_one(name):
    import importlib
    t = time.perf_counter()
    importlib.import_module(name)
    return json.dumps({"module": name, "s": round(time.perf_counter() - t, 3)})


def load_data(path):
    t = time.perf_counter()
    _state.clear()
    _state["df"] = nodes.load(path)
    X, _ = _xy("cls")
    return json.dumps({"rows": len(_state["df"]), "features": int(X.shape[1]), "s": round(time.perf_counter() - t, 3)})


# ---- E2 -------------------------------------------------------------------------------------
def e2(path, variant="full"):
    t = time.perf_counter()
    if variant == "full":
        df = nodes.load(path)
    elif variant == "sample100k":
        df = nodes.load(path, nrows=100000)
    else:
        cols = pd.read_csv(path, nrows=0).columns.tolist()[:10]
        df = nodes.load(path, usecols=cols)
    read_s = time.perf_counter() - t
    t = time.perf_counter()
    p = nodes.profile(df)
    profile_s = time.perf_counter() - t
    return json.dumps({"rows": p["rows"], "cols": p["cols"], "read_s": round(read_s, 3),
                       "profile_s": round(profile_s, 3), "frame_mb": round(df.memory_usage(deep=True).sum() / 1e6, 1)})


# ---- E3 -------------------------------------------------------------------------------------
def e3_one(name):
    return json.dumps(nodes.bench(name, _xy("reg" if name == "ridge" else "cls"), n_jobs=1))


# ---- E4 -------------------------------------------------------------------------------------
def e4():
    import os
    import threading
    from sklearn.ensemble import RandomForestClassifier
    from xgboost import XGBClassifier

    X, y = _xy("cls")
    Xtr, ytr = X[:20000], y[:20000]
    out = {"os_cpu_count": os.cpu_count(), "threads_active": threading.active_count()}
    for nj in (1, 4):
        t = time.perf_counter()
        RandomForestClassifier(n_estimators=40, max_depth=12, n_jobs=nj, random_state=0).fit(Xtr, ytr)
        out[f"rf_n_jobs_{nj}_s"] = round(time.perf_counter() - t, 3)
        t = time.perf_counter()
        XGBClassifier(n_estimators=80, max_depth=6, tree_method="hist", n_jobs=nj).fit(Xtr, ytr)
        out[f"xgb_n_jobs_{nj}_s"] = round(time.perf_counter() - t, 3)
    try:
        from joblib import Parallel, delayed
        Parallel(n_jobs=2)(delayed(pow)(2, i) for i in range(4))
        out["joblib_n_jobs_2"] = "ok"
    except Exception as e:  # noqa: BLE001
        out["joblib_n_jobs_2"] = repr(e)
    try:
        th = threading.Thread(target=lambda: None)
        th.start()
        th.join()
        out["thread_start"] = "ok"
    except Exception as e:  # noqa: BLE001
        out["thread_start"] = repr(e)
    return json.dumps(out)


# ---- E5 -------------------------------------------------------------------------------------
def e5_job(case):
    """Deliberately long jobs, started, then cancelled from the main thread."""
    X, y = _xy("cls")
    Xtr, Xte, ytr, yte = nodes.split(X, y)
    if case == "read":
        nodes.load("/tmp/big.csv")
    elif case == "rf":
        from sklearn.ensemble import RandomForestClassifier
        RandomForestClassifier(n_estimators=400, max_depth=12, n_jobs=1, random_state=0).fit(Xtr, ytr)
    elif case in ("xgb_plain", "xgb_cb"):
        from xgboost import XGBClassifier
        from xgboost.callback import TrainingCallback

        class Cb(TrainingCallback):
            def after_iteration(self, model, epoch, evals_log):
                return False

        XGBClassifier(n_estimators=3000, max_depth=6, tree_method="hist", n_jobs=1,
                      callbacks=[Cb()] if case == "xgb_cb" else None).fit(Xtr, ytr)
    elif case == "mlp_loop":
        from sklearn.neural_network import MLPClassifier
        clf = MLPClassifier(hidden_layer_sizes=(64, 32), random_state=0)
        classes = np.unique(ytr)
        for i in range(1000):
            clf.partial_fit(Xtr, ytr, classes=classes if i == 0 else None)
    return "finished"


# ---- E6 -------------------------------------------------------------------------------------
def e6_mlp(emit, epochs=15):
    from sklearn.neural_network import MLPClassifier
    X, y = _xy("cls")
    Xtr, Xte, ytr, yte = nodes.split(X, y)
    clf = MLPClassifier(hidden_layer_sizes=(64, 32), random_state=0)
    classes = np.unique(ytr)
    t0 = time.perf_counter()
    for ep in range(epochs):
        clf.partial_fit(Xtr, ytr, classes=classes if ep == 0 else None)
        if emit:
            emit("epoch_end", {"epoch": ep + 1, "totalEpochs": epochs, "trainLoss": float(clf.loss_)})
            W = clf.coefs_[0]
            emit("weights_snapshot", {"layer": 0},
                 W[:: max(1, W.shape[0] // 32), :: max(1, W.shape[1] // 32)])
    s = time.perf_counter() - t0
    return json.dumps({"s": round(s, 3), "epochs": epochs, "score": round(float((clf.predict(Xte) == yte).mean()), 4)})


def e6_mlp_fit(epochs=15):
    from sklearn.neural_network import MLPClassifier
    X, y = _xy("cls")
    Xtr, Xte, ytr, yte = nodes.split(X, y)
    clf = MLPClassifier(hidden_layer_sizes=(64, 32), max_iter=epochs, random_state=0)
    t = time.perf_counter()
    clf.fit(Xtr, ytr)
    return json.dumps({"s": round(time.perf_counter() - t, 3), "epochs": epochs,
                       "score": round(float((clf.predict(Xte) == yte).mean()), 4)})


def e6_rf(emit, n=40):
    from sklearn.ensemble import RandomForestClassifier
    X, y = _xy("cls")
    Xtr, Xte, ytr, yte = nodes.split(X, y)
    Xtr, ytr, Xs = Xtr[:30000], ytr[:30000], Xte[:2000]
    t = time.perf_counter()
    rf = RandomForestClassifier(n_estimators=1, warm_start=True, max_depth=12, n_jobs=1, random_state=0)
    for k in range(1, n + 1):
        rf.n_estimators = k
        rf.fit(Xtr, ytr)
        if emit:
            emit("ensemble_progress", {"done": k, "total": n})
    warm_s = time.perf_counter() - t
    t = time.perf_counter()
    one = RandomForestClassifier(n_estimators=n, max_depth=12, n_jobs=1, random_state=0).fit(Xtr, ytr)
    one_s = time.perf_counter() - t
    d = float(np.abs(rf.predict_proba(Xs) - one.predict_proba(Xs)).max())
    return json.dumps({"trees": n, "warm_s": round(warm_s, 3), "one_shot_s": round(one_s, 3),
                       "max_abs_proba_diff": d, "identical": d == 0.0})


def e6_xgb(emit, rounds=100):
    from xgboost import XGBClassifier
    from xgboost.callback import TrainingCallback
    X, y = _xy("cls")
    Xtr, Xte, ytr, yte = nodes.split(X, y)

    class Cb(TrainingCallback):
        def after_iteration(self, model, epoch, evals_log):
            if emit:
                emit("boost_round", {"round": epoch + 1, "total": rounds,
                                     "valLoss": evals_log["validation_0"]["logloss"][-1]})
            return False

    def fit(with_cb):
        m = XGBClassifier(n_estimators=rounds, max_depth=6, tree_method="hist", n_jobs=1, random_state=0,
                          eval_metric="logloss", callbacks=[Cb()] if with_cb else None)
        t = time.perf_counter()
        m.fit(Xtr, ytr, eval_set=[(Xte, yte)], verbose=False)
        return time.perf_counter() - t, m

    plain_s, m1 = fit(False)
    cb_s, m2 = fit(True)
    same = bool(np.array_equal(m1.predict(Xte[:2000]), m2.predict(Xte[:2000])))
    return json.dumps({"rounds": rounds, "plain_s": round(plain_s, 3), "callback_s": round(cb_s, 3),
                       "overhead_pct": round(100 * (cb_s - plain_s) / plain_s, 1), "same_predictions": same})


def e6_kmeans(emit, k=8):
    from sklearn.cluster import KMeans, kmeans_plusplus
    X, _ = _xy("cls")
    X = X[:50000]
    normal = KMeans(n_clusters=k, n_init=1, random_state=0, algorithm="lloyd").fit(X)
    centers, _ = kmeans_plusplus(X, k, random_state=0)
    tol_abs = float(np.mean(np.var(X, axis=0)) * 1e-4)
    it = 0
    km = None
    t = time.perf_counter()
    for it in range(1, 301):
        km = KMeans(n_clusters=k, init=centers, n_init=1, max_iter=1, tol=0, algorithm="lloyd").fit(X)
        shift = float(((km.cluster_centers_ - centers) ** 2).sum())
        centers = km.cluster_centers_
        if emit:
            emit("cluster_iter", {"iter": it, "inertia": float(km.inertia_), "shift": shift})
        if shift <= tol_abs:
            break
    step_s = time.perf_counter() - t
    rel = abs(km.inertia_ - normal.inertia_) / normal.inertia_
    return json.dumps({"normal_inertia": float(normal.inertia_), "normal_iters": int(normal.n_iter_),
                       "stepped_inertia": float(km.inertia_), "stepped_iters": it, "stepped_s": round(step_s, 3),
                       "relative_inertia_diff": rel})


def e6_rate(emit, n=20000):
    t = time.perf_counter()
    for i in range(n):
        emit("tick", {"i": i})
    return json.dumps({"sent": n, "worker_s": round(time.perf_counter() - t, 3)})


# ---- E7 -------------------------------------------------------------------------------------
def e7_arrow():
    import io
    import pyarrow as pa
    import pyarrow.feather as feather
    import pyarrow.parquet as pq

    df = _state["df"]
    out = {}
    t = time.perf_counter()
    tbl = pa.Table.from_pandas(df)
    out["from_pandas_s"] = round(time.perf_counter() - t, 3)

    def run(label, write, read):
        try:
            b = io.BytesIO()
            t = time.perf_counter()
            write(b)
            w = time.perf_counter() - t
            data = b.getvalue()
            t = time.perf_counter()
            back = read(io.BytesIO(data))
            r = time.perf_counter() - t
            out[label] = {"bytes": len(data), "write_s": round(w, 3), "read_s": round(r, 3), "rows": len(back)}
            return data
        except Exception as e:  # noqa: BLE001
            out[label] = {"error": repr(e)[:200]}
            return None

    raw = run("feather_uncompressed", lambda b: feather.write_feather(df, b, compression="uncompressed"), feather.read_feather)
    run("feather_lz4", lambda b: feather.write_feather(df, b, compression="lz4"), feather.read_feather)
    run("feather_zstd", lambda b: feather.write_feather(df, b, compression="zstd"), feather.read_feather)
    run("parquet_snappy", lambda b: pq.write_table(tbl, b, compression="snappy"), lambda b: pq.read_table(b).to_pandas())
    run("parquet_zstd", lambda b: pq.write_table(tbl, b, compression="zstd"), lambda b: pq.read_table(b).to_pandas())
    if raw:
        with open("/tmp/node.feather", "wb") as f:
            f.write(raw)
    return json.dumps(out)


# ---- E9 (runs natively too) -----------------------------------------------------------------
def _round(o, nd=4):
    if isinstance(o, float):
        return round(o, nd)
    if isinstance(o, dict):
        return {k: _round(v, nd) for k, v in o.items()}
    if isinstance(o, list):
        return [_round(v, nd) for v in o]
    return o


def e9(path):
    df = nodes.load(path)
    prof = nodes.profile(df)
    xy = nodes.make_xy(df, "cls")
    scores = {r["model"]: r["score"] for r in (nodes.bench(m, xy) for m in ("logistic", "knn", "random_forest"))}
    return json.dumps({
        "profile_md5_4dp": hashlib.md5(json.dumps(_round(prof), sort_keys=True).encode()).hexdigest(),
        "rows": prof["rows"], "duplicates": prof["duplicates"], "max_abs_corr": round(prof["max_abs_corr"], 6),
        "num_0_mean": round(prof["columns"]["num_0"]["mean"], 6), "scores": scores,
    })
