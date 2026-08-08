/**
 * The in-battle verdict: catch it, or run and re-roll.
 *
 * Checked in decisiveness order — a used or voided route settles it regardless
 * of species, then dupes, then whether the link with the partner is legal.
 */

import { describe, expect, it } from "vitest";
import type { PartyMemberState, PlayerId, PlayerSnapshot } from "@pokeshare/shared";
import {
  adviceFor,
  applySnapshot,
  createRun,
  toRunState,
  voidRoute,
} from "../src/engine.js";

function mon(pid: number, dex: number): PartyMemberState {
  return {
    pid,
    slot: 0,
    nationalDex: dex,
    nickname: `MON${pid}`,
    level: 10,
    currentHp: 20,
    maxHp: 20,
    status: 0,
    isEgg: false,
    isShiny: false,
    types: [],
  };
}

function snap(
  player: PlayerId,
  route: string | undefined,
  party: PartyMemberState[],
  battle?: { dex: number | undefined },
): PlayerSnapshot {
  return {
    player,
    observedAt: 1,
    gameCode: "BPEE",
    party,
    route,
    badges: 0,
    inWildBattle: battle !== undefined,
    wildEncounterDex: battle?.dex,
  };
}

const ZIGZAGOON = 263;
const LINOONE = 264; // same family as Zigzagoon
const POOCHYENA = 261;
const TREECKO = 252;

