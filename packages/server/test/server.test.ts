/**
 * End-to-end over real WebSockets: two players link a run, both catch on the
 * same route, one faints, and the cascade lands on every connected view.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type {
  ClientMessage,
  PartyMemberState,
  PlayerSnapshot,
  ServerMessage,
} from "@pokeshare/shared";
import { createPokeShareServer, type PokeShareServer } from "../src/server.js";

let server: PokeShareServer;
let port: number;

beforeAll(async () => {
  server = createPokeShareServer();
  port = await server.listen(0, "127.0.0.1");
});

afterAll(async () => {
  await server.close();
});

/** A socket that queues messages so tests can await them by predicate. */
class TestClient {
  private readonly received: ServerMessage[] = [];
  private readonly waiters: {
    match: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
  }[] = [];

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as ServerMessage;
      const index = this.waiters.findIndex((w) => w.match(message));
      if (index >= 0) this.waiters.splice(index, 1)[0]!.resolve(message);
      else this.received.push(message);
    });
  }

  static async connect(): Promise<TestClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    return new TestClient(socket);
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Bypasses JSON encoding so tests can send genuinely malformed frames. */
  sendRaw(payload: string): void {
    this.socket.send(payload);
  }

  next<T extends ServerMessage["type"]>(
    type: T,
    predicate: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const match = (m: ServerMessage): boolean =>
      m.type === type && predicate(m as Extract<ServerMessage, { type: T }>);

    const buffered = this.received.findIndex(match);
    if (buffered >= 0) {
      return Promise.resolve(
        this.received.splice(buffered, 1)[0] as Extract<ServerMessage, { type: T }>,
      );
    }
    return new Promise((resolve) => {
      this.waiters.push({ match, resolve: resolve as (m: ServerMessage) => void });
    });
  }

  close(): void {
    this.socket.close();
  }
}

function mon(pid: number, dex: number, hp = 20): PartyMemberState {
  return {
    pid,
    slot: 0,
    nationalDex: dex,
    nickname: `MON${pid}`,
    level: 10,
    currentHp: hp,
    maxHp: 20,
    status: 0,
    isEgg: false,
    isShiny: false,
  };
}

function snapshot(party: PartyMemberState[], route: string): PlayerSnapshot {
  return {
    player: "a", // overwritten by the server from the seat
    observedAt: Date.now(),
    gameCode: "BPEE",
    party,
    route,
    badges: 0,
    inWildBattle: false,
    wildEncounterDex: undefined,
  };
}

describe("linking two games over websockets", () => {
  it("creates a run, joins it by code, and pairs encounters by route", async () => {
    const a = await TestClient.connect();
    a.send({ type: "create_run" });
    const created = await a.next("run_created");

    expect(created.joinCode).toHaveLength(6);
    expect(created.player).toBe("a");

    const b = await TestClient.connect();
    b.send({ type: "join_run", joinCode: created.joinCode });
    const joined = await b.next("run_created");
    expect(joined.player).toBe("b");
    expect(joined.runId).toBe(created.runId);

    a.send({ type: "snapshot", snapshot: snapshot([mon(1, 252)], "Route 103") });
    b.send({ type: "snapshot", snapshot: snapshot([mon(2, 255)], "Route 103") });

    const state = await b.next(
      "state",
      (m) => m.state.pairs[0]?.a !== undefined && m.state.pairs[0]?.b !== undefined,
    );
    const pair = state.state.pairs[0]!;
    expect(pair.route).toBe("Route 103");
    expect(pair.status).toBe("alive");

    a.close();
    b.close();
  });

  it("accepts a lowercase join code", async () => {
    const a = await TestClient.connect();
    a.send({ type: "create_run" });
    const created = await a.next("run_created");

    const b = await TestClient.connect();
    b.send({ type: "join_run", joinCode: created.joinCode.toLowerCase() });
    expect((await b.next("run_created")).runId).toBe(created.runId);

    a.close();
    b.close();
  });

  it("rejects an unknown join code", async () => {
    const client = await TestClient.connect();
    client.send({ type: "join_run", joinCode: "ZZZZZZ" });
    expect((await client.next("error")).message).toMatch(/no such run/i);
    client.close();
  });

  it("prompts on a faint and cascades to the partner once confirmed", async () => {
    const a = await TestClient.connect();
    a.send({ type: "create_run" });
    const created = await a.next("run_created");

    const b = await TestClient.connect();
    b.send({ type: "join_run", joinCode: created.joinCode });
    await b.next("run_created");

    // A third connection stands in for the /stream or /pairs view.
    const viewer = await TestClient.connect();
    viewer.send({ type: "join_run", joinCode: created.joinCode });
    await viewer.next("run_created");

    a.send({ type: "snapshot", snapshot: snapshot([mon(1, 252)], "Route 103") });
    b.send({ type: "snapshot", snapshot: snapshot([mon(2, 255)], "Route 103") });
    await viewer.next(
      "state",
      (m) => m.state.pairs[0]?.a !== undefined && m.state.pairs[0]?.b !== undefined,
    );

    // A's Pokemon faints.
    a.send({
      type: "snapshot",
      snapshot: snapshot([mon(1, 252, 0)], "Route 103"),
    });

    const pending = await viewer.next("death_pending");
    expect(pending.pair.route).toBe("Route 103");
    expect(pending.pair.triggeredBy).toBe("a");

    // Nothing dies until a human confirms.
    const stillPending = await viewer.next(
      "state",
      (m) => m.state.pairs[0]?.status === "pending",
    );
    expect(stillPending.state.deaths).toBe(0);

    viewer.send({ type: "confirm_death", pairId: pending.pair.id });

    const dead = await b.next("state", (m) => m.state.pairs[0]?.status === "dead");
    expect(dead.state.deaths).toBe(1);
    // B's Pokemon never fainted, but the soul link kills it too.
    expect(dead.state.pairs[0]!.b?.fainted).toBe(false);

    a.close();
    b.close();
    viewer.close();
  });

  it("relays webrtc signalling between peers without inspecting it", async () => {
    const a = await TestClient.connect();
    a.send({ type: "create_run" });
    const created = await a.next("run_created");

    const b = await TestClient.connect();
    b.send({ type: "join_run", joinCode: created.joinCode });
    await b.next("run_created");

    a.send({ type: "signal", to: "b", payload: { sdp: "offer-blob" } });
    const relayed = await b.next("signal");
    expect(relayed.from).toBe("a");
    expect(relayed.payload).toEqual({ sdp: "offer-blob" });

    a.close();
    b.close();
  });

  it("survives a frame that is not JSON at all", async () => {
    const client = await TestClient.connect();
    client.sendRaw("not json {{{");
    expect((await client.next("error")).message).toMatch(/malformed/i);
    client.close();
  });

  it("rejects valid JSON that has no discriminant", async () => {
    // `"not json"` and `[]` both parse cleanly but carry no `type`.
    const client = await TestClient.connect();
    client.sendRaw(JSON.stringify("not json"));
    expect((await client.next("error")).message).toMatch(/malformed/i);

    client.sendRaw(JSON.stringify([1, 2, 3]));
    expect((await client.next("error")).message).toMatch(/malformed/i);
    client.close();
  });

  it("reports an unknown message type instead of ignoring it", async () => {
    const client = await TestClient.connect();
    client.sendRaw(JSON.stringify({ type: "nonsense" }));
    expect((await client.next("error")).message).toMatch(/unknown message type/i);
    client.close();
  });
});
