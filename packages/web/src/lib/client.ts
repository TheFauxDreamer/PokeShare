/**
 * WebSocket client for a run.
 *
 * Reconnects on drop, because this runs for the length of a stream and a
 * momentary network blip must not require the player to alt-tab out of the
 * game. Run state is server-authoritative, so a reconnect simply re-subscribes
 * and receives the current state -- there is nothing to replay.
 */

import type { ClientMessage, ServerMessage } from "@pokeshare/shared";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface RunClientOptions {
  readonly url: string;
  readonly onMessage: (message: ServerMessage) => void;
  readonly onStatus?: (status: ConnectionStatus) => void;
  /** Sent as soon as the socket opens, and again after every reconnect. */
  readonly hello: () => ClientMessage | undefined;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

export class RunClient {
  private socket: WebSocket | undefined;
  private attempts = 0;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: RunClientOptions) {
    this.open();
  }

  private open(): void {
    this.options.onStatus?.("connecting");
    const socket = new WebSocket(this.options.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.attempts = 0;
      this.options.onStatus?.("open");
      const hello = this.options.hello();
      if (hello) this.send(hello);
    });

    socket.addEventListener("message", (event) => {
      try {
        this.options.onMessage(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        // A frame we cannot parse is not worth tearing the connection down for.
      }
    });

    socket.addEventListener("close", () => {
      this.options.onStatus?.("closed");
      this.scheduleReconnect();
    });

    // 'error' is always followed by 'close', so reconnection is handled there.
    socket.addEventListener("error", () => socket.close());
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.attempts,
      RECONNECT_MAX_MS,
    );
    this.attempts += 1;
    this.timer = setTimeout(() => this.open(), delay);
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
  }
}

/** Resolve the WebSocket URL for the page's own origin. */
export function defaultSocketUrl(): string {
  const protocol = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${globalThis.location.host}/ws`;
}
