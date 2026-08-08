/**
 * Where the starter gets recorded.
 *
 * In Ruby/Sapphire/Emerald the bag opens while you are standing on Route 101,
 * so a naive reading files the starter under Route 101 — which then consumes
 * that route's single encounter and makes it impossible to ever catch a wild
 * Pokemon there. Convention is to attribute it to the home town.
 */

import { describe, expect, it } from "vitest";
import type { PartyMemberState, PlayerId, PlayerSnapshot } from "@pokeshare/shared";
import { applySnapshot, createRun, pairsOf } from "../src/engine.js";

function mon(pid: number, dex: number, nickname = `MON${pid}`): PartyMemberState {
  return {
    pid,
    slot: 0,
    nationalDex: dex,
    nickname,
    level: 5,
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
  route: string,
  party: PartyMemberState[],
  gameCode = "BPEE",
): PlayerSnapshot {
  return {
    player,
    observedAt: 1,
    gameCode,
    party,
    route,
    badges: 0,
    inWildBattle: false,
    wildEncounterDex: undefined,
  };
}

const MUDKIP = 258;
const POOCHYENA = 261;
const ZIGZAGOON = 263;

describe("starter attribution", () => {
  it("records an Emerald starter under Littleroot Town, not Route 101", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Route 101", [mon(1, MUDKIP, "MUDKIP")]));

    const pairs = pairsOf(state);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.route).toBe("Littleroot Town");
    expect(pairs[0]!.a?.nickname).toBe("MUDKIP");
  });

  it("leaves Route 101 free for a real encounter afterwards", () => {
    // The whole point: the starter must not consume the route's one catch.
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Route 101", [mon(1, MUDKIP)]));
    applySnapshot(state, snap("a", "Route 101", [mon(1, MUDKIP), mon(2, POOCHYENA)]));

    const byRoute = new Map(pairsOf(state).map((p) => [p.route, p]));
    expect(byRoute.get("Littleroot Town")!.a?.pid).toBe(1);
    expect(byRoute.get("Route 101")!.a?.pid).toBe(2);
  });

  it("only remaps the first catch, never a later one", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Route 101", [mon(1, MUDKIP)]));
    applySnapshot(state, snap("a", "Route 103", [mon(1, MUDKIP), mon(2, ZIGZAGOON)]));
    // Back on Route 101 with a third Pokemon: stays on Route 101.
    applySnapshot(
      state,
      snap("a", "Route 101", [mon(1, MUDKIP), mon(2, ZIGZAGOON), mon(3, POOCHYENA)]),
    );

    const byRoute = new Map(pairsOf(state).map((p) => [p.route, p]));
    expect(byRoute.get("Littleroot Town")!.a?.pid).toBe(1);
    expect(byRoute.get("Route 101")!.a?.pid).toBe(3);
    expect(byRoute.get("Route 103")!.a?.pid).toBe(2);
  });

  it("does not remap a first catch made somewhere else", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Route 103", [mon(1, ZIGZAGOON)]));
    expect(pairsOf(state)[0]!.route).toBe("Route 103");
  });

  it("applies to Ruby as well as Emerald", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Route 101", [mon(1, MUDKIP)], "AXVE"));
    expect(pairsOf(state)[0]!.route).toBe("Littleroot Town");
  });

  it("leaves FireRed alone, where the starter is already in Pallet Town", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Pallet Town", [mon(1, 1)], "BPRE"));
    expect(pairsOf(state)[0]!.route).toBe("Pallet Town");
  });

  it("does not remap FireRed's Route 1", () => {
    // FR/LG has no starterFix, so Route 1 behaves like any other route.
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Route 1", [mon(1, 16)], "BPRE"));
    expect(pairsOf(state)[0]!.route).toBe("Route 1");
  });

  it("remaps each player independently", () => {
    const state = createRun("r", "C");
    applySnapshot(state, snap("a", "Route 101", [mon(1, MUDKIP)]));
    applySnapshot(state, snap("b", "Route 101", [mon(2, 252)]));

    const pair = pairsOf(state).find((p) => p.route === "Littleroot Town")!;
    expect(pair.a?.pid).toBe(1);
    expect(pair.b?.pid).toBe(2);
  });
});
