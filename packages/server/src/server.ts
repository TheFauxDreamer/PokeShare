/**
 * HTTP + WebSocket transport.
 *
 * Responsibilities are deliberately thin: decode a message, call the rules
 * engine, broadcast the resulting state. All game logic lives in engine.ts, and
 * WebRTC payloads are relayed verbatim without being understood.
 */

import type { Server } from "node:http";
import Fastify from "fastify";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  ClientMessage,
  PlayerId,
  ServerMessage,
} from "@pokeshare/shared";
import {
  applySnapshot,
  confirmDeath,
  pairsOf,
  repair,
  toRunState,
  voidRoute,
} from "./engine.js";
import { loadAllRuns, saveRun } from "./persistence.js";
import { RunRegistry, type Run } from "./runs.js";

/** Everything we track about one open socket. */
interface Client {
  readonly socket: WebSocket;
  readonly token: symbol;
  run: Run | undefined;
  /** `undefined` for a view-only connection such as /stream or /pairs. */
  player: PlayerId | undefined;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

export interface PokeShareServerOptions {
  /**
   * Directory to persist runs to. Omit to keep everything in memory, which is
   * what the tests do.
   */
  readonly dataDir?: string;
}

export interface PokeShareServer {
  readonly http: Server;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createPokeShareServer(
  options: PokeShareServerOptions = {},
): PokeShareServer {
  const app = Fastify({ logger: false });
  const registry = new RunRegistry();
  const clients = new Set<Client>();
  const { dataDir } = options;

  /**
   * Fire-and-forget persist. A failed write must never break a live run, so
   * errors are swallowed here rather than propagating into message handling.
   */
  function persist(run: Run): void {
    if (!dataDir) return;
    void saveRun(dataDir, run.state).catch(() => undefined);
  }

  app.get("/health", async () => ({ ok: true }));

  // Share Fastify's own HTTP server so both protocols live on one port.
  const wss = new WebSocketServer({ server: app.server });

  /** Push current run state to everyone watching that run, and persist it. */
  function broadcast(run: Run): void {
    const message: ServerMessage = { type: "state", state: toRunState(run.state) };
    for (const client of clients) {
      if (client.run === run) send(client.socket, message);
    }
    persist(run);
  }

  function broadcastPending(run: Run, route: string): void {
    const pair = pairsOf(run.state).find((candidate) => candidate.route === route);
    if (!pair) return;
    for (const client of clients) {
      if (client.run === run) {
        send(client.socket, { type: "death_pending", pair });
      }
    }
  }

  function handle(client: Client, message: ClientMessage): void {
    switch (message.type) {
      case "create_run": {
        const run = registry.create();
        client.run = run;
        client.player = registry.seat(run, client.token);
        send(client.socket, {
          type: "run_created",
          runId: run.state.runId,
          joinCode: run.state.joinCode,
          player: client.player ?? "a",
        });
        broadcast(run);
        return;
      }

      case "join_run": {
        const run = registry.byCode(message.joinCode);
        if (!run) {
          send(client.socket, { type: "error", message: "No such run" });
          return;
        }
        client.run = run;
        // A full run is not an error: /stream and /pairs join as spectators.
        client.player = registry.seat(run, client.token);
        send(client.socket, {
          type: "run_created",
          runId: run.state.runId,
          joinCode: run.state.joinCode,
          player: client.player ?? "a",
        });
        broadcast(run);
        return;
      }

      case "snapshot": {
        if (!client.run || !client.player) return;
        // Trust the seat, not the payload, for which player this is.
        const events = applySnapshot(client.run.state, {
          ...message.snapshot,
          player: client.player,
        });
        broadcast(client.run);
        for (const event of events) {
          if (event.type === "death_pending") {
            broadcastPending(client.run, event.route);
          }
        }
        return;
      }

      case "confirm_death": {
        if (!client.run) return;
        confirmDeath(client.run.state, routeFromPairId(message.pairId));
        broadcast(client.run);
        return;
      }

      case "void_route": {
        if (!client.run) return;
        voidRoute(client.run.state, message.route);
        broadcast(client.run);
        return;
      }

      case "repair_pair": {
        if (!client.run) return;
        repair(
          client.run.state,
          routeFromPairId(message.pairId),
          message.player,
          message.pid,
        );
        broadcast(client.run);
        return;
      }

      default: {
        // Unknown discriminant. Answering explicitly beats silence: a client
        // sending a message this server does not understand should find out.
        send(client.socket, {
          type: "error",
          message: `Unknown message type: ${String((message as { type?: unknown }).type)}`,
        });
        return;
      }

      case "signal": {
        // WebRTC offer/answer/ICE. Relayed as-is; the server never inspects it.
        if (!client.run) return;
        for (const peer of clients) {
          if (peer === client || peer.run !== client.run) continue;
          if (message.to === "stream" || peer.player === message.to) {
            send(peer.socket, {
              type: "signal",
              from: client.player ?? "stream",
              payload: message.payload,
            });
          }
        }
        return;
      }
    }
  }

  wss.on("connection", (socket) => {
    const client: Client = {
      socket,
      token: Symbol("client"),
      run: undefined,
      player: undefined,
    };
    clients.add(client);

    socket.on("message", (raw) => {
      let message: ClientMessage;
      try {
        const parsed: unknown = JSON.parse(String(raw));
        // Valid JSON is not enough -- a bare string or array parses fine but
        // has no discriminant, and would otherwise be dropped silently.
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          typeof (parsed as { type?: unknown }).type !== "string"
        ) {
          send(socket, { type: "error", message: "Malformed message" });
          return;
        }
        message = parsed as ClientMessage;
      } catch {
        send(socket, { type: "error", message: "Malformed message" });
        return;
      }
      try {
        handle(client, message);
      } catch (error) {
        send(socket, {
          type: "error",
          message: error instanceof Error ? error.message : "Unhandled error",
        });
      }
    });

    socket.on("close", () => {
      if (client.run) registry.release(client.run, client.token);
      clients.delete(client);
    });
  });

  return {
    http: app.server,

    async listen(port, host = "0.0.0.0") {
      // Restore before accepting connections, so a reconnecting player finds
      // their run already present rather than racing the load.
      if (dataDir) {
        for (const state of await loadAllRuns(dataDir)) registry.adopt(state);
      }
      await app.listen({ port, host });
      const address = app.server.address();
      // Port 0 means "any free port", so report what was actually bound.
      return typeof address === "object" && address ? address.port : port;
    },

    async close() {
      for (const client of clients) client.socket.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await app.close();
    },
  };
}

/** Pair ids are `pair:<route>`; the route is the actual key. */
function routeFromPairId(pairId: string): string {
  return pairId.startsWith("pair:") ? pairId.slice("pair:".length) : pairId;
}
