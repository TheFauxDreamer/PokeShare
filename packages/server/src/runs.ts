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

import type { ClientId, PlayerId } from "@pokeshare/shared";
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

  /** @param randomised both players are on UPR-ZX ROMs; see createRun. */
  create(randomised = false): Run {
    let joinCode = randomCode();
    while (this.byJoinCode.has(joinCode)) joinCode = randomCode();

    const runId = globalThis.crypto.randomUUID();
    const run: Run = { state: createRun(runId, joinCode, randomised) };

    this.byId.set(runId, run);
    this.byJoinCode.set(joinCode, runId);
    return run;
  }

  /** Register a run restored from disk. */
  adopt(state: EngineState): Run {
    // Seats come back with the state, so a restored run keeps who was who.
    const run: Run = { state };
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
   * Claim a player slot for a client, or return the one it already holds.
   *
   * Returns `undefined` when both seats belong to other clients — that is a
   * spectator (the /stream and /pairs views), not an error.
   */
  seat(run: Run, clientId: ClientId): PlayerId | undefined {
    const seats = run.state.seats;
    for (const [player, owner] of seats) {
      if (owner === clientId) return player; // reclaim
    }
    for (const player of ["a", "b"] as const) {
      if (!seats.has(player)) {
        seats.set(player, clientId);
        return player;
      }
    }
    return undefined;
  }

  /**
   * Give up a seat explicitly.
   *
   * Deliberately NOT called on disconnect — see the note on {@link Run.seats}.
   * It exists for the case where someone genuinely changes machines and needs
   * to hand their slot over.
   */
  release(run: Run, clientId: ClientId): void {
    for (const [player, owner] of run.state.seats) {
      if (owner === clientId) run.state.seats.delete(player);
    }
  }
}
