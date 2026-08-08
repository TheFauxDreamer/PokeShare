# PokeShare — Browser Soul Link for Gen 3

## Context

Two players run co-op **Soul Link** Nuzlockes on Gen 3 Pokémon games (Ruby/Sapphire/Emerald/FireRed/LeafGreen, including UPR-ZX randomised ROMs) and stream them. The stream should show **both players' games side by side with each player's team directly beneath their own picture**, and the players themselves need a **second view listing every soul-link pair, its faint status, and the route it was caught on**.

The repo is greenfield — a one-line `README.md`. `FULL_PLAN.md` describes a *different* architecture (native emulator + Lua sensor + local TCP bridge) and is **superseded by this document**; it should be deleted or archived.

The change in direction is that **the game now runs inside the browser** via a WebAssembly GBA core. That removes the entire Lua/bridge/TLS-termination stack: the app is in the same process as the emulator, so it can read game memory directly and drive every view from one place.

**Decisions locked with the user:**

| Decision | Choice |
|---|---|
| Game source | Real Gen 3 ROMs in an in-browser GBA emulator |
| Games | R/S/E + FR/LG, vanilla **and** UPR-ZX randomised |
| Stream picture | App renders **both** games itself (one OBS browser source) |
| Run structure | Full route-based run |
| Topology | Players are **remote, different houses** |
| Death handling | **Alert + confirm, then mark** (human in the loop) |
| Rules tracked | Dupes clause, species clause on pairs, badge-based level cap |
| Not tracked | Shiny clause |

---

## Research findings that shape the design

Four findings materially changed the plan. They are load-bearing — read before the architecture.