describe("encounter advice", () => {
  it("says nothing when the player is not in a wild battle", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Route 103", []));
    expect(adviceFor(state, "a")).toBeUndefined();
  });

  it("allows a fresh species on an unused route", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Route 103", [], { dex: ZIGZAGOON }));

    const advice = adviceFor(state, "a")!;
    expect(advice.verdict).toBe("catchable");
    expect(advice.rerollNeeded).toBe(false);
  });

  it("flags a route whose encounter is already used", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Route 103", [mon(1, TREECKO)]));
    applySnapshot(state, snap("a", "Route 103", [mon(1, TREECKO)], { dex: POOCHYENA }));

    const advice = adviceFor(state, "a")!;
    expect(advice.verdict).toBe("route_taken");
    expect(advice.rerollNeeded).toBe(true);
    expect(advice.message).toContain("Route 103");
  });

  it("flags a dupe of a family caught on another route", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Route 103", [mon(1, ZIGZAGOON)]));
    // Now encountering Linoone on a different route: same family.
    applySnapshot(state, snap("a", "Route 104", [mon(1, ZIGZAGOON)], { dex: LINOONE }));

    const advice = adviceFor(state, "a")!;
    expect(advice.verdict).toBe("dupe");
    expect(advice.rerollNeeded).toBe(true);
    expect(advice.message).toContain("Route 103");
  });

  it("does not call it a dupe on a randomised run, where families differ", () => {
    const state = createRun("r", "C", true);
    applySnapshot(state, snap("a", "Route 103", [mon(1, ZIGZAGOON)]));
    applySnapshot(state, snap("a", "Route 104", [mon(1, ZIGZAGOON)], { dex: LINOONE }));
    expect(adviceFor(state, "a")!.verdict).toBe("catchable");
  });

  it("flags a clash with the partner's catch on the same route", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("b", "Route 103", [mon(2, ZIGZAGOON)]));
    // A is now facing a Linoone on that same route.
    applySnapshot(state, snap("a", "Route 103", [], { dex: LINOONE }));

    const advice = adviceFor(state, "a")!;
    expect(advice.verdict).toBe("species_clash");
    expect(advice.rerollNeeded).toBe(true);
    expect(advice.message).toContain("MON2");
  });

  it("allows a different family from the partner's catch", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("b", "Route 103", [mon(2, ZIGZAGOON)]));
    applySnapshot(state, snap("a", "Route 103", [], { dex: TREECKO }));
    expect(adviceFor(state, "a")!.verdict).toBe("catchable");
  });

  it("flags a voided route ahead of any species rule", () => {
    const state = createRun("r", "C");
    voidRoute(state, "Route 103");
    applySnapshot(state, snap("a", "Route 103", [], { dex: TREECKO }));
    expect(adviceFor(state, "a")!.verdict).toBe("route_void");
  });

  it("prefers route_taken over dupe when both apply", () => {
    // Decisiveness order: the route is spent regardless of what this is.
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Route 103", [mon(1, ZIGZAGOON)]));
    applySnapshot(
      state,
      snap("a", "Route 103", [mon(1, ZIGZAGOON)], { dex: LINOONE }),
    );
    expect(adviceFor(state, "a")!.verdict).toBe("route_taken");
  });

  /**
   * The sprite shown must match the Pokemon the message names. The wild one is
   * already on screen behind the overlay, so showing it there both duplicates
   * it and contradicts the text.
   */
  describe("which Pokemon the message is about", () => {
    it("names the already-caught one when the route is used", () => {
      const state = createRun("r", "C");
      applySnapshot(state, snap("a", "Route 103", [mon(1, TREECKO)]));
      applySnapshot(
        state,
        snap("a", "Route 103", [mon(1, TREECKO)], { dex: POOCHYENA }),
      );

      const advice = adviceFor(state, "a")!;
      expect(advice.nationalDex).toBe(POOCHYENA); // what you are facing
      expect(advice.blockerDex).toBe(TREECKO); // what the message names
      expect(advice.blockerNickname).toBe("MON1");
    });

    it("names the earlier catch on a dupe", () => {
      const state = createRun("r", "C");
      applySnapshot(state, snap("a", "Route 103", [mon(1, ZIGZAGOON)]));
      applySnapshot(
        state,
        snap("a", "Route 104", [mon(1, ZIGZAGOON)], { dex: LINOONE }),
      );

      const advice = adviceFor(state, "a")!;
      expect(advice.nationalDex).toBe(LINOONE);
      expect(advice.blockerDex).toBe(ZIGZAGOON);
    });

    it("names the partner's Pokemon on a species clash", () => {
      const state = createRun("r", "C");
      applySnapshot(state, snap("b", "Route 103", [mon(2, ZIGZAGOON)]));
      applySnapshot(state, snap("a", "Route 103", [], { dex: LINOONE }));

      const advice = adviceFor(state, "a")!;
      expect(advice.blockerDex).toBe(ZIGZAGOON);
      expect(advice.blockerNickname).toBe("MON2");
    });

    it("has no blocker and no detail text when the encounter is fine", () => {
      // The overlay shows only "Catch Available" — no sprite, no second line,
      // since the wild Pokemon is already visible behind the overlay.
      const state = createRun("r", "C");
      applySnapshot(state, snap("a", "Route 103", [], { dex: TREECKO }));

      const advice = adviceFor(state, "a")!;
      expect(advice.blockerDex).toBeUndefined();
      expect(advice.blockerNickname).toBeUndefined();
      expect(advice.message).toBe("");
      expect(advice.nationalDex).toBe(TREECKO);
    });

    it("gives every blocked verdict a sprite and an explanation", () => {
      const state = createRun("r", "C");
      applySnapshot(state, snap("a", "Route 103", [mon(1, TREECKO)]));
      applySnapshot(
        state,
        snap("a", "Route 103", [mon(1, TREECKO)], { dex: POOCHYENA }),
      );

      const advice = adviceFor(state, "a")!;
      expect(advice.rerollNeeded).toBe(true);
      expect(advice.blockerDex).toBeDefined();
      expect(advice.message).not.toBe("");
    });
  });

  it("copes with an unreadable species", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Route 103", [], { dex: undefined }));
    expect(adviceFor(state, "a")!.verdict).toBe("catchable");
  });

  it("is exposed per player in run state", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Route 103", [], { dex: TREECKO }));
    applySnapshot(state, snap("b", "Route 104", []));

    const run = toRunState(state);
    expect(run.advice.a?.verdict).toBe("catchable");
    expect(run.advice.b).toBeUndefined();
  });
});
