/**
 * A stable identity for this browser, persisted across reloads.
 *
 * Seats are bound to this rather than to a socket. Without it, a dropped
 * connection frees the seat and whoever reconnects first takes it — which can
 * hand player A's slot to player B and record A's party as B's, silently, in
 * the middle of a stream.
 *
 * Scoped per view so that opening /stream or /pairs in the same browser as
 * /play does not try to reclaim the player's seat.
 */

const STORAGE_PREFIX = "pokeshare.clientId";

function newId(): string {
  // randomUUID needs a secure context; the app requires one anyway for
  // cross-origin isolation, but fall back rather than throw.
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function getClientId(scope = "play"): string {
  const key = `${STORAGE_PREFIX}.${scope}`;
  try {
    const existing = globalThis.localStorage?.getItem(key);
    if (existing) return existing;
    const created = newId();
    globalThis.localStorage?.setItem(key, created);
    return created;
  } catch {
    // Private mode or storage disabled: fall back to a per-session id. Seats
    // will not survive a reload, but nothing breaks.
    return newId();
  }
}
