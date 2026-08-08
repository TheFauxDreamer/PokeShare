/**
 * Dupes clause and species clause.
 *
 * Both operate on *evolutionary families*, not bare species -- catching a
 * Zigzagoon after already owning a Linoone is still a dupe. Families come from
 * a {@link FamilyResolver} rather than a baked-in table, because a randomised
 * ROM rewrites evolutions: the correct source is the game's own evolution table
 * read out of ROM. Until that is wired up (see PLAN.md Phase 7) the default
 * resolver treats every species as its own family, which makes both clauses
 * exact-species checks -- correct but slightly permissive.
 */

import type { ClauseWarning, PlayerId, SoulLinkPair } from "@pokeshare/shared";

/**
 * Map a National Dex number to a stable identifier for its evolution family.
 * Returning the input unchanged disables family grouping.
 */
export type FamilyResolver = (nationalDex: number) => number;

const PLAYERS: readonly PlayerId[] = ["a", "b"];

/** Pairs that are void or dead no longer constrain future encounters. */
function isLive(pair: SoulLinkPair): boolean {
  return pair.status !== "void";
}

/**
 * Dupes clause: the same family caught twice by the *same* player.
 *
 * Reported against the later route, which is the one that should be re-rolled.
 */
function dupeWarnings(
  pairs: readonly SoulLinkPair[],
  familyOf: FamilyResolver,
): ClauseWarning[] {
  const warnings: ClauseWarning[] = [];

  for (const player of PLAYERS) {
    const seenAt = new Map<number, string>();
    for (const pair of pairs) {
      if (!isLive(pair)) continue;
      const dex = pair[player]?.nationalDex;
      if (dex === undefined) continue;

      const family = familyOf(dex);
      const previous = seenAt.get(family);
      if (previous === undefined) {
        seenAt.set(family, pair.route);
      } else {
        warnings.push({
          kind: "dupes",
          route: pair.route,
          message:
            `Player ${player.toUpperCase()}: ${pair[player]!.nickname} on ` +
            `${pair.route} duplicates a family already caught on ${previous}.`,
        });
      }
    }
  }

  return warnings;
}

/**
 * Species clause on pairs: a pair whose two halves are the same family.
 *
 * Linking a species to itself makes the soul link meaningless, and most groups
 * ban it outright.
 */
function speciesWarnings(
  pairs: readonly SoulLinkPair[],
  familyOf: FamilyResolver,
): ClauseWarning[] {
  const warnings: ClauseWarning[] = [];

  for (const pair of pairs) {
    if (!isLive(pair)) continue;
    const a = pair.a?.nationalDex;
    const b = pair.b?.nationalDex;
    if (a === undefined || b === undefined) continue;

    if (familyOf(a) === familyOf(b)) {
      warnings.push({
        kind: "species",
        route: pair.route,
        message:
          `${pair.route} links two Pokémon of the same family ` +
          `(${pair.a!.nickname} / ${pair.b!.nickname}).`,
      });
    }
  }

  return warnings;
}

export function checkClauses(
  pairs: readonly SoulLinkPair[],
  familyOf: FamilyResolver = (dex) => dex,
): ClauseWarning[] {
  return [...dupeWarnings(pairs, familyOf), ...speciesWarnings(pairs, familyOf)];
}
