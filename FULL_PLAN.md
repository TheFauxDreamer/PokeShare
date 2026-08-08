# PokeShare — Multiplayer Soul Link Nuzlocke Tracker

## Context

Two friends run co-op Nuzlockes, each livestreaming/recording their own perspective. The two feeds get composited side by side, with each player's team shown beneath their own gameplay. Today there's nothing driving those team displays — they'd have to be updated by hand mid-run, which is exactly the thing you can't do while playing.

PokeShare fixes that. A Lua script inside each player's emulator reads the live party out of game RAM and pushes it to a shared cloud server. Each player points OBS at a transparent browser-source overlay that renders their own team, kept in sync automatically. Because both players talk to the same server, it also enforces the **Soul Link**: when one player's Pokémon dies, its linked partner on the other side dies too, on both overlays, instantly.

The repo is currently empty (`README.md` only), so this is greenfield.

**Decisions locked in with the user:**

| Decision | Choice |
|---|---|
| Data entry | Auto-read from emulator RAM |
| Ruleset | Soul Link |
| Hosting | Free cloud deploy |
| Overlay content | Party of 6 + sprites, soul-link partner badge, graveyard/death counter, badges + level cap |
| Death marking | Auto-detect, then confirm in control panel |
| Pairing | Auto-pair by route |
| First game | **Pokémon Emerald Rogue** (Emerald-based ROM hack) |
| Emulator | mGBA first, BizHawk after |
| Future scope | All GBA, then DS, then 3DS |

---

## Research findings that shape the design

Four findings from surveying prior art changed the plan materially. They're worth reading before the architecture.

