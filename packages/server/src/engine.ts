/**
 * The Soul Link rules engine.
 *
 * Everything the players see is derived here from raw {@link PlayerSnapshot}s.
 * The emulator side never decides anything, which is what keeps a future
 * generation to "write one new reader".
 *
 * Two design choices are load-bearing:
 *
 *  - **Pairs are keyed on route name.** So the two runs may drift arbitrarily
 *    far apart: A's Route 110 encounter simply waits until B reaches Route 110,
 *    then the pair forms retroactively. No lockstep, no checkpoints.
 *  - **A catch is a new PID appearing in the party**, not a battle starting.
 *    The party is the ground truth for what was actually caught; watching
 *    battles would misfire on every Pokemon that fled or fainted.
 *
 * State is mutated in place. The server owns exactly one instance per run.
 */

import {
  exactSpecies,
  familyOf as vanillaFamilyOf,
  layoutForGameCode,
  levelCapFor,
} from "@pokeshare/data";
import {
  type ClientId,
  normalisePlayerName,
  type ClauseWarning,
  type EncounterAdvice,
  type EncounterVerdict,
  type PairMember,
  type PairStatus,
  type PartyMemberState,
  type PlayerId,
  type PlayerSnapshot,
  type RunState,
  type SoulLinkPair,
} from "@pokeshare/shared";
import { checkClauses, type FamilyResolver } from "./clauses.js";

export const PLAYERS: readonly PlayerId[] = ["a", "b"];

/** One player's half of a route's encounter. */
export interface EncounterRecord {
  readonly pid: number;
  readonly nationalDex: number | undefined;
  nickname: string;
  level: number;
  fainted: boolean;
  /** Confirmed dead, either directly or via the soul-link cascade. */
  dead: boolean;
}

interface RouteEntry {
  a: EncounterRecord | undefined;
  b: EncounterRecord | undefined;
  /** Set when a faint is awaiting operator confirmation. */
  pendingBy: PlayerId | undefined;
  voided: boolean;
}

export interface EngineState {
  readonly runId: string;
  readonly joinCode: string;
  readonly snapshots: Record<PlayerId, PlayerSnapshot | undefined>;
  /** Insertion-ordered so pairs display in the order they were caught. */
  readonly routes: Map<string, RouteEntry>;
  /** Every PID ever seen in each player's party, to detect genuinely new ones. */
  readonly seenPids: Record<PlayerId, Set<number>>;
  /** Last observed HP per PID, for edge-triggered faint detection. */
  readonly lastHp: Record<PlayerId, Map<number, number>>;
  readonly familyOf: FamilyResolver;
  /** True for a UPR-ZX ROM, where vanilla evolution families do not apply. */
  readonly randomised: boolean;
  /**
   * Player slot -> owning client. Part of run state, not connection state, so
   * it survives both a reconnect and a server restart.
   */
  readonly seats: Map<PlayerId, ClientId>;
  /** Display names, chosen by the players themselves. */
  readonly names: Record<PlayerId, string | undefined>;
}

export type EngineEvent =
  | { readonly type: "pair_formed"; readonly route: string }
  | { readonly type: "death_pending"; readonly route: string; readonly by: PlayerId }
  | { readonly type: "death_confirmed"; readonly route: string };

/**
 * Create a run.
 *
 * `randomised` selects the clause resolver: vanilla evolution families by
 * default, exact species for a UPR-ZX ROM (whose evolutions differ from
 * vanilla, making the bundled family table wrong).
 */
export function createRun(
  runId: string,
  joinCode: string,
  randomised = false,
): EngineState {
  const familyOf: FamilyResolver = randomised ? exactSpecies : vanillaFamilyOf;
  return buildRun(runId, joinCode, familyOf, randomised);
}

function buildRun(
  runId: string,
  joinCode: string,
  familyOf: FamilyResolver,
  randomised: boolean,
): EngineState {
  return {
    runId,
    joinCode,
    snapshots: { a: undefined, b: undefined },
    routes: new Map(),
    seenPids: { a: new Set(), b: new Set() },
    lastHp: { a: new Map(), b: new Map() },
    familyOf,
    randomised,
    seats: new Map(),
    names: { a: undefined, b: undefined },
  };
}

/** Record a display name for a player. Empty clears it back to the default. */
export function setName(
  state: EngineState,
  player: PlayerId,
  name: string,
): void {
  const clean = normalisePlayerName(name);
  state.names[player] = clean.length > 0 ? clean : undefined;
}

function entryFor(state: EngineState, route: string): RouteEntry {
  let entry = state.routes.get(route);
  if (!entry) {
    entry = { a: undefined, b: undefined, pendingBy: undefined, voided: false };
    state.routes.set(route, entry);
  }
  return entry;
}

