# Deterministic desktop user flows

“Deterministic” means the client has one declared owner and next state for an
accepted `(current state, user event)` pair. Native, sidecar, network, and AI
work still have success and failure outcomes; both belong to the flow. A
deliberate no-op and a visible retry are preferable to two operations racing
for the final screen.

In the diagrams below, `→` means ordered work. Indented lines are the complete
outcomes of the preceding external step.

## Boot

```text
launch → paint cached theme (or the OS appearance on first launch) → find local user
  offline/timeout → retry connection up to the boot limit
  no user (404) → onboarding
  existing user → load settings + API-key status + templates
                → load/create initial entry snapshot → ready
  any other failure → explicit start error → Try again → new boot run
```

Only genuine connection failures are retried. A server error never masquerades
as first-run onboarding. An older boot run cannot commit after a newer retry.
The initial entry is the first history entry returned by the sidecar, or a new
blank entry when History is empty. The first workspace boot also opens the tour
until that tour has been dismissed once — except in notes-only mode, where the
tour is skipped because it teaches recording and chat.

The loaded settings include `ai_enabled`; the workspace paints AI surfaces only
when it is on. The sidecar enforces the same setting before any provider call.

There is no persisted “system” theme option. On first launch — before any
preference exists — the app resolves the OS's effective light/dark appearance,
paints the whole onboarding surface with it, and persists that resolved value
when onboarding completes. Light and Dark remain selectable afterwards.

## Onboarding

```text
theme (pre-picked from the OS appearance) → mode
mode → name → AI key → microphone → system audio → recap   (Notes + AI)
mode → name → recap                                        (Notes only)
→ save name (+ theme + ai_enabled) → load workspace → tour
```

- The theme step is first and starts on the OS's effective light/dark
  appearance; picking the other one repaints the whole screen immediately.
  The chosen value is persisted when onboarding completes.
- The mode step chooses the product path once and the choice cannot change
  halfway through: onboarding has no back button, and the mode choice decides
  which steps exist.
- Onboarding and the boot-failure screen use two columns in one color family
  (a quiet surface tone beside the page background), so the native window edge
  and the content share one theme.
- A non-blank name is the only required setup value.
- Saving the API key is single-flight. A failed save stays on the key step with
  an inline error; the optional step can still be skipped after the operation
  finishes.
- A permission request is single-flight. Continue is disabled while it is in
  flight, but microphone and system-audio permission may both be skipped.
- The recap submit is single-flight. It saves the name once, persists the chosen
  AI mode before the workspace boots (so the first screen matches the choice),
  then uses the normal workspace boot path. Failure becomes the application's
  explicit boot error rather than silently returning to setup.
- Setup music belongs to the onboarding page, retries after the first user
  gesture when autoplay was blocked, and stops when the page unmounts.

The Record control later requires an API key. Native capture can still operate
in a declared one-source degraded mode when only one audio permission/source is
available; see Recording.

## AI mode

`ai_enabled` is one persisted preference (true by default). The server
re-checks it on every provider-capable endpoint: chat send and Enhance return
403 and live transcription closes the socket with 4403 while it is off, before
any keychain read or provider work.

Notes only hides: recording and live transcription, chat, Enhance and enhanced
versions, AI templates, the API-key and permission settings sections, the
Meeting window mode, the Enhance/Record help rows, and the first-run tour.
Notes, History, Markdown, Download, theme, and fonts stay.

Switching modes from Settings is one controlled transition:

```text
turn AI off:
  finalize recording → flush note/version edits → cancel chat and Enhance
  → select the human note version → persist ai_enabled=false → repaint
  finalize/flush failure → stay in AI mode → inline error → retry
  persist failure          → stay in AI mode → inline error → retry
  success                  → collapse boxes, leave Meeting mode

turn AI on:
  persist ai_enabled=true → repaint with AI surfaces
```

Turning AI off leaves all existing chat, transcript, and enhanced-version data
on disk; only the surfaces that create or consume provider work are hidden.

## Workspace panels and History

```text
click Chat | Transcript | Audio → that one panel expands
click the note surface → no panel expanded
load another entry → no panel expanded
```

