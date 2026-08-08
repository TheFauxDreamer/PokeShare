import { describe, expect, it } from "vitest";
import {
  familyOf,
  internalToNationalDex,
  layoutForGameCode,
  nationalDexToInternal,
  routeName,
} from "@pokeshare/data";
import { decodeGen3String } from "../src/gen3/charmap.js";
import {
  isShiny,
  looksLikeValidSlot,
  parsePartySlot,
  substructOffset,
} from "../src/gen3/pokemon.js";
import { buildPartySlot, encodeGen3String } from "./fixtures.js";

const EMERALD = layoutForGameCode("BPEE")!;

describe("party slot parsing", () => {
  it("round-trips a slot through real encryption", () => {
    const slot = buildPartySlot({
      personality: 0x12345678,
      otId: 0x9abcdef0,
      speciesInternal: 277, // Treecko
      level: 5,
      currentHp: 19,
      maxHp: 20,
      nickname: "TREECKO",
      experience: 135,
    });

    const mon = parsePartySlot(slot);
    expect(mon).toBeDefined();
    expect(mon!.checksumValid).toBe(true);
    expect(mon!.speciesInternal).toBe(277);
    expect(mon!.level).toBe(5);
    expect(mon!.currentHp).toBe(19);
    expect(mon!.maxHp).toBe(20);
    expect(mon!.nickname).toBe("TREECKO");
    expect(mon!.experience).toBe(135);
    expect(mon!.isEgg).toBe(false);
  });

  /**
   * The subtlest failure mode in the whole parser: reading Growth from the
   * wrong substructure yields a plausible but wrong species. Cover all 24.
   */
  it("decodes species correctly for every substructure permutation", () => {
    for (let remainder = 0; remainder < 24; remainder += 1) {
      // Base must be a multiple of 24 so that personality % 24 == remainder.
      const personality = 24 * 0x1a2b3c + remainder;
      expect(personality % 24).toBe(remainder);

      const slot = buildPartySlot({
        personality,
        otId: 0x0000beef,
        speciesInternal: 300,
        level: 42,
        currentHp: 100,
        maxHp: 120,
      });

      const mon = parsePartySlot(slot);
      expect(mon, `permutation ${remainder}`).toBeDefined();
      expect(mon!.checksumValid, `permutation ${remainder}`).toBe(true);
      expect(mon!.speciesInternal, `permutation ${remainder}`).toBe(300);
    }
  });

  it("places the four substructures at distinct offsets", () => {
    for (let remainder = 0; remainder < 24; remainder += 1) {
      const offsets = (["G", "A", "E", "M"] as const).map((key) =>
        substructOffset(remainder, key),
      );
      expect(new Set(offsets).size).toBe(4);
      expect([...offsets].sort((a, b) => a - b)).toEqual([0, 12, 24, 36]);
    }
  });

  it("flags a corrupted data section via the checksum", () => {
    const slot = buildPartySlot({
      personality: 0xaabbccdd,
      otId: 0x11223344,
      speciesInternal: 25,
      level: 10,
      currentHp: 30,
      maxHp: 30,
    });
    slot[0x24] = (slot[0x24]! ^ 0xff) & 0xff; // corrupt encrypted data

    expect(parsePartySlot(slot)!.checksumValid).toBe(false);
    expect(looksLikeValidSlot(slot)).toBe(false);
  });

  it("treats an all-zero slot as empty", () => {
    expect(parsePartySlot(new Uint8Array(100))).toBeUndefined();
    expect(looksLikeValidSlot(new Uint8Array(100))).toBe(true);
  });

  it("rejects a slot with an impossible level", () => {
    const slot = buildPartySlot({
      personality: 0x1,
      otId: 0x2,
      speciesInternal: 1,
      level: 200,
      currentHp: 10,
      maxHp: 10,
    });
    expect(looksLikeValidSlot(slot)).toBe(false);
  });

  it("rejects current HP above max HP", () => {
    const slot = buildPartySlot({
      personality: 0x3,
      otId: 0x4,
      speciesInternal: 1,
      level: 10,
      currentHp: 999,
      maxHp: 10,
    });
    expect(looksLikeValidSlot(slot)).toBe(false);
  });

  it("reads an egg's flag", () => {
    const slot = buildPartySlot({
      personality: 0x55,
      otId: 0x66,
      speciesInternal: 1,
      level: 5,
      currentHp: 11,
      maxHp: 11,
      isEgg: true,
    });
    expect(parsePartySlot(slot)!.isEgg).toBe(true);
  });
});

describe("shininess", () => {
  it("is true when the XOR of both halves is below 8", () => {
    // otId ^ pid halves cancel exactly -> value 0 -> shiny.
    expect(isShiny(0x12345678, 0x12345678)).toBe(true);
  });

  it("is false for an ordinary pairing", () => {
    expect(isShiny(0x12345678, 0x0000ffff)).toBe(false);
  });
});

