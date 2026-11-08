"""Seeded synthetic CSV generator for the spike.

Columns: id, date (ISO string), num_0.. (numeric, some skewed, some with 5% NaN),
cat_0..cat_2 (low cardinality), key (high cardinality string), y_cls (binary), y_reg (numeric).
Total column count = `cols`.

Usage: python data/gen_data.py            # default set
       python data/gen_data.py 100000 50  # one file
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parent / "out"
DEFAULT = [(10_000, 20), (100_000, 20), (100_000, 50), (500_000, 50), (1_000_000, 50)]


def make(rows: int, cols: int, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    n_num = cols - 8
    df = {"id": np.arange(rows)}
    start = np.datetime64("2020-01-01")
    df["date"] = pd.Series(start + rng.integers(0, 1500, rows).astype("timedelta64[D]")).dt.strftime("%Y-%m-%d")
    nums = []
    for i in range(n_num):
        kind = i % 3
        v = rng.normal(0, 1, rows) if kind == 0 else rng.lognormal(0, 1, rows) if kind == 1 else rng.uniform(-5, 5, rows)
        nums.append(v.copy())
        if i % 4 == 0:
            v[rng.random(rows) < 0.05] = np.nan
        df[f"num_{i}"] = v
    levels = [4, 8, 12]
    cat_codes = []
    for i, k in enumerate(levels):
        codes = rng.integers(0, k, rows)
        cat_codes.append(codes)
        col = pd.Series(np.array([f"c{i}_{j}" for j in range(k)])[codes], dtype="object")
        if i == 0:
            col[rng.random(rows) < 0.05] = None
        df[f"cat_{i}"] = col
    df["key"] = np.char.add("k", rng.integers(0, 5000, rows).astype(str))
    signal = sum((i + 1) * 0.3 * (nums[i] - nums[i].mean()) / nums[i].std() for i in range(min(5, n_num)))
    signal = signal + 0.5 * cat_codes[0] + 0.2 * cat_codes[1]
    y_reg = signal + rng.normal(0, 1, rows)
    df["y_cls"] = (y_reg + rng.normal(0, 0.5, rows) > np.median(y_reg)).astype(int)
    df["y_reg"] = y_reg
    return pd.DataFrame(df)


def main(argv):
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [(int(argv[0]), int(argv[1]))] if len(argv) == 2 else DEFAULT
    for rows, cols in jobs:
        path = OUT / f"d{rows // 1000}k_{cols}.csv"
        if path.exists():
            print("exists", path.name)
            continue
        make(rows, cols).to_csv(path, index=False, float_format="%.5g")
        print(f"wrote {path.name}  {path.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main(sys.argv[1:])
