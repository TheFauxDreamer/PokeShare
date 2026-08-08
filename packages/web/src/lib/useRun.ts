import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClientMessage,
  PlayerId,
  RunState,
  ServerMessage,
  SoulLinkPair,
} from "@pokeshare/shared";
import { RunClient, defaultSocketUrl, type ConnectionStatus } from "./client.js";
import { getClientId } from "./clientId.js";
import { loadPlayerName } from "./playerName.js";

export interface RunConnection {
  readonly status: ConnectionStatus;
  readonly state: RunState | undefined;
  readonly player: PlayerId | undefined;
  /** Faints awaiting confirmation, newest last. */
  readonly pending: readonly SoulLinkPair[];
  readonly error: string | undefined;
  readonly send: (message: ClientMessage) => void;
}

/** Incoming WebRTC signalling, relayed verbatim from a peer. */
export type SignalHandler = (
  from: PlayerId | "stream",
  payload: unknown,
) => void;

/**
 * Subscribe to a run.
 *
 * `joinCode` of `undefined` creates a new run; anything else joins by code.
 * Views that only display (stream, pairs) join with a code and are seated as
 * spectators if both player slots are taken.
 *
 * `onSignal` is held in a ref rather than being a dependency, so a view can
 * pass a fresh closure each render without tearing down the socket.
 */
export function useRun(
  joinCode: string | undefined,
  onSignal?: SignalHandler,
  options: { readonly randomised?: boolean; readonly scope?: string } = {},
): RunConnection {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [state, setState] = useState<RunState | undefined>();
  const [player, setPlayer] = useState<PlayerId | undefined>();
  const [pending, setPending] = useState<readonly SoulLinkPair[]>([]);
  const [error, setError] = useState<string | undefined>();
  const clientRef = useRef<RunClient | undefined>(undefined);
  const signalRef = useRef<SignalHandler | undefined>(onSignal);
  signalRef.current = onSignal;
  // Read at connect time only; changing it later must not reconnect.
  const randomisedRef = useRef(options.randomised ?? false);
  randomisedRef.current = options.randomised ?? false;
  // Stable across reconnects, so `hello` reclaims the same seat every time.
  const clientIdRef = useRef(getClientId(options.scope));

  useEffect(() => {
    const client = new RunClient({
      url: defaultSocketUrl(),
      onStatus: setStatus,
      hello: () =>
        joinCode
          ? { type: "join_run", joinCode, clientId: clientIdRef.current }
          : {
              type: "create_run",
              clientId: clientIdRef.current,
              randomised: randomisedRef.current,
            },
      onMessage: (message: ServerMessage) => {
        switch (message.type) {
          case "run_created":
            setPlayer(message.player);
            setError(undefined);
            // Re-assert the name on every (re)connect: the server keys names to
            // the seat, and a fresh run has none yet.
            if (message.player) {
              const stored = loadPlayerName();
              if (stored) client.send({ type: "set_name", name: stored });
            }
            return;
          case "state":
            setState(message.state);
            // Drop prompts the server no longer reports as pending, so a
            // confirmation made on another device clears here too.
            setPending((current) =>
              current.filter((pair) =>
                message.state.pairs.some(
                  (candidate) =>
                    candidate.id === pair.id && candidate.status === "pending",
                ),
              ),
            );
            return;
          case "death_pending":
            setPending((current) =>
              current.some((pair) => pair.id === message.pair.id)
                ? current
                : [...current, message.pair],
            );
            return;
          case "signal":
            signalRef.current?.(message.from, message.payload);
            return;
          case "error":
            setError(message.message);
            return;
          default:
            return;
        }
      },
    });

    clientRef.current = client;
    return () => {
      client.close();
      clientRef.current = undefined;
    };
  }, [joinCode]);

  /**
   * Stable across renders, deliberately.
   *
   * The connection object's identity changes on every server broadcast, so
   * anything depending on it re-runs constantly. A poll loop keyed to it gets
   * its timer cleared and restarted on each message — including messages caused
   * by the *other* player — which can starve it of ever firing. Consumers
   * should depend on `send`, not on the connection object.
   */
  const send = useCallback(
    (message: ClientMessage) => clientRef.current?.send(message),
    [],
  );

  return useMemo(
    () => ({ status, state, player, pending, error, send }),
    [status, state, player, pending, error, send],
  );
}
