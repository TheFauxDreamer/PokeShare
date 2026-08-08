/**
 * Key bindings and fast-forward.
 *
 * mGBA binds keys by *SDL key name* ("Return", "Left", "Keypad 5"), while the
 * browser reports `KeyboardEvent.code` ("Enter", "ArrowLeft", "Numpad5"). The
 * two vocabularies do not match, so rebinding needs a translation layer — that
 * translation is the only fiddly part here, and it is pure, so it is tested.
 */

/** The ten GBA inputs, in the order they are shown in the UI. */
export const GBA_INPUTS = [
  "Up",
  "Down",
  "Left",
  "Right",
  "A",
  "B",
  "L",
  "R",
  "Start",
  "Select",
] as const;

export type GbaInput = (typeof GBA_INPUTS)[number];

/** GBA input -> SDL key name. */
export type Bindings = Record<GbaInput, string>;

export const DEFAULT_BINDINGS: Bindings = {
  Up: "Up",
  Down: "Down",
  Left: "Left",
  Right: "Right",
  A: "X",
  B: "Z",
  L: "A",
  R: "S",
  Start: "Return",
  Select: "Backspace",
};

/**
 * Keys held to fast-forward, as `KeyboardEvent.code` values.
 *
 * Both Shift keys, so it works from either hand. Tab was the original choice
 * and proved unreliable — it drives browser focus navigation, so other
 * handlers can act on it before ours does.
 */
export const FAST_FORWARD_CODES: readonly string[] = [
  "ShiftLeft",
  "ShiftRight",
];

/** What to call the fast-forward key on screen. */
export const FAST_FORWARD_LABEL = "Shift";

export const DEFAULT_FAST_FORWARD_MULTIPLIER = 4;

/** Named `KeyboardEvent.code` values whose SDL name differs. */
const CODE_TO_SDL: Readonly<Record<string, string>> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Enter: "Return",
  NumpadEnter: "Keypad Enter",
  Escape: "Escape",
  Backspace: "Backspace",
  Space: "Space",
  Tab: "Tab",
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift",
  ControlLeft: "Left Ctrl",
  ControlRight: "Right Ctrl",
  AltLeft: "Left Alt",
  AltRight: "Right Alt",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
};

/**
 * Translate a `KeyboardEvent.code` to the SDL key name mGBA expects.
 *
 * Returns `undefined` for keys with no SDL equivalent, so the rebind UI can
 * reject them rather than silently binding something that never fires.
 */
export function codeToSdlKeyName(code: string): string | undefined {
  const named = CODE_TO_SDL[code];
  if (named) return named;

  // KeyA -> "A"
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;

  // Digit1 -> "1"
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1]!;

  // Numpad1 -> "Keypad 1"
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad) return `Keypad ${numpad[1]!}`;

  // F1 -> "F1"
  if (/^F\d{1,2}$/.test(code)) return code;

  return undefined;
}

/** Minimal emulator surface this module needs. Keeps it unit-testable. */
export interface BindableEmulator {
  bindKey(bindingName: string, inputName: string): void;
  setFastForwardMultiplier(multiplier: number): void;
}

export function applyBindings(
  emulator: BindableEmulator,
  bindings: Bindings,
): void {
  for (const input of GBA_INPUTS) {
    emulator.bindKey(bindings[input], input);
  }
}

/**
 * Reject a binding that would leave two GBA inputs on one physical key.
 * Returns the input already using `sdlKey`, if any.
 */
export function conflictFor(
  bindings: Bindings,
  sdlKey: string,
  except: GbaInput,
): GbaInput | undefined {
  return GBA_INPUTS.find(
    (input) => input !== except && bindings[input] === sdlKey,
  );
}

const STORAGE_KEY = "pokeshare.bindings";

export function loadBindings(): Bindings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BINDINGS };
    const parsed = JSON.parse(raw) as Partial<Bindings>;
    // Merge over defaults so a stored file missing a key cannot leave an
    // input unbound.
    return { ...DEFAULT_BINDINGS, ...parsed };
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

export function saveBindings(bindings: Bindings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Storage unavailable: bindings simply do not persist.
  }
}

/** Human-readable summary, for the on-screen hint. */
export function describeBindings(bindings: Bindings): string {
  return [
    "Arrows = D-pad",
    `${bindings.A} = A`,
    `${bindings.B} = B`,
    `${bindings.L}/${bindings.R} = L/R`,
    `${bindings.Start} = Start`,
    `${bindings.Select} = Select`,
  ].join(" · ");
}