**1. Existing projects each solve half the problem, none solve this one.**
- [jynnie/soullocke](https://github.com/jynnie/soullocke) (Next.js + Firebase) — good soul-link data model and real-time multi-player sync, but **fully manual entry, no OBS overlay**.
- [yeager-j/old.nuzlocke.gg](https://github.com/yeager-j/old.nuzlocke.gg), [EladKarni/soul-link](https://github.com/EladKarni/soul-link), [soopercool101/soullink-nuzlocke-tracker](https://github.com/soopercool101/soullink-nuzlocke-tracker) — same shape: manual soul-link trackers.
- [besteon/Ironmon-Tracker](https://github.com/besteon/Ironmon-Tracker) (MIT) — **battle-tested Gen 3 RAM reading** for FRLG/RSE on BizHawk + mGBA. This is the single best reference for the Lua side. Single-player, local drawing only, no network.
- [EverOddish/PokeStreamer-Tools](https://github.com/EverOddish/PokeStreamer-Tools) — closest prior art (Lua → OBS for Gen 3–7), but **archived and unmaintained since 2022**, and syncs by swapping sprite files on disk rather than pushing structured state.
- [JacenBoy/Nuzlocke-Stream-Dashboard](https://github.com/JacenBoy/Nuzlocke-Stream-Dashboard) — C#/WinForms, manual, Gen 6 cap, 9 commits.

Nothing combines **RAM auto-read + two-player sync + OBS overlay**. Reuse the Gen 3 memory knowledge from Ironmon-Tracker (MIT, compatible); build the rest.

**2. Emerald Rogue is a roguelike, which breaks "auto-pair by route" as literally specified.**
Routes are *procedurally generated and randomised in order* every run — one player's third route and the other player's third route are different places with different names. Pairing on route *name* would never match. It also has **no PC**: adding a Pokémon means permanently sacrificing another, and fainting removes a Pokémon from the run for good.

Adaptation (this is a deviation from the literal answer, and the reason for it):
- Pair on **route ordinal within the run** (both players' 1st route pairs with each other, 2nd with 2nd, …), not route name. This preserves the intent of "auto-pair by route" in a game where route names are meaningless.
- Replace the "boxed" state with **released/sacrificed**, and make the confirm prompt ask *died* vs *released* — because in Rogue a Pokémon vanishing from the party is ambiguous between the two.
- Level cap is built into the game per area, so it can eventually be read from RAM rather than configured by hand.

**3. Emerald Rogue is decomp-based, so the party address is not at the vanilla location.**
It's built from [Pokabbie/pokeemerald-rogue](https://github.com/Pokabbie/pokeemerald-rogue), a full decompilation. Vanilla Emerald has `gPlayerParty` at a fixed `0x020244EC`; a decomp hack relocates it, and it moves again on every release. Hardcoding an address would break on each update.

Solution: a **runtime signature scanner** that finds the party by scanning EWRAM for a structurally valid party block (details below). This costs a little more upfront but pays off enormously — the same scanner works on vanilla Emerald, FRLG, RSE, *and* every Gen 3 hack, without per-ROM maintenance. That directly serves the "all GBA in future" goal.

**4. The Gen 3 party structure is fully documented, and conveniently split.**
Per [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_data_structure_(Generation_III)), each party slot is 100 bytes:

| Range | Encrypted? | Contents |
|---|---|---|
| `0x00–0x1F` | No | Personality Value (PID) `0x00`, OT ID `0x04`, nickname `0x08`, checksum `0x1C` |
| `0x20–0x4F` | **Yes** | 4 × 12-byte substructures: Growth (species, item, exp), Attacks, EVs, Misc |
| `0x50–0x63` | No | Status `0x50`, **level `0x54`**, **current HP `0x56`**, **max HP `0x58`**, stats |

The fields that matter most for a Nuzlocke — level, current HP, max HP, status — are **unencrypted**. Only species/item require decryption: XOR the data section with `PID XOR OTID`, with substructure order given by `PID % 24`. The `0x1C` checksum gives a free correctness check, which is what makes the signature scanner reliable.

**PID (`u32` at offset `0x00`) is a stable unique identity** that survives nickname changes, level-ups, and party reordering. Use it as the primary key for every Pokémon across the whole system.

---

## Architecture

Lua is a **dumb sensor**. It reads RAM and emits normalised snapshots. It knows nothing about Nuzlocke rules, soul links, or deaths. All game logic lives on the server. This is what keeps per-game work small: adding Gen 4 later means writing one new adapter, not touching any rules code.

```
 PLAYER A                                            PLAYER B
┌────────────────────────┐                    ┌────────────────────────┐
│ mGBA + pokeshare.lua   │                    │ mGBA + pokeshare.lua   │
│  scans EWRAM → party   │                    │                        │
└───────────┬────────────┘                    └───────────┬────────────┘
            │ TCP, line-delimited JSON (127.0.0.1:4321)   │
┌───────────▼────────────┐                    ┌───────────▼────────────┐
│ pokeshare-bridge       │  (tiny local Node) │ pokeshare-bridge       │
└───────────┬────────────┘                    └───────────┬────────────┘
            │ WSS (TLS)                                   │ WSS
            └──────────────────┬──────────────────────────┘
                               ▼
                 ┌──────────────────────────────┐
                 │   PokeShare Server (Fly.io)  │
                 │  · run + encounter state     │
                 │  · soul-link pairing         │
                 │  · death detect + confirm    │
                 │  · SQLite (persistent vol)   │
                 └──────────────┬───────────────┘
                                │ WebSocket fan-out
         ┌──────────────┬───────┴───────┬──────────────┐
         ▼              ▼               ▼              ▼
   Overlay A       Overlay B     Control Panel   Control Panel
  (OBS browser)   (OBS browser)    (A, phone)     (B, phone)
```

**Why the local bridge exists (it is not optional):** the cloud server is HTTPS/WSS, and emulator Lua has no TLS. mGBA's Lua socket API is raw TCP; BizHawk's `comm.*` is quirkier still (length-prefixed protocol, null-byte truncation). The bridge is ~150 lines whose entire job is terminating plain TCP locally and speaking WSS outward. It also isolates every emulator quirk in one place, so the server protocol stays clean.

---

## Repo layout

pnpm workspaces monorepo, TypeScript everywhere except the Lua script.

```
PokeShare/
├── packages/
│   ├── shared/          # protocol types + zod schemas — single source of truth
│   ├── server/          # Fastify + ws + better-sqlite3 (cloud)
│   ├── bridge/          # local TCP↔WSS relay, minimal deps
│   └── web/             # Vite + React: overlay AND control panel
├── lua/
│   ├── pokeshare.lua            # entry point + main loop
│   ├── transport/
│   │   ├── detect.lua           # which emulator am I running in?
│   │   ├── mgba.lua             # socket.tcp()
│   │   └── bizhawk.lua          # comm.socketServerSend  (Phase 7)
│   ├── games/
│   │   ├── registry.lua         # ROM header/CRC → adapter
│   │   ├── scanner.lua          # ★ generic EWRAM party signature scan
│   │   └── gen3/
│   │       ├── base.lua         # decrypt + parse (shared by all Gen 3)
│   │       ├── emerald.lua      # BPEE
│   │       ├── firered.lua      # BPRE
│   │       ├── rubysapphire.lua # AXVE/AXPE
│   │       └── hacks/emerald_rogue.lua
│   └── lib/json.lua
└── assets/sprites/      # bundled locally — no CDN, works offline
```

### The adapter contract

Every game adapter — Gen 3 today, Gen 4/5 later — implements one interface. The server is unaware which one is loaded.

```lua
adapter.detect(romCode, romCrc) -> boolean
adapter.readParty()    -> { { pid, species, nickname, level, hp, maxHp,
                             status, item, shiny, gender }, ... }
adapter.readLocation() -> { mapId, mapName }
adapter.readBadges()   -> number
adapter.readPlayer()   -> { name, trainerId }
```

---

## Key technical decisions

**Signature scanner (`lua/games/scanner.lua`)** — the load-bearing piece.
Scan EWRAM (`0x02000000`–`0x02040000`, 256 KB) on 4-byte alignment for a candidate 100-byte block, validating:
1. Decrypt the `0x20–0x4F` section; verify its sum matches the checksum at `0x1C`.
2. Level at `0x54` is 1–100.
3. `currentHP ≤ maxHP`, `maxHP` within sane bounds.
4. Species (from decrypted Growth) is non-zero and within the ROM's species range.
5. Between 1 and 6 *consecutive* valid blocks confirm a real party.

Cache the hit; re-scan only if validation fails for N consecutive frames (i.e. the game reloaded or the address moved). Poll at ~4 Hz, not per-frame — overlay latency of 250 ms is invisible on stream and keeps emulator overhead near zero while OBS is encoding.

**Send diffs, not snapshots.** Lua hashes the party each poll and transmits only on change. An idle run generates near-zero traffic.

**Server owns all rules.** State transitions it derives from raw snapshots:
- Unseen PID appears in party → **new encounter**, tagged with the current route ordinal → attempt auto-pair against the partner's encounter at the same ordinal.
- `hp` transitions `>0 → 0` → emit `death_pending` → control panel confirms → on confirm, **cascade the death to the soul-link partner** and push to both overlays.
- A PID disappears from the party → prompt *died* or *released* (Emerald Rogue has no PC, so both are permanent and RAM alone can't distinguish them).
- Badge count increases → advance level cap.

**Auto-pair drift is expected, so make correcting it a single click.** If one player whiffs an encounter, ordinals desync. The control panel gets an explicit "no encounter here" button plus manual re-pair. Auto-pairing is a convenience with a fast override, never a constraint.

**Sprites are bundled, not fetched.** A strict local asset set under `assets/sprites/` means the overlay works offline and mid-stream, and Emerald Rogue EX's Gen 9 species are handled by a species-ID → sprite override map rather than by hoping a remote API knows the hack's IDs.

**Two overlay variants, one build.** `/overlay?run=<id>&player=a` renders transparent, `body { background: transparent }`, sized for a strip beneath gameplay. Control panel is the same Vite app under `/panel`, designed for a phone or second monitor so it never occupies capture space.

---

## Build phases

Each phase is independently demoable. Phases 1–5 are the actual deliverable; 6–8 are the "all games" expansion.

**Phase 1 — Vertical slice.** Monorepo scaffold, `shared` protocol types, server with WS fan-out + SQLite, bridge, `pokeshare.lua` with the signature scanner, and a bare overlay showing 6 slots with sprites, nickname, level, HP bar. *Target on vanilla Emerald first* — species 1–386 are fully known, so the pipeline gets proven with zero hack unknowns. Success: launch Emerald in mGBA, the browser shows the live party updating.

**Phase 2 — Nuzlocke engine.** Encounter detection by PID, death detection on HP→0, the pending-death confirm queue, released-vs-died disambiguation, graveyard persistence.

**Phase 3 — Soul Link.** Two-player runs, route-ordinal auto-pairing, death cascade to partner, manual re-pair, "no encounter" skip.

**Phase 4 — Control panel.** Run setup + join codes, death confirmation prompts, re-pairing UI, manual overrides for everything the RAM read gets wrong, level-cap config.

**Phase 5 — Overlay polish.** All four requested elements: party + sprites, soul-link partner badge on each slot, graveyard/combined death counter, badge row + level cap. Plus fainted-state styling, theming, and layout presets sized for a side-by-side composite.

**Phase 6 — Emerald Rogue adapter.** Species table for EX (Gen 1–9 IDs), sprite overrides, run-progress/route-ordinal reading, in-game level cap. Also investigate [Pokabbie/pokeemerald-rogue-assistant](https://github.com/Pokabbie/pokeemerald-rogue-assistant) — the hack author's own BizHawk/Lua tool, which may expose a supported data path that beats scanning. Treated as an optimisation, not a dependency, since it's thinly documented.

**Phase 7 — Cloud deploy + BizHawk transport.** Fly.io with a persistent volume, run-scoped join codes, `comm.socketServerSend` transport (needed for DS later anyway).

**Phase 8 — Later generations.** Gen 4/5 adapters on BizHawk's melonDS core; DS party blocks are encrypted *and* block-shuffled, so this is real work — [DevreeseJorik/universal-ds-lua-script](https://github.com/DevreeseJorik/universal-ds-lua-script) and [dude22072/PokeStats](https://github.com/dude22072/PokeStats) have usable offsets. 3DS is genuinely uncertain: it needs a scripting-capable Citra fork, and mainline Citra is defunct. Flag as research-first, not committed.

---

## Verification

**Phase 1 gate (end-to-end, no test framework needed):**
1. `pnpm dev` — server on :8080, bridge on :4321, web on :5173.
2. Open vanilla Emerald in mGBA 0.10+, load `lua/pokeshare.lua` via Tools → Scripting.
3. Confirm the Lua console logs a resolved party address from the scanner.
4. Open `http://localhost:5173/overlay?run=test&player=a` — party renders.
5. In-game: level up, swap party order, faint a Pokémon → overlay reflects each within ~250 ms.

**Scanner robustness (the riskiest component):** verify address resolution on vanilla Emerald, FireRed, and Emerald Rogue; then soft-reset mid-run and confirm it re-locks without restarting the script.

**Soul Link (Phase 3):** run two emulator instances locally as players A and B, kill a Pokémon on A, confirm the prompt appears and that accepting it kills the linked partner on B's overlay.

**OBS (Phase 5):** add the overlay URL as a Browser Source at 1920×300, confirm the background is genuinely transparent over gameplay, and confirm CPU cost is negligible while encoding.

**Automated:** unit tests on the Gen 3 decrypt/parse against known-good byte fixtures, and on the server's state machine (encounter → death → cascade) with synthetic snapshot sequences. These are the two places where a silent bug would corrupt a run.

---

## Open items

- **Emerald Rogue version**: EX (Gen 1–9 species) vs Vanilla (Gen 3 mechanics) affects the size of the species/sprite table in Phase 6. Will confirm before starting that phase — it doesn't block Phases 1–5.
- **Route-ordinal source**: Phase 3 can pair on server-counted map transitions with no hack-specific RAM. Reading Rogue's own run-progress counter is a Phase 6 refinement.
- **3DS support** is explicitly research-first; not committed until a scriptable emulator is confirmed viable.
