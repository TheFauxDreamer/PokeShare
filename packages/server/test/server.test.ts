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

/** A fresh client identity, as a new browser would generate. */
let idCounter = 0;
const id = (): string => `client-${(idCounter += 1)}`;

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
    a.send({ type: "create_run", clientId: id() });
    const created = await a.next("run_created");

    expect(created.joinCode).toHaveLength(6);
    expect(created.player).toBe("a");

    const b = await TestClient.connect();
    b.send({ type: "join_run", clientId: id(), joinCode: created.joinCode });
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

  it("carries the randomised flag from create through to run state", async () => {
    const a = await TestClient.connect();
    a.send({ type: "create_run", clientId: id(), randomised: true });
    await a.next("run_created");
    expect((await a.next("state")).state.randomised).toBe(true);
    a.close();

    const b = await TestClient.connect();
    b.send({ type: "create_run", clientId: id() });
    await b.next("run_created");
    expect((await b.next("state")).state.randomised).toBe(false);
    b.close();
  });

  it("accepts a lowercase join code", async () => {
    const a = await TestClient.connect();
    a.send({ type: "create_run", clientId: id() });
    const created = await a.next("run_created");

    const b = await TestClient.connect();
    b.send({ type: "join_run", clientId: id(), joinCode: created.joinCode.toLowerCase() });
    expect((await b.next("run_created")).runId).toBe(created.runId);

    a.close();
    b.close();
  });

  it("rejects an unknown join code", async () => {
    const client = await TestClient.connect();
    client.send({ type: "join_run", clientId: id(), joinCode: "ZZZZZZ" });
    expect((await client.next("error")).message).toMatch(/no such run/i);
    client.close();
  });

  it("prompts on a faint and cascades to the partner once confirmed", async () => {
    const a = await TestClient.connect();
    a.send({ type: "create_run", clientId: id() });
    const created = await a.next("run_created");

    const b = await TestClient.connect();
    b.send({ type: "join_run", clientId: id(), joinCode: created.joinCode });
    await b.next("run_created");

    // A third connection stands in for the /stream or /pairs view.
    const viewer = await TestClient.connect();
    viewer.send({ type: "join_run", clientId: id(), joinCode: created.joinCode });
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
    a.send({ type: "create_run", clientId: id() });
    const created = await a.next("run_created");

    const b = await TestClient.connect();
    b.send({ type: "join_run", clientId: id(), joinCode: created.joinCode });
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

  it("rejects a join with no client id", async () => {
    const client = await TestClient.connect();
    client.sendRaw(JSON.stringify({ type: "create_run" }));
    expect((await client.next("error")).message).toMatch(/clientid/i);
    client.close();
  });
});

/**
 * Seats must belong to the client, not the connection.
 *
 * The bug these cover: seats were keyed on a per-connection token and released
 * on disconnect, so after a drop the first client back took whichever slot was
 * free. Player A could return as player B, and A's party would then be recorded
 * against B — silently, mid-run.
 */
describe("seat ownership across reconnects", () => {
  it("returns a reconnecting player to the same seat", async () => {
    const alice = id();
    const a1 = await TestClient.connect();
    a1.send({ type: "create_run", clientId: alice });
    const created = await a1.next("run_created");
    expect(created.player).toBe("a");

    const bob = id();
    const b1 = await TestClient.connect();
    b1.send({ type: "join_run", clientId: bob, joinCode: created.joinCode });
    expect((await b1.next("run_created")).player).toBe("b");

    // Both drop.
    a1.close();
    b1.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Bob reconnects FIRST. Under the old behaviour he would take seat "a".
    const b2 = await TestClient.connect();
    b2.send({ type: "join_run", clientId: bob, joinCode: created.joinCode });
    expect((await b2.next("run_created")).player).toBe("b");

    const a2 = await TestClient.connect();
    a2.send({ type: "join_run", clientId: alice, joinCode: created.joinCode });
    expect((await a2.next("run_created")).player).toBe("a");

    b2.close();
    a2.close();
  });

  it("keeps a reconnected player's party on their own side", async () => {
    const alice = id();
    const bob = id();

    const a1 = await TestClient.connect();
    a1.send({ type: "create_run", clientId: alice });
    const created = await a1.next("run_created");

    const b1 = await TestClient.connect();
    b1.send({ type: "join_run", clientId: bob, joinCode: created.joinCode });
    await b1.next("run_created");

    a1.send({ type: "snapshot", snapshot: snapshot([mon(1, 252)], "Route 103") });
    await b1.next("state", (m) => m.state.pairs[0]?.a !== undefined);

    a1.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Alice comes back and reports the same Pokemon.
    const a2 = await TestClient.connect();
    a2.send({ type: "join_run", clientId: alice, joinCode: created.joinCode });
    await a2.next("run_created");
    a2.send({ type: "snapshot", snapshot: snapshot([mon(1, 252)], "Route 103") });

    const state = await a2.next("state", (m) => m.state.players.a !== undefined);
    // Still on side A, and side B was never contaminated.
    expect(state.state.players.a?.party[0]?.pid).toBe(1);
    expect(state.state.players.b).toBeUndefined();
    expect(state.state.pairs[0]?.b).toBeUndefined();

    a2.close();
    b1.close();
  });

  it("seats a third connection as a spectator, not as player a", async () => {
    const a = await TestClient.connect();
    a.send({ type: "create_run", clientId: id() });
    const created = await a.next("run_created");

    const b = await TestClient.connect();
    b.send({ type: "join_run", clientId: id(), joinCode: created.joinCode });
    await b.next("run_created");

    const viewer = await TestClient.connect();
    viewer.send({ type: "join_run", clientId: id(), joinCode: created.joinCode });
    // Undefined, rather than being mislabelled as player "a".
    expect((await viewer.next("run_created")).player).toBeUndefined();

    a.close();
    b.close();
    viewer.close();
  });

  it("ignores snapshots from a spectator", async () => {
    const a = await TestClient.connect();
    a.send({ type: "create_run", clientId: id() });
    const created = await a.next("run_created");

    const b = await TestClient.connect();
    b.send({ type: "join_run", clientId: id(), joinCode: created.joinCode });
    await b.next("run_created");

    const viewer = await TestClient.connect();
    viewer.send({ type: "join_run", clientId: id(), joinCode: created.joinCode });
    await viewer.next("run_created");

    viewer.send({
      type: "snapshot",
      snapshot: snapshot([mon(99, 300)], "Route 110"),
    });
    a.send({ type: "snapshot", snapshot: snapshot([mon(1, 252)], "Route 103") });

    const state = await a.next("state", (m) => m.state.pairs.length > 0);
    // Only the real player's encounter was recorded.
    expect(state.state.pairs.map((p) => p.route)).toEqual(["Route 103"]);

    a.close();
    b.close();
    viewer.close();
  });
});
