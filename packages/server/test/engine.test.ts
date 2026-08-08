import { describe, expect, it } from "vitest";
import type { PartyMemberState, PlayerId, PlayerSnapshot } from "@pokeshare/shared";
import {
  applySnapshot,
  confirmDeath,
  createRun,
  pairsOf,
  repair,
  toRunState,
  voidRoute,
} from "../src/engine.js";

let clock = 0;

function mon(
  pid: number,
  nationalDex: number,
  overrides: Partial<PartyMemberState> = {},
): PartyMemberState {
  return {
    pid,
    slot: 0,
    nationalDex,
    nickname: `MON${pid}`,
    level: 10,
    currentHp: 20,
    maxHp: 20,
    status: 0,
    isEgg: false,
    isShiny: false,
    ...overrides,
  };
}

function snap(
  player: PlayerId,
  route: string | undefined,
  party: PartyMemberState[],
  overrides: Partial<PlayerSnapshot> = {},
): PlayerSnapshot {
  clock += 1;
  return {
    player,
    observedAt: clock,
    gameCode: "BPEE",
    party,
    route,
    badges: 0,
    inWildBattle: false,
    wildEncounterDex: undefined,
    ...overrides,
  };
}

function newRun() {
  return createRun("run1", "K7QP2M");
}

describe("encounter registration", () => {
  it("registers a new party member as that route's encounter", () => {
    const state = newRun();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252)]));

    const pairs = pairsOf(state);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.route).toBe("Route 103");
    expect(pairs[0]!.a?.pid).toBe(1);
    expect(pairs[0]!.b).toBeUndefined();
  });

  it("only counts the first encounter on a route", () => {
    const state = newRun();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252)]));
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252), mon(2, 261)]));

    const pairs = pairsOf(state);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.a?.pid).toBe(1);
  });

  it("ignores party members seen while the route is unknown", () => {
    const state = newRun();
    applySnapshot(state, snap("a", undefined, [mon(1, 252)]));
    expect(pairsOf(state)).toHaveLength(0);
  });

  it("tracks level and nickname changes on a registered encounter", () => {
    const state = newRun();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252)]));
    applySnapshot(
      state,
      snap("a", "Route 103", [mon(1, 252, { level: 17, nickname: "SPROUT" })]),
    );

    expect(pairsOf(state)[0]!.a).toMatchObject({ level: 17, nickname: "SPROUT" });
  });
});

describe("pairing across drifting progress", () => {
  it("forms the pair retroactively when the second player catches up", () => {
    const state = newRun();

    // A races ahead through three routes.
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252)]));
    applySnapshot(state, snap("a", "Route 104", [mon(1, 252), mon(2, 263)]));
    applySnapshot(
      state,
      snap("a", "Route 110", [mon(1, 252), mon(2, 263), mon(3, 309)]),
    );

    expect(pairsOf(state).every((pair) => pair.b === undefined)).toBe(true);

    // B arrives at Route 110 much later; the pair forms then.
    const events = applySnapshot(state, snap("b", "Route 110", [mon(9, 322)]));
    expect(events).toContainEqual({ type: "pair_formed", route: "Route 110" });

    const route110 = pairsOf(state).find((p) => p.route === "Route 110")!;
    expect(route110.a?.pid).toBe(3);
    expect(route110.b?.pid).toBe(9);
    expect(route110.status).toBe("alive");
  });

  it("keeps pairs in the order routes were first encountered", () => {
    const state = newRun();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252)]));
    applySnapshot(state, snap("b", "Route 104", [mon(2, 263)]));
    applySnapshot(state, snap("a", "Route 104", [mon(1, 252), mon(3, 261)]));

    expect(pairsOf(state).map((p) => p.route)).toEqual([
      "Route 103",
      "Route 104",
    ]);
  });
});

