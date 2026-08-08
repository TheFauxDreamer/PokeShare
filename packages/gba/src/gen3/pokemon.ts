/**
 * Gen 3 Pokemon data structure: decrypt, validate, parse.
 *
 * Reference: https://bulbapedia.bulbagarden.net/wiki/Pokémon_data_structure_(Generation_III)
 *
 * A party slot is 100 bytes:
 *
 *   0x00-0x1F  plaintext  PID, OT ID, nickname, checksum
 *   0x20-0x4F  ENCRYPTED  4 x 12-byte substructures (Growth/Attacks/EVs/Misc)
 *   0x50-0x63  plaintext  status, level, current HP, max HP, stats
 *
 * The happy accident that makes this cheap: everything a Nuzlocke actually
 * cares about moment-to-moment -- level, HP, status -- is plaintext. Only
 * species and held item require decryption.
 *
 * The checksum at 0x1C covers the decrypted data section, which gives a free
 * correctness oracle. We use it to validate that a candidate address really is
 * a party (see resolve.ts) -- a random 100 bytes passes with probability 2^-16.
 */

import { decodeGen3String } from "./charmap.js";

export const PARTY_SLOT_SIZE = 100;
export const PARTY_SLOTS = 6;

const OFF_PID = 0x00;
const OFF_OT_ID = 0x04;
const OFF_NICKNAME = 0x08;
const NICKNAME_LENGTH = 10;
const OFF_CHECKSUM = 0x1c;
const OFF_DATA = 0x20;
const DATA_SIZE = 48;
const SUBSTRUCT_SIZE = 12;

const OFF_STATUS = 0x50;
const OFF_LEVEL = 0x54;
const OFF_CURRENT_HP = 0x56;
const OFF_MAX_HP = 0x58;

/**
 * Substructure ordering is a permutation of Growth/Attacks/EVs/Misc selected by
 * `personality % 24`. Order matters: reading Growth from the wrong offset
 * yields a plausible-looking but wrong species.
 */
const SUBSTRUCT_ORDERS = [
  "GAEM", "GAME", "GEAM", "GEMA", "GMAE", "GMEA",
  "AGEM", "AGME", "AEGM", "AEMG", "AMGE", "AMEG",
  "EGAM", "EGMA", "EAGM", "EAMG", "EMGA", "EMAG",
  "MGAE", "MGEA", "MAGE", "MAEG", "MEGA", "MEAG",
] as const;

export type SubstructKey = "G" | "A" | "E" | "M";

export interface Gen3Pokemon {
  /** Stable unique identity. Survives nicknames, level-ups and reordering. */
  readonly personality: number;
  readonly otId: number;
  readonly nickname: string;
  /** Gen 3 *internal* species index, not National Dex. */
  readonly speciesInternal: number;
  readonly heldItem: number;
  readonly experience: number;
  readonly level: number;
  readonly currentHp: number;
  readonly maxHp: number;
  readonly status: number;
  readonly isEgg: boolean;
  readonly isShiny: boolean;
  /** True when the 0x1C checksum matched the decrypted data. */
  readonly checksumValid: boolean;
}

/** An empty party slot reads as all zeroes (species 0). */
export function isEmptySlot(slot: Uint8Array): boolean {
  return readU32(slot, OFF_PID) === 0 && readU16(slot, OFF_CHECKSUM) === 0;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
      0)
  );
}

/**
 * Decrypt the 48-byte data section by XORing each 32-bit word with
 * `otId XOR personality`.
 */
export function decryptDataSection(
  slot: Uint8Array,
  personality: number,
  otId: number,
): Uint8Array {
  const key = (otId ^ personality) >>> 0;
  const out = new Uint8Array(DATA_SIZE);
  for (let offset = 0; offset < DATA_SIZE; offset += 4) {
    const word = (readU32(slot, OFF_DATA + offset) ^ key) >>> 0;
    out[offset] = word & 0xff;
    out[offset + 1] = (word >>> 8) & 0xff;
    out[offset + 2] = (word >>> 16) & 0xff;
    out[offset + 3] = (word >>> 24) & 0xff;
  }
  return out;
}

/** Sum of the decrypted section as 16-bit words, truncated to 16 bits. */
export function computeChecksum(decrypted: Uint8Array): number {
  let sum = 0;
  for (let offset = 0; offset < DATA_SIZE; offset += 2) {
    sum = (sum + readU16(decrypted, offset)) & 0xffff;
  }
  return sum;
}

/** Byte offset of a substructure within the decrypted section. */
export function substructOffset(
  personality: number,
  key: SubstructKey,
): number {
  const order = SUBSTRUCT_ORDERS[personality % 24]!;
  return order.indexOf(key) * SUBSTRUCT_SIZE;
}

/**
 * Gen 3 shininess: XOR the two halves of the OT ID with the two halves of the
 * personality value; shiny when the result is below 8.
 */
export function isShiny(personality: number, otId: number): boolean {
  const value =
    ((otId & 0xffff) ^
      (otId >>> 16) ^
      (personality & 0xffff) ^
      (personality >>> 16)) >>>
    0;
  return value < 8;
}

/**
 * Parse one 100-byte party slot.
 *
 * Returns `undefined` for an empty slot. A slot whose checksum fails is still
 * returned, flagged via `checksumValid`, so callers can decide whether to
 * display stale data or wait for the next poll -- mid-write tears are normal
 * when reading a live console at 4 Hz.
 */
export function parsePartySlot(slot: Uint8Array): Gen3Pokemon | undefined {
  if (slot.length < PARTY_SLOT_SIZE) {
    throw new RangeError(
      `Party slot must be ${PARTY_SLOT_SIZE} bytes, got ${slot.length}`,
    );
  }
  if (isEmptySlot(slot)) return undefined;

  const personality = readU32(slot, OFF_PID);
  const otId = readU32(slot, OFF_OT_ID);
  const decrypted = decryptDataSection(slot, personality, otId);

  const growth = substructOffset(personality, "G");
  const misc = substructOffset(personality, "M");
  const ivEggAbility = readU32(decrypted, misc + 4);

  return {
    personality,
    otId,
    nickname: decodeGen3String(
      slot.subarray(OFF_NICKNAME, OFF_NICKNAME + NICKNAME_LENGTH),
    ),
    speciesInternal: readU16(decrypted, growth + 0),
    heldItem: readU16(decrypted, growth + 2),
    experience: readU32(decrypted, growth + 4),
    level: slot[OFF_LEVEL]!,
    currentHp: readU16(slot, OFF_CURRENT_HP),
    maxHp: readU16(slot, OFF_MAX_HP),
    status: readU32(slot, OFF_STATUS),
    isEgg: ((ivEggAbility >>> 30) & 1) === 1,
    isShiny: isShiny(personality, otId),
    checksumValid: computeChecksum(decrypted) === readU16(slot, OFF_CHECKSUM),
  };
}

/**
 * Structural plausibility check used to confirm we are looking at a real party
 * rather than arbitrary memory. Intentionally strict.
 */
export function looksLikeValidSlot(slot: Uint8Array): boolean {
  if (isEmptySlot(slot)) return true; // trailing empty slots are expected

  const mon = parsePartySlot(slot);
  if (!mon) return true;
  if (!mon.checksumValid) return false;
  if (mon.level < 1 || mon.level > 100) return false;
  if (mon.maxHp < 1 || mon.maxHp > 999) return false;
  if (mon.currentHp > mon.maxHp) return false;
  if (mon.speciesInternal < 1 || mon.speciesInternal > 411) return false;
  return true;
}
