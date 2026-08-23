"""In-process leases for workflows that must have one active writer."""

from collections.abc import Hashable
from threading import Lock


class LeaseRegistry:
    def __init__(self) -> None:
        self._active: set[Hashable] = set()
        self._lock = Lock()

    def acquire(self, key: Hashable) -> bool:
        with self._lock:
            if key in self._active:
                return False
            self._active.add(key)
            return True

    def release(self, key: Hashable) -> None:
        with self._lock:
            self._active.discard(key)