function toRecord(member: PartyMemberState): EncounterRecord {
  return {
    pid: member.pid,
    nationalDex: member.nationalDex,
    nickname: member.nickname,
    level: member.level,
    fainted: member.currentHp === 0,
    dead: false,
  };
}

/** Has this player registered any encounter yet? */
function hasAnyEncounter(state: EngineState, player: PlayerId): boolean {
  for (const entry of state.routes.values()) {
    if (entry[player]) return true;
  }
  return false;
}

/**
 * Where an encounter should be recorded.
 *
 * Normally the route you are standing on — except for the starter. In
 * Ruby/Sapphire/Emerald the bag opens while you are on Route 101, so the
 * starter would eat that route's single encounter and leave you unable to
 * catch anything there. Only the run's *first* catch is remapped, so a later
 * genuine Route 101 encounter is unaffected.
 */
function locationFor(
  state: EngineState,
  player: PlayerId,
  snapshot: PlayerSnapshot,
): string | undefined {
  const route = snapshot.route;
  if (!route) return undefined;

  const fix = layoutForGameCode(snapshot.gameCode)?.starterFix;
  if (fix && route === fix.obtainedOn && !hasAnyEncounter(state, player)) {
    return fix.recordAs;
  }
  return route;
}

/** Find the route a given PID was registered under, if any. */
function routeOfPid(
  state: EngineState,
  player: PlayerId,
  pid: number,
): string | undefined {
  for (const [route, entry] of state.routes) {
    if (entry[player]?.pid === pid) return route;
  }
  return undefined;
}

/**
 * Fold one snapshot into the run.
 *
 * Returns the events it produced so the caller can push `death_pending`
 * prompts without diffing state itself.
 */
export function applySnapshot(
  state: EngineState,
  snapshot: PlayerSnapshot,
): EngineEvent[] {
  const events: EngineEvent[] = [];
  const player = snapshot.player;
  state.snapshots[player] = snapshot;

  const seen = state.seenPids[player];
  const lastHp = state.lastHp[player];

  for (const member of snapshot.party) {
    const isNew = !seen.has(member.pid);
    seen.add(member.pid);

    // A brand-new party member on a known location is that location's
    // encounter, unless it already has one (only the first counts).
    const location = isNew ? locationFor(state, player, snapshot) : undefined;
    if (location) {
      const entry = entryFor(state, location);
      if (!entry[player] && !entry.voided) {
        entry[player] = toRecord(member);
        if (entry.a && entry.b) {
          events.push({ type: "pair_formed", route: location });
        }
      }
    }

    const route = routeOfPid(state, player, member.pid);
    const record = route ? state.routes.get(route)![player] : undefined;
    if (record) {
      record.level = member.level;
      record.nickname = member.nickname;
    }

    // Edge-triggered: only a >0 -> 0 transition is a faint. A Pokemon that is
    // simply *observed* at 0 HP (e.g. first snapshot after a reconnect) must
    // not re-trigger a prompt that was already resolved.
    const previous = lastHp.get(member.pid);
    const justFainted = previous !== undefined && previous > 0 && member.currentHp === 0;
    lastHp.set(member.pid, member.currentHp);

    if (justFainted && route && record && !record.dead) {
      record.fainted = true;
      const entry = state.routes.get(route)!;
      if (!entry.voided && entry.pendingBy === undefined) {
        entry.pendingBy = player;
        events.push({ type: "death_pending", route, by: player });
      }
    }
  }

  return events;
}

/**
 * Confirm a pending faint. This is the cascade: both halves of the pair die,
 * including a partner sitting at full HP on the other player's team.
 */
export function confirmDeath(state: EngineState, route: string): EngineEvent[] {
  const entry = state.routes.get(route);
  if (!entry || entry.pendingBy === undefined) return [];

  entry.pendingBy = undefined;
  if (entry.a) entry.a.dead = true;
  if (entry.b) entry.b.dead = true;
  return [{ type: "death_confirmed", route }];
}

/**
 * Mark a route as having no valid encounter for either player.
 *
 * Used when someone whiffs -- the Pokemon fled or was knocked out -- so the
 * route never blocks pairing and the partner's catch is forfeit too.
 */
export function voidRoute(state: EngineState, route: string): void {
  const entry = entryFor(state, route);
  entry.voided = true;
  entry.pendingBy = undefined;
  entry.a = undefined;
  entry.b = undefined;
}

/** Manually attach a party member to a route, overriding auto-pairing. */
export function repair(
  state: EngineState,
  route: string,
  player: PlayerId,
  pid: number,
): boolean {
  const snapshot = state.snapshots[player];
  const member = snapshot?.party.find((m) => m.pid === pid);
  if (!member) return false;

  // Detach it from wherever it was previously registered.
  const previous = routeOfPid(state, player, pid);
  if (previous) state.routes.get(previous)![player] = undefined;

  const entry = entryFor(state, route);
  entry.voided = false;
  entry[player] = toRecord(member);
  return true;
}

