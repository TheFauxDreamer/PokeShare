import { useCallback, useEffect, useRef, useState } from "react";
import {
  levelCapForBadges,
  type PlayerId,
  type PlayerSnapshot,
} from "@pokeshare/shared";
import { TeamStrip } from "../components/TeamStrip.js";
import { ControlsPanel } from "../components/ControlsPanel.js";
import { createEmulator, POLL_INTERVAL_MS, type Emulator } from "../lib/emulator.js";
import {
  FAST_FORWARD_CODES,
  DEFAULT_FAST_FORWARD_MULTIPLIER,
  describeBindings,
  loadBindings,
  type Bindings,
} from "../lib/input.js";
import { useFastForward } from "../lib/useFastForward.js";
import { snapshotDigest, toPlayerSnapshot } from "../lib/snapshot.js";
import { useRun } from "../lib/useRun.js";
import { publishCanvas } from "../lib/video.js";

/**
 * Run setup, shown only to the player creating a run.
 *
 * This exists because `create_run` is sent the instant the socket opens, so
 * anything that configures the run has to be decided *before* connecting.
 * Joining players skip it — the setting belongs to the run, not the player.
 */
function RunSetup({ onStart }: { onStart: (randomised: boolean) => void }) {
  const [randomised, setRandomised] = useState(false);

  return (
    <div className="landing">
      <h1>Start a Soul Link run</h1>
      <p>
        You will get a join code to send your partner. Both of you load your own
        ROM; nothing is uploaded.
      </p>

      <label className="check">
        <input
          type="checkbox"
          checked={randomised}
          onChange={(event) => setRandomised(event.target.checked)}
        />
        <span>
          <strong>Randomised ROMs</strong>
          <small>
            Randomisers rewrite evolutions, so the dupes and species clauses
            compare exact species instead of evolution families. Leave off for
            vanilla Ruby/Sapphire/Emerald/FireRed/LeafGreen.
          </small>
        </span>
      </label>

      <button type="button" onClick={() => onStart(randomised)}>
        Create run
      </button>
    </div>
  );
}

/**
 * Where a player actually plays.
 *
 * Owns the emulator, the 4 Hz poll loop, and the outgoing video publish. Sends
 * a snapshot only when something the server cares about changed, so an idle run
 * generates almost no traffic.
 */
export function PlayView({ joinCode }: { joinCode: string | undefined }) {
  // Joining players connect straight away; creators choose settings first.
  const [randomised, setRandomised] = useState<boolean | undefined>(
    joinCode ? false : undefined,
  );

  if (randomised === undefined) {
    return <RunSetup onStart={setRandomised} />;
  }
  return <ConnectedPlayView joinCode={joinCode} randomised={randomised} />;
}

