# meetwrite desktop

The macOS app: a React 19 + Tailwind UI inside a Tauri 2 shell. The shell owns
the frameless rounded window, native microphone/system-audio capture, and the
bundled Python sidecar lifecycle.

- `src/` — the webview UI, organized as `app`, `pages`, `widgets`, `features`, and `shared`.
- [`docs/USER_FLOWS.md`](docs/USER_FLOWS.md) — accepted desktop transitions,
  failure/retry behavior, and shutdown guarantees.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — dependency, state,
  side-effect, logging, testing, and extension rules.
- `src-tauri/src/` — Rust window states, traffic-light hiding, shared audio
  plumbing, the microphone/system-audio taps, and release sidecar launch.
- `src-tauri/tauri.conf.json` — window, bundle, external binary, and embedded
  runtime config.

## Develop

With the sidecar running (`uv run --directory api uvicorn meetwrite.main:app --reload --port 8321`):

```bash
npm run tauri dev
```

`npm run dev` alone runs the UI in a browser, but recording needs the native
shell because both audio taps are Rust.

## Check

```bash
npm run check                      # eslint + vitest + tsc + vite
cargo test --manifest-path src-tauri/Cargo.toml
```

## Build

From the repo root:

```bash
make app
```

This builds and embeds the Python sidecar, then produces `meetwrite.app` and
`meetwrite_0.1.0_aarch64.dmg` under `src-tauri/target/release/bundle/`. The
build is unsigned: right-click → Open on first launch. Distribution requires a
Developer ID identity and notarization configured through `tauri.conf.json`.

## App icon

Keep a square source PNG (1024×1024 recommended) at
`src-tauri/meetwrite.png`, then from the repo root:

```bash
npm run tauri --prefix desktop -- icon src-tauri/meetwrite.png
```

That regenerates everything in `src-tauri/icons/`: `icon.icns` (macOS),
`icon.ico`, and the PNGs already listed in `tauri.conf.json`. No config edits
are needed.
