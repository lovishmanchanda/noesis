from pathlib import Path

import pandas as pd
import pytest

DATA = Path(__file__).resolve().parents[3] / "fixtures" / "data"


@pytest.fixture(scope="session")
def housing() -> pd.DataFrame:
    return pd.read_csv(DATA / "housing_small.csv")


@pytest.fixture(scope="session")
def customers() -> pd.DataFrame:
    return pd.read_csv(DATA / "customers_small.csv")
