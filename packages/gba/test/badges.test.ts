/**
 * Badge counting.
 *
 * Regression cover for a bug found against a real ROM: at Littleroot Town with
 * a level 5 starter (zero badges), the tracker reported 1. The badge flags do
 * not start on a byte boundary in Emerald or Ruby/Sapphire — FLAG_BADGE01_GET
 * is bit 7 — so reading one byte counted seven unrelated system flags.
 */

import { describe, expect, it } from "vitest";
import { layoutForGameCode } from "@pokeshare/data";
import { EWRAM_SIZE, EWRAM_START, IWRAM_START, RegionMemory } from "../src/memory.js";
import { readBadges } from "../src/gen3/reader.js";

const EMERALD = layoutForGameCode("BPEE")!;
const FIRERED = layoutForGameCode("BPRE")!;
const RUBY = layoutForGameCode("AXVE")!;

const SAVE_BLOCK_1 = 0x02025734;

/**
 * Build memory whose flag array has `badges` badge flags set, plus optional
 * unrelated system flags in the same bytes.
 */
function memoryWith(
  layout: typeof EMERALD,
  badges: number,
  noise = 0,
): RegionMemory {
  const ewram = new Uint8Array(EWRAM_SIZE);
  const iwram = new Uint8Array(0x8000);

  if (layout.saveBlock1.kind === "pointer") {
    const offset = layout.saveBlock1.address - IWRAM_START;
    for (let i = 0; i < 4; i += 1) {
      iwram[offset + i] = (SAVE_BLOCK_1 >>> (i * 8)) & 0xff;
    }
  }
  const base =
    (layout.saveBlock1.kind === "pointer"
      ? SAVE_BLOCK_1
      : layout.saveBlock1.address) - EWRAM_START;

  // `badges` low bits set, shifted into position, plus noise outside the field.
  const badgeBits = ((1 << badges) - 1) << layout.badgeBitOffset;
  const value = (badgeBits | noise) >>> 0;

  ewram[base + layout.badgeOffset] = value & 0xff;
  ewram[base + layout.badgeOffset + 1] = (value >>> 8) & 0xff;

  return new RegionMemory(ewram, iwram);
}

describe("badge counting", () => {
  it.each([0, 1, 2, 5, 8])("counts %i badges on Emerald", (badges) => {
    expect(readBadges(memoryWith(EMERALD, badges), EMERALD)).toBe(badges);
  });

  it.each([0, 1, 8])("counts %i badges on FireRed", (badges) => {
    expect(readBadges(memoryWith(FIRERED, badges), FIRERED)).toBe(badges);
  });

  it.each([0, 1, 8])("counts %i badges on Ruby", (badges) => {
    expect(readBadges(memoryWith(RUBY, badges), RUBY)).toBe(badges);
  });

  /**
   * The exact failure seen in the wild: zero badges, but other system flags in
   * the same byte set. Bits 0-6 of Emerald's byte 0x137C are not badges.
   */
  it("ignores unrelated system flags sharing the byte", () => {
    const noise = 0b0111_1111; // every non-badge bit below the badge field
    expect(readBadges(memoryWith(EMERALD, 0, noise), EMERALD)).toBe(0);
    expect(readBadges(memoryWith(RUBY, 0, noise), RUBY)).toBe(0);
  });

  it("ignores flags above the badge field", () => {
    // Bit 15 is beyond badge 8 on Emerald (bits 7..14).
    expect(readBadges(memoryWith(EMERALD, 8, 1 << 15), EMERALD)).toBe(8);
  });

  it("never exceeds eight", () => {
    expect(readBadges(memoryWith(EMERALD, 8, 0xffff), EMERALD)).toBe(8);
  });

  it("uses bit 7 on Emerald and Ruby, bit 0 on FireRed", () => {
    // Pinning the constants themselves: these came from the decomps and a
    // wrong value here is invisible until someone plays a real game.
    expect(EMERALD.badgeBitOffset).toBe(7);
    expect(RUBY.badgeBitOffset).toBe(7);
    expect(FIRERED.badgeBitOffset).toBe(0);
  });
});
