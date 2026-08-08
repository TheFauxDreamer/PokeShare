import { useEffect } from "react";
import type { Emulator } from "./emulator.js";

/** How often to flush the emulator filesystem to durable storage. */
export const SAVE_SYNC_INTERVAL_MS = 30_000;

/**
 * Persist the in-game save.
 *
 * mGBA keeps saves in an IDBFS mount that only reaches IndexedDB when
 * `FSSync()` is called. Nothing calls it automatically, so without this a
 * closed tab or a crashed browser loses the player's save entirely — which for
 * a multi-hour Nuzlocke is the worst data loss this app could cause.
 *
 * Syncs periodically and again whenever the page is hidden. `pagehide` and
 * `visibilitychange` are used rather than `beforeunload`, which Safari on
 * mobile does not fire reliably.
 */
export function useSaveSync(emulator: Emulator | undefined, enabled: boolean): void {
  useEffect(() => {
    if (!emulator || !enabled) return;

    let disposed = false;
    const sync = () => {
      if (disposed) return;
      // Fire and forget: a failed sync must never interrupt play.
      void emulator.syncSaves().catch(() => undefined);
    };

    const timer = setInterval(sync, SAVE_SYNC_INTERVAL_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") sync();
    };

    globalThis.addEventListener("pagehide", sync);
    document.addEventListener("visibilitychange", onHide);

    return () => {
      disposed = true;
      clearInterval(timer);
      globalThis.removeEventListener("pagehide", sync);
      document.removeEventListener("visibilitychange", onHide);
      // One last flush on the way out.
      void emulator.syncSaves().catch(() => undefined);
    };
  }, [emulator, enabled]);
}
