"""E11: GPU detection and CPU vs GPU timing (XGBoost). Run on the Windows/NVIDIA machine.

Usage: python native/gpu_bench.py [label]
Writes results/gpu-<label>.json. Safe to run without a GPU: it records what it found and skips the GPU run.
"""
import json
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "py"))
import nodes  # noqa: E402


def nvidia_smi():
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        return subprocess.run([exe, "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
                              capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception as e:  # noqa: BLE001
        return f"error: {e!r}"


def fit_time(X, y, device):
    from xgboost import XGBClassifier
    m = XGBClassifier(n_estimators=300, max_depth=8, tree_method="hist", device=device, random_state=0)
    t = time.perf_counter()
    m.fit(X, y)
    return round(time.perf_counter() - t, 3)


def main():
    label = sys.argv[1] if len(sys.argv) > 1 else platform.system().lower()
    import xgboost
    res = {"label": label, "platform": platform.platform(), "xgboost": xgboost.__version__, "nvidia_smi": nvidia_smi(), "runs": []}
    df = nodes.load(str(ROOT / "data" / "out" / "d500k_50.csv"))
    X, y = nodes.make_xy(df, "cls")
    for device in ("cpu", "cuda"):
        try:
            res["runs"].append({"device": device, "rows": int(len(X)), "fit_s": fit_time(X, y, device)})
        except Exception as e:  # noqa: BLE001
            res["runs"].append({"device": device, "error": repr(e)[:300]})
        print(res["runs"][-1], flush=True)
    out = ROOT / "results" / f"gpu-{label}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(res, indent=2))
    print("wrote", out)


if __name__ == "__main__":
    main()
