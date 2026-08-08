/**
 * Gen 3 elemental types.
 *
 * Type ids are read out of the ROM's base-stats table rather than a bundled
 * species->type map, because UPR-ZX can randomise types. A static table would
 * be silently wrong for exactly the runs this project is built for.
 */

export const TYPE_NONE = 255;

/** Index is the in-game type id. 9 is the unused "Mystery" slot. */
export const TYPE_NAMES: Readonly<Record<number, string>> = {
  0: "Normal",
  1: "Fighting",
  2: "Flying",
  3: "Poison",
  4: "Ground",
  5: "Rock",
  6: "Bug",
  7: "Ghost",
  8: "Steel",
  9: "Mystery",
  10: "Fire",
  11: "Water",
  12: "Grass",
  13: "Electric",
  14: "Psychic",
  15: "Ice",
  16: "Dragon",
  17: "Dark",
};

export function typeName(id: number): string | undefined {
  return TYPE_NAMES[id];
}

/**
 * Collapse a (type1, type2) pair into display order.
 *
 * Single-typed Pokemon store the same id twice, so the duplicate is dropped.
 */
export function typeNames(type1: number, type2: number): string[] {
  const first = typeName(type1);
  const second = typeName(type2);
  if (!first) return second ? [second] : [];
  if (!second || type1 === type2) return [first];
  return [first, second];
}
