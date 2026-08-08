/**
 * Gen 3 stores an *internal* species index that is not the National Dex number.
 *
 * The internal ordering is NOT National Dex ordering, and the difference is not
 * a fixed offset. Treecko happens to land at internal 277 -> national 252,
 * which makes a naive "subtract 25" look right, but 109 of the 386 species
 * break it:
 *
 *     SPECIES_NINCADA = 301 (internal)  ->  national 290, not 276
 *
 * So the mapping is a generated table, joined from pokeemerald's species.h and
 * pokedex.h. See scripts/gen-species.py.
 *
 * Randomised ROMs shuffle *which* species appears where but still use these
 * same internal indices, so this holds for UPR-ZX output too.
 */

import { INTERNAL_TO_NATIONAL } from "./species.generated.js";

export const GEN3_INTERNAL_MAX = 411;
export const NATIONAL_DEX_MAX = 386;

/** Reverse lookup, built once. The forward table is a bijection. */
const NATIONAL_TO_INTERNAL: Readonly<Record<number, number>> = Object.freeze(
  Object.fromEntries(
    Object.entries(INTERNAL_TO_NATIONAL).map(([internal, national]) => [
      national,
      Number(internal),
    ]),
  ),
);

/**
 * National Dex number, or `undefined` for an empty slot, a glitch index
 * (internal 252-276, the OLD_UNOWN placeholders) or an out-of-range value.
 */
export function internalToNationalDex(internal: number): number | undefined {
  return INTERNAL_TO_NATIONAL[internal];
}

/** Inverse of {@link internalToNationalDex}. */
export function nationalDexToInternal(national: number): number | undefined {
  return NATIONAL_TO_INTERNAL[national];
}

export { INTERNAL_TO_NATIONAL };
