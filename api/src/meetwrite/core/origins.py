"""Browser origins allowed to call the local sidecar."""

TRUSTED_ORIGINS = frozenset(
    {
        "tauri://localhost",
        "http://tauri.localhost",
        "http://localhost:1420",
        "http://127.0.0.1:1420",
    }
)
