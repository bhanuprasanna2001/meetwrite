# meetwrite API

The local FastAPI sidecar for the meetwrite desktop app. It owns the app's
SQLite data, saved PCM recordings, OpenAI key access, live transcription,
chat, and note enhancement. The development server listens on
`127.0.0.1:8321`. Browser CORS is limited to the desktop webview and local
development origins, and the transcription WebSocket checks the same list.

See [Architecture](docs/architecture.md) for the model graph, dependency
boundaries, request flows, and route surface.

The committed [OpenAPI snapshot](openapi.json) is the desktop wire contract.
When an intentional route or schema change is coordinated with the client,
regenerate it with `uv run python scripts/export_openapi.py`.

## Quick start

Requirements: [uv](https://docs.astral.sh/uv/) and Python 3.13 or newer. From
the repository root:

```bash
cd api
uv sync
uv run uvicorn meetwrite.main:app --reload --port 8321
```

Startup upgrades the configured database to the current Alembic revision
before serving requests. It then creates the local user, preferences, and any
missing built-in templates. There is no `SQLModel.metadata.create_all()`
fallback: `migrations/` is the schema source of truth.

Check readiness with `http://127.0.0.1:8321/health`. FastAPI's development
OpenAPI UI is at `http://127.0.0.1:8321/docs`.

## Configuration

`AppConfig` reads `.env` and environment variables with the `MEETWRITE_`
prefix.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MEETWRITE_DATABASE_URL` | `sqlite:///meetwrite.db` | SQLAlchemy database URL |
| `MEETWRITE_AUDIO_DIR` | `audio` | Root for user-scoped PCM recordings |
| `MEETWRITE_LOG_LEVEL` | `INFO` | Python log level |
| `MEETWRITE_CHAT_MODEL` | `gpt-4.1` | OpenAI model for chat and enhancement |
| `MEETWRITE_TRANSCRIBE_MODEL` | `gpt-live-transcribe` | OpenAI Realtime transcription model |
| `MEETWRITE_AI_TIMEOUT_SECONDS` | `120` | Chat/enhancement provider timeout |
| `MEETWRITE_TRANSCRIPTION_EVENT_TIMEOUT_SECONDS` | `10` | Realtime setup and flush timeout |
| `MEETWRITE_CHAT_CONTEXT_CHARACTERS` | `60000` | Chat context budget |
| `MEETWRITE_ENHANCE_CONTEXT_CHARACTERS` | `60000` | Enhancement source budget |

The packaged desktop app sets the database and audio paths to its application
data directory. The relative defaults above are for local development from
`api/`.

## Migrations

Models live together in `src/meetwrite/db/models.py`; the matching migration
history lives in `migrations/versions/`. A generated revision is only a draft:
review it for unintended table rebuilds, types, nullability, defaults, indexes,
foreign keys, and downgrade behavior.

```bash
uv run alembic revision --autogenerate -m "describe the schema change"
uv run alembic upgrade head
uv run alembic check
uv run pytest -q tests/db/test_migrations.py
```

The migration test builds a fresh database, compares it with SQLModel
metadata, and checks the revision at `head`. The same migration runner and
files are bundled into the production sidecar.

### Pre-production reset after the baseline squash

The refactor replaced the old development revision chain with the
`0001_initial` baseline. It intentionally does not upgrade databases stamped
with one of the removed revision IDs. This project is still pre-production, so
reset those local databases rather than adding compatibility migrations:

1. Quit the desktop app and stop the development API.
2. Back up, then move aside the database, its `-wal` and `-shm` companions, and
   the audio directory.

   - Development defaults: `api/meetwrite.db`, `api/meetwrite.db-wal`,
     `api/meetwrite.db-shm`, and `api/audio/`.
   - Packaged macOS app: open
     `~/Library/Application Support/com.bhanuprasanna.meetwrite/` in Finder and
     move aside the same three database files plus `audio/`.

3. Restart. Startup applies `0001_initial` to a fresh database and bootstraps
   the local user, preferences, and built-in templates.

The OpenAI key is stored separately in the operating-system keychain and is
not removed by a database/audio reset. Remove it through Settings if a full
credential reset is also intended.

## Checks

Run the complete API gate from the repository root:

```bash
make check-api
```

This checks formatting, lint, types, all tests, and migration drift against a
fresh temporary database. It never depends on or mutates `api/meetwrite.db`.

For a quick inner loop from `api/`:

```bash
uv run pytest -q && uv run ruff check src tests && uv run mypy src
```

## Packaging

From the repository root:

```bash
make sidecar
make app
```

`make sidecar` creates the PyInstaller runtime in
`desktop/src-tauri/sidecar-runtime/` and its Tauri launcher in
`desktop/src-tauri/binaries/`. The bundle includes `alembic.ini` and
`migrations/`, so packaged startup follows the same migration-led path as
development.