describe("Gen 3 text", () => {
  it("round-trips letters, digits and spaces", () => {
    expect(decodeGen3String(encodeGen3String("ABC xyz 09", 10))).toBe(
      "ABC xyz 09",
    );
  });

  it("stops at the terminator", () => {
    const bytes = encodeGen3String("HI", 10);
    expect(decodeGen3String(bytes)).toBe("HI");
  });
});

describe("species index mapping", () => {
  it("passes Gen 1 and 2 through unchanged", () => {
    expect(internalToNationalDex(1)).toBe(1);
    expect(internalToNationalDex(251)).toBe(251);
  });

  /**
   * Internal order is NOT National Dex order, and there is no fixed offset.
   * Treecko coincidentally satisfies "internal - 25", which is exactly what
   * makes the wrong assumption so easy to ship; Nincada does not.
   */
  it("uses a real table for Gen 3, not a fixed offset", () => {
    expect(internalToNationalDex(277)).toBe(252); // Treecko — matches -25
    expect(internalToNationalDex(301)).toBe(290); // Nincada — -25 gives 276
    expect(internalToNationalDex(303)).toBe(292); // Shedinja
    expect(internalToNationalDex(410)).toBe(386); // Deoxys, the last species
  });

  it("rejects the glitch range and out-of-range values", () => {
    expect(internalToNationalDex(252)).toBeUndefined(); // OLD_UNOWN_B
    expect(internalToNationalDex(276)).toBeUndefined();
    expect(internalToNationalDex(0)).toBeUndefined();
    expect(internalToNationalDex(412)).toBeUndefined();
  });

  it("is a bijection over the whole National Dex", () => {
    const seen = new Set<number>();
    for (let national = 1; national <= 386; national += 1) {
      const internal = nationalDexToInternal(national);
      expect(internal, `national ${national}`).toBeDefined();
      expect(internalToNationalDex(internal!)).toBe(national);
      seen.add(internal!);
    }
    expect(seen.size).toBe(386);
  });
});

describe("evolution families", () => {
  it("groups a linear chain under its base form", () => {
    expect(familyOf(1)).toBe(1); // Bulbasaur
    expect(familyOf(2)).toBe(1);
    expect(familyOf(3)).toBe(1);
  });

  it("groups branching evolutions", () => {
    // Eeveelutions all belong to Eevee.
    for (const dex of [134, 135, 136, 196, 197]) expect(familyOf(dex)).toBe(133);
    // Gloom -> Vileplume and Gloom -> Bellossom both trace to Oddish.
    expect(familyOf(45)).toBe(43);
    expect(familyOf(182)).toBe(43);
  });

  it("groups Shedinja with Nincada", () => {
    // Nincada's second evolution entry — easy to miss when parsing.
    expect(familyOf(291)).toBe(290);
    expect(familyOf(292)).toBe(290);
  });

  it("treats an evolution-less species as its own family", () => {
    expect(familyOf(132)).toBe(132); // Ditto
  });

  it("never groups two unrelated species", () => {
    expect(familyOf(252)).not.toBe(familyOf(255));
  });
});

describe("game layouts", () => {
  it("resolves every supported game code", () => {
    for (const code of ["BPEE", "BPRE", "BPGE", "AXVE", "AXPE"]) {
      expect(layoutForGameCode(code), code).toBeDefined();
    }
    expect(layoutForGameCode("XXXX")).toBeUndefined();
  });

  it("keeps Ruby/Sapphire's party in IWRAM and the others' in EWRAM", () => {
    expect(layoutForGameCode("AXVE")!.playerParty).toBeGreaterThanOrEqual(
      0x03000000,
    );
    expect(EMERALD.playerParty).toBeLessThan(0x03000000);
    expect(layoutForGameCode("BPRE")!.playerParty).toBeLessThan(0x03000000);
  });

  it("does not assume the enemy party sits 600 bytes after the player party", () => {
    // True on Emerald, but FR/LG places the enemy party *below* the player's.
    expect(EMERALD.enemyParty - EMERALD.playerParty).toBe(600);
    const firered = layoutForGameCode("BPRE")!;
    expect(firered.enemyParty).toBeLessThan(firered.playerParty);
  });
});

describe("route names", () => {
  it("resolves Route 103 in all three tables", () => {
    expect(routeName("EMERALD", 18)).toBe("Route 103");
    expect(routeName("RS", 18)).toBe("Route 103");
    expect(routeName("FRLG", 18)).toBe("Route 103");
  });

  it("resolves Kanto locations for FRLG", () => {
    expect(routeName("FRLG", 88)).toBe("Pallet Town");
    expect(routeName("FRLG", 101)).toBe("Route 1");
  });

  it("returns undefined for an unknown section", () => {
    expect(routeName("EMERALD", 9999)).toBeUndefined();
  });
});
