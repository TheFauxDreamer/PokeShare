# PokeShare

Browser-based **Soul Link Nuzlocke** for Gen 3 Pokémon, built for streaming.

Two players each run their own ROM in their own browser. PokeShare reads the
live party straight out of emulated console RAM, links the two runs, and drives
three views:

- **`/play`** — where each player actually plays.
- **`/stream`** — one OBS browser source: both games side by side, each player's
  team beneath their own picture.
- **`/pairs`** — every soul-link pair, its faint status, and the route it was
  caught on.

Nobody types a Pokémon name, a level, or a route. The only manual step in the
whole loop is confirming a death.

See **[PLAN.md](PLAN.md)** for the architecture and build phases.

## Status

Early. The Gen 3 reader and its test suite exist; the server and the views do
not yet. Current state:

| Package | What it does | Status |
|---|---|---|
| `packages/data` | Per-version RAM layouts, route tables, species mapping | Written |
| `packages/gba` | Gen 3 decrypt/parse, RAM location, save-state fallback | Written, untested against a real ROM |
| `packages/shared` | Wire protocol between play view, server and displays | Written |
| `packages/server` | Run state, route pairing, death cascade, clauses, signalling | Written and tested; runs persist across restarts |
| `packages/web` | The three views, emulator wiring, WebRTC video | Written; builds and serves, untested against a real ROM |

## Getting started

Requires Node 20+ and pnpm.

```bash
pnpm install
pnpm test        # 81 tests: Gen 3 parsing, RAM location, rules engine, sockets
pnpm typecheck
pnpm build

# Two terminals:
pnpm dev:server                      # http + ws on :8080
pnpm --filter @pokeshare/web dev     # views on :5173
```

Then open `/play`, pick your ROM, and share the join code. `/stream` is the OBS
browser source (1920×1080); `/pairs` is the second screen.

**Start at `/diagnostics`.** Nothing here has yet read a live game. That page
loads a ROM and walks every link of the read path — state format, game code,
party address, checksums, route, badges — reporting which one breaks and why.
Run it before trusting a stream to any of this.

Runs persist to `./data/runs` (`POKESHARE_DATA_DIR` to change), so restarting
the server does not lose a run in progress.

> **Cross-origin isolation is required.** The mGBA core is threaded and needs
> `SharedArrayBuffer`, so every response must carry
> `Cross-Origin-Opener-Policy: same-origin` and
> `Cross-Origin-Embedder-Policy: require-corp`. Vite sets these in dev and
> preview; **production hosting must send them too** or the emulator will not
> start.

To regenerate the route tables from the pret decompilations:

```bash
pnpm gen:mapsec  # needs python3
```

## ROMs

You supply your own. ROMs are loaded from local disk into your own browser and
are never uploaded. `.gitignore` refuses to commit `*.gba`, `*.sav` and save
states. See [NOTICE.md](NOTICE.md).
