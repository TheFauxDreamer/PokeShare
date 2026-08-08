import { useCallback, useEffect, useRef, useState } from "react";
import {
  displayName,
  levelCapForBadges,
  type PlayerId,
  type PlayerSnapshot,
} from "@pokeshare/shared";
import { TeamStrip } from "../components/TeamStrip.js";
import { ControlsPanel } from "../components/ControlsPanel.js";
import { RunBar } from "../components/RunBar.js";
import { EncounterOverlay } from "../components/EncounterOverlay.js";
import { normaliseJoinCode, rememberRunInUrl } from "../lib/links.js";
import { loadPlayerName, savePlayerName } from "../lib/playerName.js";
import { createEmulator, POLL_INTERVAL_MS, type Emulator } from "../lib/emulator.js";
import {
  FAST_FORWARD_CODES,
  DEFAULT_FAST_FORWARD_MULTIPLIER,
  describeBindings,
  loadBindings,
  type Bindings,
} from "../lib/input.js";
import { useFastForward } from "../lib/useFastForward.js";
import { useGameInput } from "../lib/useGameInput.js";
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
function RunSetup({
  onCreate,
  onJoin,
}: {
  onCreate: (randomised: boolean) => void;
  onJoin: (code: string) => void;
}) {
  const [randomised, setRandomised] = useState(false);
  const [code, setCode] = useState("");
  const normalised = normaliseJoinCode(code);

  return (
    <div className="landing">
      <h1>Soul Link</h1>

      <section className="setup">
        <h2>Join your partner's run</h2>
        <p>Enter the code they gave you.</p>
        <form
          className="join"
          onSubmit={(event) => {
            event.preventDefault();
            if (!normalised) return;
            rememberRunInUrl(normalised);
            onJoin(normalised);
          }}
        >
          <input
            className="join__code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="K7QP2M"
            aria-label="Join code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={12}
          />
          <button type="submit" disabled={!normalised}>
            Join
          </button>
        </form>
      </section>

      <h2>…or start a new run</h2>
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

      <button type="button" onClick={() => onCreate(randomised)}>
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
  /**
   * Undefined until the run is chosen. A code in the URL skips the setup step;
   * otherwise the player either joins with a code or creates a run, and the
   * `randomised` flag has to be settled *before* connecting because
   * `create_run` is sent the moment the socket opens.
   */
  const [config, setConfig] = useState<
    { code: string | undefined; randomised: boolean } | undefined
  >(joinCode ? { code: joinCode, randomised: false } : undefined);

  if (!config) {
    return (
      <RunSetup
        onCreate={(randomised) => setConfig({ code: undefined, randomised })}
        onJoin={(code) => setConfig({ code, randomised: false })}
      />
    );
  }
  return (
    <ConnectedPlayView joinCode={config.code} randomised={config.randomised} />
  );
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
  const [name, setName] = useState(() => loadPlayerName());
  const fastForward = useFastForward(emulator, FAST_FORWARD_CODES, multiplier);

  // Focus-independent key forwarding; see useGameInput.
  useGameInput(emulator, bindings, !!romName);

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
  const send = run.send;

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

        const snapshot = toPlayerSnapshot(
          observed,
          player,
          emulator.gameCode,
          Date.now(),
          (id) => emulator.typesFor(id),
        );
        const digest = snapshotDigest(snapshot);
        if (digest === lastDigest.current) return;
        lastDigest.current = digest;

        // Render from the local reading, not the server round trip. Your own
        // team must stay on screen even if the server is down or reconnecting
        // -- a blip mid-stream should never blank it.
        setLocal(snapshot);
        send({ type: "snapshot", snapshot });
        setPollError(undefined);
      } catch (error) {
        setPollError(error instanceof Error ? error.message : String(error));
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
    // Depends on `run.send` (stable), never on `run` itself: `run` changes
    // identity on every broadcast and would reset this timer each time.
  }, [romName, player, run.send]);

  useEffect(() => () => publisher.current?.close(), []);

  const state = run.state;
  // Prefer the local reading: it is fresher than the server echo and survives
  // a disconnect. Fall back to server state before the first poll lands.
  const mine = local ?? state?.players?.[player];
  const party = mine?.party ?? [];

  return (
    <div className="play">
      <header className="play__header">
        <h1>PokeShare</h1>
        <div className="play__meta">
          <span className={`status status--${run.status}`}>{run.status}</span>
          {state?.randomised ? <span className="tag">Randomised</span> : null}
          <span>{displayName(player, state?.names?.[player])}</span>
        </div>
      </header>

      {state ? (
        <RunBar
          joinCode={state.joinCode}
          name={name}
          onNameChange={(next) => {
            setName(next);
            run.send({ type: "set_name", name: savePlayerName(next) });
          }}
        />
      ) : null}

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

      <div className="screen-wrap">
        <canvas
          ref={canvasRef}
          className="play__canvas"
          width={240}
          height={160}
          tabIndex={0}
          onClick={activate}
        />
        <EncounterOverlay advice={state?.advice?.[player]} />
      </div>
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
