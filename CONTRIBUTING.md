# Contributing

MeetWrite is a local-first macOS app with three cooperating layers: the Python
API sidecar, the React desktop UI, and the Rust Tauri shell. Keep changes inside
the smallest layer that owns the behavior, and update a cross-layer contract
deliberately when more than one layer must change.

Read the [API architecture](api/docs/architecture.md) or the
[desktop architecture](desktop/docs/ARCHITECTURE.md) before changing those
areas. User-visible desktop transitions are specified in
[desktop user flows](desktop/docs/USER_FLOWS.md).

## Setup and checks

On macOS, install Rust, a Node version accepted by `desktop/package.json`, uv,
and Python 3.13 or newer. Then install the locked dependencies:

```bash
make setup
```

Run the complete local gate before opening a pull request:

```bash
make check
```

The focused commands are `make check-api`, `make check-desktop`, and
`make check-rust`. The API gate uses a fresh temporary database for Alembic
upgrade and drift checks; it does not rely on a developer's local database.

## API changes

- Keep transport validation and error mapping in routers, deterministic domain
  behavior in services, persistence models in `meetwrite.db`, and operating
  system or provider code in `meetwrite.integrations`.
- Add a port only when tests or a future deployment genuinely need a replaceable
  external boundary. Do not create repositories or wrappers around ordinary
  in-process calls.
- Scope persisted data and queries to the user. Preserve stable ordering with an
  explicit tie-breaker.
- Do not hold a request database session open while awaiting a provider stream.
  Commit a completed unit of work once; failures must not leave partial turns or
  versions.
- Never log or return API keys, audio, notes, transcripts, chat content, or
  generated content.

The generated FastAPI OpenAPI document is the HTTP contract. When a request,
response, status, SSE frame, or WebSocket frame changes, update the matching
contract test and coordinate the desktop consumer.

## Database changes

`api/src/meetwrite/db/models.py` is the model graph and Alembic is the schema
source of truth. Generate a draft migration, review it, and verify a fresh
database:

```bash
cd api
uv run alembic revision --autogenerate -m "describe the schema change"
uv run pytest -q tests/db/test_migrations.py
```

Review generated SQL for nullability, foreign keys, cascades, uniqueness,
indexes, checks, and downgrade behavior. Never add `metadata.create_all()` as a
runtime fallback. The current pre-production baseline/reset policy is described
in [the API README](api/README.md#pre-production-reset-after-the-baseline-squash).

## Tests and code style

Test observable behavior, ownership, transaction boundaries, ordering, and
failure recovery. Prefer a small test with a real temporary SQLite database and
injected fake integration over assertions about private implementation details.
Do not keep tests that only repeat framework or schema behavior without guarding
a product contract.

Use comments for protocol invariants, security constraints, or non-obvious
tradeoffs. Avoid comments that restate the next line or describe behavior that
the code no longer has.

## Pull requests

Keep a pull request focused, explain any contract or migration impact, link
related issues, and include screenshots for visual changes. Commit messages use
one [Gitmoji](https://gitmoji.dev/) followed by a short, clear sentence.
