/**
 * Evolutionary families, for the dupes and species clauses.
 *
 * Catching a Zigzagoon when you already have a Linoone is still a dupe, so both
 * clauses compare family ids rather than bare species. The family id is the
 * lowest National Dex number in the family (i.e. the base form).
 *
 * These are **vanilla** evolutions, generated from pokeemerald. A UPR-ZX
 * randomised ROM rewrites the evolution table, so they are wrong for a
 * randomised run — which is why a run can turn family grouping off. Reading the
 * real table out of the ROM would need a per-version address for
 * `gEvolutionTable` that nobody appears to have published; see PLAN.md.
 */

import { EVOLUTION_FAMILIES } from "./families.generated.js";

/**
 * Map a National Dex number to its family id.
 * Species with no evolutions are their own family.
 */
export function familyOf(nationalDex: number): number {
  return EVOLUTION_FAMILIES[nationalDex] ?? nationalDex;
}

/** Treats every species as its own family. For randomised ROMs. */
export function exactSpecies(nationalDex: number): number {
  return nationalDex;
}

export { EVOLUTION_FAMILIES };
