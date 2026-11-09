"""A cache of step outputs, keyed by the step's hash (see docs/design/hashing-and-runs.md).

Outputs are stored as Feather (Arrow IPC) with lz4 compression, which the engine experiment found
to reload a 100k x 50 table in about half a second at 27% smaller than uncompressed. Where pyarrow
is not available the cache falls back to compressed pickles, so it works either way.

Entries that have not been used for the longest are dropped first when the size budget is full.
Everything here can be recomputed, so dropping an entry only costs time.
"""

from __future__ import annotations

import pickle
import zlib
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from .context import Data


def _arrow() -> Any:
    """pyarrow and its Feather module, or None. The browser engine loads pyarrow on demand, so
    this is checked each time until it is there."""
    try:
        import pyarrow as pa
        import pyarrow.feather as feather
    except ImportError:
        return None
    return pa, feather


DEFAULT_BUDGET_MB = 256


@dataclass
class _Entry:
    frames: dict[str, bytes]
    fitted: bytes | None
    size: int


@dataclass
class CacheStats:
    entries: int = 0
    bytes: int = 0
    hits: int = 0
    misses: int = 0
    evicted: int = 0


# The first byte of a stored frame says how it was written, so old entries stay readable if
# pyarrow arrives later.
_ARROW, _PICKLE = b"A", b"P"


def _pack(frame: pd.DataFrame) -> bytes:
    arrow = _arrow()
    if arrow is not None:
        pa, feather = arrow
        sink = pa.BufferOutputStream()
        feather.write_feather(pa.Table.from_pandas(frame, preserve_index=True), sink, compression="lz4")
        return _ARROW + sink.getvalue().to_pybytes()
    return _PICKLE + zlib.compress(pickle.dumps(frame, protocol=pickle.HIGHEST_PROTOCOL), 1)


def _unpack(blob: bytes) -> pd.DataFrame:
    kind, body = blob[:1], blob[1:]
    if kind == _ARROW:
        pa, feather = _arrow()
        return feather.read_table(pa.BufferReader(body)).to_pandas()
    return pickle.loads(zlib.decompress(body))


@dataclass
class NodeCache:
    budget_bytes: int = DEFAULT_BUDGET_MB * 1024 * 1024
    _items: "OrderedDict[str, _Entry]" = field(default_factory=OrderedDict)
    stats: CacheStats = field(default_factory=CacheStats)

    @property
    def format(self) -> str:
        return "feather-lz4" if _arrow() is not None else "pickle-zlib"

    def __contains__(self, key: str) -> bool:
        return key in self._items

    def put(self, key: str, data: Data, fitted: Any = None) -> bool:
        """Store an output. Returns False when it alone is bigger than the whole budget."""
        frames = {name: _pack(frame) for name, frame in data.parts.items()}
        blob = None if fitted is None else zlib.compress(pickle.dumps(fitted), 1)
        size = sum(len(b) for b in frames.values()) + (len(blob) if blob else 0)
        if size > self.budget_bytes:
            return False
        self.discard(key)
        self._items[key] = _Entry(frames, blob, size)
        self.stats.bytes += size
        while self.stats.bytes > self.budget_bytes and len(self._items) > 1:
            oldest = next(iter(self._items))
            if oldest == key:
                break
            self.discard(oldest)
            self.stats.evicted += 1
        self.stats.entries = len(self._items)
        return True

    def get(self, key: str) -> tuple[Data, Any] | None:
        entry = self._items.get(key)
        if entry is None:
            self.stats.misses += 1
            return None
        self._items.move_to_end(key)
        self.stats.hits += 1
        data = Data({name: _unpack(blob) for name, blob in entry.frames.items()})
        fitted = None if entry.fitted is None else pickle.loads(zlib.decompress(entry.fitted))
        return data, fitted

    def discard(self, key: str) -> None:
        entry = self._items.pop(key, None)
        if entry is not None:
            self.stats.bytes -= entry.size
            self.stats.entries = len(self._items)

    def clear(self) -> None:
        self._items.clear()
        self.stats.bytes = 0
        self.stats.entries = 0
