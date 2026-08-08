/**
 * Run persistence.
 *
 * A run spans a whole stream, so losing it to a server restart is not
 * acceptable. Storage is a JSON file per run, written atomically.
 *
 * JSON rather than SQLite deliberately: there are two players and one run at a
 * time, the whole state is a few kilobytes, and better-sqlite3 is a native
 * module that needs a toolchain to build. If this ever needs many concurrent
 * runs or real queries, swap the two functions below.
 *
 * `EngineState` contains Maps and Sets, which JSON cannot represent, so the
 * shape is converted explicitly rather than relying on a replacer -- an
 * accidental `{}` here would silently lose an entire run's pairs.
 */

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PlayerId, PlayerSnapshot } from "@pokeshare/shared";
import type { EncounterRecord, EngineState } from "./engine.js";
import { createRun } from "./engine.js";

const FORMAT_VERSION = 1;

interface StoredRoute {
  readonly route: string;
  readonly a: EncounterRecord | undefined;
  readonly b: EncounterRecord | undefined;
  readonly pendingBy: PlayerId | undefined;
  readonly voided: boolean;
}

interface StoredRun {
  readonly version: number;
  readonly runId: string;
  readonly joinCode: string;
  readonly snapshots: Record<PlayerId, PlayerSnapshot | undefined>;
  readonly routes: readonly StoredRoute[];
  readonly seenPids: Record<PlayerId, number[]>;
  readonly lastHp: Record<PlayerId, [number, number][]>;
}

export function serialise(state: EngineState): StoredRun {
  return {
    version: FORMAT_VERSION,
    runId: state.runId,
    joinCode: state.joinCode,
    snapshots: { a: state.snapshots.a, b: state.snapshots.b },
    routes: [...state.routes].map(([route, entry]) => ({
      route,
      a: entry.a,
      b: entry.b,
      pendingBy: entry.pendingBy,
      voided: entry.voided,
    })),
    seenPids: {
      a: [...state.seenPids.a],
      b: [...state.seenPids.b],
    },
    lastHp: {
      a: [...state.lastHp.a],
      b: [...state.lastHp.b],
    },
  };
}

export function deserialise(stored: StoredRun): EngineState {
  if (stored.version !== FORMAT_VERSION) {
    throw new Error(
      `Unsupported run format ${stored.version}; expected ${FORMAT_VERSION}`,
    );
  }

  const state = createRun(stored.runId, stored.joinCode);
  state.snapshots.a = stored.snapshots.a;
  state.snapshots.b = stored.snapshots.b;

  for (const entry of stored.routes) {
    state.routes.set(entry.route, {
      a: entry.a,
      b: entry.b,
      pendingBy: entry.pendingBy,
      voided: entry.voided,
    });
  }
  for (const player of ["a", "b"] as const) {
    state.seenPids[player] = new Set(stored.seenPids[player]);
    state.lastHp[player] = new Map(stored.lastHp[player]);
  }
  return state;
}

/** Write via a temp file + rename so a crash mid-write cannot truncate a run. */
export async function saveRun(directory: string, state: EngineState): Promise<void> {
  const path = join(directory, `${state.runId}.json`);
  await mkdir(dirname(path), { recursive: true });

  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(serialise(state)), "utf8");
  await rename(temporary, path);
}

export async function loadRun(
  directory: string,
  runId: string,
): Promise<EngineState | undefined> {
  try {
    const raw = await readFile(join(directory, `${runId}.json`), "utf8");
    return deserialise(JSON.parse(raw) as StoredRun);
  } catch {
    return undefined;
  }
}

/** Restore every run on the disk, skipping any that fail to parse. */
export async function loadAllRuns(directory: string): Promise<EngineState[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const runs: EngineState[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const state = await loadRun(directory, entry.slice(0, -".json".length));
    // One corrupt file must not prevent the others from loading.
    if (state) runs.push(state);
  }
  return runs;
}
