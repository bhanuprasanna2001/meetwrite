"""Append-only PCM recording storage for the local app."""

from pathlib import Path


class FileAudioStore:
    def __init__(self, root: Path) -> None:
        self._root = root

    def path(self, user_id: int, entry_id: int) -> Path:
        return self._root / str(user_id) / f"{entry_id}.pcm"

    def append(self, user_id: int, entry_id: int, pcm: bytes) -> None:
        path = self.path(user_id, entry_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("ab") as file:
            file.write(pcm)

    def read(self, user_id: int, entry_id: int) -> bytes | None:
        path = self.path(user_id, entry_id)
        return path.read_bytes() if path.is_file() else None

    def delete(self, user_id: int, entry_id: int) -> None:
        self.path(user_id, entry_id).unlink(missing_ok=True)
