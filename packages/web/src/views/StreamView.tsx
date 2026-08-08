import { useEffect, useRef, useState } from "react";
import { displayName, type PlayerId } from "@pokeshare/shared";
import { TeamStrip } from "../components/TeamStrip.js";
import { JoinGate } from "../components/JoinGate.js";
import { EncounterOverlay } from "../components/EncounterOverlay.js";
import { useRun } from "../lib/useRun.js";
import { subscribeToPlayer } from "../lib/video.js";

/**
 * The OBS browser source: both games side by side, each player's team directly
 * beneath their own picture.
 *
 * Fixed 1920x1080 and scaled to fit, so the layout is identical regardless of
 * the source dimensions OBS is configured with.
 */
/** How often to re-offer to a player whose video has not arrived yet. */
const RETRY_INTERVAL_MS = 4000;

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

/**
 * These views can only ever *join* a run. Without a code they must ask for one:
 * connecting with no code would create a brand new empty run and claim a
 * player seat, which is never what a display surface wants.
 */
export function StreamView({ joinCode }: { joinCode: string | undefined }) {
  const [code, setCode] = useState(joinCode);
  if (!code) {
    return (
      <JoinGate
        title="Stream view"
        description="Enter the run's join code to show both games side by side. Add this page as an OBS browser source at 1920x1080."
        onJoin={setCode}
      />
    );
  }
  return <ConnectedStreamView joinCode={code} />;
}

function ConnectedStreamView({ joinCode }: { joinCode: string }) {
  const subs = useRef<
    Partial<Record<PlayerId, ReturnType<typeof subscribeToPlayer>>>
  >({});

  // Route each answer/ICE back to the subscription that asked for it.
  // Its own scope so the OBS browser source never reclaims a player's seat.
  const run = useRun(
    joinCode,
    (from, payload) => {
      if (from === "stream") return;
      subs.current[from]?.accept(payload);
    },
    { scope: "stream" },
  );

  const videoRefs = {
    a: useRef<HTMLVideoElement | null>(null),
    b: useRef<HTMLVideoElement | null>(null),
  };
  const [connected, setConnected] = useState<Record<PlayerId, boolean>>({
    a: false,
    b: false,
  });
  // Mirrored in a ref so the retry timer can read it without re-subscribing,
  // and without doing side effects inside a state updater (React may run an
  // updater twice, which would double-offer).
  const connectedRef = useRef<Record<PlayerId, boolean>>({ a: false, b: false });

  /**
   * Subscribe to both players' canvases, retrying until video actually arrives.
   *
   * Retrying is essential, not defensive. A player only starts publishing once
   * they load a ROM, but this view offers the moment it connects — so if the
   * stream view is opened first (or a player reloads), the offer lands with
   * nobody listening and that player would never appear. Re-offering also
   * recovers from a failed ICE negotiation.
   *
   * Subscribes to the local player too: the OBS browser is a separate process
   * from the player's browser, so there is no cheaper local route, and one code
   * path is easier to reason about.
   */
  useEffect(() => {
    if (run.status !== "open") return;

    const offer = (player: PlayerId) => {
      subs.current[player]?.close();
      subs.current[player] = subscribeToPlayer(player, run.send, (stream) => {
        const video = videoRefs[player].current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => undefined);
        }
        connectedRef.current[player] = true;
        setConnected((current) => ({ ...current, [player]: true }));
      });
    };

    for (const player of ["a", "b"] as const) offer(player);

    const retry = setInterval(() => {
      for (const player of ["a", "b"] as const) {
        if (!connectedRef.current[player]) offer(player);
      }
    }, RETRY_INTERVAL_MS);

    return () => {
      clearInterval(retry);
      for (const sub of Object.values(subs.current)) sub?.close();
      subs.current = {};
      connectedRef.current = { a: false, b: false };
      setConnected({ a: false, b: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.status, run.send]);

  const state = run.state;

  return (
    <div className="stream">
      <div className="stream__stage">
        {(["a", "b"] as const).map((player) => (
          <section key={player} className="column">
            <PlayerColumn
              player={player}
              label={displayName(player, state?.names?.[player])}
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
                  Waiting for {displayName(player, state?.names?.[player])}…
                </div>
              ) : null}
              <EncounterOverlay advice={state?.advice?.[player]} />
            </div>
            <div className="column__route">
              {state?.players?.[player]?.route ?? "—"}
            </div>
            <TeamStrip
              party={state?.players?.[player]?.party ?? []}
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
            {state?.players?.a?.badges ?? 0} / {state?.players?.b?.badges ?? 0}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">Pairs</span>
          <span className="stat__value">
            {state?.pairs?.filter((p) => p.a && p.b).length ?? 0}
          </span>
        </div>
      </footer>
    </div>
  );
}
