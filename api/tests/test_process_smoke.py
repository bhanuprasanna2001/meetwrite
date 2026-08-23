import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen


def _available_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _json_request(
    base_url: str,
    method: str,
    path: str,
    payload: dict[str, object] | None = None,
) -> tuple[int, Any]:
    body = json.dumps(payload).encode() if payload is not None else None
    request = Request(
        f"{base_url}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with urlopen(request, timeout=2) as response:
        return response.status, json.loads(response.read())


def _wait_until_ready(process: subprocess.Popen[str], base_url: str) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout is not None else ""
            raise AssertionError(f"sidecar exited during startup:\n{output}")
        try:
            status, body = _json_request(base_url, "GET", "/health")
            if status == 200 and body == {"status": "ok"}:
                return
        except (URLError, TimeoutError, ConnectionResetError):
            time.sleep(0.05)
    raise AssertionError("sidecar did not become ready within 10 seconds")


def test_sidecar_process_boots_and_completes_the_primary_notes_flow(
    tmp_path: Path,
) -> None:
    api_root = Path(__file__).parents[1]
    port = _available_port()
    base_url = f"http://127.0.0.1:{port}"
    process_environment = os.environ.copy()
    process_environment.update(
        {
            "MEETWRITE_DATABASE_URL": f"sqlite:///{tmp_path / 'smoke.db'}",
            "MEETWRITE_AUDIO_DIR": str(tmp_path / "audio"),
            "MEETWRITE_LOG_LEVEL": "WARNING",
        }
    )
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "tests.smoke_app:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--no-access-log",
        ],
        cwd=api_root,
        env=process_environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        _wait_until_ready(process, base_url)
        create_status, entry = _json_request(base_url, "POST", "/entries")
        assert create_status == 201

        entry_id = entry["id"]
        save_status, saved = _json_request(
            base_url,
            "PATCH",
            f"/entries/{entry_id}",
            {"note_md": "one two three four five six seven eight nine ten"},
        )
        assert save_status == 200
        assert saved["note_md"].endswith("nine ten")

        enhance_status, enhanced = _json_request(
            base_url, "POST", f"/entries/{entry_id}/enhance"
        )
        assert enhance_status == 200
        assert enhanced["title"] == "Smoke title"
        assert enhanced["content"] == "Smoke notes"
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
