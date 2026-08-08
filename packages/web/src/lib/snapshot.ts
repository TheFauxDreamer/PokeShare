/**
 * Convert an observed {@link GameSnapshot} into the wire {@link PlayerSnapshot},
 * and decide whether it is worth sending.
 *
 * Pure, so the "only transmit on change" rule is testable without an emulator.
 */

import type { GameSnapshot } from "@pokeshare/gba";
import type { PartyMemberState, PlayerId, PlayerSnapshot } from "@pokeshare/shared";

export function toPlayerSnapshot(
  snapshot: GameSnapshot,
  player: PlayerId,
  gameCode: string,
  observedAt = Date.now(),
): PlayerSnapshot {
  const party: PartyMemberState[] = snapshot.party.map((member) => ({
    pid: member.personality,
    slot: member.slot,
    nationalDex: member.nationalDex,
    nickname: member.nickname,
    level: member.level,
    currentHp: member.currentHp,
    maxHp: member.maxHp,
    status: member.status,
    isEgg: member.isEgg,
    isShiny: member.isShiny,
  }));

  return {
    player,
    observedAt,
    gameCode,
    party,
    route: snapshot.route,
    badges: snapshot.badges,
    inWildBattle: snapshot.inWildBattle,
    wildEncounterDex: snapshot.wildEncounter?.nationalDex,
  };
}

/**
 * Stable digest of everything the server reacts to.
 *
 * `observedAt` is deliberately excluded -- including it would defeat the
 * purpose and make an idle run chatter once per poll.
 */
export function snapshotDigest(snapshot: PlayerSnapshot): string {
  const party = snapshot.party
    .map(
      (m) =>
        `${m.pid}:${m.slot}:${m.level}:${m.currentHp}:${m.maxHp}:${m.status}:${m.nickname}`,
    )
    .join("|");
  return [
    snapshot.gameCode,
    snapshot.route ?? "",
    snapshot.badges,
    snapshot.inWildBattle ? 1 : 0,
    snapshot.wildEncounterDex ?? "",
    party,
  ].join("/");
}