function ConnectedPlayView({
  joinCode,
  randomised,
}: {
  joinCode: string | undefined;
  randomised: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const emulatorRef = useRef<Emulator | undefined>(undefined);
  const lastDigest = useRef<string | undefined>(undefined);
  const publisher = useRef<ReturnType<typeof publishCanvas> | undefined>(undefined);

  const [romName, setRomName] = useState<string | undefined>();
  const [pollError, setPollError] = useState<string | undefined>();
  const [bindings, setBindings] = useState<Bindings>(() => loadBindings());
  const [multiplier, setMultiplier] = useState(DEFAULT_FAST_FORWARD_MULTIPLIER);
  const [emulator, setEmulator] = useState<Emulator | undefined>();
  /** Latest local reading, so the team renders without a server. */
  const [local, setLocal] = useState<PlayerSnapshot | undefined>();
  const fastForward = useFastForward(emulator, FAST_FORWARD_CODES, multiplier);

  // Push rebinds straight through; no reload needed.
  useEffect(() => {
    emulator?.setBindings(bindings);
  }, [emulator, bindings]);

  // Hand incoming offers/ICE to the publisher. Without this the stream view
  // never gets a picture, because the publisher only ever answers.
  const run = useRun(
    joinCode,
    (from, payload) => publisher.current?.accept(from, payload),
    { randomised },
  );
  const player: PlayerId = run.player ?? "a";

  const loadRom = useCallback(async (file: File) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!emulatorRef.current) {
      emulatorRef.current = await createEmulator(canvas);
      publisher.current = publishCanvas(canvas, run.send);
      setEmulator(emulatorRef.current);
    }
    await emulatorRef.current.loadRom(file);
    setRomName(file.name);
    lastDigest.current = undefined;
    canvas.focus(); // keyboard events only reach a focused canvas
  }, [run.send]);

  /** Browsers suspend audio until a gesture; clicking the canvas is one. */
  const activate = useCallback(() => {
    canvasRef.current?.focus();
    emulatorRef.current?.module.resumeAudio();
  }, []);

  // The poll loop. Deliberately interval-based rather than per-frame: 250 ms is
  // invisible on stream and keeps overhead near zero while OBS encodes.
  useEffect(() => {
    if (!romName) return;

    const timer = setInterval(() => {
      const emulator = emulatorRef.current;
      if (!emulator) return;

      try {
        const observed = emulator.poll();
        if (!observed || !emulator.gameCode) return;

        const snapshot = toPlayerSnapshot(observed, player, emulator.gameCode);
        const digest = snapshotDigest(snapshot);
        if (digest === lastDigest.current) return;
        lastDigest.current = digest;

        // Render from the local reading, not the server round trip. Your own
        // team must stay on screen even if the server is down or reconnecting
        // -- a blip mid-stream should never blank it.
        setLocal(snapshot);
        run.send({ type: "snapshot", snapshot });
        setPollError(undefined);
      } catch (error) {
        setPollError(error instanceof Error ? error.message : String(error));
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [romName, player, run]);

  useEffect(() => () => publisher.current?.close(), []);

  const state = run.state;
  // Prefer the local reading: it is fresher than the server echo and survives
  // a disconnect. Fall back to server state before the first poll lands.
  const mine = local ?? state?.players[player];
  const party = mine?.party ?? [];

  return (
    <div className="play">
      <header className="play__header">
        <h1>PokeShare</h1>
        <div className="play__meta">
          <span className={`status status--${run.status}`}>{run.status}</span>
          {state ? (
            <span className="joincode">
              Join code <strong>{state.joinCode}</strong>
            </span>
          ) : null}
          {state?.randomised ? <span className="tag">Randomised</span> : null}
          <span>Player {player.toUpperCase()}</span>
        </div>
      </header>

      {run.error ? <p className="error">{run.error}</p> : null}
      {pollError ? <p className="error">{pollError}</p> : null}
      {run.status !== "open" ? (
        <p className="error">
          Not connected to the PokeShare server, so nothing is syncing to your
          partner or to the stream view. Your own team below is read straight
          from the emulator and is still live. Start the server with{" "}
          <code>pnpm dev:server</code>.
        </p>
      ) : null}

      <canvas
        ref={canvasRef}
        className="play__canvas"
        width={240}
        height={160}
        tabIndex={0}
        onClick={activate}
      />
      {romName ? (
        <>
          <p className="controls">{describeBindings(bindings)}</p>
          <ControlsPanel
            bindings={bindings}
            onChange={setBindings}
            multiplier={multiplier}
            onMultiplierChange={setMultiplier}
            fastForwarding={fastForward.active}
            onToggleFastForward={fastForward.toggle}
          />
        </>
      ) : null}

      {!romName ? (
        <label className="rom-picker">
          <span>Choose your Gen 3 ROM</span>
          <input
            type="file"
            accept=".gba"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadRom(file);
            }}
          />
          <small>
            Stays on this machine. Nothing is uploaded.
          </small>
        </label>
      ) : (
        <p className="rom-name">{romName}</p>
      )}

      {run.pending.length > 0 ? (
        <div className="prompt">
          <h2>Confirm death</h2>
          {run.pending.map((pair) => (
            <div key={pair.id} className="prompt__row">
              <span>
                {pair.route}: {pair[player]?.nickname ?? "—"} fainted. Its
                partner {pair[player === "a" ? "b" : "a"]?.nickname ?? "—"} dies too.
              </span>
              <button
                type="button"
                onClick={() => run.send({ type: "confirm_death", pairId: pair.id })}
              >
                Confirm
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <TeamStrip
        party={party}
        pairs={state?.pairs ?? []}
        player={player}
        levelCap={state?.levelCap ?? levelCapForBadges(mine?.badges ?? 0)}
      />

      <footer className="play__footer">
        <span>Badges: {mine?.badges ?? 0}</span>
        <span>
          Level cap:{" "}
          {state?.levelCap ?? levelCapForBadges(mine?.badges ?? 0) ?? "—"}
        </span>
        <span>Route: {mine?.route ?? "—"}</span>
        <span>Deaths: {state?.deaths ?? 0}</span>
      </footer>
    </div>
  );
}
