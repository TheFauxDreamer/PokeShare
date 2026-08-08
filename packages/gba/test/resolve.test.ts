import { describe, expect, it } from "vitest";
import { layoutForGameCode } from "@pokeshare/data";
import { EWRAM_SIZE, EWRAM_START, IWRAM_START } from "../src/memory.js";
import { findRegionOffset, resolveMemory } from "../src/resolve.js";
import { readBadges, readParty, readSnapshot } from "../src/gen3/reader.js";
import { memoryFromSaveState, saveStateGameCode } from "../src/savestate.js";
import { buildPartySlot, buildSaveState, writeParty } from "./fixtures.js";

const EMERALD = layoutForGameCode("BPEE")!;
const RUBY = layoutForGameCode("AXVE")!;

const TEAM = [
  buildPartySlot({
    personality: 0x1234abcd,
    otId: 0x0000c0de,
    speciesInternal: 277,
    level: 12,
    currentHp: 30,
    maxHp: 36,
    nickname: "TREECKO",
  }),
  buildPartySlot({
    personality: 0x77778888,
    otId: 0x0000c0de,
    speciesInternal: 280,
    level: 10,
    currentHp: 0, // fainted
    maxHp: 28,
    nickname: "TORCHIC",
  }),
];

/** A heap with EWRAM planted at a deliberately non-obvious offset. */
function heapWithEwramAt(offset: number): Uint8Array {
  const heap = new Uint8Array(offset + EWRAM_SIZE + 0x1000);
  writeParty(
    heap,
    offset + (EMERALD.playerParty - EWRAM_START),
    offset + (EMERALD.playerPartyCount - EWRAM_START),
    TEAM,
  );
  return heap;
}

describe("locating console RAM in the wasm heap", () => {
  it("finds the region base from a validated party", () => {
    const offset = 0x9d4c;
    expect(findRegionOffset(heapWithEwramAt(offset), EMERALD)).toBe(offset);
  });

  it("finds it at a different offset too", () => {
    const offset = 0x21000;
    expect(findRegionOffset(heapWithEwramAt(offset), EMERALD)).toBe(offset);
  });

  it("returns undefined when there is no party to lock onto", () => {
    const heap = new Uint8Array(EWRAM_SIZE + 0x2000);
    expect(findRegionOffset(heap, EMERALD)).toBeUndefined();
  });

  it("is not fooled by noise that fails the checksum", () => {
    const heap = heapWithEwramAt(0x4000);
    // Corrupt the encrypted section of the first slot.
    const partyAt = 0x4000 + (EMERALD.playerParty - EWRAM_START);
    heap[partyAt + 0x24] = (heap[partyAt + 0x24]! ^ 0xff) & 0xff;
    expect(findRegionOffset(heap, EMERALD)).toBeUndefined();
  });

  it("reads the party back through the resolved memory view", () => {
    const resolved = resolveMemory(heapWithEwramAt(0x9d4c), EMERALD);
    expect(resolved).toBeDefined();

    const party = readParty(resolved!.memory, EMERALD);
    expect(party).toHaveLength(2);
    expect(party[0]!.nickname).toBe("TREECKO");
    expect(party[0]!.nationalDex).toBe(252);
    expect(party[0]!.level).toBe(12);
    expect(party[1]!.nickname).toBe("TORCHIC");
    expect(party[1]!.currentHp).toBe(0);
  });

  it("handles Ruby/Sapphire keeping the party in IWRAM", () => {
    const iwramOffset = 0x40000;
    const heap = new Uint8Array(iwramOffset + 0x10000);
    writeParty(
      heap,
      iwramOffset + (RUBY.playerParty - IWRAM_START),
      iwramOffset + (RUBY.playerPartyCount - IWRAM_START),
      TEAM,
    );

    expect(findRegionOffset(heap, RUBY)).toBe(iwramOffset);

    const resolved = resolveMemory(heap, RUBY);
    expect(resolved!.iwramOffset).toBe(iwramOffset);
    expect(readParty(resolved!.memory, RUBY)).toHaveLength(2);
  });
});

describe("save state fallback", () => {
  const ewram = new Uint8Array(EWRAM_SIZE);

  writeParty(
    ewram,
    EMERALD.playerParty - EWRAM_START,
    EMERALD.playerPartyCount - EWRAM_START,
    TEAM,
  );
  // Two badges, and a SaveBlock1 pointer that lands inside EWRAM.
  const saveBlock1 = 0x02025734;
  const pointerOffset = EMERALD.saveBlock1.address - IWRAM_START;
  const iwram = new Uint8Array(0x8000);
  iwram[pointerOffset] = saveBlock1 & 0xff;
  iwram[pointerOffset + 1] = (saveBlock1 >>> 8) & 0xff;
  iwram[pointerOffset + 2] = (saveBlock1 >>> 16) & 0xff;
  iwram[pointerOffset + 3] = (saveBlock1 >>> 24) & 0xff;
  ewram[saveBlock1 - EWRAM_START + EMERALD.badgeOffset] = 0b0000_0011;

  const state = buildSaveState({ gameCode: "BPEE", ewram, iwram });

  it("identifies the game from the state header", () => {
    expect(saveStateGameCode(state)).toBe("BPEE");
  });

  it("reads the party out of a save state", () => {
    const memory = memoryFromSaveState(state);
    const party = readParty(memory, EMERALD);
    expect(party).toHaveLength(2);
    expect(party[0]!.nickname).toBe("TREECKO");
  });

  it("counts badges through the SaveBlock1 pointer", () => {
    expect(readBadges(memoryFromSaveState(state), EMERALD)).toBe(2);
  });

  it("produces a full snapshot", () => {
    const snapshot = readSnapshot(memoryFromSaveState(state), EMERALD);
    expect(snapshot.party).toHaveLength(2);
    expect(snapshot.badges).toBe(2);
    expect(snapshot.inBattle).toBe(false);
    expect(snapshot.wildEncounter).toBeUndefined();
  });

  it("rejects a state with a bad magic", () => {
    const bad = new Uint8Array(state);
    bad[3] = 0xff;
    expect(() => memoryFromSaveState(bad)).toThrow(/magic/i);
  });

  it("rejects a truncated state", () => {
    expect(() => memoryFromSaveState(new Uint8Array(1024))).toThrow(/bytes/i);
  });
});
