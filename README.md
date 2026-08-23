# meetwrite

A minimalist, local-first AI meeting note-taker for macOS. Open it, press **Record**, and it transcribes the meeting — your mic and the meeting's system audio as two labeled streams — while you type your own notes. Then **Enhance** turns everything into clean notes, and **Chat** answers questions about what was said. No accounts, no cloud: notes, transcripts, and recordings live on your Mac, and the only bytes that leave are the ones you send to OpenAI with your own key.

- **Record** — live transcription with two labeled streams (“me” and “them”)
- **Notes** — a calm, empty page; human and AI-enhanced versions side by side
- **Chat** — ask questions about the current meeting's transcript and notes
- **History** — every meeting, searchable with ⌘K
- **Keyboard-first** — ⌘K search, ⌘N new note, ⌘R record, ⌘W/⌘Q close/quit, `?` for the full list

Built with [Tauri 2](https://tauri.app) (Rust + React) around a bundled [FastAPI](https://fastapi.tiangolo.com) sidecar. Start with the [API architecture](api/docs/architecture.md), [desktop architecture](desktop/docs/ARCHITECTURE.md), and [desktop user flows](desktop/docs/USER_FLOWS.md).

## Repository layout

- `desktop/` — the macOS app: React UI + Tauri shell (window, native audio capture, sidecar launch)
- `api/` — the Python sidecar: SQLite storage, transcription, chat, and enhance via your OpenAI key
- `.github/workflows/` — reproducible API and desktop quality gates

## Prerequisites (macOS)

- [Rust](https://rustup.rs) (for the Tauri shell)
- [Node.js](https://nodejs.org) ≥ 20 (for the webview UI)
- [uv](https://docs.astral.sh/uv) with Python ≥ 3.13 (for the sidecar)

## Develop

Install locked dependencies once:

```bash
make setup
```

Then use two terminals:

```bash
# 1. the sidecar
make dev-api

# 2. the app
make dev
```

`make dev` starts the Tauri shell with the Vite dev server. The webview UI can also run alone in a browser with `npm run dev --prefix desktop`, but recording needs the native shell (both audio taps live in Rust).

## Check

```bash
make check
```

Use `make check-api`, `make check-desktop`, or `make check-rust` while working
inside one layer. Pull requests run the API and desktop gates in CI; native Rust
checks remain part of the local macOS gate.

## Build & ship

```bash
make app
```

This builds the Python sidecar, embeds it inside the app, and produces both:

- `desktop/src-tauri/target/release/bundle/macos/meetwrite.app` — **what you run**: drag it into Applications and double-click.
- `desktop/src-tauri/target/release/bundle/dmg/meetwrite_0.1.0_aarch64.dmg` — **what you share**: the installer you give to other people.

Ship the `.app` for yourself and the `.dmg` to hand the app to someone else. Everything is self-contained — users never install Python.

The build is **unsigned**: on first launch, right-click the app and choose Open (Gatekeeper). To distribute publicly, sign it with a Developer ID and notarize it (`bundle.macOS.signingIdentity` + entitlements in `desktop/src-tauri/tauri.conf.json`).

App data lives in `~/Library/Application Support/com.bhanuprasanna.meetwrite/` — the database and the saved recordings.

## Clean

```bash
make clean
```