describe("death detection and the soul-link cascade", () => {
  function runWithPair() {
    const state = newRun();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252)]));
    applySnapshot(state, snap("b", "Route 103", [mon(2, 255)]));
    return state;
  }

  it("raises a pending prompt on a faint rather than killing immediately", () => {
    const state = runWithPair();
    const events = applySnapshot(
      state,
      snap("a", "Route 103", [mon(1, 252, { currentHp: 0 })]),
    );

    expect(events).toContainEqual({
      type: "death_pending",
      route: "Route 103",
      by: "a",
    });

    const pair = pairsOf(state)[0]!;
    expect(pair.status).toBe("pending");
    expect(pair.triggeredBy).toBe("a");
    // Nothing is dead until it is confirmed.
    expect(toRunState(state).deaths).toBe(0);
  });

  it("kills the healthy partner once confirmed", () => {
    const state = runWithPair();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252, { currentHp: 0 })]));
    confirmDeath(state, "Route 103");

    const pair = pairsOf(state)[0]!;
    expect(pair.status).toBe("dead");
    expect(pair.a?.fainted).toBe(true);
    // B never fainted, but the link kills it anyway.
    expect(pair.b?.fainted).toBe(false);
    expect(toRunState(state).deaths).toBe(1);
  });

  it("is edge-triggered, so a re-observed 0 HP does not re-prompt", () => {
    const state = runWithPair();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252, { currentHp: 0 })]));
    confirmDeath(state, "Route 103");

    const events = applySnapshot(
      state,
      snap("a", "Route 103", [mon(1, 252, { currentHp: 0 })]),
    );
    expect(events).toHaveLength(0);
    expect(pairsOf(state)[0]!.status).toBe("dead");
  });

  it("does not fire on the very first sighting of a fainted Pokemon", () => {
    // Guards against a reconnect mid-run re-triggering old deaths.
    const state = newRun();
    const events = applySnapshot(
      state,
      snap("a", "Route 103", [mon(1, 252, { currentHp: 0 })]),
    );
    expect(events.some((e) => e.type === "death_pending")).toBe(false);
  });

  it("ignores confirmation for a route with nothing pending", () => {
    const state = runWithPair();
    expect(confirmDeath(state, "Route 103")).toEqual([]);
    expect(confirmDeath(state, "Nowhere")).toEqual([]);
  });

  it("counts each dead pair once", () => {
    const state = runWithPair();
    applySnapshot(state, snap("a", "Route 104", [mon(1, 252), mon(3, 263)]));
    applySnapshot(state, snap("b", "Route 104", [mon(2, 255), mon(4, 265)]));

    applySnapshot(
      state,
      snap("a", "Route 103", [mon(1, 252, { currentHp: 0 }), mon(3, 263)]),
    );
    confirmDeath(state, "Route 103");
    expect(toRunState(state).deaths).toBe(1);
  });
});

describe("voiding a whiffed route", () => {
  it("clears both halves and forfeits the partner's catch", () => {
    const state = newRun();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252)]));
    voidRoute(state, "Route 103");

    const pair = pairsOf(state)[0]!;
    expect(pair.status).toBe("void");
    expect(pair.a).toBeUndefined();
    expect(pair.b).toBeUndefined();
  });

  it("stops a voided route from absorbing later encounters", () => {
    const state = newRun();
    voidRoute(state, "Route 103");
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252)]));
    expect(pairsOf(state)[0]!.a).toBeUndefined();
  });
});

describe("manual re-pairing", () => {
  it("moves a Pokemon to a different route", () => {
    const state = newRun();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252)]));

    expect(repair(state, "Route 104", "a", 1)).toBe(true);

    const byRoute = new Map(pairsOf(state).map((p) => [p.route, p]));
    expect(byRoute.get("Route 103")!.a).toBeUndefined();
    expect(byRoute.get("Route 104")!.a?.pid).toBe(1);
  });

  it("refuses a PID that is not in the player's party", () => {
    const state = newRun();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252)]));
    expect(repair(state, "Route 104", "a", 999)).toBe(false);
  });
});

/**
 * Whiting out heals the whole party, so HP returns to full moments after a
 * faint. A Nuzlocke must not treat that as a resurrection.
 */
