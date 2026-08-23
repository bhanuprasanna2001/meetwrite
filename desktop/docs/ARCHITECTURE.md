# Desktop frontend architecture

The desktop frontend is organized by product responsibility. The shape is
inspired by Feature-Sliced Design, but it is intentionally smaller than the
full methodology. KISS wins: add a folder, state library, registry, or generic
workflow abstraction only after the code has a concrete repeated need for it.

```text
src/
  app/       application composition, boot, shutdown, global UI/window state
  pages/     complete onboarding, workspace, and settings surfaces
  widgets/   reusable page-sized regions (currently the bottom bar)
  features/  user capabilities and their local UI/state
  shared/
    api/      common fetch primitives, sidecar endpoints, wire contracts
    lib/      framework-light helpers and the logging boundary
    platform/ reusable browser/Tauri adapters
    ui/       small presentation primitives used by multiple owners
  main.tsx   theme prepaint, logging setup, React mount
```

This is a responsibility map, not a mandate to fill every folder. A feature
with one component does not need `model/`, `ui/`, and barrel files merely for
symmetry.

## Dependency boundaries

The intended import direction is:

```text
main/app → pages → widgets/features → shared
```

- `app` composes pages and owns application-wide lifecycle concerns.
- A page coordinates features when one action crosses feature boundaries. The
  workspace page/model is therefore the owner of stop-recording → flush-save →
  load-snapshot flows.
- Feature slices do not import sibling feature internals. Their coordination
  belongs in the owning page or in `app`.
- `shared` does not know about product features or pages. Put code there only
  when it is genuinely reusable or is an application boundary such as the
  sidecar client.

ESLint mechanically prevents `shared` from importing product layers and a
feature from importing a sibling feature. The remaining direction rules are
kept explicit here and reviewed in code review; do not add a heavier boundary
tool until a concrete violation shows that it is needed.

## State and workflow rules

- Keep state as local as its consumers allow. Lift it only when two owners must
  agree on the same value.
- Store one tagged state for mutually exclusive conditions. The application
  has one overlay value; recording has `idle | starting | active | stopping`.
- Derive `busy`, `recording`, and other booleans from their owning state instead
  of keeping duplicate flags that can disagree.
- Use a pure reducer when a workflow has a meaningful transition table. Small
  leaf interactions can remain ordinary component or hook state.
- Add a single-flight guard when repeated work must be rejected, an operation
  id when stale completion can target a new owner, and an ordered promise chain
  when every write must run in input order. Not every asynchronous call needs
  all three mechanisms.
- Fetch an entry's note, transcript, versions, chats, and active messages into
  one workspace snapshot, then commit it atomically. Mixed-entry screens are
  not an accepted intermediate state.
- Before entry/settings navigation, stop and finalize entry-scoped recording,
  flush pending note/version edits, then cancel chat/enhance ownership. Abort
  the navigation if the flush fails.
- The AI mode is one persisted setting (`ai_enabled`, true by default). The app
  controller owns the single transition that turns it off — finalize recording,
  flush, cancel AI work, select the human version, persist, repaint — and the
  sidecar re-checks the same setting before any provider call, so a stale or
  modified client cannot trigger AI work in notes-only mode.
- Treat deliberate rejection as a named no-op: for example, a second workspace
  transition or chat operation while the first owns the flow.

The accepted transitions and failure outcomes live in
[`USER_FLOWS.md`](./USER_FLOWS.md). “Deterministic” describes client-side
ownership and next states; it does not pretend network, sidecar, native, or AI
work cannot fail.

## Side-effect boundaries

`shared/api/client.ts` owns the common `fetch` boundary: timeouts, caller
cancellation, status mapping, empty or malformed JSON, `ApiError`, and the
fetch-based SSE decoder used by chat. `shared/api/sidecar.ts` owns typed
resource calls, snake_case/camelCase mapping, resource URLs, teardown keepalive
patches, and runtime validation at the dangerous transcript/chat stream
boundaries.

Those files are not the only transports:

- transcript keeps its long-lived browser `EventSource` beside transcript
  state and runtime-validates every frame;
- recording keeps its WebSocket and feature-specific native capture commands
  beside the recorder;
