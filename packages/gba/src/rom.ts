/**
 * Reading data tables out of the ROM file itself.
 *
 * A save state contains only RAM — no ROM — so anything living in the
 * cartridge has to come from the file the player loaded. That is fine: the
 * browser already has it.
 *
 * This matters for randomised ROMs. UPR-ZX rewrites gBaseStats in place, so
 * reading types from the cartridge gives the *randomised* types, where a
 * bundled species->type table would be confidently wrong.
 */

import {
  BASE_STATS_STRIDE,
  BASE_STATS_TYPES_OFFSET,
  GEN3_INTERNAL_MAX,
  typeNames,
  type GameLayout,
} from "@pokeshare/data";

/** GBA ROM is mapped at 0x08000000; file offset is the address minus that. */
export const ROM_BASE = 0x08000000;

/** Offset of the 4-character game code in the GBA cartridge header. */
export const ROM_GAME_CODE_OFFSET = 0xac;

export function romGameCode(rom: Uint8Array): string {
  return String.fromCharCode(
    ...rom.subarray(ROM_GAME_CODE_OFFSET, ROM_GAME_CODE_OFFSET + 4),
  );
}

/**
 * The two raw type ids for an internal species index.
 *
 * Returns `undefined` when the entry would fall outside the file, which is what
 * happens if the address table does not match this ROM.
 */
export function readSpeciesTypeIds(
  rom: Uint8Array,
  layout: GameLayout,
  speciesInternal: number,
): readonly [number, number] | undefined {
  // Bound by the real species count, not just by the file length. A large ROM
  // is big enough that a garbage index still lands inside it, and would return
  // a confident-looking type read from unrelated bytes.
  if (speciesInternal <= 0 || speciesInternal > GEN3_INTERNAL_MAX) {
    return undefined;
  }

  const at =
    layout.baseStats -
    ROM_BASE +
    speciesInternal * BASE_STATS_STRIDE +
    BASE_STATS_TYPES_OFFSET;

  if (at < 0 || at + 1 >= rom.length) return undefined;
  return [rom[at]!, rom[at + 1]!];
}

/** Display-ready type names, de-duplicated for single-typed species. */
export function readSpeciesTypes(
  rom: Uint8Array,
  layout: GameLayout,
  speciesInternal: number,
): string[] {
  const ids = readSpeciesTypeIds(rom, layout, speciesInternal);
  return ids ? typeNames(ids[0], ids[1]) : [];
}
