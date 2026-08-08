/**
 * Builders that produce byte-exact Gen 3 structures.
 *
 * These encrypt in the same direction the game does, so parsing a fixture
 * exercises the real decrypt path rather than a mirror of it.
 */

import {
  computeChecksum,
  substructOffset,
} from "../src/gen3/pokemon.js";
import {
  SAVESTATE_EWRAM_OFFSET,
  SAVESTATE_GAME_CODE_OFFSET,
  SAVESTATE_IWRAM_OFFSET,
  SAVESTATE_SIZE,
} from "../src/savestate.js";

export interface PartySlotSpec {
  personality: number;
  otId: number;
  speciesInternal: number;
  level: number;
  currentHp: number;
  maxHp: number;
  nickname?: string;
  heldItem?: number;
  experience?: number;
  isEgg?: boolean;
}

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
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

/** Inverse of the decoder in charmap.ts; covers A-Z, a-z, 0-9 and space. */
export function encodeGen3String(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length).fill(0xff);
  for (let i = 0; i < Math.min(text.length, length); i += 1) {
    const char = text[i]!;
    if (char === " ") out[i] = 0x00;
    else if (char >= "0" && char <= "9")
      out[i] = 0xa1 + (char.charCodeAt(0) - 0x30);
    else if (char >= "A" && char <= "Z")
      out[i] = 0xbb + (char.charCodeAt(0) - 0x41);
    else if (char >= "a" && char <= "z")
      out[i] = 0xd5 + (char.charCodeAt(0) - 0x61);
    else out[i] = 0xac; // "?"
  }
  return out;
}

/** Build a valid, correctly-encrypted 100-byte party slot. */
export function buildPartySlot(spec: PartySlotSpec): Uint8Array {
  const { personality, otId } = spec;

  const data = new Uint8Array(48);
  const growth = substructOffset(personality, "G");
  writeU16(data, growth + 0, spec.speciesInternal);
  writeU16(data, growth + 2, spec.heldItem ?? 0);
  writeU32(data, growth + 4, spec.experience ?? 0);

  const misc = substructOffset(personality, "M");
  writeU32(data, misc + 4, spec.isEgg ? 1 << 30 : 0);

  const slot = new Uint8Array(100);
  writeU32(slot, 0x00, personality);
  writeU32(slot, 0x04, otId);
  slot.set(encodeGen3String(spec.nickname ?? "TESTMON", 10), 0x08);
  writeU16(slot, 0x1c, computeChecksum(data));

  // Encrypt the data section into place.
  const key = (otId ^ personality) >>> 0;
  for (let offset = 0; offset < 48; offset += 4) {
    writeU32(slot, 0x20 + offset, (readU32(data, offset) ^ key) >>> 0);
  }

  slot[0x54] = spec.level;
  writeU16(slot, 0x56, spec.currentHp);
  writeU16(slot, 0x58, spec.maxHp);
  return slot;
}

/** Place a party into a buffer at the offset implied by a region base. */
export function writeParty(
  buffer: Uint8Array,
  partyOffset: number,
  countOffset: number,
  slots: readonly Uint8Array[],
): void {
  buffer[countOffset] = slots.length;
  slots.forEach((slot, index) => {
    buffer.set(slot, partyOffset + index * 100);
  });
}

/** Build a minimal but structurally valid mGBA save state. */
export function buildSaveState(options: {
  gameCode: string;
  version?: number;
  ewram?: Uint8Array;
  iwram?: Uint8Array;
}): Uint8Array {
  const state = new Uint8Array(SAVESTATE_SIZE);
  writeU32(state, 0, (0x01000000 | (options.version ?? 0x0b)) >>> 0);
  for (let i = 0; i < 4; i += 1) {
    state[SAVESTATE_GAME_CODE_OFFSET + i] = options.gameCode.charCodeAt(i);
  }
  if (options.ewram) state.set(options.ewram, SAVESTATE_EWRAM_OFFSET);
  if (options.iwram) state.set(options.iwram, SAVESTATE_IWRAM_OFFSET);
  return state;
}
