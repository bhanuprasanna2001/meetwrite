"""Bounded in-process fan-out used by the local transcript stream."""

import asyncio
from collections import defaultdict
from threading import Lock


class EventHub[Event]:
    def __init__(self, queue_size: int = 256) -> None:
        self._queue_size = queue_size
        self._subscribers: dict[int, set[asyncio.Queue[Event | None]]] = defaultdict(
            set
        )
        self._lock = Lock()

    def subscribe(self, topic: int) -> asyncio.Queue[Event | None]:
        queue: asyncio.Queue[Event | None] = asyncio.Queue(maxsize=self._queue_size)
        with self._lock:
            self._subscribers[topic].add(queue)
        return queue

    def unsubscribe(self, topic: int, queue: asyncio.Queue[Event | None]) -> None:
        with self._lock:
            subscribers = self._subscribers.get(topic)
            if subscribers is None:
                return
            subscribers.discard(queue)
            if not subscribers:
                self._subscribers.pop(topic, None)

    def publish(self, topic: int, event: Event) -> None:
        with self._lock:
            subscribers = tuple(self._subscribers.get(topic, ()))
        for queue in subscribers:
            if queue.full():
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(None)
                continue
            queue.put_nowait(event)
