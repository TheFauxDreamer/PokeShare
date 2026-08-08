import { describe, expect, it } from "vitest";
import { displayName, normalisePlayerName } from "@pokeshare/shared";
import { createRun, setName, toRunState } from "../src/engine.js";
import { deserialise, serialise } from "../src/persistence.js";

describe("player names", () => {
  it("records a name against a seat", () => {
    const state = createRun("r", "C");
    setName(state, "a", "Cloud");
    setName(state, "b", "Sam");

    const run = toRunState(state);
    expect(run.names.a).toBe("Cloud");
    expect(run.names.b).toBe("Sam");
  });

  it("falls back to Player A/B when unset", () => {
    expect(displayName("a", undefined)).toBe("Player A");
    expect(displayName("b", "")).toBe("Player B");
    expect(displayName("a", "Cloud")).toBe("Cloud");
  });

  it("trims and collapses whitespace", () => {
    expect(normalisePlayerName("  Cloud  ")).toBe("Cloud");
    expect(normalisePlayerName("Cloud   The   Great")).toBe("Cloud The Great");
  });

  it("clamps a very long name so the stream layout holds", () => {
    expect(normalisePlayerName("x".repeat(200))).toHaveLength(20);
  });

  it("clears back to the default when set to blank", () => {
    const state = createRun("r", "C");
    setName(state, "a", "Cloud");
    setName(state, "a", "   ");
    expect(toRunState(state).names.a).toBeUndefined();
  });

  it("survives a save and restore", () => {
    const state = createRun("r", "C");
    setName(state, "a", "Cloud");
    const restored = deserialise(serialise(state));
    expect(restored.names.a).toBe("Cloud");
  });
});
