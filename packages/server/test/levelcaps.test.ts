/**
 * Level caps, per game.
 *
 * Values extracted from the pret decompilations' trainer party tables (each
 * boss's highest-level Pokemon). They differ enough between games that sharing
 * one table is a real correctness bug, not a rounding issue: FR/LG's fifth
 * badge caps at 43 where Emerald's caps at 31.
 */

import { describe, expect, it } from "vitest";
import {
  LEVEL_CAP_WARNING_MARGIN,
  levelCapStatus,
  type PartyMemberState,
  type PlayerId,
  type PlayerSnapshot,
} from "@pokeshare/shared";
import { levelCapFor } from "@pokeshare/data";
import { applySnapshot, createRun, toRunState } from "../src/engine.js";

function snap(
  player: PlayerId,
  badges: number,
  gameCode: string,
): PlayerSnapshot {
  const party: PartyMemberState[] = [];
  return {
    player,
    observedAt: 1,
    gameCode,
    party,
    route: "Route 103",
    badges,
    inWildBattle: false,
    wildEncounterDex: undefined,
  };
}

describe("per-game level caps", () => {
  it("uses Emerald's table for Emerald", () => {
    expect(levelCapFor("BPEE", 0)).toBe(15);
    expect(levelCapFor("BPEE", 7)).toBe(46); // Juan
    expect(levelCapFor("BPEE", 8)).toBe(58); // Wallace
  });

  it("uses FireRed's table, which is very different mid-game", () => {
    expect(levelCapFor("BPRE", 0)).toBe(14);
    expect(levelCapFor("BPRE", 4)).toBe(43); // Koga — Emerald's is 31
    expect(levelCapFor("BPRE", 8)).toBe(63); // Blue
  });

  it("gives Ruby its own eighth gym, which is Wallace not Juan", () => {
    expect(levelCapFor("AXVE", 7)).toBe(43);
    expect(levelCapFor("BPEE", 7)).toBe(46);
  });

  it("shares tables between siblings", () => {
    for (let badges = 0; badges <= 8; badges += 1) {
      expect(levelCapFor("BPGE", badges)).toBe(levelCapFor("BPRE", badges));
      expect(levelCapFor("AXPE", badges)).toBe(levelCapFor("AXVE", badges));
    }
  });

  it("clamps out-of-range badge counts", () => {
    expect(levelCapFor("BPEE", -1)).toBe(15);
    expect(levelCapFor("BPEE", 99)).toBe(58);
  });

  it("falls back to Emerald for an unknown game", () => {
    expect(levelCapFor("ZZZZ", 0)).toBe(15);
    expect(levelCapFor(undefined, 0)).toBe(15);
  });

  it("resolves the run's cap through the game actually being played", () => {
    const emerald = createRun("r", "C");
    applySnapshot(emerald, snap("a", 4, "BPEE"));
    expect(toRunState(emerald).levelCap).toBe(31);

    const firered = createRun("r", "C");
    applySnapshot(firered, snap("a", 4, "BPRE"));
    expect(toRunState(firered).levelCap).toBe(43);
  });

  it("follows whichever player has more badges", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", 1, "BPEE"));
    applySnapshot(state, snap("b", 3, "BPEE"));
    expect(toRunState(state).levelCap).toBe(29);
  });
});

describe("approaching the cap", () => {
  it("warns within the margin, before the cap is breached", () => {
    // Experience cannot be un-gained, so the useful warning is on approach.
    expect(levelCapStatus(28, 31)).toBe("ok");
    expect(levelCapStatus(29, 31)).toBe("near");
    expect(levelCapStatus(30, 31)).toBe("near");
    expect(levelCapStatus(31, 31)).toBe("near");
    expect(levelCapStatus(32, 31)).toBe("over");
  });

  it("uses a margin of three", () => {
    expect(LEVEL_CAP_WARNING_MARGIN).toBe(3);
    const cap = 20;
    expect(levelCapStatus(cap - LEVEL_CAP_WARNING_MARGIN, cap)).toBe("ok");
    expect(levelCapStatus(cap - LEVEL_CAP_WARNING_MARGIN + 1, cap)).toBe("near");
  });

  it("says nothing when there is no cap", () => {
    expect(levelCapStatus(99, undefined)).toBe("ok");
  });
});
