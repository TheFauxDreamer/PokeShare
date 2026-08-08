/**
 * The display name a player chose for themselves.
 *
 * Kept per browser rather than per run: you are the same person across runs,
 * and re-typing it every session is friction nobody wants mid-stream.
 */

import { normalisePlayerName } from "@pokeshare/shared";

const STORAGE_KEY = "pokeshare.playerName";

export function loadPlayerName(): string {
  try {
    return normalisePlayerName(
      globalThis.localStorage?.getItem(STORAGE_KEY) ?? "",
    );
  } catch {
    return "";
  }
}

export function savePlayerName(name: string): string {
  const clean = normalisePlayerName(name);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, clean);
  } catch {
    // Storage unavailable: the name still applies for this session.
  }
  return clean;
}
