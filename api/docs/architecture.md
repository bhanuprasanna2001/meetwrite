# API architecture

The API is a local sidecar with one composition root, one central persistence
model, and small feature slices. HTTP and WebSocket handlers enforce wire
contracts and ownership; services own deterministic domain behavior and
transactions; adapters contain operating-system and provider details.

## Startup and runtime

`meetwrite.app.create_app()` accepts configuration plus three replaceable
integration ports. Its lifespan performs these steps in order:

1. Run Alembic `upgrade head` against the configured database.
2. Create the SQLAlchemy engine with SQLite foreign keys enabled and WAL mode.
3. Construct any adapters not supplied by the caller.
4. Build one immutable `Runtime` containing configuration, the engine, ports,
   the transcript event hub, and concurrency lease registries.
5. Ensure local user `1`, that user's preferences, and missing built-in
   templates exist, committing initialization before serving.
6. Serve requests; dispose the engine during shutdown.

A migration or bootstrap failure prevents the application from becoming
ready. Runtime code never creates tables from model metadata. In a packaged
build, `meetwrite.db.migrations` locates bundled Alembic resources through
PyInstaller's runtime directory.

## Persistence and ownership

All SQLModel tables are declared in `meetwrite.db.models` and registered as one
Alembic metadata graph:

```text
User
├── Preferences
├── Template
└── Entry
    ├── TranscriptLine
    ├── EnhancedVersion
    └── Chat
        └── Message
```

Every persisted object is directly user-owned, including descendants. The
entry/transcript, entry/version, entry/chat, and chat/message relationships use
composite foreign keys containing `user_id`; a row cannot point across user
boundaries. User deletion cascades through the graph. Template identity is the
composite `(user_id, id)`, while normalized template names are unique per user.

The desktop product currently resolves local user `1`, but queries and keys
remain user-scoped. That keeps ownership explicit and prevents a future hosted
identity layer from requiring a persistence rewrite.

Audio bytes and credentials are deliberately outside SQLite:

- recordings are append-only PCM files under `<audio root>/<user_id>/<entry_id>.pcm`;
- OpenAI keys are stored under per-user accounts in the operating-system
  keychain and are never returned by the API.

## Injected integrations

Only the composition root chooses concrete adapters. Tests can pass in-memory
or scripted implementations without patching SDKs.

| Port | Default adapter | Responsibility |
| --- | --- | --- |
| `KeyStore` | `KeyringKeyStore` | Read, write, and delete per-user OpenAI keys |
| `AudioStore` | `FileAudioStore` | Append, read, and delete user/entry PCM files |
| `AiProvider` | `OpenAIProvider` | Stream chat and produce schema-constrained enhancements |

`RuntimeDep` gives routes the already-constructed runtime. Request-scoped
database sessions come from that runtime's engine. Realtime transcription is a
feature-level WebSocket protocol driver: it reads the key through `KeyStore`
but maintains its own outbound OpenAI Realtime connections.

## Feature boundaries

Each directory under `meetwrite.features` exposes only the files it needs:

- `router.py` handles transport validation, dependencies, and error mapping;
- `schemas.py` defines request and response contracts;
- `services.py` contains persistence and deterministic domain operations;
- `dependencies.py` resolves user-owned resources where useful.

Shared models, configuration, ports, clocks, events, leases, and audio framing
live in `meetwrite.db` or `meetwrite.core`. Concrete keychain, filesystem, and
OpenAI code lives in `meetwrite.integrations`. Built-in template content lives
in `features.templates.catalog`; enhancement consumes that catalog without a
reverse feature dependency.

## AI-mode gate

`Preferences.ai_enabled` is the single server-side switch for AI features. The
`features.settings.dependencies.require_ai_enabled` dependency guards the three
endpoints that can reach the provider — chat send, Enhance, and live
transcription — returning 403 (or a 4403 socket close) while AI is off, before
any keychain read or provider work. The desktop hides the same surfaces and
must persist the setting before showing a notes-only workspace; the gate is the
backstop against a stale or modified client.

