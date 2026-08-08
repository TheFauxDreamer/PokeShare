import { describe, expect, it } from "vitest";
import type { SoulLinkPair } from "@pokeshare/shared";
import { checkClauses, type FamilyResolver } from "../src/clauses.js";

function pair(
  route: string,
  aDex: number | undefined,
  bDex: number | undefined,
  status: SoulLinkPair["status"] = "alive",
): SoulLinkPair {
  const half = (dex: number | undefined) =>
    dex === undefined
      ? undefined
      : { pid: dex, nationalDex: dex, nickname: `M${dex}`, level: 10, fainted: false };
  return {
    id: `pair:${route}`,
    route,
    a: half(aDex),
    b: half(bDex),
    status,
    triggeredBy: undefined,
  };
}

/** Zigzagoon (263) evolves into Linoone (264); everything else stands alone. */
const family: FamilyResolver = (dex) => (dex === 264 ? 263 : dex);

describe("dupes clause", () => {
  it("flags the same species caught twice by one player", () => {
    const warnings = checkClauses([
      pair("Route 103", 263, 252),
      pair("Route 104", 263, 255),
    ]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: "dupes", route: "Route 104" });
    expect(warnings[0]!.message).toContain("Route 103");
  });

  it("does not flag the same species across different players", () => {
    // A and B both catching a Zigzagoon is not a *dupe* -- dupes are per-player.
    // It is still a species-clause violation, so scope the assertion to dupes.
    const warnings = checkClauses([pair("Route 103", 263, 263)]);
    expect(warnings.filter((w) => w.kind === "dupes")).toHaveLength(0);
  });

  it("uses evolution families when a resolver is supplied", () => {
    const pairs = [pair("Route 103", 263, 252), pair("Route 104", 264, 255)];
    expect(checkClauses(pairs)).toHaveLength(0);
    expect(checkClauses(pairs, family)).toMatchObject([
      { kind: "dupes", route: "Route 104" },
    ]);
  });

  it("ignores voided routes", () => {
    const warnings = checkClauses([
      pair("Route 103", 263, 252),
      pair("Route 104", 263, 255, "void"),
    ]);
    expect(warnings).toHaveLength(0);
  });

  it("still constrains after a pair has died", () => {
    // A dead Pokemon was still caught, so it keeps consuming its species.
    const warnings = checkClauses([
      pair("Route 103", 263, 252, "dead"),
      pair("Route 104", 263, 255),
    ]);
    expect(warnings).toHaveLength(1);
  });
});

describe("species clause on pairs", () => {
  it("flags a pair linking the same species to itself", () => {
    const warnings = checkClauses([pair("Route 103", 263, 263)]);
    expect(warnings).toMatchObject([{ kind: "species", route: "Route 103" }]);
  });

  it("flags a pair linking two members of one family", () => {
    expect(checkClauses([pair("Route 103", 263, 264)], family)).toMatchObject([
      { kind: "species", route: "Route 103" },
    ]);
  });

  it("says nothing about a half-formed pair", () => {
    expect(checkClauses([pair("Route 103", 263, undefined)])).toHaveLength(0);
  });

  it("says nothing about an ordinary pair", () => {
    expect(checkClauses([pair("Route 103", 252, 255)])).toHaveLength(0);
  });
});
