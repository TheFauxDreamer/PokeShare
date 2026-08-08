import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "@pokeshare/gba";
import { snapshotDigest, toPlayerSnapshot } from "../src/lib/snapshot.js";

function member(overrides: Partial<GameSnapshot["party"][number]> = {}) {
  return {
    personality: 0xabcd,
    otId: 0x1234,
    nickname: "TREECKO",
    speciesInternal: 277,
    heldItem: 0,
    experience: 135,
    level: 12,
    currentHp: 30,
    maxHp: 36,
    status: 0,
    isEgg: false,
    isShiny: false,
    checksumValid: true,
    slot: 0,
    nationalDex: 252,
    ...overrides,
  };
}

function observed(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    party: [member()],
    mapSecId: 18,
    route: "Route 103",
    badges: 1,
    inBattle: false,
    inWildBattle: false,
    wildEncounter: undefined,
    ...overrides,
  };
}

describe("snapshot conversion", () => {
  it("maps the emulator reading onto the wire shape", () => {
    const snapshot = toPlayerSnapshot(observed(), "a", "BPEE", 1000);

    expect(snapshot).toMatchObject({
      player: "a",
      gameCode: "BPEE",
      route: "Route 103",
      badges: 1,
      observedAt: 1000,
    });
    // PID becomes the wire identity.
    expect(snapshot.party[0]).toMatchObject({
      pid: 0xabcd,
      nationalDex: 252,
      nickname: "TREECKO",
      level: 12,
      currentHp: 30,
    });
  });

  it("carries the wild encounter species when in a wild battle", () => {
    const snapshot = toPlayerSnapshot(
      observed({
        inWildBattle: true,
        wildEncounter: member({ nationalDex: 263, personality: 0x99 }),
      }),
      "b",
      "BPEE",
    );
    expect(snapshot.inWildBattle).toBe(true);
    expect(snapshot.wildEncounterDex).toBe(263);
  });
});

describe("change detection", () => {
  const base = toPlayerSnapshot(observed(), "a", "BPEE", 1000);

  it("ignores the timestamp, so an idle run sends nothing", () => {
    const later = toPlayerSnapshot(observed(), "a", "BPEE", 999_999);
    expect(snapshotDigest(later)).toBe(snapshotDigest(base));
  });

  it.each([
    ["hp", observed({ party: [member({ currentHp: 29 })] })],
    ["level", observed({ party: [member({ level: 13 })] })],
    ["nickname", observed({ party: [member({ nickname: "SPROUT" })] })],
    ["status", observed({ party: [member({ status: 64 })] })],
    ["slot order", observed({ party: [member({ slot: 1 })] })],
    ["route", observed({ route: "Route 104" })],
    ["badges", observed({ badges: 2 })],
    ["party size", observed({ party: [member(), member({ personality: 2 })] })],
    ["wild battle", observed({ inWildBattle: true })],
  ])("detects a change in %s", (_label, next) => {
    const digest = snapshotDigest(toPlayerSnapshot(next, "a", "BPEE", 1000));
    expect(digest).not.toBe(snapshotDigest(base));
  });
});
