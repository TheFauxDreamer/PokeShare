/**
 * mGBA-wasm wiring and the state polling loop.
 *
 * Reads game state by taking a save state and parsing it, rather than reading
 * the wasm heap. That choice is forced: the shipped core never attaches its
 * heap views to the module object, and it is threaded, so memory is imported
 * from a worker rather than exported. `saveState` + `FS.readFile` are fully
 * supported APIs and the state layout is fixed and verified.
 *
 * At 4 Hz the serialise cost is ~390 KB per poll, which is negligible next to
 * video encoding.
 */

import mGBA, { type mGBAEmulator } from "@thenick775/mgba-wasm";
import { layoutForGameCode, type GameLayout } from "@pokeshare/data";
import {
  memoryFromSaveState,
  readSnapshot,
  saveStateGameCode,
  type GameSnapshot,
} from "@pokeshare/gba";

/** Dedicated slot so polling never clobbers a player's own save states. */
const POLL_SLOT = 9;

/**
 * Save-state flags. Omitting SAVESTATE_SCREENSHOT (bit 0) is essential: with it
 * set, mGBA wraps the state in a PNG and the struct offsets no longer apply.
 */
const SAVESTATE_FLAGS = 0;

export const POLL_INTERVAL_MS = 250;

/** The raw export accepts flags; the typed `saveState` wrapper does not. */
type WithSlotSave = mGBAEmulator & {
  _saveStateSlot?: (slot: number, flags: number) => boolean;
};

export interface Emulator {
  readonly module: mGBAEmulator;
  loadRom(file: File): Promise<void>;
  /** Current game state, or `undefined` before a ROM is running. */
  poll(): GameSnapshot | undefined;
  readonly layout: GameLayout | undefined;
  readonly gameCode: string | undefined;
}

export async function createEmulator(
  canvas: HTMLCanvasElement,
): Promise<Emulator> {
  const module = await mGBA({ canvas });
  await module.FSInit();

  let layout: GameLayout | undefined;
  let gameCode: string | undefined;
  let statePath: string | undefined;

  /** Locate the file `saveState` just wrote, rather than guessing its name. */
  function findStateFile(): string | undefined {
    if (statePath) return statePath;
    const directory = module.filePaths().saveStatePath;
    const entries = module.FS.readdir(directory) as string[];
    const match = entries.find((entry) => entry.endsWith(`.ss${POLL_SLOT}`));
    if (match) statePath = `${directory}/${match}`;
    return statePath;
  }

  return {
    module,

    async loadRom(file: File) {
      await new Promise<void>((resolve) => {
        module.uploadRom(file, () => resolve());
      });
      module.loadGame(`${module.filePaths().gamePath}/${file.name}`);
      // A new ROM means a new state file and possibly a different game.
      statePath = undefined;
      layout = undefined;
      gameCode = undefined;
    },

    poll() {
      const withSlot = module as WithSlotSave;
      const saved =
        withSlot._saveStateSlot?.(POLL_SLOT, SAVESTATE_FLAGS) ??
        module.saveState(POLL_SLOT);
      if (!saved) return undefined;

      const path = findStateFile();
      if (!path) return undefined;

      const bytes = module.FS.readFile(path) as Uint8Array;
      const memory = memoryFromSaveState(bytes);

      if (!layout) {
        gameCode = saveStateGameCode(bytes);
        layout = layoutForGameCode(gameCode);
        if (!layout) {
          throw new Error(
            `Unsupported game code "${gameCode}". PokeShare supports Gen 3 ` +
              "(Ruby, Sapphire, Emerald, FireRed, LeafGreen) and their hacks.",
          );
        }
      }

      return readSnapshot(memory, layout);
    },

    get layout() {
      return layout;
    },
    get gameCode() {
      return gameCode;
    },
  };
}