describe("healing after a faint", () => {
  function runWithPair() {
    const state = newRun();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252)]));
    applySnapshot(state, snap("b", "Route 103", [mon(2, 255)]));
    return state;
  }

  it("keeps a confirmed death dead once the game heals it", () => {
    const state = runWithPair();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252, { currentHp: 0 })]));
    confirmDeath(state, "Route 103");

    // White out -> Pokemon Center -> back to full HP.
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252, { currentHp: 20 })]));

    const pair = pairsOf(state)[0]!;
    expect(pair.status).toBe("dead");
    expect(pair.a?.fainted).toBe(true);
    expect(toRunState(state).deaths).toBe(1);
  });

  it("keeps the prompt pending if the heal happens before confirmation", () => {
    // The likely real sequence: you faint, white out, and only then reach for
    // the confirm button.
    const state = runWithPair();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252, { currentHp: 0 })]));
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252, { currentHp: 20 })]));

    expect(pairsOf(state)[0]!.status).toBe("pending");

    confirmDeath(state, "Route 103");
    expect(pairsOf(state)[0]!.status).toBe("dead");
  });

  it("does not raise a second prompt when a healed Pokemon faints again", () => {
    const state = runWithPair();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252, { currentHp: 0 })]));
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252, { currentHp: 20 })]));

    const events = applySnapshot(
      state,
      snap("a", "Route 103", [mon(1, 252, { currentHp: 0 })]),
    );
    // Already pending; one faint, one prompt.
    expect(events.filter((e) => e.type === "death_pending")).toHaveLength(0);
  });

  it("counts a death once even if the Pokemon faints repeatedly", () => {
    const state = runWithPair();
    for (const hp of [0, 20, 0, 20, 0]) {
      applySnapshot(state, snap("a", "Route 103", [mon(1, 252, { currentHp: hp })]));
    }
    confirmDeath(state, "Route 103");
    expect(toRunState(state).deaths).toBe(1);
  });
});

describe("randomised runs", () => {
  /** Zigzagoon (263) and Linoone (264) are one family in vanilla. */
  function runWithFamilyDupe(randomised: boolean) {
    const state = createRun("run1", "K7QP2M", randomised);
    applySnapshot(state, snap("a", "Route 103", [mon(1, 263)]));
    applySnapshot(state, snap("a", "Route 104", [mon(1, 263), mon(2, 264)]));
    return state;
  }

  it("groups evolution families by default", () => {
    const warnings = toRunState(runWithFamilyDupe(false)).warnings;
    expect(warnings.filter((w) => w.kind === "dupes")).toHaveLength(1);
  });

  it("falls back to exact species when randomised", () => {
    // A randomiser rewrites evolutions, so Linoone may not follow Zigzagoon.
    const warnings = toRunState(runWithFamilyDupe(true)).warnings;
    expect(warnings.filter((w) => w.kind === "dupes")).toHaveLength(0);
  });

  it("still flags an exact-species dupe when randomised", () => {
    const state = createRun("run1", "K7QP2M", true);
    applySnapshot(state, snap("a", "Route 103", [mon(1, 263)]));
    applySnapshot(state, snap("a", "Route 104", [mon(1, 263), mon(2, 263)]));
    expect(
      toRunState(state).warnings.filter((w) => w.kind === "dupes"),
    ).toHaveLength(1);
  });

  it("reports the flag in run state", () => {
    expect(toRunState(createRun("r", "C", true)).randomised).toBe(true);
    expect(toRunState(createRun("r", "C")).randomised).toBe(false);
  });
});

describe("level cap", () => {
  it("follows whichever player has more badges", () => {
    const state = newRun();
    applySnapshot(state, snap("a", "Route 103", [mon(1, 252)], { badges: 1 }));
    applySnapshot(state, snap("b", "Route 103", [mon(2, 255)], { badges: 3 }));
    expect(toRunState(state).levelCap).toBe(29);
  });

  it("starts at the zero-badge cap", () => {
    expect(toRunState(newRun()).levelCap).toBe(15);
  });
});
