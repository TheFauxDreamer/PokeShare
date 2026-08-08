/**
 * Reads game state out of a live GBA address space.
 *
 * This layer is a *dumb sensor*: it reports what the console currently says and
 * knows nothing about Nuzlockes, soul links, pairing or deaths. All rules live
 * on the server, which is what keeps adding a future generation cheap.
 */

import {
  BATTLE_TYPE_TRAINER,
  MAP_HEADER_REGION_MAPSEC_OFFSET,
  type GameLayout,
  internalToNationalDex,
  routeName,
} from "@pokeshare/data";
import type { MemorySource } from "../memory.js";
import {
  PARTY_SLOTS,
  PARTY_SLOT_SIZE,
  type Gen3Pokemon,
  parsePartySlot,
} from "./pokemon.js";

export interface PartyMember extends Gen3Pokemon {
  readonly slot: number;
  /** National Dex number; `undefined` for a glitch/unmapped internal index. */
  readonly nationalDex: number | undefined;
}

export interface GameSnapshot {
  readonly party: readonly PartyMember[];
  /** Region map section id straight from the map header. */
  readonly mapSecId: number;
  /** Human route name, or `undefined` if the id is not a known location. */
  readonly route: string | undefined;
  readonly badges: number;
  readonly inBattle: boolean;
  readonly inWildBattle: boolean;
  /** Opposing lead. Only meaningful when `inWildBattle` is true. */
  readonly wildEncounter: PartyMember | undefined;
}

function toMember(mon: Gen3Pokemon, slot: number): PartyMember {
  return {
    ...mon,
    slot,
    nationalDex: internalToNationalDex(mon.speciesInternal),
  };
}

/** Read up to six party slots. Stops at the first empty slot. */
export function readParty(
  memory: MemorySource,
  layout: GameLayout,
): PartyMember[] {
  const declared = memory.readU8(layout.playerPartyCount);
  // Never trust the count blindly -- a mid-write read can report garbage.
  const count = Math.min(Math.max(declared, 0), PARTY_SLOTS);

  const party: PartyMember[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const bytes = memory.readBytes(
      layout.playerParty + slot * PARTY_SLOT_SIZE,
      PARTY_SLOT_SIZE,
    );
    const mon = parsePartySlot(bytes);
    if (!mon) break;
    party.push(toMember(mon, slot));
  }
  return party;
}

/** Resolve the current location to a pairable route name. */
export function readLocation(
  memory: MemorySource,
  layout: GameLayout,
): { mapSecId: number; route: string | undefined } {
  const mapSecId = memory.readU8(
    layout.mapHeader + MAP_HEADER_REGION_MAPSEC_OFFSET,
  );
  return { mapSecId, route: routeName(layout.mapSecTable, mapSecId) };
}

/**
 * Count gym badges.
 *
 * The eight badge flags are consecutive bits inside SaveBlock1's flag array,
 * but they do NOT start on a byte boundary in every game: Emerald and
 * Ruby/Sapphire put FLAG_BADGE01_GET at bit 7, so the eight flags straddle two
 * bytes. Reading a single byte there counts seven unrelated system flags as
 * badges — which reports a badge before the first gym.
 *
 * Reading 16 bits and shifting by `badgeBitOffset` handles both layouts.
 * Ruby/Sapphire address SaveBlock1 directly; Emerald and FR/LG store a pointer.
 */
export function readBadges(memory: MemorySource, layout: GameLayout): number {
  const base =
    layout.saveBlock1.kind === "pointer"
      ? memory.readU32(layout.saveBlock1.address)
      : layout.saveBlock1.address;

  const window = memory.readU16(base + layout.badgeOffset);
  const badges = (window >>> layout.badgeBitOffset) & 0xff;

  let count = 0;
  for (let bit = 0; bit < 8; bit += 1) {
    if ((badges >>> bit) & 1) count += 1;
  }
  return count;
}

/** Read everything needed for one state push. */
export function readSnapshot(
  memory: MemorySource,
  layout: GameLayout,
): GameSnapshot {
  const { mapSecId, route } = readLocation(memory, layout);
  const battleTypeFlags = memory.readU32(layout.battleTypeFlags);
  const inBattle = battleTypeFlags !== 0;
  const inWildBattle = inBattle && (battleTypeFlags & BATTLE_TYPE_TRAINER) === 0;

  let wildEncounter: PartyMember | undefined;
  if (inWildBattle) {
    const bytes = memory.readBytes(layout.enemyParty, PARTY_SLOT_SIZE);
    const mon = parsePartySlot(bytes);
    if (mon) wildEncounter = toMember(mon, 0);
  }

  return {
    party: readParty(memory, layout),
    mapSecId,
    route,
    badges: readBadges(memory, layout),
    inBattle,
    inWildBattle,
    wildEncounter,
  };
}