**1. Nothing in the prior art does this.** The survey splits cleanly in two, and neither half is what's wanted:
- *Manual soul-link trackers*: [soopercool101/soullink-nuzlocke-tracker](https://github.com/soopercool101/soullink-nuzlocke-tracker), [SidoJain/Pokemon-Soul-Link](https://github.com/SidoJain/Pokemon-Soul-Link), [EladKarni/soul-link](https://github.com/EladKarni/soul-link), [yeager-j/old.nuzlocke.gg](https://github.com/yeager-j/old.nuzlocke.gg), [jynnie/soullocke](https://github.com/jynnie/soullocke). Good data models, **100% hand-entered, no live game, no stream output**.
- *Live-RAM trackers*: [besteon/Ironmon-Tracker](https://github.com/besteon/Ironmon-Tracker), [paulthemagno/pokemon-emulator-tracker](https://github.com/paulthemagno/pokemon-emulator-tracker), [jakobskr/Nuzlocke-Tracker](https://github.com/jakobskr/Nuzlocke-Tracker). Real memory reading, but **single-player, native emulator + Lua, local drawing only**.
- *Browser multiplayer Pokémon*: [project-pokeworld](https://github.com/rohan-shettyy/project-pokeworld), [PokeMMO-Online](https://github.com/aaron5670/PokeMMO-Online-Realtime-Multiplayer-Game) — custom engines, not real ROMs, irrelevant to soul link.

No project combines browser ROM + two-player soul link + stream output. Build it, but **harvest Ironmon-Tracker's data** (see finding 4).

**2. `@thenick775/mgba-wasm` exposes no memory-read API — but the heap is still reachable.** This was the single biggest risk and it is now resolved. Inspecting the shipped `mgba.d.ts`, `main.c` and `memory.c`: there is **no** `readMemory`/`readRange`, and `main.c`'s `EMSCRIPTEN_KEEPALIVE` exports cover only input, save states, audio and lifecycle. `memory.c` is just `memalign`/`free` helpers, not emulated memory. Grepping the built `dist/mgba.js` confirms `Module["..."]` exports include `FS`, `cwrap`, `addFunction` and `instantiateWasm`, but **not** `HEAPU8`/`wasmMemory`.

Two ways in, neither requiring a fork:

- **Primary — `Module.instantiateWasm` hook.** This standard Emscripten hook lets the host instantiate the wasm module itself. Doing so yields the `WebAssembly.Memory` object, and therefore `new Uint8Array(memory.buffer)` — the entire heap, including emulated EWRAM. Reads are then plain typed-array indexing at effectively zero cost.
- **Fallback — savestate parsing.** `saveStateSlot(slot, 0)` writes a raw state into the Emscripten FS, readable via the exported `FS.readFile`. Verified against mGBA's `serialize.h`: `struct GBASerializedState` is `static_assert`-ed at **`0x61000` bytes**, with `wram` (256 KB EWRAM) as the **final** field — so EWRAM sits at a fixed offset of **`0x21000`**, and IWRAM at `0x19000`. Fully supported APIs, no fork, just heavier per poll.

Phase 1 is a spike that settles which one ships.

**3. Randomised ROMs are nearly free — with one real exception.** UPR-ZX rewrites *data tables* (species, encounters, movesets), not code layout, the party struct, or the map list. So the same memory reader, the same route list and the same address tables work on vanilla and randomised alike. The one exception is the **species clause**: it depends on evolutionary families, and randomisers rewrite evolutions. Resolve this by reading the game's **own randomised evolution table out of ROM memory** rather than shipping a static family table — correct by construction on any ROM. ([RandomizerLog.lua](https://github.com/besteon/Ironmon-Tracker/blob/main/ironmon_tracker/data/RandomizerLog.lua) is a reference for optional log import, not a dependency.)

**4. Ironmon-Tracker has already done the Gen 3 archaeology, MIT-licensed.** [`ironmon_tracker/GameAddresses/`](https://github.com/besteon/Ironmon-Tracker/tree/main/ironmon_tracker/GameAddresses) holds per-version JSON address tables for **every Gen 3 game and revision** (Emerald, FireRed 1.0/1.1, LeafGreen 1.0/1.1, Ruby 1.0/1.1/1.2, Sapphire 1.0/1.1/1.2, plus EU languages). Confirmed present in `Pokemon Emerald.json`:

| Key | Value | Use |
|---|---|---|
| `gPlayerPartyCount` | `0x20244E9` | party size; `gPlayerParty` = `0x20244EC` |
| `gBattleTypeFlags` | `0x2022FEC` | wild vs trainer battle |
| `gMapHeader` | `0x2037318` | current map → route name |
| `gSaveBlock1ptr` | `0x3005D8C` | + `badgeOffset` `0x137C` → badges |
| `gBattleMons` | `0x2024084` | live battle state |

Also reusable: `data/RouteData.lua` (map ID → route name) and `data/PokemonData.lua`. **Port these tables to JSON/TS; do not re-derive them.** Retain the MIT notice.

**5. Gen 3 party structure** ([Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_data_structure_(Generation_III))) — 100 bytes per slot:

| Range | Encrypted? | Contents |
|---|---|---|
| `0x00–0x1F` | No | PID `0x00`, OT ID `0x04`, nickname `0x08`, checksum `0x1C` |
| `0x20–0x4F` | **Yes** | 4 × 12-byte substructs: Growth / Attacks / EVs / Misc |
| `0x50–0x63` | No | status `0x50`, **level `0x54`**, **cur HP `0x56`**, **max HP `0x58`** |

The Nuzlocke-critical fields (level, HP, status) are **unencrypted**. Only species/item need decryption: XOR the data section with `PID XOR OTID`, substruct order = `PID % 24`. The `0x1C` checksum gives a free correctness check. **PID is the stable primary key** for a Pokémon across the whole system — it survives nicknames, level-ups and reordering.

---

## Architecture

Soul Link means **two independent playthroughs**, not a shared game state. There is therefore *no* netplay, lockstep or rollback problem — the hard part of "multiplayer emulator" simply does not exist here. Only two things cross the network: a trickle of JSON state, and video for the stream view.

```
 PLAYER A (home)                              PLAYER B (home)
┌──────────────────────────┐              ┌──────────────────────────┐
│ Play view (browser tab)  │              │ Play view (browser tab)  │
│  mgba-wasm + local ROM   │              │  mgba-wasm + local ROM   │
│  memory reader @ 4 Hz    │              │  memory reader @ 4 Hz    │
│  canvas.captureStream()  │              │                          │
└─────┬──────────────┬─────┘              └─────┬──────────────┬─────┘
      │ WSS (state)  │ WebRTC (video)           │              │
      └──────────┐   └──────────────┐   ┌───────┘   ┌──────────┘
                 ▼                  │   │           │
   ┌──────────────────────────┐     │   │           │
   │  PokeShare Server        │     │   │           │
   │   · run + pair state     │     │   │           │
   │   · rules engine         │     │   │           │
   │   · WebRTC signalling    │     │   │           │
   │   · SQLite               │     │   │           │
   └───────────┬──────────────┘     │   │           │
               │ WS fan-out         ▼   ▼           ▼
      ┌────────┴────────┐     ┌──────────────────────────┐
      ▼                 ▼     │  Stream view (OBS)       │
  Pairs view A    Pairs view B│  both canvases + teams   │
                              └──────────────────────────┘
```

**Video path.** `canvas.captureStream(30)` → WebRTC → stream view. The stream view treats **both** players as peers, including the local one (loopback WebRTC), so there is a single code path and one self-contained OBS browser source. Because the players are in different houses, this needs a STUN server plus a **TURN fallback** (Cloudflare TURN or self-hosted coturn) for the ~10–20% of NAT pairs that won't hole-punch. *Escape hatch if quality or latency disappoints: capture the local player's window natively in OBS and stream only the partner's video — a scene-layout change, not an architectural one.*

**Server owns all rules.** The reader is a dumb sensor emitting normalised snapshots; it knows nothing about Nuzlockes. This keeps future generations cheap: a new gen means one new parser, no rules changes.

---

## Repo layout

pnpm workspaces monorepo, TypeScript throughout.

```
PokeShare/
├── packages/
│   ├── shared/     # protocol types + zod schemas — single source of truth
│   ├── gba/        # emulator wrapper, heap access, Gen 3 parser (pure, unit-tested)
│   ├── data/       # Gen 3 address tables, route maps, species tables (ported from Ironmon)
│   ├── server/     # Fastify + ws + better-sqlite3 + WebRTC signalling
│   └── web/        # Vite + React — /play, /stream, /pairs
└── assets/sprites/ # bundled locally, no CDN — works offline mid-stream
```

`packages/gba` is deliberately free of React and network code so the decrypt/parse logic can be tested against byte fixtures with no emulator running.

---

## The three views

**`/play` — each player.** Loads a ROM from local disk (see *Legal*), runs mgba-wasm, handles input, shows own team + level cap + pending-death prompts. Publishes state and video.

**`/stream` — the OBS browser source.** Both game pictures side by side, each player's 6-slot team strip directly beneath their own picture, soul-link partner badge per slot, combined death counter, badge row + level cap. Sized for a 1920×1080 canvas; layout presets via URL params.

**`/pairs` — the players' second screen.** Every pair in the run as a table: both species, **faint status**, and **the route it was caught on**. Plus dupes/species-clause warnings and the pending-death confirm queue. Designed for a phone or second monitor so it never occupies capture space.

---

## Key technical decisions

**Locating EWRAM in the heap.** Don't blind-scan for a party. The GBA address of `gPlayerParty` is *known per version* from the Ironmon tables, so only one unknown exists: where EWRAM's 256 KB block starts inside the wasm heap. Find it once by scanning candidate offsets and validating that (a) `gPlayerPartyCount` reads 1–6 and (b) the party blocks at the implied address pass their `0x1C` checksums. Cache the base; re-resolve only after N consecutive validation failures (game reset). This is far more reliable than a structural party search and reuses the checksum as a free oracle.

**Poll at 4 Hz, transmit on change.** 250 ms is invisible on stream and keeps overhead near zero while OBS encodes. Hash the party each poll and send only diffs; an idle run generates almost no traffic.

**ROM identification.** Read the ROM header game code + revision to select the right address table, exactly as Ironmon does. Randomised ROMs keep their header, so they resolve to their base game automatically.

**Rules, all server-side:**
- Wild battle starts (`gBattleTypeFlags`) → read opponent species + `gMapHeader` → if it's the first encounter on that route, that's the route encounter.
- **Pairing is by route name.** Vanilla Gen 3 has a stable, shared route list, so A's Route 103 encounter pairs with B's Route 103 encounter directly — no ordinal gymnastics.
- **Dupes clause**: flag an encounter whose species (as randomised, read live) was already caught; offer re-roll.
- **Species clause on pairs**: warn on illegal links, using the **randomised evolution table read from ROM**.
- **Level cap**: badge count from `gSaveBlock1ptr + badgeOffset`; highlight any Pokémon over cap.
- **Death**: party HP `>0 → 0` → `death_pending` → prominent alert on all views naming the partner to retire → **explicit confirm** → cascade to the linked partner and push everywhere.
- Manual override for every one of the above. Auto-detection is a convenience with a fast override, never a constraint.

**Sprites bundled, not fetched** (openly-licensed sprite set, e.g. PokeAPI's), so the overlay works offline and mid-stream.

---

## Legal

ROMs are **loaded from the user's own disk into their own browser** and never uploaded to the server; persist them in IndexedDB/Emscripten FS client-side only. The repo ships **no ROM, and no game-ripped assets**. mGBA is BSD-2-Clause and Ironmon-Tracker is MIT — both are compatible; retain their notices in `packages/data` and the emulator wrapper.

---

## Build phases

Each phase is independently demoable.

**Phase 1 — Memory spike (riskiest, do first).** Stand up mgba-wasm in a bare page, boot Emerald, and prove EWRAM is readable via `instantiateWasm`; fall back to savestate-at-`0x21000` if not. Success: log a live, correctly-decrypted party that updates as you play. *Everything else depends on this; timebox it and settle the approach before building anything on top.*

**Phase 2 — `/play` view.** Monorepo scaffold, `shared` protocol, ROM loading from disk, input, `packages/gba` parser with fixture tests, live own-team panel.

**Phase 3 — Server + two-player state.** Fastify + ws + SQLite, run creation and join codes, both players' state synced and persisted.

**Phase 4 — Video + `/stream` view.** WebRTC signalling, `captureStream` publish, both-canvas subscribe, side-by-side layout with team strips beneath. Verify as a real OBS browser source.

**Phase 5 — Soul-link engine.** Encounter detection, route-name pairing, death detect → alert → confirm → cascade, graveyard.

**Phase 6 — `/pairs` view.** Full pair table with faint status and route, confirm queue, manual re-pair and overrides.

**Phase 7 — Rules.** Dupes clause, species clause via ROM-read evolution table, badge level cap.

**Phase 8 — Randomiser + deploy.** Verify end-to-end on a UPR-ZX ROM, remaining Gen 3 versions, deploy server + TURN.

---

## Verification

**Phase 1 gate:** boot Emerald in the browser, confirm the console logs a resolved EWRAM base and a party whose levels/HP/species match what's on screen, and that HP updates within ~250 ms of taking damage in-game.

**Parser correctness (automated):** unit tests in `packages/gba` for Gen 3 decrypt/parse against known-good byte fixtures, including the `PID % 24` substruct permutation and checksum validation. This is where a silent bug corrupts a run.

**Rules engine (automated):** unit tests driving the server state machine (encounter → pair → death → confirm → cascade) with synthetic snapshot sequences.

**Address resolution:** confirm on Emerald, FireRed 1.1 and a randomised Emerald; soft-reset mid-run and confirm the base re-locks without a page reload.

**Soul link (manual):** two browsers as A and B, faint a Pokémon on A, confirm the alert fires on all three views, and that confirming marks the linked partner dead on B.

**OBS (manual):** add `/stream` as a Browser Source at 1920×1080, confirm both pictures render live, teams sit beneath the correct player, and CPU cost is acceptable while encoding.

---

## Risks and open items

- **`instantiateWasm` heap access is unproven** until the Phase 1 spike. Savestate parsing is a verified fallback with known offsets, so the phase cannot hard-fail — but it may cost more per poll. *This is the only genuine unknown in the plan.*
- **Emulator performance under OBS**: two wasm cores plus WebRTC encode on the streaming machine. Only one core runs locally per player, so this should be fine, but measure in Phase 4.
- **TURN relay** will be needed for some NAT pairs; budget for Cloudflare TURN or a small coturn box.
- **Input latency** in-browser vs native — verify it's acceptable to the players early, in Phase 2, since it affects whether they'll actually want to play this way.
- **`FULL_PLAN.md`** is superseded by this document (its emulator/Lua/bridge architecture no longer applies) and should be deleted.
