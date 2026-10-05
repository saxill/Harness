---
name: run-harness
description: Launch the Harness Tauri desktop app (dev mode with hot reload, or the installed release build). Use when asked to run, start, or open Harness.
---

# Run Harness

Harness is a Tauri 2 + React + Vite desktop app (Rust backend in `src-tauri/`,
frontend in `src/`). It must run as a native window — the frontend alone in a
browser has no backend (SSH/exec/agent calls are Tauri commands).

Verified on macOS (this Mac) and Linux (Omarchy laptop, `saxill@100.120.253.10`).

## Dev mode (native window, hot reload)

```bash
cd ~/code/harness
export PATH="$HOME/.cargo/bin:$PATH"   # cargo is NOT on the login-shell PATH here
npm run tauri dev
```

- Vite serves on http://localhost:1420 (a `200` from curl means the frontend is up).
- First run in a while recompiles Rust deps (`--no-default-features` feature set,
  ~1.5–2 min on this Mac); afterwards it's incremental.
- Success = terminal shows `Running 'target/debug/harness'`, no error lines after it,
  and the Harness window opens on screen. A blank window or a panic in the log is a failure.
- Leave it running in a terminal tab; the user stops it with Ctrl-C.

Gotcha: without the PATH export, `tauri dev` dies with
`failed to run 'cargo metadata' ... No such file or directory` — that's cargo missing, not a project bug.

## Installed build

- macOS: `npm run tauri build` → `src-tauri/target/release/bundle/macos/Harness.app`
  (plus a dmg next to it). Installed to `/Applications/Harness.app`.
- Linux: `npm ci && npx tauri build --no-bundle`, then `ops/install-linux.sh`
  installs `~/.local/bin/harness`, a launcher entry, and the 21:30 digest timer.

To smoke-test the installed build instead of dev mode, run the binary directly
(`open -a Harness` on Mac, `harness` on Linux) and check the window appears.

## Interacting with a running instance

There is no CLI/socket remote — drive it through the window. For programmatic
checks while developing, run the Vite server (`npm run dev`) and open
http://localhost:1420 in a browser pane, knowing Tauri IPC calls will fail there;
only use that to check the frontend renders, not end-to-end behavior.