## Deterministic chat flow

1. Resolve the chat for the local user and acquire a `(user_id, chat_id)` lease.
   A second concurrent turn receives `409`.
2. In a short read session, reload the chat and entry, order prior messages by
   ID, keep the newest complete history within its budget, and build one prompt
   from the fixed system rule, canonical meeting source, history, and question.
3. Stream provider text as SSE `delta` events. No message row is written while
   the provider is still streaming.
4. After a non-empty complete reply, open a new write session, re-check that the
   chat exists, and commit the user message, assistant message, and first-turn
   title together.
5. Emit the saved assistant message, close the provider stream, and release the
   lease on every exit path.

Provider and deletion failures become terminal SSE error events. An interrupted
or empty stream leaves no partial turn in the database.

## Deterministic transcription flow

1. Accept `/entries/{entry_id}/transcribe`, validate its origin, resolve the
   user-owned entry and key, and acquire the entry's single-recording lease.
2. Validate each `me` or `them` frame as base64 PCM16. A recording opens at most
   one OpenAI Realtime connection for each source.
3. Assign a monotonically increasing sequence when the provider commits a turn.
   Finals may arrive out of order; `RecordingSession` buffers them and drains
   only the next committed sequence. Empty finals consume their sequence but do
   not create transcript rows.
4. Persist each non-empty final once under the unique `(entry_id, sequence)`
   key, update the entry timestamp, and publish its final event.
5. On stop, flush both sources and distinguish the final manual commit from any
   in-flight server-VAD commit. Wait for every matching final, close
   connections, acknowledge the stop, and release the lease.

Transcript SSE subscribers first receive a database `resync` snapshot. Its
sequence watermark suppresses queued duplicate finals and stale deltas;
periodic comments keep an idle connection alive.

## Other write flows

- Enhancement builds one bounded source from notes plus transcript, layers the
  base, selected-template, and custom instructions in that order, validates
  structured provider output, then commits the new version and entry metadata
  together. Provider or format failures persist nothing.
- Built-in templates are seeded per user only when missing, so startup is
  idempotent and preserves edits. Custom IDs are deterministic normalized slugs
  with collision suffixes; database uniqueness is authoritative.
- Entry deletion removes its PCM file first, then cascades relational children.
  A filesystem failure leaves the entry reachable so deletion can be retried.

## Route surface

| Area | Routes |
| --- | --- |
| Health and identity | `/health`, `/me` |
| Preferences and key | `/settings`, `/key`, `/key/status` |
| Entries and audio | `/entries`, `/entries/{entry_id}`, `/entries/{entry_id}/audio`, `/entries/{entry_id}/audio/file` |
| Transcription | `/entries/{entry_id}/transcribe` (WebSocket), `/entries/{entry_id}/transcript`, `/entries/{entry_id}/transcript/events` (SSE) |
| Templates and enhancement | `/templates`, `/templates/{template_id}`, `/templates/{template_id}/reset`, `/entries/{entry_id}/enhance`, `/entries/{entry_id}/enhanced-versions`, `/enhanced-versions/{version_id}` |
| Chat | `/entries/{entry_id}/chats`, `/chats/{chat_id}`, `/chats/{chat_id}/messages` (including streaming SSE writes) |

FastAPI's generated OpenAPI document remains the authority for methods,
payload fields, validation constraints, and response schemas. The committed
`api/openapi.json` snapshot makes unintended contract changes fail in tests.

## Observability and errors

The application logs lifecycle events and one completion line per HTTP request
with request ID, method, route pattern, status, and duration. Response headers
carry the same request ID. Feature services add identifiers and state
transitions without logging note content, transcript text, chat content, audio,
or API keys. Provider adapters translate SDK exceptions into `AiProviderError`;
routers translate domain errors into stable HTTP, SSE, or WebSocket contracts.
All response timestamps serialize as explicit UTC rather than SQLite's naive
datetime representation.
