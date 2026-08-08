/**
 * Gen 3 English text encoding.
 *
 * Nicknames and trainer names are stored in a proprietary single-byte encoding,
 * not ASCII. Only the English table is implemented; other languages remap the
 * accented ranges. Unmapped bytes decode to "?" rather than throwing, because a
 * nickname is display-only and must never be able to break a live run.
 */

const TERMINATOR = 0xff;

function buildCharmap(): ReadonlyMap<number, string> {
  const map = new Map<number, string>();

  map.set(0x00, " ");

  const punctuation: Record<number, string> = {
    0xab: "!",
    0xac: "?",
    0xad: ".",
    0xae: "-",
    0xaf: "・",
    0xb0: "…",
    0xb1: "“",
    0xb2: "”",
    0xb3: "‘",
    0xb4: "’",
    0xb5: "♂", // male
    0xb6: "♀", // female
    0xb7: "$",
    0xb8: ",",
    0xb9: "×",
    0xba: "/",
  };
  for (const [byte, char] of Object.entries(punctuation)) {
    map.set(Number(byte), char);
  }

  for (let i = 0; i < 10; i += 1) map.set(0xa1 + i, String(i));
  for (let i = 0; i < 26; i += 1) {
    map.set(0xbb + i, String.fromCharCode(0x41 + i)); // A-Z
    map.set(0xd5 + i, String.fromCharCode(0x61 + i)); // a-z
  }

  return map;
}

const CHARMAP = buildCharmap();

/** Decode a fixed-width Gen 3 string, stopping at the 0xFF terminator. */
export function decodeGen3String(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    if (byte === TERMINATOR) break;
    out += CHARMAP.get(byte) ?? "?";
  }
  return out;
}