Only one of the three meeting panels is expanded at a time. Bottom-bar actions
do not collapse it. In notes-only mode the meeting-panel row is not rendered
at all.

History is a single docked sidebar. Its list is supplied most-recently-edited
first by the sidecar. Toggling Meeting mode closes History, hides the History,
New Entry, and Settings controls, and prevents the sidebar from rendering.

## Edit and autosave

```text
keystroke → paint locally → merge latest value into pending batch
→ 600 ms quiet period → serialize persistence
  success → request History refresh → clean
  failure → restore failed batch behind newer edits + visible error
          → retry on a later edit or required flush
```

A batch may contain the Human note and any number of enhanced versions. A new
edit wins over an older failed value for the same field, while an edit to
version B cannot erase a pending edit to version A. Every flush joins an active
write before taking the next batch, so an older PATCH cannot finish after a
newer one.

Navigation, chat send, Enhance, version selection, and close all require a
successful flush. When that flush fails, the owning action stops and the
current editor content remains available.

## New/open note

```text
click New/Open → acquire workspace transition → stop/finalize recording
→ flush edits → cancel old chat/enhance ownership
→ fetch complete target snapshot
→ atomically commit entry + transcript + versions + chats + messages → ready
```

A second workspace transition while one is active is a deliberate no-op.
Opening the already-active note is also a no-op.

- A failed required edit flush or target load leaves the current note in place
  with a visible error. Recording finalization is awaited; if the recorder
  reports a finalization error, that error is surfaced but the flow continues
  to the edit-flush gate.
- If New successfully creates a row but loading its snapshot fails, History is
  refreshed and the error explains that the user can choose the created note
  there. The old note remains current.
- A stale chat stream or Enhance completion from the old entry cannot mutate
  the newly committed snapshot.

## Rename note

```text
click pencil → inline title input
  Escape → cancel locally
  Enter/blur → trim title (blank becomes untitled) → PATCH title
    success → update active title when applicable → refresh History
    failure → visible rename error if the original entry still owns the screen
```

Rename changes only the title; it does not flush or replace note content. One
rename request owns the flow, so blur after Enter and repeated rename attempts
cannot submit twice. A late failure after the user has moved to another entry
does not place an error on that new entry.

## Delete note

```text
click Delete → acquire workspace transition → flush current pending edits
→ DELETE entry
  background entry → remove row → refresh History → current note remains
  current entry → clear deleted entry → load newest survivor snapshot → ready
  current entry + no survivors → create/load blank note snapshot → ready
```

Deleting the current entry also stops/finalizes its recording and cancels its
chat/Enhance ownership before deletion. If DELETE itself fails, the entry and
pending content remain. If DELETE succeeds but History or replacement loading
fails, the deletion is retained and a recovery-specific error is shown; a
deleted current note is never painted as though it still exists.

## Recording

```text
idle → Record → starting → open transcription socket
→ start microphone → start system audio
  both fail → cleanup → idle + visible error
  one succeeds → active with available source + visible degraded-source error
  both succeed → active

starting/active → Stop → stopping → request transcript flush
→ stop native taps → mix captured sources → append saved audio
→ refresh entry/History → idle
```

The recording state is `idle | starting | active | stopping`; the UI's
`recording` value is derived from it. Stop is accepted during `starting`, and
clicks during `stopping` are ignored. A repeated stop joins the current
finalization. While `stopping`, the bottom bar shows “Stopping…” so
finalization is never mistaken for a hung Stop button.

While `active`, the transcript header shows the one deterministic recording
indicator: a red “REC” label with the elapsed time (the `startedAt` on the
active state is its origin). There are no dots or animations anywhere in the
transcript — in-flight turns read as fainter bubbles until they finalize.

