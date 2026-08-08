import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BINDINGS,
  GBA_INPUTS,
  applyBindings,
  codeToSdlKeyName,
  conflictFor,
  describeBindings,
  type Bindings,
} from "../src/lib/input.js";

describe("KeyboardEvent.code -> SDL key name", () => {
  it("translates letters and digits", () => {
    expect(codeToSdlKeyName("KeyX")).toBe("X");
    expect(codeToSdlKeyName("KeyA")).toBe("A");
    expect(codeToSdlKeyName("Digit1")).toBe("1");
  });

  it("translates the names SDL spells differently", () => {
    // These are the ones a naive `event.key` would get wrong.
    expect(codeToSdlKeyName("ArrowLeft")).toBe("Left");
    expect(codeToSdlKeyName("ArrowUp")).toBe("Up");
    expect(codeToSdlKeyName("Enter")).toBe("Return");
    expect(codeToSdlKeyName("ShiftLeft")).toBe("Left Shift");
    expect(codeToSdlKeyName("Backspace")).toBe("Backspace");
  });

  it("translates the numeric keypad to SDL's spelling", () => {
    expect(codeToSdlKeyName("Numpad5")).toBe("Keypad 5");
    expect(codeToSdlKeyName("NumpadEnter")).toBe("Keypad Enter");
  });

  it("passes function keys through", () => {
    expect(codeToSdlKeyName("F1")).toBe("F1");
    expect(codeToSdlKeyName("F12")).toBe("F12");
  });

  it("returns undefined for keys with no SDL equivalent", () => {
    // Better to refuse than to bind something that never fires.
    expect(codeToSdlKeyName("MediaPlayPause")).toBeUndefined();
    expect(codeToSdlKeyName("Unidentified")).toBeUndefined();
  });

  it("gives every default binding a reachable name", () => {
    // Guards against shipping a default that the core cannot bind.
    for (const input of GBA_INPUTS) {
      expect(DEFAULT_BINDINGS[input], input).toBeTruthy();
    }
  });
});

describe("applying bindings", () => {
  it("binds all ten inputs, SDL key first", () => {
    const emulator = {
      bindKey: vi.fn(),
      setFastForwardMultiplier: vi.fn(),
    };
    applyBindings(emulator, DEFAULT_BINDINGS);

    expect(emulator.bindKey).toHaveBeenCalledTimes(10);
    // Argument order is (sdlKey, gbaInput) -- reversing it silently does nothing.
    expect(emulator.bindKey).toHaveBeenCalledWith("X", "A");
    expect(emulator.bindKey).toHaveBeenCalledWith("Return", "Start");
    expect(emulator.bindKey).toHaveBeenCalledWith("Up", "Up");
  });
});

describe("conflict detection", () => {
  it("finds an input already using a key", () => {
    expect(conflictFor(DEFAULT_BINDINGS, "X", "B")).toBe("A");
  });

  it("ignores the input being rebound", () => {
    expect(conflictFor(DEFAULT_BINDINGS, "X", "A")).toBeUndefined();
  });

  it("returns undefined for a free key", () => {
    expect(conflictFor(DEFAULT_BINDINGS, "Q", "A")).toBeUndefined();
  });
});

describe("binding summary", () => {
  it("reflects a rebind", () => {
    const custom: Bindings = { ...DEFAULT_BINDINGS, A: "K", B: "J" };
    const summary = describeBindings(custom);
    expect(summary).toContain("K = A");
    expect(summary).toContain("J = B");
  });
});
