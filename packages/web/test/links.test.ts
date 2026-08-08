import { describe, expect, it } from "vitest";
import { pairsUrl, playUrl, streamUrl } from "../src/lib/links.js";

const ORIGIN = "http://localhost:5173";

describe("run URLs", () => {
  it("builds each view's URL with the run code", () => {
    expect(playUrl("K7QP2M", ORIGIN)).toBe(`${ORIGIN}/play?run=K7QP2M`);
    expect(streamUrl("K7QP2M", ORIGIN)).toBe(`${ORIGIN}/stream?run=K7QP2M`);
    expect(pairsUrl("K7QP2M", ORIGIN)).toBe(`${ORIGIN}/pairs?run=K7QP2M`);
  });

  it("works against a LAN origin, for OBS on another machine", () => {
    expect(streamUrl("K7QP2M", "http://192.168.1.20:5173")).toBe(
      "http://192.168.1.20:5173/stream?run=K7QP2M",
    );
  });

  it("encodes anything unexpected in the code", () => {
    expect(playUrl("A B&C", ORIGIN)).toBe(`${ORIGIN}/play?run=A%20B%26C`);
  });
});
