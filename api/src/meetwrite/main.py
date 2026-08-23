"""Run the API server."""

import os
import threading
import time

import uvicorn

from meetwrite.app import create_app

# Module-level app so `uvicorn meetwrite.main:app --reload` works in dev.
app = create_app()


def _exit_when_orphaned() -> None:
    """Keep the sidecar tied to the desktop process that launched it."""

    while True:
        if os.getppid() == 1:
            os._exit(0)
        time.sleep(0.5)


def main() -> None:
    """Run the production sidecar (no reload — it runs inside the app)."""

    threading.Thread(target=_exit_when_orphaned, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=8321, access_log=False)
