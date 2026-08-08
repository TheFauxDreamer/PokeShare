/**
 * Read console RAM out of an mGBA save state.
 *
 * This is the *fallback* path for reading game state. It uses only supported,
 * documented APIs -- `saveStateSlot()` writes a state into the Emscripten FS
 * and `FS.readFile()` reads it back -- so it works against stock
 * @thenick775/mgba-wasm with no fork and no rebuild. The cost is serialising
 * ~390 KB per poll instead of reading the heap in place.
 *
 * Layout verified against mgba-emu/mgba `include/mgba/internal/gba/serialize.h`,
 * where `struct GBASerializedState` is static_assert-ed at 0x61000 bytes:
 *
 *   0x0001C - 0x0001F : Game code (e.g. "BPEE")
 *   0x19000 - 0x20FFF : IWRAM  (32 KB)
 *   0x21000 - 0x60FFF : WRAM   (EWRAM, 256 KB)
 */

import {
  EWRAM_SIZE,
  IWRAM_SIZE,
  RegionMemory,
  type MemorySource,
} from "./memory.js";

export const SAVESTATE_SIZE = 0x61000;
export const SAVESTATE_GAME_CODE_OFFSET = 0x1c;
export const SAVESTATE_IWRAM_OFFSET = 0x19000;
export const SAVESTATE_EWRAM_OFFSET = 0x21000;

/** High 24 bits of `versionMagic`; the low byte is the format version. */
const SAVESTATE_MAGIC = 0x01000000;

export class InvalidSaveStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSaveStateError";
  }
}

/** Format version from the state header, after checking the magic. */
export function saveStateVersion(state: Uint8Array): number {
  const versionMagic =
    (state[0]! |
      (state[1]! << 8) |
      (state[2]! << 16) |
      (state[3]! << 24)) >>>
    0;
  if ((versionMagic & 0xffffff00) >>> 0 !== SAVESTATE_MAGIC) {
    throw new InvalidSaveStateError(
      `Bad save state magic 0x${versionMagic.toString(16)}; ` +
        "the state may be PNG-wrapped -- pass flags=0 to saveStateSlot",
    );
  }
  return versionMagic & 0xff;
}

/**
 * The 4-character game code, read straight from the state header.
 *
 * Convenient because it identifies the ROM without touching the cartridge --
 * randomised ROMs keep their header, so they resolve to their base game.
 */
export function saveStateGameCode(state: Uint8Array): string {
  const bytes = state.subarray(
    SAVESTATE_GAME_CODE_OFFSET,
    SAVESTATE_GAME_CODE_OFFSET + 4,
  );
  return String.fromCharCode(...bytes);
}

/** Build a {@link MemorySource} over a save state's IWRAM and EWRAM. */
export function memoryFromSaveState(state: Uint8Array): MemorySource {
  if (state.length < SAVESTATE_SIZE) {
    throw new InvalidSaveStateError(
      `Save state must be at least ${SAVESTATE_SIZE} bytes, got ${state.length}`,
    );
  }
  saveStateVersion(state);

  return new RegionMemory(
    state.subarray(
      SAVESTATE_EWRAM_OFFSET,
      SAVESTATE_EWRAM_OFFSET + EWRAM_SIZE,
    ),
    state.subarray(
      SAVESTATE_IWRAM_OFFSET,
      SAVESTATE_IWRAM_OFFSET + IWRAM_SIZE,
    ),
  );
}
