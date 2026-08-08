import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PartyMemberState, PlayerId, PlayerSnapshot } from "@pokeshare/shared";
import {
  applySnapshot,
  confirmDeath,
  createRun,
  pairsOf,
  toRunState,
  voidRoute,
} from "../src/engine.js";
import {
  deserialise,
  loadAllRuns,
  loadRun,
  saveRun,
  serialise,
} from "../src/persistence.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pokeshare-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function mon(pid: number, dex: number, hp = 20): PartyMemberState {
  return {
    pid,
    slot: 0,
    nationalDex: dex,
    nickname: `MON${pid}`,
    level: 10,
    currentHp: hp,
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
): PlayerSnapshot {
  return {
    player,
    observedAt: 1,
    gameCode: "BPEE",
    party,
    route,
    badges: 2,
    inWildBattle: false,
    wildEncounterDex: undefined,
  };
}

/** A run with a live pair, a confirmed death and a voided route. */
function busyRun() {
  const state = createRun("run-1", "K7QP2M");
  applySnapshot(state, snap("a", "Route 103", [mon(1, 252)]));
  applySnapshot(state, snap("b", "Route 103", [mon(2, 255)]));
  applySnapshot(state, snap("a", "Route 104", [mon(1, 252), mon(3, 263)]));
  applySnapshot(state, snap("b", "Route 104", [mon(2, 255), mon(4, 265)]));
  applySnapshot(state, snap("a", "Route 103", [mon(1, 252, 0), mon(3, 263)]));
  confirmDeath(state, "Route 103");
  voidRoute(state, "Route 110");
  return state;
}

describe("round-tripping a run", () => {
  it("preserves the full projected state", () => {
    const original = busyRun();
    const restored = deserialise(serialise(original));
    expect(toRunState(restored)).toEqual(toRunState(original));
  });

  it("preserves pairs, statuses and routes", () => {
    const restored = deserialise(serialise(busyRun()));
    const byRoute = new Map(pairsOf(restored).map((p) => [p.route, p]));

    expect(byRoute.get("Route 103")!.status).toBe("dead");
    expect(byRoute.get("Route 104")!.status).toBe("alive");
    expect(byRoute.get("Route 110")!.status).toBe("void");
    expect(byRoute.get("Route 104")!.a?.nickname).toBe("MON3");
  });

  it("restores Sets and Maps rather than leaving empty objects", () => {
    const restored = deserialise(serialise(busyRun()));
    expect(restored.seenPids.a).toBeInstanceOf(Set);
    expect(restored.seenPids.a.has(1)).toBe(true);
    expect(restored.lastHp.a).toBeInstanceOf(Map);
    expect(restored.lastHp.a.get(1)).toBe(0);
  });

  it("keeps faint detection edge-triggered after a restore", () => {
    // The restored lastHp means an already-fainted Pokemon must not re-prompt.
    const restored = deserialise(serialise(busyRun()));
    const events = applySnapshot(
      restored,
      snap("a", "Route 103", [mon(1, 252, 0), mon(3, 263)]),
    );
    expect(events.some((e) => e.type === "death_pending")).toBe(false);
  });

  it("keeps a randomised run randomised", async () => {
    // Dropping this flag would silently switch the clauses back to vanilla
    // evolution families, which are wrong for a randomised ROM.
    const state = createRun("run-r", "AAAAAA", true);
    applySnapshot(state, snap("a", "Route 103", [mon(1, 263)]));
    applySnapshot(state, snap("a", "Route 104", [mon(1, 263), mon(2, 264)]));

    await saveRun(directory, state);
    const restored = (await loadRun(directory, "run-r"))!;

    expect(restored.randomised).toBe(true);
    expect(toRunState(restored).randomised).toBe(true);
    // Exact-species matching survives the round trip: 263/264 is not a dupe.
    expect(
      toRunState(restored).warnings.filter((w) => w.kind === "dupes"),
    ).toHaveLength(0);
  });

  it("preserves seat ownership across a restart", async () => {
    // A restart that reshuffled seats would swap the two players just as
    // surely as a reconnect did.
    const state = createRun("run-s", "BBBBBB");
    state.seats.set("a", "alice-client");
    state.seats.set("b", "bob-client");

    await saveRun(directory, state);
    const restored = (await loadRun(directory, "run-s"))!;

    expect(restored.seats.get("a")).toBe("alice-client");
    expect(restored.seats.get("b")).toBe("bob-client");
  });

  it("rejects an unknown format version", () => {
    const stored = { ...serialise(busyRun()), version: 99 };
    expect(() => deserialise(stored)).toThrow(/format/i);
  });
});

describe("on-disk storage", () => {
  it("saves and reloads a run", async () => {
    const original = busyRun();
    await saveRun(directory, original);

    const restored = await loadRun(directory, "run-1");
    expect(restored).toBeDefined();
    expect(toRunState(restored!)).toEqual(toRunState(original));
  });

  it("returns undefined for a run that is not there", async () => {
    expect(await loadRun(directory, "nope")).toBeUndefined();
  });

  it("leaves no temp file behind", async () => {
    await saveRun(directory, busyRun());
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(directory)).some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("loads every run in the directory", async () => {
    await saveRun(directory, busyRun());
    const second = createRun("run-2", "AAAAAA");
    await saveRun(directory, second);

    const runs = await loadAllRuns(directory);
    expect(runs.map((r) => r.runId).sort()).toEqual(["run-1", "run-2"]);
  });

  it("skips a corrupt file instead of failing the whole load", async () => {
    await saveRun(directory, busyRun());
    await writeFile(join(directory, "broken.json"), "{not json", "utf8");

    const runs = await loadAllRuns(directory);
    expect(runs.map((r) => r.runId)).toEqual(["run-1"]);
  });

  it("returns nothing for a directory that does not exist", async () => {
    expect(await loadAllRuns(join(directory, "missing"))).toEqual([]);
  });
});
