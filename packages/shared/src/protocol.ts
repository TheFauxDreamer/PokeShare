/**
 * The wire contract between the play view, the server and the display views.
 *
 * The emulator side is a dumb sensor: it sends {@link PlayerSnapshot} and
 * nothing else. Every rule -- pairing, deaths, clauses, level caps -- is
 * decided by the server, so adding a future generation means writing one new
 * reader, not touching any rules code.
 */

export type PlayerId = "a" | "b";

/** A Pokemon as it currently exists in a player's party. */
export interface PartyMemberState {
  /** Gen 3 personality value: stable across nicknames, levels and reordering. */
  readonly pid: number;
  readonly slot: number;
  readonly nationalDex: number | undefined;
  readonly nickname: string;
  readonly level: number;
  readonly currentHp: number;
  readonly maxHp: number;
  readonly status: number;
  readonly isEgg: boolean;
  readonly isShiny: boolean;
  /**
   * Elemental types, read from the ROM's base-stats table so they stay correct
   * on randomised ROMs. Empty when the ROM has not been read.
   */
  readonly types: readonly string[];
}

/** One poll's worth of observed state. Sent only when it differs. */
export interface PlayerSnapshot {
  readonly player: PlayerId;
  /** Milliseconds since epoch, set by the client that observed it. */
  readonly observedAt: number;
  readonly gameCode: string;
  readonly party: readonly PartyMemberState[];
  readonly route: string | undefined;
  readonly badges: number;
  readonly inWildBattle: boolean;
  /** Lead of the opposing party during a wild battle. */
  readonly wildEncounterDex: number | undefined;
}

export type PairStatus =
  /** Both halves caught and alive. */
  | "alive"
  /** A faint was detected and is awaiting confirmation. */
  | "pending"
  /** Confirmed dead; both halves are retired. */
  | "dead"
  /** One or both players whiffed the encounter; the route is void. */
  | "void";

/** One half of a soul-link pair. */
export interface PairMember {
  readonly pid: number;
  readonly nationalDex: number | undefined;
  readonly nickname: string;
  readonly level: number;
  readonly fainted: boolean;
}

/**
 * A soul-link pair, keyed on the route both encounters happened on.
 *
 * Either half may be absent while the other player has not reached that route
 * yet -- pairs form retroactively, which is what lets the two runs drift out of
 * sync without breaking anything.
 */
export interface SoulLinkPair {
  readonly id: string;
  readonly route: string;
  readonly a: PairMember | undefined;
  readonly b: PairMember | undefined;
  readonly status: PairStatus;
  /** Set when status is "pending": which side's faint triggered it. */
  readonly triggeredBy: PlayerId | undefined;
}

/**
 * Verdict on the wild Pokemon currently on screen.
 *
 * Surfaced while the player is still in the encounter, because that is the only
 * moment the answer is actionable: catch it, or run and re-roll.
 */
export type EncounterVerdict =
  /** Nothing wrong with it. */
  | "catchable"
  /** This route's encounter is already used. */
  | "route_taken"
  /** The route was marked as having no valid encounter. */
  | "route_void"
  /** You already caught this evolutionary family. */
  | "dupe"
  /** Your partner's encounter here is the same family, so the link is illegal. */
  | "species_clash";

export interface EncounterAdvice {
  readonly verdict: EncounterVerdict;
  /** The wild Pokemon being faced. */
  readonly nationalDex: number | undefined;
  /**
   * The already-caught Pokemon that makes this encounter illegal, if any.
   *
   * This is what the message names, and what the overlay shows: the wild one is
   * already on screen behind the overlay, so its sprite adds nothing, whereas
   * the blocker is the thing you cannot see.
   */
  readonly blockerDex: number | undefined;
  readonly blockerNickname: string | undefined;
  readonly route: string | undefined;
  readonly message: string;
  /** True when the run's rules say this one should be re-rolled. */
  readonly rerollNeeded: boolean;
}

export interface ClauseWarning {
  readonly kind: "dupes" | "species";
  readonly route: string;
  readonly message: string;
}

