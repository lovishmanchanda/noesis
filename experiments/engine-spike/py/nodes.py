"""Shared node code. The SAME file runs in Pyodide and natively (experiment E9).

Plain pandas / scikit-learn / XGBoost only, no environment-specific imports at module level.
"""
import time
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

TARGET_CLS = "y_cls"
TARGET_REG = "y_reg"


def load(path, usecols=None, nrows=None):
    return pd.read_csv(path, usecols=usecols, nrows=nrows)


def profile(df, target=TARGET_CLS):
    """The profile the rule engine needs (see docs/rule-engine.md)."""
    out = {"rows": int(len(df)), "cols": int(df.shape[1]), "duplicates": int(df.duplicated().sum()), "columns": {}}
    for c in df.columns:
        s = df[c]
        info = {"dtype": str(s.dtype), "null": int(s.isna().sum()), "unique": int(s.nunique(dropna=True))}
        if pd.api.types.is_numeric_dtype(s):
            q1, med, q3 = s.quantile([0.25, 0.5, 0.75]).tolist()
            iqr = q3 - q1
            info.update(
                min=float(s.min()), max=float(s.max()), mean=float(s.mean()), std=float(s.std()),
                median=float(med), skew=float(s.skew()),
                outliers=int(((s < q1 - 1.5 * iqr) | (s > q3 + 1.5 * iqr)).sum()),
            )
        else:
            top = s.value_counts(dropna=True).head(3)
            info["top"] = {str(k): int(v) for k, v in top.items()}
        out["columns"][c] = info
    num = df.select_dtypes("number")
    samp = num.sample(min(len(num), 20000), random_state=0)
    corr = np.array(samp.corr().abs().to_numpy(), copy=True)
    np.fill_diagonal(corr, 0)
    out["max_abs_corr"] = float(np.nanmax(corr))
    if target in df:
        out["target_balance"] = {str(k): float(v) for k, v in df[target].value_counts(normalize=True).items()}
    return out


def make_xy(df, task="cls", max_onehot=12):
    y = df[TARGET_CLS if task == "cls" else TARGET_REG].to_numpy()
    X = df.drop(columns=[TARGET_CLS, TARGET_REG, "id"], errors="ignore")
    nonnum = [c for c in X.columns if not pd.api.types.is_numeric_dtype(X[c])]
    X = X.drop(columns=[c for c in nonnum if X[c].nunique() > max_onehot])
    num = X.select_dtypes("number")
    cat = X.select_dtypes(exclude="number")
    num = num.fillna(num.median()).astype("float32")
    cat = pd.get_dummies(cat.astype(str).fillna("NA"), dtype="float32")
    return pd.concat([num, cat], axis=1).to_numpy(dtype="float32"), y


def split(X, y, seed=0, test=0.2):
    idx = np.random.default_rng(seed).permutation(len(X))
    n_te = int(len(X) * test)
    te, tr = idx[:n_te], idx[n_te:]
    return X[tr], X[te], y[tr], y[te]


def make_model(name, n_jobs=1, seed=0):
    if name == "random_forest":
        from sklearn.ensemble import RandomForestClassifier
        return RandomForestClassifier(n_estimators=100, max_depth=12, n_jobs=n_jobs, random_state=seed)
    if name == "xgboost":
        from xgboost import XGBClassifier
        return XGBClassifier(n_estimators=200, max_depth=6, tree_method="hist", n_jobs=n_jobs, random_state=seed)
    if name == "logistic":
        from sklearn.linear_model import LogisticRegression
        return LogisticRegression(max_iter=200)
    if name == "ridge":
        from sklearn.linear_model import Ridge
        return Ridge(alpha=1.0)
    if name == "knn":
        from sklearn.neighbors import KNeighborsClassifier
        return KNeighborsClassifier(n_neighbors=5)
    if name == "kmeans":
        from sklearn.cluster import KMeans
        return KMeans(n_clusters=8, n_init=1, random_state=seed, algorithm="lloyd")
    if name == "mlp":
        from sklearn.neural_network import MLPClassifier
        return MLPClassifier(hidden_layer_sizes=(64, 32), max_iter=20, random_state=seed)
    raise ValueError(name)


def bench(name, Xy, n_jobs=1, seed=0):
    X, y = Xy
    Xtr, Xte, ytr, yte = split(X, y, seed)
    if name == "knn":
        Xtr, ytr, Xte, yte = Xtr[:20000], ytr[:20000], Xte[:2000], yte[:2000]
    m = make_model(name, n_jobs, seed)
    t = time.perf_counter()
    m.fit(Xtr) if name == "kmeans" else m.fit(Xtr, ytr)
    fit_s = time.perf_counter() - t
    t = time.perf_counter()
    pred = m.predict(Xte)
    pred_s = time.perf_counter() - t
    if name == "ridge":
        score = float(1 - ((yte - pred) ** 2).sum() / ((yte - yte.mean()) ** 2).sum())
    elif name == "kmeans":
        score = float(m.inertia_)
    else:
        score = float((pred == yte).mean())
    return {"model": name, "n_jobs": n_jobs, "rows_train": int(len(Xtr)), "features": int(X.shape[1]),
            "fit_s": round(fit_s, 3), "predict_s": round(pred_s, 3), "score": round(score, 6)}


def run_suite(df, names=("logistic", "ridge", "knn", "kmeans", "random_forest", "xgboost", "mlp"), n_jobs=1):
    xy = {"cls": make_xy(df, "cls"), "reg": make_xy(df, "reg")}
    return [bench(n, xy["reg" if n == "ridge" else "cls"], n_jobs) for n in names]
