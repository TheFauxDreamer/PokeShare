/**
 * Gen 3 stores an *internal* species index that is not the National Dex number.
 *
 *   internal 1..251   -> national 1..251   (Gen 1 + Gen 2, identical)
 *   internal 252..276 -> unused/glitch slots
 *   internal 277..411 -> national 252..386 (Gen 3, shifted by 25)
 *
 * Sprites and names are keyed on National Dex, so everything read out of RAM
 * must go through here first. Randomised ROMs shuffle *which* species appears
 * where but still use these same indices, so this mapping holds for UPR-ZX
 * output too.
 */

export const GEN3_INTERNAL_MAX = 411;
const GEN3_SHIFT = 25;
const GEN2_MAX = 251;
const GEN3_INTERNAL_START = 277;

/** National Dex number, or `undefined` for an empty slot or glitch index. */
export function internalToNationalDex(internal: number): number | undefined {
  if (internal <= 0 || internal > GEN3_INTERNAL_MAX) return undefined;
  if (internal <= GEN2_MAX) return internal;
  if (internal < GEN3_INTERNAL_START) return undefined;
  return internal - GEN3_SHIFT;
}

/** Inverse of {@link internalToNationalDex}. */
export function nationalDexToInternal(national: number): number | undefined {
  if (national <= 0 || national > 386) return undefined;
  if (national <= GEN2_MAX) return national;
  return national + GEN3_SHIFT;
}