The mic path is echo-cancelled against the system tap (WebRTC AEC3) before it
reaches transcription, so meeting audio played through the speakers never
appears in the “me” transcript. The capture is held back a constant 60 ms in
the AEC loop, which guarantees the reference is always ahead of the echo it
must cancel; the saved mix pads the system track by the same 60 ms so the two
tracks stay sample-aligned. The mic and the tap run on two independent device
clocks, so the loop also slips one reference sample per 10 ms frame instead of
ever hard-skipping: a hard skip reinitializes AEC3, which forgets its learned
filter and leaks echo for seconds while it re-converges. `audio.echo_stats`
logs ERLE, the measured delay, and filter divergence every ~5 seconds, which
pinpoints any alignment problem at runtime.

The recorder deliberately succeeds when either the microphone (“me”) or
system-audio (“them”) tap starts. The failed source is reported, and the saved
file contains the source that was captured. Capture fails only when neither
source starts (or the transcription socket cannot open).

Manual note/settings navigation and native close wait for finalization. The
recorder asks the sidecar to flush in-flight words and waits for an acknowledgement
or an eight-second ceiling before closing the socket. An unexpected socket
close moves the UI to `stopping`, explains that captured audio is being saved,
then returns to `idle`. Audio reload happens only after normal finalization has
completed.

Audio upload failure is caught inside the recorder, logged, and surfaced as a
recording error. `Recorder.stop()` then resolves; there is no automatic upload
retry, and the failure does not block the following navigation or close gate.
The saved mix is appended in ordered 30-second chunks, so stop never blocks on
one giant base64 string or one giant request.

When “Meeting mode on Record” is enabled, successful capture enters Meeting
mode. Stop returns from Meeting to Normal only when that preference is enabled
and the window is still in Meeting mode.

## Transcript

```text
recording owns EventSource
  resync → replace authoritative finalized lines + clear both partials
  delta(source) → append to that source's partial text
  final(line) → append finalized line + clear that source's partial
recording becomes idle → close EventSource
```

JSON, event type, source, line id, text, and timestamp are runtime-validated.
Malformed or unknown frames are logged and do not mutate transcript state. A
later resync supplies the authoritative state after an EventSource reconnect.

## Chat CRUD

Every chat create/select/rename/delete/send operation is single-flight. While
one owns the controller, the chat controls are disabled.

```text
New chat → create → append/select empty chat
  failure → keep prior selection + explicit create error

Select chat → fetch messages → commit selection and messages together
  failure → keep prior selection/messages + explicit load error

Rename chat → trim title (blank becomes untitled) → PATCH → replace row
  failure → retain row + explicit rename error

Delete background chat → DELETE → remove row
Delete active chat → DELETE → remove row → select last remaining chat
                   → fetch its messages
  no remaining chat → clear active chat/messages
  DELETE failure → retain chat
  post-delete load failure → keep deletion + explicit recovery error
```

Inline chat rename commits once on Enter or blur and cancels on Escape.

## Send chat message

The save gate happens before the optimistic message, and the input draft stays
owned by the form until the controller accepts the send:

```text
submit non-blank draft → retain input → working → flush note/version edits
  flush failure → no optimistic row → idle + "save first" error + retain draft
  flush success → append optimistic user row
                → create/select chat if none exists
                → stream assistant reply
    final assistant message → refetch persisted messages/first-message title
      refresh success → commit persisted thread → accept → clear draft → idle
      refresh failure → append validated final assistant locally
                      → recovery error → accept → clear draft → idle
    stream/API failure before final → clear stream UI
                                    → keep optimistic question + draft
                                    → explicit error → idle
```

The preparation-failure path adds nothing to the thread and leaves the draft
ready for an explicit retry. A failure after streaming starts but before a
valid final event retains both the optimistic question and the draft; the
question remains visible while the user decides whether to retry. Once a valid
final assistant message has arrived, a later refresh failure is recovery-only:
the saved reply is appended locally, the draft clears, and reopening the chat
can retry the authoritative refresh. There is no automatic resend.

Switching entry aborts the fetch-based stream and invalidates its operation.
Late deltas, title refreshes, or completions cannot update the new entry.

## Enhance and versions

```text
Enhance → choose template or custom instructions → close picker
→ flush Human/enhanced edits → generate new version
  success → append/select version → apply generated title when allowed
          → refresh History → idle
  save failure → do not call Enhance + visible "save first" error
  generation failure → keep existing versions + explicit error → idle
```

