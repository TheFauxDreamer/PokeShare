import { describe, expect, it } from "vitest";
import { layoutForGameCode } from "@pokeshare/data";
import { EWRAM_SIZE, EWRAM_START, IWRAM_START, SAVESTATE_SIZE } from "@pokeshare/gba";
import { diagnoseSaveState } from "../src/lib/diagnostics.js";
import {
  buildPartySlot,
  buildSaveState,
  writeParty,
} from "../../gba/test/fixtures.js";

const EMERALD = layoutForGameCode("BPEE")!;

function stateWithParty(options: { gameCode?: string; corrupt?: boolean } = {}) {
  const ewram = new Uint8Array(EWRAM_SIZE);
  const slot = buildPartySlot({
    personality: 0x1234abcd,
    otId: 0x0000c0de,
    speciesInternal: 277,
    level: 12,
    currentHp: 30,
    maxHp: 36,
    nickname: "TREECKO",
  });
  if (options.corrupt) slot[0x24] = (slot[0x24]! ^ 0xff) & 0xff;

  writeParty(
    ewram,
    EMERALD.playerParty - EWRAM_START,
    EMERALD.playerPartyCount - EWRAM_START,
    [slot],
  );

  // MAPSEC 18 == Route 103.
  ewram[EMERALD.mapHeader - EWRAM_START + 0x14] = 18;

  // SaveBlock1 pointer (in IWRAM) -> a location inside EWRAM, two badges set.
  const saveBlock1 = 0x02025734;
  const iwram = new Uint8Array(0x8000);
  const pointerOffset = EMERALD.saveBlock1.address - IWRAM_START;
  for (let i = 0; i < 4; i += 1) {
    iwram[pointerOffset + i] = (saveBlock1 >>> (i * 8)) & 0xff;
  }
  // Two badges, positioned at FLAG_BADGE01_GET's bit offset (7 on Emerald).
  const badgeAt = saveBlock1 - EWRAM_START + EMERALD.badgeOffset;
  const badgeValue = 0b11 << EMERALD.badgeBitOffset;
  ewram[badgeAt] = badgeValue & 0xff;
  ewram[badgeAt + 1] = (badgeValue >>> 8) & 0xff;

  return buildSaveState({ gameCode: options.gameCode ?? "BPEE", ewram, iwram });
}

const byName = (steps: ReturnType<typeof diagnoseSaveState>, name: string) =>
  steps.find((s) => s.name === name);

describe("save-state diagnostics", () => {
  it("passes every step on a well-formed state", () => {
    const steps = diagnoseSaveState(stateWithParty());

    expect(steps.every((s) => s.ok)).toBe(true);
    expect(byName(steps, "Game identified")!.detail).toContain("Emerald");
    expect(byName(steps, "Party count")!.detail).toContain("1");
    expect(byName(steps, "Current route")!.detail).toContain("Route 103");
    expect(byName(steps, "Party parsed")!.detail).toContain("TREECKO");
    expect(byName(steps, "Badges")!.detail).toContain("2");
  });

  it("names the exact fix when the state is PNG-wrapped", () => {
    const png = new Uint8Array(SAVESTATE_SIZE);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);

    const steps = diagnoseSaveState(png);
    expect(steps[0]!.ok).toBe(false);
    expect(steps[0]!.detail).toMatch(/SAVESTATE_SCREENSHOT/);
    expect(steps[0]!.detail).toMatch(/_saveStateSlot/);
  });

  it("reports a truncated state without throwing", () => {
    const steps = diagnoseSaveState(new Uint8Array(512));
    expect(byName(steps, "State size")!.ok).toBe(false);
  });

  it("reports an unrecognised game code", () => {
    const steps = diagnoseSaveState(stateWithParty({ gameCode: "ZZZZ" }));
    const identified = byName(steps, "Game identified")!;
    expect(identified.ok).toBe(false);
    expect(identified.detail).toContain("ZZZZ");
  });

  it("blames the address when checksums fail", () => {
    const steps = diagnoseSaveState(stateWithParty({ corrupt: true }));
    const checksums = byName(steps, "Checksums")!;
    expect(checksums.ok).toBe(false);
    expect(checksums.detail).toMatch(/address/i);
  });

  it("flags an implausible party count", () => {
    const state = stateWithParty();
    // 0x21000 is the EWRAM offset within the state.
    state[0x21000 + (EMERALD.playerPartyCount - EWRAM_START)] = 99;

    const steps = diagnoseSaveState(state);
    expect(byName(steps, "Party count")!.ok).toBe(false);
    expect(byName(steps, "Party count")!.detail).toMatch(/address table/i);
  });

  it("says which memory region the party lives in", () => {
    expect(byName(diagnoseSaveState(stateWithParty()), "Party region")!.detail).toContain(
      "EWRAM",
    );
  });
});
