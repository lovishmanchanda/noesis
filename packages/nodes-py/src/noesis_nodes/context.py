"""Shared containers: the data flowing between steps, and the run context."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

import pandas as pd


class Cancelled(Exception):
    """Raised inside a step when the user asked to stop."""


class LeakageError(Exception):
    """A step that learns from data was asked to run before the split."""


@dataclass
class Data:
    """Frames flowing between steps. One frame ('all') before the split, three after."""

    parts: dict[str, pd.DataFrame]

    @classmethod
    def single(cls, frame: pd.DataFrame) -> "Data":
        return cls({"all": frame})

    @property
    def is_split(self) -> bool:
        return "train" in self.parts

    def fit_frame(self, step: str) -> pd.DataFrame:
        """The rows a step may learn from: training rows only, and only after the split."""
        if not self.is_split:
            raise LeakageError(f"{step} learns from the data, so it must run after the split")
        return self.parts["train"]

    def map(self, fn: Callable[[str, pd.DataFrame], pd.DataFrame]) -> "Data":
        return Data({name: fn(name, frame) for name, frame in self.parts.items()})


@dataclass
class Ctx:
    """What every step needs to know about the run."""

    task: str
    seed: int = 0
    target: str | None = None
    reference: str | None = None
    excluded: frozenset[str] = frozenset()
    fitted: dict[str, Any] = field(default_factory=dict)
    emit: Callable[[str, dict], None] = lambda event, data: None
    cancelled: Callable[[], bool] = lambda: False

    @classmethod
    def from_pipeline(cls, pipeline: dict, **kwargs: Any) -> "Ctx":
        columns = pipeline["dataset"]["columns"]
        pick = lambda role: [c["name"] for c in columns if c["role"] == role]  # noqa: E731
        targets, references = pick("target"), pick("reference")
        return cls(
            task=pipeline["task"]["type"],
            seed=pipeline["project"]["seed"],
            target=targets[0] if targets else None,
            reference=references[0] if references else None,
            excluded=frozenset(pick("exclude")),
            **kwargs,
        )

    def special(self) -> set[str]:
        """Columns that are not features: the target, the reference column and excluded columns."""
        return set(self.excluded) | {c for c in (self.target, self.reference) if c}

    def feature_columns(self, frame: pd.DataFrame, numeric_only: bool = False) -> list[str]:
        special = self.special()
        names = [c for c in frame.columns if c not in special]
        if numeric_only:
            names = [c for c in names if pd.api.types.is_numeric_dtype(frame[c])]
        return names

    def check_cancel(self) -> None:
        if self.cancelled():
            raise Cancelled()