Enhance requires an API key, a current entry, enough note/transcript source,
and no active recording. It uses the saved Human note and transcript at the
start of the run. The editor is read-only while preparation/generation owns the
flow. A generated title applies only when the same entry is still active and
still untitled. Navigation invalidates a running result, so it cannot land on a
different note.

```text
choose Human/Enhanced version → close picker → flush currently shown edit
  success → switch editor source
  failure → retain current source + visible save error
```

Each enhanced version has its own pending-save slot; changing views cannot
cross-write version content.

## Enter and leave Settings

```text
Settings → acquire transition → stop/finalize recording → flush edits
→ cancel entry-scoped chat/enhance ownership → Settings page
  save failure → remain in workspace with visible error

Back → workspace → refresh application API-key gate
```

The Settings sidebar and Back control are disabled during a name, API-key,
permission, or template mutation. Appearance/general setting writes use a
separate ordered save chain and may continue after returning to the workspace;
native close drains that chain. A recording finalization error is surfaced but,
after the attempt finishes, does not replace the edit flush as the navigation
gate.

## Name

```text
edit name → Enter causes blur / blur commits → trim
  blank or unchanged → no-op
  changed → disable Settings navigation → PUT name
    success → update application user → unlock
    failure → keep draft + inline error → unlock for retry
```

Only one name write runs at a time.

## API key

```text
open API-key step/section → read Keychain status
Save non-blank key → single-flight Keychain write
  success → show Set, clear input
  failure → keep input + inline error
Clear → single-flight Keychain delete
  success → show Not set
  failure → retain Set status + inline error
```

The stored key is never read back into the UI or logged. In Settings,
navigation is locked during Save/Clear. Returning to the workspace refreshes
the application-level key gate used by Record, chat, and Enhance. A failed
initial status lookup leaves the section's status unknown (`…`) and is logged
without exposing the key.

## Permissions

```text
open onboarding/Permissions → read microphone + system-audio status
window regains focus → refresh both statuses
  granted → show check
  not determined → Allow → native request → refresh
  denied → Open System Settings → focus return → refresh
```

Only one permission request runs at a time; Settings navigation is disabled
until it completes. A request failure or failure to open System Settings is
shown beside the permission controls. If the status check itself fails, the
safe rendered fallback is denied.

## Templates

```text
New/edit template → validate non-blank, case-insensitively unique name
→ disable Settings navigation → create/update
  success → replace/append returned template in application state → list
  failure → retain editor values + inline error → retry

built-in Reset → reset on sidecar → replace returned template → list
custom Delete → delete on sidecar → remove local row → list
```

Built-in templates can be edited and reset but not deleted. Custom templates
can be edited and deleted. Every mutation is single-flight and keeps the editor
open on failure.

## Theme, font, size, and recording preference

```text
change control → paint choice immediately → append full settings PUT
  success → choice remains
  failure → choice remains on screen + visible save error
```

Full settings writes run in click order, preventing an older request from
finishing after a newer one. The current UI is optimistic and does not roll
back a failed choice.

- Theme can be toggled in General, the bottom bar, or the palette. It updates
  the webview and cached prepaint immediately and asks the shell to repaint the
  native window.
- Font and size affect only the note editor. Settings exposes explicit selects;
  bottom-bar controls cycle the four fonts and the even sizes 16–32 px.
- “Meeting mode on Record” changes only the automatic recording/window
  choreography described under Recording.

## Window modes

```text
N/F/M click → paint requested mode optimistically → serialize native command
  success → requested mode becomes last confirmed mode
  latest failure → roll UI back to last confirmed mode
native resize/fullscreen change → reconcile reported fullscreen state
```

Normal is the base window, Meeting is the right third at full height, and Full
screen uses native macOS fullscreen. Clicking F while already fullscreen asks
the shell to exit and returns to the last non-fullscreen mode. Entering Meeting
always closes History. Native mode failures are logged; rollback is the visible
feedback.

## Audio, copy, and download

### Saved audio

