"""Writes the small seeded datasets used by tests. Usage: python fixtures/data/generate.py"""
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parent


def housing(n: int = 600, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    city = rng.choice(["Leeds", "Bath", "York", "Hull"], n, p=[0.4, 0.25, 0.25, 0.1])
    area = rng.normal(90, 25, n).clip(25, 220)
    rooms = np.clip((area / 25 + rng.normal(0, 0.8, n)).round(), 1, 9)
    age = rng.integers(1, 80, n).astype(float)
    income = np.exp(rng.normal(10.8, 0.5, n))
    bonus = {"Leeds": 0.0, "Bath": 25.0, "York": 10.0, "Hull": -15.0}
    price = 1.8 * area + 6.0 * rooms - 0.4 * age + np.array([bonus[c] for c in city]) + rng.normal(0, 12, n)
    frame = pd.DataFrame({"id": np.arange(n), "area": area.round(1), "rooms": rooms, "age": age, "income": income.round(0), "city": city, "price": price.round(1)})
    frame["expensive"] = (frame["price"] > frame["price"].median()).astype(int)
    frame["moved_in"] = (pd.Timestamp("2015-01-01") + pd.to_timedelta(rng.integers(0, 2000, n), unit="D")).strftime("%Y-%m-%d")
    frame.loc[rng.random(n) < 0.12, "age"] = np.nan
    frame.loc[rng.random(n) < 0.05, "city"] = None
    frame.loc[rng.choice(n, 6, replace=False), "income"] *= 40  # a few outliers
    return frame


def customers(n: int = 400, seed: int = 11) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    centres = np.array([[25, 30, 80], [45, 90, 20], [60, 50, 50], [35, 70, 90]], dtype=float)
    label = rng.integers(0, 4, n)
    x = centres[label] + rng.normal(0, 7, (n, 3))
    return pd.DataFrame({"customer_id": np.arange(n), "age": x[:, 0].round(1), "income": x[:, 1].round(1), "spend": x[:, 2].round(1), "segment": np.array(list("ABCD"))[label]})


if __name__ == "__main__":
    housing().to_csv(OUT / "housing_small.csv", index=False)
    customers().to_csv(OUT / "customers_small.csv", index=False)
    print("wrote housing_small.csv and customers_small.csv")
