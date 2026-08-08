/**
 * Per-version RAM layouts for the Gen 3 games.
 *
 * Addresses are ported from besteon/Ironmon-Tracker (MIT), which has the
 * best-tested Gen 3 address tables in the wild. See NOTICE.md.
 *
 * Two things here routinely surprise people, so they are called out:
 *
 *  1. Ruby/Sapphire keep the party in **IWRAM** (0x03xxxxxx), while Emerald and
 *     FR/LG keep it in **EWRAM** (0x02xxxxxx). Any reader must handle both.
 *  2. The enemy party is *not* at `playerParty + 600` on FR/LG -- it sits
 *     *below* the player party. Always use the explicit address.
 *
 * ROM revisions within a family (FireRed 1.0 vs 1.1, Ruby 1.0/1.1/1.2) share
 * identical addresses, so the 4-character game code at ROM offset 0xAC is
 * sufficient to identify a layout.
 */

/** Which generated MAPSEC table a game's `regionMapSectionId` indexes into. */
export type MapSecTable = "RS" | "EMERALD" | "FRLG";

/**
 * Ruby/Sapphire address SaveBlock1 directly; Emerald and FR/LG store a pointer
 * to it (the block moves as an anti-corruption measure).
 */
export type SaveBlockRef =
  | { readonly kind: "direct"; readonly address: number }
  | { readonly kind: "pointer"; readonly address: number };

export interface GameLayout {
  readonly code: string;
  readonly name: string;
  readonly mapSecTable: MapSecTable;
  /** Start of the 6 x 100-byte party array. */
  readonly playerParty: number;
  /** Start of the opposing party. Used to identify a wild encounter's species. */
  readonly enemyParty: number;
  /** u8: number of Pokemon in the player's party (1-6). A cheap sanity oracle. */
  readonly playerPartyCount: number;
  /** struct MapHeader; `regionMapSectionId` is the u8 at +0x14. */
  readonly mapHeader: number;
  /** u32 bitfield describing the current battle (wild, trainer, double, ...). */
  readonly battleTypeFlags: number;
  readonly saveBlock1: SaveBlockRef;
  /** Offset from SaveBlock1 to the byte containing FLAG_BADGE01_GET. */
  readonly badgeOffset: number;
  /**
   * Bit position of FLAG_BADGE01_GET within that byte.
   *
   * Not always 0, and getting it wrong counts unrelated system flags as
   * badges. Derived from the decomps:
   *
   *   Emerald  FLAG_BADGE01_GET = 0x860 + 0x7  = 0x867 -> byte 0x10C, bit 7
   *   Ruby/Sap FLAG_BADGE01_GET = 0x800 + 0x07 = 0x807 -> byte 0x100, bit 7
   *   FR/LG    FLAG_BADGE01_GET = 0x800 + 0x20 = 0x820 -> byte 0x104, bit 0
   *
   * With a bit offset of 7 the eight badge flags straddle two bytes, so the
   * reader must take 16 bits and shift.
   */
  readonly badgeBitOffset: number;
}

/** Offset of `regionMapSectionId` within struct MapHeader. */
export const MAP_HEADER_REGION_MAPSEC_OFFSET = 0x14;

/** Set in `battleTypeFlags` when the current battle is against a trainer. */
export const BATTLE_TYPE_TRAINER = 0x08;

const EMERALD: GameLayout = {
  code: "BPEE",
  name: "Pokémon Emerald",
  mapSecTable: "EMERALD",
  playerParty: 0x020244ec,
  enemyParty: 0x02024744,
  playerPartyCount: 0x020244e9,
  mapHeader: 0x02037318,
  battleTypeFlags: 0x02022fec,
  saveBlock1: { kind: "pointer", address: 0x03005d8c },
  badgeOffset: 0x137c,
  badgeBitOffset: 7,
};

const FIRERED: GameLayout = {
  code: "BPRE",
  name: "Pokémon FireRed",
  mapSecTable: "FRLG",
  playerParty: 0x02024284,
  enemyParty: 0x0202402c,
  playerPartyCount: 0x02024029,
  mapHeader: 0x02036dfc,
  battleTypeFlags: 0x02022b4c,
  saveBlock1: { kind: "pointer", address: 0x03005008 },
  badgeOffset: 0xfe4,
  badgeBitOffset: 0,
};

const LEAFGREEN: GameLayout = {
  ...FIRERED,
  code: "BPGE",
  name: "Pokémon LeafGreen",
};

const RUBY: GameLayout = {
  code: "AXVE",
  name: "Pokémon Ruby",
  mapSecTable: "RS",
  playerParty: 0x03004360,
  enemyParty: 0x030045c0,
  playerPartyCount: 0x03004350,
  mapHeader: 0x0202e828,
  battleTypeFlags: 0x020239f8,
  saveBlock1: { kind: "direct", address: 0x02025734 },
  badgeOffset: 0x1320,
  badgeBitOffset: 7,
};

const SAPPHIRE: GameLayout = {
  ...RUBY,
  code: "AXPE",
  name: "Pokémon Sapphire",
};

export const GAME_LAYOUTS: readonly GameLayout[] = [
  EMERALD,
  FIRERED,
  LEAFGREEN,
  RUBY,
  SAPPHIRE,
];

/**
 * Resolve a layout from the 4-character game code at ROM offset 0xAC.
 *
 * UPR-ZX randomised ROMs keep their header intact, so they resolve to their
 * base game automatically -- randomisation rewrites data tables, not the
 * party struct or the map list.
 */
export function layoutForGameCode(code: string): GameLayout | undefined {
  return GAME_LAYOUTS.find((layout) => layout.code === code);
}