function toPairMember(record: EncounterRecord | undefined): PairMember | undefined {
  if (!record) return undefined;
  return {
    pid: record.pid,
    nationalDex: record.nationalDex,
    nickname: record.nickname,
    level: record.level,
    fainted: record.fainted,
  };
}

function statusOf(entry: RouteEntry): PairStatus {
  if (entry.voided) return "void";
  if (entry.pendingBy !== undefined) return "pending";
  if (entry.a?.dead || entry.b?.dead) return "dead";
  return "alive";
}

export function pairsOf(state: EngineState): SoulLinkPair[] {
  return [...state.routes].map(([route, entry]) => ({
    id: `pair:${route}`,
    route,
    a: toPairMember(entry.a),
    b: toPairMember(entry.b),
    status: statusOf(entry),
    triggeredBy: entry.pendingBy,
  }));
}

/**
 * Highest badge count either player has reached drives the shared cap.
 *
 * Resolved through the game they are actually playing: the tables differ
 * substantially, with FR/LG running up to ten levels ahead of Hoenn mid-game.
 */
function currentLevelCap(state: EngineState): number | undefined {
  const badges = PLAYERS.map((p) => state.snapshots[p]?.badges ?? 0);
  const gameCode = state.snapshots.a?.gameCode ?? state.snapshots.b?.gameCode;
  return levelCapFor(gameCode, Math.max(...badges));
}

/**
 * Judge the wild Pokemon a player is currently facing.
 *
 * Checked in decisiveness order: a route that is already used or void settles
 * the question regardless of species, then the dupes clause, then whether the
 * link with the partner's catch would be legal.
 *
 * Returns `undefined` unless the player is actually in a wild battle.
 */
export function adviceFor(
  state: EngineState,
  player: PlayerId,
): EncounterAdvice | undefined {
  const snapshot = state.snapshots[player];
  if (!snapshot?.inWildBattle) return undefined;

  const route = snapshot.route;
  const dex = snapshot.wildEncounterDex;
  const entry = route ? state.routes.get(route) : undefined;

  const advice = (
    verdict: EncounterVerdict,
    message: string,
    rerollNeeded: boolean,
    blocker?: EncounterRecord,
  ): EncounterAdvice => ({
    verdict,
    nationalDex: dex,
    blockerDex: blocker?.nationalDex,
    blockerNickname: blocker?.nickname,
    route,
    message,
    rerollNeeded,
  });

  if (entry?.voided) {
    return advice("route_void", `${route} is marked as no encounter.`, true);
  }
  if (entry?.[player]) {
    const mine = entry[player]!;
    return advice(
      "route_taken",
      `You already caught ${mine.nickname} on ${route ?? "this route"}.`,
      true,
      mine,
    );
  }
  if (dex === undefined) {
    return advice("catchable", "Unknown species — no rule applies.", false);
  }

  const family = state.familyOf(dex);

  // Dupes: same family already caught by this player anywhere in the run.
  for (const [caughtRoute, candidate] of state.routes) {
    const mine = candidate[player];
    if (candidate.voided || !mine?.nationalDex) continue;
    if (state.familyOf(mine.nationalDex) === family) {
      return advice(
        "dupe",
        `Dupe — you already have ${mine.nickname} from ${caughtRoute}.`,
        true,
        mine,
      );
    }
  }

  // Species clause: the partner's catch on this route must be a different family.
  const partner = player === "a" ? "b" : "a";
  const theirs = entry?.[partner];
  if (theirs?.nationalDex && state.familyOf(theirs.nationalDex) === family) {
    return advice(
      "species_clash",
      `Same family as your partner's ${theirs.nickname} — the link would be illegal.`,
      true,
      theirs,
    );
  }

  // No detail line: "Catch Available" already says everything, and an extra
  // line of text over live gameplay is noise.
  return advice("catchable", "", false);
}

export function warningsOf(state: EngineState): ClauseWarning[] {
  return checkClauses(pairsOf(state), state.familyOf);
}

/** Project the engine's working state onto the wire format. */
export function toRunState(state: EngineState): RunState {
  const pairs = pairsOf(state);
  return {
    runId: state.runId,
    joinCode: state.joinCode,
    randomised: state.randomised,
    players: { a: state.snapshots.a, b: state.snapshots.b },
    names: { a: state.names.a, b: state.names.b },
    pairs,
    warnings: checkClauses(pairs, state.familyOf),
    advice: { a: adviceFor(state, "a"), b: adviceFor(state, "b") },
    levelCap: currentLevelCap(state),
    deaths: pairs.filter((pair) => pair.status === "dead").length,
  };
}
