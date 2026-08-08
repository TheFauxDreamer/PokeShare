import { describe, expect, it } from "vitest";
import { normaliseJoinCode } from "../src/lib/links.js";

/**
 * Join codes get read aloud over voice chat and typed back in, so accept them
 * loosely. The generator's alphabet already omits O/0, I/1 and S/5.
 */
describe("join code normalisation", () => {
  it("uppercases", () => {
    expect(normaliseJoinCode("k7qp2m")).toBe("K7QP2M");
  });

  it("strips spaces and dashes people add while reading it out", () => {
    expect(normaliseJoinCode("K7Q P2M")).toBe("K7QP2M");
    expect(normaliseJoinCode("K7Q-P2M")).toBe("K7QP2M");
    expect(normaliseJoinCode("  K7QP2M  ")).toBe("K7QP2M");
  });

  it("drops punctuation entirely", () => {
    expect(normaliseJoinCode("K7QP2M.")).toBe("K7QP2M");
  });

  it("returns empty for input with nothing usable", () => {
    expect(normaliseJoinCode("")).toBe("");
    expect(normaliseJoinCode("   ")).toBe("");
    expect(normaliseJoinCode("---")).toBe("");
  });

  it("leaves an already-clean code untouched", () => {
    expect(normaliseJoinCode("K7QP2M")).toBe("K7QP2M");
  });
});
