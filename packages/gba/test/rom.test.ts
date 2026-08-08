/**
 * Reading elemental types out of the ROM's base-stats table.
 *
 * Done from the cartridge rather than a bundled species->type map because
 * UPR-ZX can randomise types: a static table would be confidently wrong for
 * exactly the runs this is built for.
 */

import { describe, expect, it } from "vitest";
import {
  BASE_STATS_STRIDE,
  BASE_STATS_TYPES_OFFSET,
  layoutForGameCode,
} from "@pokeshare/data";
import { ROM_BASE, readSpeciesTypeIds, readSpeciesTypes, romGameCode } from "../src/rom.js";

const EMERALD = layoutForGameCode("BPEE")!;

const TYPE_WATER = 11;
const TYPE_GROUND = 4;
const TYPE_NORMAL = 0;

/** A ROM with types planted for one internal species index. */
function romWithTypes(
  speciesInternal: number,
  type1: number,
  type2: number,
  layout = EMERALD,
): Uint8Array {
  const rom = new Uint8Array(0x1000000);
  const at =
    layout.baseStats -
    ROM_BASE +
    speciesInternal * BASE_STATS_STRIDE +
    BASE_STATS_TYPES_OFFSET;
  rom[at] = type1;
  rom[at + 1] = type2;
  return rom;
}

describe("species types from ROM", () => {
  it("reads a dual-typed species", () => {
    // Swampert is internal 285; Water/Ground in vanilla.
    const rom = romWithTypes(285, TYPE_WATER, TYPE_GROUND);
    expect(readSpeciesTypeIds(rom, EMERALD, 285)).toEqual([
      TYPE_WATER,
      TYPE_GROUND,
    ]);
    expect(readSpeciesTypes(rom, EMERALD, 285)).toEqual(["Water", "Ground"]);
  });

  it("collapses a single-typed species, which stores its type twice", () => {
    const rom = romWithTypes(283, TYPE_WATER, TYPE_WATER); // Mudkip
    expect(readSpeciesTypes(rom, EMERALD, 283)).toEqual(["Water"]);
  });

  it("reads whatever the cartridge says, including randomised types", () => {
    // A randomiser could make Mudkip Normal/Dark; nothing here assumes vanilla.
    const rom = romWithTypes(283, TYPE_NORMAL, 17);
    expect(readSpeciesTypes(rom, EMERALD, 283)).toEqual(["Normal", "Dark"]);
  });

  it("uses the right stride, so neighbours do not bleed into each other", () => {
    const rom = romWithTypes(285, TYPE_WATER, TYPE_GROUND);
    // Species 284 and 286 were never written, so they read as Normal/Normal.
    expect(readSpeciesTypes(rom, EMERALD, 284)).toEqual(["Normal"]);
    expect(readSpeciesTypes(rom, EMERALD, 286)).toEqual(["Normal"]);
  });

  it("returns nothing for an out-of-range species", () => {
    // A large ROM is big enough that a garbage index still lands inside the
    // file, so the bound has to be the species count, not the file length --
    // otherwise unrelated bytes come back looking like a real type.
    const rom = romWithTypes(1, TYPE_NORMAL, TYPE_NORMAL);
    expect(readSpeciesTypeIds(rom, EMERALD, 0)).toBeUndefined();
    expect(readSpeciesTypeIds(rom, EMERALD, 412)).toBeUndefined();
    expect(readSpeciesTypes(rom, EMERALD, 99999)).toEqual([]);
    // 411 is the last real Gen 3 species and must still read.
    expect(readSpeciesTypeIds(rom, EMERALD, 411)).toBeDefined();
  });

  it("returns nothing when the ROM is too small for the table", () => {
    expect(readSpeciesTypeIds(new Uint8Array(1024), EMERALD, 285)).toBeUndefined();
  });

  it("reads the game code from the cartridge header", () => {
    const rom = new Uint8Array(0x1000);
    rom.set([0x42, 0x50, 0x45, 0x45], 0xac); // "BPEE"
    expect(romGameCode(rom)).toBe("BPEE");
  });

  it("keeps sibling games on their own base-stats address", () => {
    // LeafGreen shares FireRed's RAM layout but not its ROM offsets, and
    // Sapphire likewise differs from Ruby. Conflating them shifts every type.
    expect(layoutForGameCode("BPGE")!.baseStats).not.toBe(
      layoutForGameCode("BPRE")!.baseStats,
    );
    expect(layoutForGameCode("AXPE")!.baseStats).not.toBe(
      layoutForGameCode("AXVE")!.baseStats,
    );
  });
});
