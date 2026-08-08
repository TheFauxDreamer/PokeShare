/**
 * A read-only view of the GBA address space.
 *
 * Deliberately abstract: the same interface is satisfied by live wasm heap
 * views, by a parsed save state, and by hand-built fixtures in tests. Nothing
 * above this layer needs to know which one it is talking to.
 */

export const EWRAM_START = 0x02000000;
export const EWRAM_SIZE = 0x40000; // 256 KB
export const IWRAM_START = 0x03000000;
export const IWRAM_SIZE = 0x08000; // 32 KB

export interface MemorySource {
  readU8(address: number): number;
  readU16(address: number): number;
  readU32(address: number): number;
  readBytes(address: number, length: number): Uint8Array;
}

export class UnmappedAddressError extends Error {
  constructor(address: number) {
    super(`Address 0x${address.toString(16)} is not mapped`);
    this.name = "UnmappedAddressError";
  }
}

interface Region {
  readonly start: number;
  readonly bytes: Uint8Array;
}

/**
 * Backs the GBA address space with EWRAM and IWRAM buffers.
 *
 * Both regions are required because Ruby/Sapphire hold the party in IWRAM
 * while Emerald and FR/LG hold it in EWRAM.
 */
export class RegionMemory implements MemorySource {
  private readonly regions: readonly Region[];

  constructor(ewram: Uint8Array, iwram: Uint8Array) {
    this.regions = [
      { start: EWRAM_START, bytes: ewram },
      { start: IWRAM_START, bytes: iwram },
    ];
  }

  /** Locate the region containing `address` and return its local offset. */
  private locate(address: number, length: number): [Uint8Array, number] {
    for (const region of this.regions) {
      const offset = address - region.start;
      if (offset >= 0 && offset + length <= region.bytes.length) {
        return [region.bytes, offset];
      }
    }
    throw new UnmappedAddressError(address);
  }

  readU8(address: number): number {
    const [bytes, offset] = this.locate(address, 1);
    return bytes[offset]!;
  }

  readU16(address: number): number {
    const [bytes, offset] = this.locate(address, 2);
    return bytes[offset]! | (bytes[offset + 1]! << 8);
  }

  readU32(address: number): number {
    const [bytes, offset] = this.locate(address, 4);
    // `>>> 0` keeps the result unsigned; the top bit is set for ROM pointers.
    return (
      ((bytes[offset]! |
        (bytes[offset + 1]! << 8) |
        (bytes[offset + 2]! << 16) |
        (bytes[offset + 3]! << 24)) >>>
        0)
    );
  }

  readBytes(address: number, length: number): Uint8Array {
    const [bytes, offset] = this.locate(address, length);
    return bytes.subarray(offset, offset + length);
  }
}