```text
open Audio panel → load duration
  no audio/load failure → disabled player at 0:00
  duration → load WAV + decode waveform
    success → Play/Pause + click-to-seek
    decode failure → disabled waveform player + warning log
recording finalizes → reload duration/WAV/waveform
```

Each recording appends to the entry's existing saved audio. Playback ends by
resetting to 0:00; leaving the Audio panel unmounts and stops its player. A
browser playback rejection leaves the player stopped and is logged, with no
separate visible error.

### Copy

```text
Copy → copying
  clipboard success → check/Copied for 1.2 s → idle
  clipboard failure → Copy failed label/title for 1.2 s + error log → idle
```

Another click during `copying` is ignored. The bottom bar copies the currently
shown Human or Enhanced note. Chat copies one message. Transcript copy builds a
meeting template from finalized lines only; live partials are not included.

### Download

```text
Download → choose currently shown Human/Enhanced markdown
→ sanitize title for a filename → one-shot .md browser download
```

Untitled notes use `meeting-notes.md`; enhanced views add `-enhanced`. The
current implementation has no completion or failure message for download.

## Palette, overlays, focus, and shortcuts

The ready application owns exactly one overlay value:

```text
closed ↔ palette | help | enhance | versions | tour
```

- Opening an overlay replaces the current non-tour overlay. The first-run tour
  blocks replacement until it is dismissed; backdrop, Escape, Skip, or Done
  dismisses it and marks it seen.
- While an application overlay is open, the page underneath is `inert` and the
  overlay declares `role="dialog"` and `aria-modal="true"` with an accessible
  label. Palette, Enhance, and Versions autofocus their input; Help and Tour
  autofocus their dialog.
- Palette/Help/Enhance/Versions remember the opening element. Focus returns
  after the overlay closes and any resulting workspace/Enhance operation is
  idle, provided that element still exists and is enabled.
- Escape closes the current application overlay. Command-K toggles the palette
  and may replace another non-tour overlay. Other global workspace shortcuts do
  not run behind an overlay.
- Palette arrow movement wraps, Enter runs the selected item, and an action
  closes the palette before handing work to its owning flow. Meeting mode hides
  New and History actions, matching the bottom bar.

The inert background and initial focus make the dialogs keyboard-reachable, but
the application does not implement a custom focus-cycling trap.

## Legal pages

During onboarding, Terms and Privacy open a local legal dialog above setup. The
onboarding surface becomes inert; the dialog is labelled, autofocuses, and
closes from its Close button, backdrop, or local Escape handler, returning to
the same setup step.

In Settings, Privacy and Terms are static pages. Opening either from About
records About as the return section. Opening one directly from the sidebar uses
the stored legal return section (Help until About has set another one); the
page's Back button returns there.

## Close Window and Quit

Once the workspace is ready, native Close Window (Command-W) and the
application-menu Quit action (Command-Q) use the same guarded shutdown path:

```text
Command-W close request → prevent default ┐
custom Command-Q menu action ─────────────┴→ mark closing + lock application UI
→ stop/finalize recording → flush pending Human/enhanced edits
  flush failure → cancel close → unlock UI → retain content + visible save error
  success → cancel chat/enhance ownership
          → wait for active Settings mutation
          → wait for ordered settings-save chain
            latest settings save failed → cancel close + keep its visible error
            settings saved → destroy native window
```

Repeated close/quit requests join the same close operation. If the workflow or
native destroy fails, the window remains open, the UI unlocks, and a global
close/save alert is shown. During boot/onboarding, where no ready workspace
exists, shutdown skips workspace preparation and proceeds through the remaining
gate, including waiting for a tracked setup mutation. A later successful
settings change clears a prior settings-save block. Recording audio upload
failure has already been caught by the recorder and therefore does not cancel
shutdown; autosave and the latest settings write are the blocking save gates.

Dock-level quit and OS-forced termination are outside the JavaScript close/menu
gate. On teardown, `pagehide` sends keepalive note/version patches and requests
recorder stop as a defensive fallback, and the shell kills the bundled sidecar
when the app exits. These fallback actions do not await recording finalization,
settings writes, or confirmation that keepalive edits landed.
