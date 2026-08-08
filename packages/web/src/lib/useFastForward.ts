import { useCallback, useEffect, useState } from "react";
import type { Emulator } from "./emulator.js";
import { isTypingTarget } from "./input.js";

export interface FastForward {
  readonly active: boolean;
  /** Flip the state; also driven by the key and by the panel button. */
  readonly toggle: () => void;
  readonly setActive: (active: boolean) => void;
}

/**
 * Toggle fast-forward.
 *
 * Tapping the key switches it on and leaves it on until switched off again, so
 * you can put the controller down mid-grind. Because that state is easy to
 * forget about, the UI shows a persistent badge whenever it is engaged.
 *
 * Listeners are registered in the **capture** phase so nothing downstream can
 * consume the key first. This is why Tab did not work as the default: it drives
 * browser focus navigation and was handled before a bubble-phase listener ran.
 */
export function useFastForward(
  emulator: Emulator | undefined,
  codes: readonly string[],
  multiplier: number,
): FastForward {
  const [active, setActive] = useState(false);

  const toggle = useCallback(() => setActive((current) => !current), []);

  // Key handling only flips the flag; applying the speed is the effect below,
  // so the emulator, the key and the panel button cannot disagree.
  useEffect(() => {
    if (!emulator) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Ignore auto-repeat, or holding the key would flicker on and off.
      if (!codes.includes(event.code) || event.repeat) return;
      // Shift is also how you type a capital letter.
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      toggle();
    };

    globalThis.addEventListener("keydown", onKeyDown, true);
    return () => globalThis.removeEventListener("keydown", onKeyDown, true);
  }, [emulator, codes, toggle]);

  // Single place that talks to the emulator, so a multiplier change while
  // engaged takes effect immediately.
  useEffect(() => {
    if (!emulator) return;
    emulator.setSpeed(active ? multiplier : 1);
    // Never leave the emulator fast when this unmounts.
    return () => emulator.setSpeed(1);
  }, [emulator, active, multiplier]);

  return { active, toggle, setActive };
}
