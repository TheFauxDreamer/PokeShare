/**
 * The run registry: creating runs, minting join codes, seating players.
 *
 * A "run" is the shared link between two games. Player A creates one and hands
 * the join code to B; from then on both browsers are subscribed to the same
 * run and nothing else needs to be exchanged by hand.
 *
 * State is in memory. Persisting to SQLite is a later phase -- restarting the
 * server currently loses a run.
 */

import type { PlayerId } from "@pokeshare/shared";
import { createRun, type EngineState } from "./engine.js";

/**
 * Join-code alphabet with the ambiguous glyphs removed (no O/0, I/1, S/5).
 * These get read aloud over voice chat, so confusable characters are a real
 * cost.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";
const JOIN_CODE_LENGTH = 6;

export interface Run {
  readonly state: EngineState;
  /** Which player slots have been claimed. */
  readonly seats: Map<PlayerId, symbol>;
}

function randomCode(): string {
  const bytes = new Uint8Array(JOIN_CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

export class RunRegistry {
  private readonly byId = new Map<string, Run>();
  private readonly byJoinCode = new Map<string, string>();

  create(): Run {
    let joinCode = randomCode();
    while (this.byJoinCode.has(joinCode)) joinCode = randomCode();

    const runId = globalThis.crypto.randomUUID();
    const run: Run = { state: createRun(runId, joinCode), seats: new Map() };

    this.byId.set(runId, run);
    this.byJoinCode.set(joinCode, runId);
    return run;
  }

  /** Register a run restored from disk. */
  adopt(state: EngineState): Run {
    const run: Run = { state, seats: new Map() };
    this.byId.set(state.runId, run);
    this.byJoinCode.set(state.joinCode, state.runId);
    return run;
  }

  /** Every live run, for periodic persistence. */
  all(): Run[] {
    return [...this.byId.values()];
  }

  byCode(joinCode: string): Run | undefined {
    const runId = this.byJoinCode.get(joinCode.toUpperCase());
    return runId === undefined ? undefined : this.byId.get(runId);
  }

  get(runId: string): Run | undefined {
    return this.byId.get(runId);
  }

  /**
   * Claim a player slot. Returns the assigned id, or `undefined` when both
   * seats are already taken.
   *
   * `token` identifies the connection so a reconnecting player reclaims their
   * own seat instead of being handed the partner's.
   */
  seat(run: Run, token: symbol): PlayerId | undefined {
    for (const [player, held] of run.seats) {
      if (held === token) return player;
    }
    for (const player of ["a", "b"] as const) {
      if (!run.seats.has(player)) {
        run.seats.set(player, token);
        return player;
      }
    }
    return undefined;
  }

  release(run: Run, token: symbol): void {
    for (const [player, held] of run.seats) {
      if (held === token) run.seats.delete(player);
    }
  }
}
