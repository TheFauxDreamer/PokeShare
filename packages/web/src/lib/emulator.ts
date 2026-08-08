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
  readSpeciesTypes,
  saveStateGameCode,
  type GameSnapshot,
} from "@pokeshare/gba";
import { applyBindings, loadBindings, type Bindings } from "./input.js";

/** Dedicated slot so polling never clobbers a player's own save states. */
const POLL_SLOT = 9;

/**
 * Save-state flags. Omitting SAVESTATE_SCREENSHOT (bit 0) is essential: with it
 * set, mGBA wraps the state in a PNG and the struct offsets no longer apply.
 */
const SAVESTATE_FLAGS = 0;

export const POLL_INTERVAL_MS = 250;

/** Normal speed. Fast-forward is a multiplier above this. */
const NORMAL_SPEED = 1;

/** The raw export accepts flags; the typed `saveState` wrapper does not. */
type WithSlotSave = mGBAEmulator & {
  _saveStateSlot?: (slot: number, flags: number) => boolean;
};

export interface Emulator {
  readonly module: mGBAEmulator;
  loadRom(file: File): Promise<void>;
  /** Re-apply bindings without reloading the ROM. */
  setBindings(bindings: Bindings): void;
  /** `1` is normal speed; higher is faster. */
  setSpeed(multiplier: number): void;
  /** Elemental types for an internal species index, read from the ROM. */
  typesFor(speciesInternal: number): string[];
  /**
   * Flush the emulator filesystem to IndexedDB.
   *
   * The in-game save (the battery save the cartridge would hold) lives in an
   * IDBFS mount that only reaches durable storage when this is called. Without
   * it, closing the tab loses the save — hours of a Nuzlocke, silently.
   */
  syncSaves(): Promise<void>;
  /** Current game state, or `undefined` before a ROM is running. */
  poll(): GameSnapshot | undefined;
  readonly layout: GameLayout | undefined;
  readonly gameCode: string | undefined;
}

/**
 * Take a save state and return its raw bytes.
 *
 * The directory is listed rather than the filename being guessed, because the
 * naming convention is mGBA's business and is not part of the documented API.
 * Listing an in-memory FS directory is far cheaper than the serialise itself,
 * so doing it every poll costs nothing and avoids a stale path when the player
 * switches ROMs.
 */
export function readRawState(module: mGBAEmulator): Uint8Array | undefined {
  const withSlot = module as WithSlotSave;
  const saved =
    withSlot._saveStateSlot?.(POLL_SLOT, SAVESTATE_FLAGS) ??
    module.saveState(POLL_SLOT);
  if (!saved) return undefined;

  const directory = module.filePaths().saveStatePath;
  const entries = module.FS.readdir(directory) as string[];
  const match = entries.find((entry) => entry.endsWith(`.ss${POLL_SLOT}`));
  if (!match) return undefined;

  return module.FS.readFile(`${directory}/${match}`) as Uint8Array;
}

export async function createEmulator(
  canvas: HTMLCanvasElement,
): Promise<Emulator> {
  const module = await mGBA({ canvas });
  await module.FSInit();

  let layout: GameLayout | undefined;
  let gameCode: string | undefined;
  // The cartridge itself, kept because save states contain no ROM and the
  // base-stats table (types) lives there.
  let rom: Uint8Array | undefined;

  return {
    module,

    async loadRom(file: File) {
      await new Promise<void>((resolve) => {
        module.uploadRom(file, () => resolve());
      });
      rom = new Uint8Array(await file.arrayBuffer());

      const romPath = `${module.filePaths().gamePath}/${file.name}`;
      // loadGame returns false rather than throwing, so an unchecked call
      // presents as a permanently black canvas with no explanation.
      if (!module.loadGame(romPath)) {
        throw new Error(
          `mGBA refused to load "${file.name}". It may not be a valid GBA ROM, ` +
            "or it may be zipped — pass the raw .gba file.",
        );
      }

      // Bind keys and enable input explicitly; the core's defaults are not
      // part of its documented API.
      applyBindings(module, loadBindings());
      module.toggleInput(true);

      // A new ROM may be a different game entirely.
      layout = undefined;
      gameCode = undefined;
    },

    typesFor(speciesInternal: number) {
      if (!rom || !layout) return [];
      return readSpeciesTypes(rom, layout, speciesInternal);
    },

    async syncSaves() {
      await module.FSSync();
    },

    setBindings(bindings: Bindings) {
      applyBindings(module, bindings);
    },

    setSpeed(multiplier: number) {
      module.setFastForwardMultiplier(Math.max(multiplier, NORMAL_SPEED));
    },

    poll() {
      const bytes = readRawState(module);
      if (!bytes) return undefined;
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
