"""Native baseline for E2 (read + profile) and E3 (models), E4 (threads), E9 (same code).

Runs the SAME py/nodes.py that the Pyodide worker runs.
Usage: python native/bench.py [label]      (label defaults to the platform name)
Writes results/native-<label>.json
"""
import json
import os
import platform
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "py"))
import exp  # noqa: E402
import nodes  # noqa: E402

DATA = ROOT / "data" / "out"
E2_FILES = ["d10k_20", "d100k_20", "d100k_50", "d500k_50", "d1000k_50"]
E3_FILE = "d100k_50"


def versions():
    import numpy, pandas, pyarrow, scipy, sklearn, xgboost
    return {"python": platform.python_version(), "numpy": numpy.__version__, "pandas": pandas.__version__,
            "scikit-learn": sklearn.__version__, "scipy": scipy.__version__, "xgboost": xgboost.__version__,
            "pyarrow": pyarrow.__version__}


def e2():
    rows = []
    for name in E2_FILES:
        path = DATA / f"{name}.csv"
        if not path.exists():
            continue
        t = time.perf_counter()
        df = nodes.load(str(path))
        read_s = time.perf_counter() - t
        t = time.perf_counter()
        nodes.profile(df)
        profile_s = time.perf_counter() - t
        rows.append({"file": name, "read_s": round(read_s, 3), "profile_s": round(profile_s, 3),
                     "frame_mb": round(df.memory_usage(deep=True).sum() / 1e6, 1)})
        print("E2", rows[-1], flush=True)
        del df
    return rows


def e3():
    df = nodes.load(str(DATA / f"{E3_FILE}.csv"))
    out = {}
    for label, n_jobs in (("single_thread", 1), ("all_threads", -1)):
        out[label] = nodes.run_suite(df, n_jobs=n_jobs)
        for r in out[label]:
            print("E3", label, r, flush=True)
    return out


def main():
    label = sys.argv[1] if len(sys.argv) > 1 else platform.system().lower()
    res = {
        "label": label, "platform": platform.platform(), "machine": platform.machine(),
        "cpu_count": os.cpu_count(), "versions": versions(),
        "e2": e2(), "e3": e3(), "e9": json.loads(exp.e9(str(DATA / "d10k_20.csv"))),
    }
    out = ROOT / "results" / f"native-{label}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(res, indent=2))
    print("wrote", out)


if __name__ == "__main__":
    main()
