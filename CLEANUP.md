# Cleaning up

Everything this project put on your Mac, and how to remove it.

Sizes measured on this machine; yours will be close.

---

## 1. Safe to delete any time (regenerable)

These come back with `pnpm install` / `pnpm build`. Deleting them costs nothing
but a reinstall.

| Path | Size | What it is |
|---|---|---|
| `PokeShare/node_modules` | 124 MB | Installed dependencies |
| `PokeShare/packages/*/node_modules` | ~3 MB | Per-package deps |
| `PokeShare/packages/web/dist` | 3.8 MB | Built site |
| `PokeShare/packages/*/dist` | small | Compiled TypeScript |
| `PokeShare/**/*.tsbuildinfo` | small | Incremental build cache |

```bash
cd ~/Documents/GitHub/PokeShare
rm -rf node_modules packages/*/node_modules packages/*/dist packages/web/dist
find . -name '*.tsbuildinfo' -delete
```

**Not** regenerable from the repo alone: `packages/web/public/sprites` (1.5 MB)
is fetched from the network by `scripts/fetch-sprites.sh`, and the generated
data tables under `packages/data/src/*.generated.ts` come from `pnpm gen`. Both
need internet to rebuild, so keep them if you might work offline.

---

## 2. Your run data

| Path | What it is |
|---|---|
| `PokeShare/data/runs/*.json` | Saved Soul Link runs — pairs, deaths, routes |

**This is the only irreplaceable thing here.** Deleting it loses run history.
It is git-ignored, so it is not in any commit.

```bash
rm -rf ~/Documents/GitHub/PokeShare/data
```

---

## 3. The project itself

```bash
rm -rf ~/Documents/GitHub/PokeShare
```

Push anything you want to keep first — the GitHub remote is
`TheFauxDreamer/PokeShare`.

Your **ROMs are not in here**. They were only ever loaded into the browser's
memory, never written to the project directory.

---

## 4. Package-manager caches — safe to delete right now

**By far the biggest thing on this list.** These are pure download caches. They
refill on demand, so deleting them costs nothing but re-downloading later, and
you can do it without touching Node itself.

| Path | Size | What it is |
|---|---|---|
| `~/.npm` | **708 MB** | npm's cache. `_cacache` (589 MB) is downloaded packages; `_npx` (111 MB) is every tool run via `npx`, e.g. `npx tsx` |
| `~/Library/Caches/node-gyp` | 62 MB | Node headers kept for building native modules |

```bash
rm -rf ~/.npm ~/Library/Caches/node-gyp
```

Safe even if you keep using Node. Worth doing periodically regardless — `~/.npm`
grows without limit and nothing prunes it automatically.

---

## 5. The Node toolchain — read before deleting

These were installed *for* this project, but they are shared tools. **If you use
Node for anything else on this Mac, do not remove them.**

| Path | Size | What it is |
|---|---|---|
| `~/.nvm` | 215 MB | nvm, Node 22.23.2, **and npm** — npm ships inside Node, so this removes it |
| `~/Library/pnpm` | 113 MB | pnpm's global package store |
| `~/.cache/node/corepack` | 19 MB | corepack's cached pnpm versions |

**~347 MB total.**

There is no separate npm to uninstall: `which npm` resolves to
`~/.nvm/versions/node/v22.23.2/bin/npm`, so it goes when nvm does.

Before removing anything, check whether other projects rely on Node:

```bash
node -v && which -a node
```

If you are sure:

```bash
rm -rf ~/.nvm ~/Library/pnpm ~/.cache/node/corepack
```

That also removes npm and npx.

Then remove the three lines nvm appended to `~/.zshrc` (currently lines 9-11):

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
```

Open a new Terminal afterwards; `node` should report "command not found".

Nothing was installed outside your home directory, and nothing needed `sudo`,
so there is nothing to clean up in `/usr/local` or `/Library`.

---

## 6. Browser storage

The app stores a little data per browser profile, under `localhost:5173`:

- `pokeshare.clientId.*` — which player seat you own
- `pokeshare.bindings` — your key bindings
- The emulator's in-memory filesystem, holding **the ROM you loaded** and its
  save files

Clear it from the browser: **Developer Tools → Application → Storage → Clear
site data**, or just delete the site data for `localhost` in your browser's
settings. Worth doing if you would rather not leave a ROM in browser storage.

---

## 7. Temporary files

Scratch files created while building and testing. `/tmp` clears itself on
reboot, so this is optional:

```bash
rm -rf /tmp/ps-data /tmp/ps-data2 /tmp/ps-seat /tmp/pe_tree.json /tmp/s?.log /tmp/vite*.log
```

---

## Everything, in order

```bash
# 1. Keep your runs?  cp -r ~/Documents/GitHub/PokeShare/data ~/Desktop/pokeshare-runs
# 2. Push anything unpushed.
rm -rf ~/Documents/GitHub/PokeShare
rm -rf /tmp/ps-data /tmp/ps-data2 /tmp/ps-seat /tmp/pe_tree.json /tmp/s?.log /tmp/vite*.log
# 3. Caches — safe even if you keep Node:
rm -rf ~/.npm ~/Library/Caches/node-gyp
# 4. Only if you do not use Node elsewhere:
rm -rf ~/.nvm ~/Library/pnpm ~/.cache/node/corepack
#    ...then delete the three NVM_DIR lines from ~/.zshrc
# 5. Clear localhost site data in your browser.
```

Reclaims roughly **1.25 GB**.