export interface RunState {
  readonly runId: string;
  readonly joinCode: string;
  /**
   * True when both players are on UPR-ZX randomised ROMs. Randomisers rewrite
   * the evolution table, so the bundled vanilla families no longer apply and
   * the clauses fall back to exact-species matching.
   */
  readonly randomised: boolean;
  readonly players: Readonly<Record<PlayerId, PlayerSnapshot | undefined>>;
  /** Display names players chose for themselves; falls back to "Player A/B". */
  readonly names: Readonly<Record<PlayerId, string | undefined>>;
  readonly pairs: readonly SoulLinkPair[];
  readonly warnings: readonly ClauseWarning[];
  /** Live verdict per player, set only while that player is in a wild battle. */
  readonly advice: Readonly<Record<PlayerId, EncounterAdvice | undefined>>;
  /** Highest level legal at the current badge count. */
  readonly levelCap: number | undefined;
  readonly deaths: number;
}

/* ---------------------------------------------------------------- messages */

/**
 * Stable per-browser identity, persisted client-side.
 *
 * Seats are bound to this rather than to a connection: a dropped socket, a page
 * reload or a server restart must all return the same person to the same seat.
 * Getting this wrong swaps the two players and misattributes a whole party.
 */
export type ClientId = string;

export type ClientMessage =
  | {
      readonly type: "create_run";
      readonly clientId: ClientId;
      readonly randomised?: boolean;
    }
  | {
      readonly type: "join_run";
      readonly clientId: ClientId;
      readonly joinCode: string;
    }
  | { readonly type: "snapshot"; readonly snapshot: PlayerSnapshot }
  /** Set this player's display name, shown on the stream and pairs views. */
  | { readonly type: "set_name"; readonly name: string }
  /** Operator confirms a detected faint; cascades to the linked partner. */
  | { readonly type: "confirm_death"; readonly pairId: string }
  /** Operator marks a route as having no valid encounter for either player. */
  | { readonly type: "void_route"; readonly route: string }
  /** Manual override when auto-pairing gets it wrong. */
  | { readonly type: "repair_pair"; readonly pairId: string; readonly pid: number; readonly player: PlayerId }
  /** WebRTC signalling, relayed verbatim between peers. */
  | { readonly type: "signal"; readonly to: PlayerId | "stream"; readonly payload: unknown };

export type ServerMessage =
  /** `player` is undefined for a spectator (both seats already claimed). */
  | {
      readonly type: "run_created";
      readonly runId: string;
      readonly joinCode: string;
      readonly player: PlayerId | undefined;
    }
  | { readonly type: "state"; readonly state: RunState }
  /** A faint needs operator confirmation before the cascade is applied. */
  | { readonly type: "death_pending"; readonly pair: SoulLinkPair }
  | { readonly type: "signal"; readonly from: PlayerId | "stream"; readonly payload: unknown }
  | { readonly type: "error"; readonly message: string };

/**
 * How close to the cap counts as a warning.
 *
 * Over-levelling is irreversible — you cannot un-gain experience — so the
 * useful moment to say something is *before* it happens, not after.
 */
export const LEVEL_CAP_WARNING_MARGIN = 3;

export type LevelCapStatus = "ok" | "near" | "over";

export function levelCapStatus(
  level: number,
  cap: number | undefined,
): LevelCapStatus {
  if (cap === undefined) return "ok";
  if (level > cap) return "over";
  if (level > cap - LEVEL_CAP_WARNING_MARGIN) return "near";
  return "ok";
}

/** Gym badges earned to level cap. Index is the badge count. */
export const DEFAULT_LEVEL_CAPS: readonly number[] = [
  15, 19, 24, 29, 31, 33, 42, 46, 58,
];

export function levelCapForBadges(badges: number): number | undefined {
  return DEFAULT_LEVEL_CAPS[Math.min(badges, DEFAULT_LEVEL_CAPS.length - 1)];
}

/** Longest display name accepted, to keep the stream layout stable. */
export const MAX_PLAYER_NAME = 20;

/** Trim and clamp a player-supplied name; empty means "use the default". */
export function normalisePlayerName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_PLAYER_NAME);
}

/** What to show for a player, given whatever name they set. */
export function displayName(
  player: PlayerId,
  name: string | undefined,
): string {
  return name && name.length > 0 ? name : `Player ${player.toUpperCase()}`;
}