- `shared/platform` contains reusable permission, shortcut, theme, and window
  adapters, while application lifecycle and feature-specific Tauri calls stay
  with their owner.

Use effects for lifecycle synchronization and subscriptions: native resize and
close listeners, keyboard/menu registration, `pagehide`, focus/permission
refresh, `EventSource`, and onboarding music. A request or theme change caused
directly by a click belongs in that event's controller or handler.

## Safe shutdown

The native Close Window request and the app-menu/Command-Q action are controlled
workflows, not best-effort unloads: the application prevents the default close,
makes the UI busy/inert, finalizes recording, flushes pending note/version
edits, waits for an active Settings mutation and the ordered settings-save
chain, and only then destroys the window. A failed autosave cancels close and
a failed latest settings write also blocks destruction; both return control to
the user with the existing error. `Recorder.stop()` is awaited, but its audio
upload failure is currently caught and surfaced inside the recorder, so that
failure does not veto close or retry the upload. Dock-level quit and OS-forced
termination cannot be gated without a native exit-request hook; `pagehide`
keepalive is their last-resort fallback, not an awaited save protocol.

## Errors and logging

- Convert transport failures into `ApiError` at the common fetch boundary, but
  validate feature-specific response/event shapes at the feature boundary that
  understands them.
- Put a user-visible error at the surface where the user can retry or choose a
  different action. Logging alone is appropriate only for non-blocking
  refreshes or degraded presentation, such as a waveform decode failure.
- `shared/lib/logger.ts` is the only allowed `console` boundary; ESLint enforces
  `no-console` elsewhere.
- Log workflow events and stable identifiers, never note text, transcripts,
  chat content, prompts, API keys, tokens, or audio payloads. Passed errors are
  reduced to their name/type rather than their message or payload.
- Use `info` for expected lifecycle milestones, `warn` for degraded but
  recoverable behavior, and `error` for failed user actions.

## Testing rules

- Test pure transition functions and transformations exhaustively where their
  state space is small.
- Use hook/component integration tests at data-loss and ownership boundaries:
  overlapping saves, stale async completion, cancellation, partial recording
  startup, malformed stream events, and close preparation.
- Assert observable state and side effects. Skip prop-forwarding tests,
  implementation-detail assertions, and broad snapshots that fail on harmless
  markup changes.
- Run the full frontend gate with `npm run check` (ESLint, Vitest, TypeScript,
  and the Vite production build).

## Adding or changing a feature

1. Write the accepted start, success, failure, retry, cancellation, and stale
   completion behavior in `USER_FLOWS.md` when the feature changes a workflow.
2. Put feature-specific UI/state under `features/<name>`; keep single-use leaf
   helpers beside their owner.
3. Add or extend a shared boundary only when it is truly cross-feature.
4. Expose the narrowest controller/component API needed by the owning page.
5. Coordinate cross-feature ordering in the page or app composition layer.
6. Add only tests that protect a real invariant or failure boundary.

The design choices above follow React's guidance on
[state structure](https://react.dev/learn/choosing-the-state-structure),
[reducers](https://react.dev/learn/extracting-state-logic-into-a-reducer), and
[effects](https://react.dev/learn/you-might-not-need-an-effect), applied with
the official Feature-Sliced Design
[layer responsibilities](https://feature-sliced.design/docs/reference/layers)
without adopting layers the app does not need.

## Deferred (roadmap)

- **Server-side search**: palette and folder filters currently match the
  loaded note list in memory, which is correct for a personal library.
  When it stops being enough, add SQLite FTS5 over title + body (rank,
  then `updated_at DESC, id DESC`) as one `/search` endpoint — do not add
  a second database for it.
- **Folder-scoped AI chat**: only if retrieval quality on real questions
  demands it; embeddings (`text-embedding-3-small`, SQLite-backed cache)
  come before any vector database.
- **Daily notes, LeetCode conventions**: ordinary entries with a nullable
  `daily_date`, a template folder, and object tags — never new domain models.
- **Distribution**: signed + notarized DMG, static landing page, `1.0.0-rc.1`
  before any `1.0.0` artifact.
