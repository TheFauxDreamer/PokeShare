import { useEffect, useRef, useState } from "react";
import type { PlayerId } from "@pokeshare/shared";
import { TeamStrip } from "../components/TeamStrip.js";
import { useRun } from "../lib/useRun.js";
import { subscribeToPlayer } from "../lib/video.js";

/**
 * The OBS browser source: both games side by side, each player's team directly
 * beneath their own picture.
 *
 * Fixed 1920x1080 and scaled to fit, so the layout is identical regardless of
 * the source dimensions OBS is configured with.
 */
function PlayerColumn({
  player,
  label,
}: {
  player: PlayerId;
  label: string;
}) {
  return (
    <div className="column__header">
      <span className={`badge badge--${player}`}>{label}</span>
    </div>
  );
}

export function StreamView({ joinCode }: { joinCode: string | undefined }) {
  const subs = useRef<
    Partial<Record<PlayerId, ReturnType<typeof subscribeToPlayer>>>
  >({});

  // Route each answer/ICE back to the subscription that asked for it.
  const run = useRun(joinCode, (from, payload) => {
    if (from === "stream") return;
    subs.current[from]?.accept(payload);
  });

  const videoRefs = {
    a: useRef<HTMLVideoElement | null>(null),
    b: useRef<HTMLVideoElement | null>(null),
  };
  const [connected, setConnected] = useState<Record<PlayerId, boolean>>({
    a: false,
    b: false,
  });

  // Subscribe to both players' canvases, including the local one -- one code
  // path for both, and the OBS browser is a separate process from the player's
  // browser anyway, so there is no cheaper local route.
  useEffect(() => {
    if (run.status !== "open") return;

    for (const player of ["a", "b"] as const) {
      subs.current[player] = subscribeToPlayer(player, run.send, (stream) => {
        const video = videoRefs[player].current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => undefined);
        }
        setConnected((current) => ({ ...current, [player]: true }));
      });
    }

    return () => {
      for (const sub of Object.values(subs.current)) sub?.close();
      subs.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.status]);

  const state = run.state;

  return (
    <div className="stream">
      <div className="stream__stage">
        {(["a", "b"] as const).map((player) => (
          <section key={player} className="column">
            <PlayerColumn
              player={player}
              label={`Player ${player.toUpperCase()}`}
            />
            <div className="column__screen">
              <video
                ref={videoRefs[player]}
                className="screen"
                autoPlay
                playsInline
                muted
              />
              {!connected[player] ? (
                <div className="screen__waiting">
                  Waiting for player {player.toUpperCase()}…
                </div>
              ) : null}
            </div>
            <div className="column__route">
              {state?.players[player]?.route ?? "—"}
            </div>
            <TeamStrip
              party={state?.players[player]?.party ?? []}
              pairs={state?.pairs ?? []}
              player={player}
              levelCap={state?.levelCap}
            />
          </section>
        ))}
      </div>

      <footer className="stream__footer">
        <div className="stat">
          <span className="stat__label">Deaths</span>
          <span className="stat__value">{state?.deaths ?? 0}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Level cap</span>
          <span className="stat__value">{state?.levelCap ?? "—"}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Badges</span>
          <span className="stat__value">
            {state?.players.a?.badges ?? 0} / {state?.players.b?.badges ?? 0}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">Pairs</span>
          <span className="stat__value">
            {state?.pairs.filter((p) => p.a && p.b).length ?? 0}
          </span>
        </div>
      </footer>
    </div>
  );
}
