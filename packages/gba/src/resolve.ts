/**
 * Locate the emulated console's RAM inside the wasm heap.
 *
 * mGBA allocates EWRAM and IWRAM with `memalign` on the wasm heap, so they sit
 * at some fixed-but-unknown offset. We know each game's *GBA* party address
 * from the address tables, so exactly one unknown remains: where the containing
 * region begins in the heap.
 *
 * Rather than blind-scanning for "something that looks like a party", we scan
 * for a validated party and then work backwards to the region base. The 0x1C
 * checksum makes false positives vanishingly unlikely: a random 100 bytes
 * passes with probability ~2^-16, and we require several consecutive slots plus
 * a plausible party count.
 */

import type { GameLayout } from "@pokeshare/data";
import {
  EWRAM_SIZE,
  EWRAM_START,
  IWRAM_SIZE,
  IWRAM_START,
  RegionMemory,
  type MemorySource,
} from "./memory.js";
import {
  PARTY_SLOT_SIZE,
  isEmptySlot,
  looksLikeValidSlot,
} from "./gen3/pokemon.js";

/** Where the party lives determines which region we are hunting for. */
function regionOf(address: number): { start: number; size: number } {
  return address >= IWRAM_START
    ? { start: IWRAM_START, size: IWRAM_SIZE }
    : { start: EWRAM_START, size: EWRAM_SIZE };
}

/**
 * Cheap prefilter run at every candidate offset before the expensive decrypt.
 *
 * Checks only plaintext fields, so it costs a handful of array reads and
 * rejects virtually all of the heap immediately.
 */
function plausiblePartyHead(heap: Uint8Array, at: number): boolean {
  if (at + PARTY_SLOT_SIZE > heap.length) return false;

  const level = heap[at + 0x54]!;
  if (level < 1 || level > 100) return false;

  const currentHp = heap[at + 0x56]! | (heap[at + 0x57]! << 8);
  const maxHp = heap[at + 0x58]! | (heap[at + 0x59]! << 8);
  if (maxHp < 1 || maxHp > 999) return false;
  if (currentHp > maxHp) return false;

  // A real Pokemon always has a non-zero personality value.
  const pid =
    heap[at]! | (heap[at + 1]! << 8) | (heap[at + 2]! << 16) | (heap[at + 3]! << 24);
  return pid !== 0;
}

export interface ResolvedRegions {
  /** Heap byte offset at which EWRAM (0x02000000) begins. */
  readonly ewramOffset: number;
  /** Heap byte offset at which IWRAM (0x03000000) begins. */
  readonly iwramOffset: number;
  readonly memory: MemorySource;
}

/**
 * Find the heap offset of the region containing the player party.
 *
 * Returns the offset of `region.start`, i.e. already adjusted backwards from
 * the party address. `undefined` if no validated party was found -- normal
 * before the player has any Pokemon at all.
 */
export function findRegionOffset(
  heap: Uint8Array,
  layout: GameLayout,
): number | undefined {
  const region = regionOf(layout.playerParty);
  const partyOffsetInRegion = layout.playerParty - region.start;
  const countOffsetInRegion = layout.playerPartyCount - region.start;

  for (let at = 0; at + PARTY_SLOT_SIZE <= heap.length; at += 4) {
    if (!plausiblePartyHead(heap, at)) continue;

    const regionOffset = at - partyOffsetInRegion;
    if (regionOffset < 0) continue;
    if (regionOffset + region.size > heap.length) break;

    const count = heap[regionOffset + countOffsetInRegion]!;
    if (count < 1 || count > 6) continue;

    if (partyValidates(heap, at, count)) return regionOffset;
  }
  return undefined;
}

/** Require every declared slot to decrypt and checksum cleanly. */
function partyValidates(heap: Uint8Array, at: number, count: number): boolean {
  for (let slot = 0; slot < count; slot += 1) {
    const start = at + slot * PARTY_SLOT_SIZE;
    if (start + PARTY_SLOT_SIZE > heap.length) return false;

    const bytes = heap.subarray(start, start + PARTY_SLOT_SIZE);
    // A declared slot must actually hold a Pokemon.
    if (isEmptySlot(bytes)) return false;
    if (!looksLikeValidSlot(bytes)) return false;
  }
  return true;
}

/**
 * Build a {@link MemorySource} over the wasm heap.
 *
 * Only the region containing the party is located by scanning; the other region
 * is derived from mGBA's allocation order, so callers should treat reads
 * outside the party's region as best-effort until the Phase 1 spike confirms
 * the layout against a real ROM.
 */
export function resolveMemory(
  heap: Uint8Array,
  layout: GameLayout,
): ResolvedRegions | undefined {
  const offset = findRegionOffset(heap, layout);
  if (offset === undefined) return undefined;

  const partyInIwram = layout.playerParty >= IWRAM_START;
  const ewramOffset = partyInIwram ? offset - EWRAM_SIZE : offset;
  const iwramOffset = partyInIwram ? offset : offset + EWRAM_SIZE;

  const slice = (start: number, size: number): Uint8Array =>
    start >= 0 && start + size <= heap.length
      ? heap.subarray(start, start + size)
      : new Uint8Array(size);

  return {
    ewramOffset,
    iwramOffset,
    memory: new RegionMemory(
      slice(ewramOffset, EWRAM_SIZE),
      slice(iwramOffset, IWRAM_SIZE),
    ),
  };
}
