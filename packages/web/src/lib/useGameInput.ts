import { useEffect } from "react";
import type { Emulator } from "./emulator.js";
import {
  GBA_INPUTS,
  isTypingTarget,
  resolveInput,
  type Bindings,
} from "./input.js";

/**
 * Drive the emulator's buttons directly from window-level key events.
 *
 * The core has its own SDL keyboard handling, but it only fires when the canvas
 * holds focus — and focus is easy to lose to any other control on the page.
 * That is why arrow keys worked on the diagnostics page and not on the play
 * view, which has more to click on. Safari is especially strict here.
 *
 * Listening on the window instead makes input independent of focus. This runs
 * *alongside* the core's own handler rather than replacing it: pressing a
 * button twice is idempotent (it sets a bit in a mask), so the redundancy is
 * harmless and means input still works if either path fails.
 *
 * `preventDefault` also stops the arrow keys scrolling the page, which on the
 * taller play view looks exactly like broken input.
 */
export function useGameInput(
  emulator: Emulator | undefined,
  bindings: Bindings,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!emulator || !enabled) return;
    const module = emulator.module;

    const onKeyDown = (event: KeyboardEvent) => {
      // Never swallow browser shortcuts (⌘R, ⌘L, ...).
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // ...nor anything aimed at a text field.
      if (isTypingTarget(event.target)) return;

      const input = resolveInput(bindings, event.code);
      if (!input) return;

      event.preventDefault();
      if (!event.repeat) module.buttonPress(input);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const input = resolveInput(bindings, event.code);
      if (!input) return;
      event.preventDefault();
      module.buttonUnpress(input);
    };

    // Losing the window with a key held would otherwise stick that direction on.
    const releaseAll = () => {
      for (const input of GBA_INPUTS) module.buttonUnpress(input);
    };

    globalThis.addEventListener("keydown", onKeyDown, true);
    globalThis.addEventListener("keyup", onKeyUp, true);
    globalThis.addEventListener("blur", releaseAll);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown, true);
      globalThis.removeEventListener("keyup", onKeyUp, true);
      globalThis.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, [emulator, bindings, enabled]);
}
