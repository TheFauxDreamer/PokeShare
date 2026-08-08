import { useCallback, useEffect, useRef, useState } from "react";
import { levelCapForBadges, type PlayerSnapshot } from "@pokeshare/shared";
import { ControlsPanel } from "../components/ControlsPanel.js";
import { TeamStrip } from "../components/TeamStrip.js";
import { POLL_INTERVAL_MS } from "../lib/emulator.js";
import { toPlayerSnapshot } from "../lib/snapshot.js";
import { diagnoseSaveState, type DiagnosticStep } from "../lib/diagnostics.js";
import { createEmulator, readRawState, type Emulator } from "../lib/emulator.js";
import {
  FAST_FORWARD_CODES,
  DEFAULT_FAST_FORWARD_MULTIPLIER,
  describeBindings,
  loadBindings,
  type Bindings,
} from "../lib/input.js";
import { useFastForward } from "../lib/useFastForward.js";
import { useGameInput } from "../lib/useGameInput.js";

/**
 * The Phase 1 spike, as a page.
 *
 * Load a ROM, play until you have a party, then press Run. Every link in the
 * read path reports separately, so a failure names itself instead of surfacing
 * as an empty team on stream.
 */
export function DiagnosticsView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const emulatorRef = useRef<Emulator | undefined>(undefined);

  const [romName, setRomName] = useState<string | undefined>();
  const [steps, setSteps] = useState<DiagnosticStep[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [bindings, setBindings] = useState<Bindings>(() => loadBindings());
  const [multiplier, setMultiplier] = useState(DEFAULT_FAST_FORWARD_MULTIPLIER);
  const [emulator, setEmulator] = useState<Emulator | undefined>();
  const [live, setLive] = useState<PlayerSnapshot | undefined>();
  /**
   * Faints observed this session.
   *
   * There is no run here, so nothing can be marked dead — but whiting out
   * heals the party, which makes it look like nothing was detected. This
   * records the >0 -> 0 edge exactly as the server's rules engine does, so the
   * detection is visible without needing a partner.
   */
  const [faints, setFaints] = useState<readonly string[]>([]);
  const lastHp = useRef(new Map<number, number>());

  // Fast-forward matters most here: you have to play through the intro before
  // there is a party to check.
  const fastForward = useFastForward(emulator, FAST_FORWARD_CODES, multiplier);

  // Focus-independent key forwarding; see useGameInput.
  useGameInput(emulator, bindings, !!romName);

  useEffect(() => {
    emulator?.setBindings(bindings);
  }, [emulator, bindings]);

  /**
   * The same 4 Hz loop the play view uses, rendering the same TeamStrip.
   *
   * Running it here exercises the whole chain — poll, parse, sprite lookup,
   * HP bars — against a real ROM without needing a server or a partner.
   */
  useEffect(() => {
    if (!emulator || !romName) return;

    const timer = setInterval(() => {
      try {
        const observed = emulator.poll();
        if (!observed || !emulator.gameCode) return;

        const snapshot = toPlayerSnapshot(
          observed,
          "a",
          emulator.gameCode,
          Date.now(),
          (id) => emulator.typesFor(id),
        );
        for (const member of snapshot.party) {
          const previous = lastHp.current.get(member.pid);
          lastHp.current.set(member.pid, member.currentHp);
          // Same edge-triggered rule the engine uses: only >0 -> 0 counts.
          if (previous !== undefined && previous > 0 && member.currentHp === 0) {
            const at = new Date().toLocaleTimeString();
            setFaints((current) => [
              ...current,
              `${member.nickname} (Lv ${member.level}) at ${at}`,
            ]);
          }
        }

        setLive(snapshot);
        setError(undefined);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [emulator, romName]);

  const loadRom = useCallback(async (file: File) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      if (!emulatorRef.current) {
        emulatorRef.current = await createEmulator(canvas);
        setEmulator(emulatorRef.current);
      }
      await emulatorRef.current.loadRom(file);
      setRomName(file.name);
      setError(undefined);
      // Keyboard events reach the emulator only once the canvas has focus.
      canvas.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  /** Browsers suspend audio until a gesture; clicking the canvas is one. */
  const activate = useCallback(() => {
    canvasRef.current?.focus();
    emulatorRef.current?.module.resumeAudio();
  }, []);

  const run = useCallback(() => {
    const emulator = emulatorRef.current;
    if (!emulator) return;
    try {
      const bytes = readRawState(emulator.module);
      if (!bytes) {
        setError(
          "Could not read a save state. mGBA reported no state file in " +
            "filePaths().saveStatePath — the write may have failed or the " +
            "naming convention differs.",
        );
        setSteps(undefined);
        return;
      }
      setSteps(diagnoseSaveState(bytes));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  return (
    <div className="play">
      <header className="play__header">
        <h1>Read-path diagnostics</h1>
      </header>

      <p className="rom-name">
        Load a ROM, play until you have at least one Pokémon, then run the
        check.
      </p>

      {error ? <p className="error">{error}</p> : null}

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
          <p className="controls">
            Click the screen to focus it, then play. {describeBindings(bindings)}
          </p>
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
          <span>Choose a Gen 3 ROM</span>
          <input
            type="file"
            accept=".gba"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadRom(file);
            }}
          />
          <small>Stays on this machine. Nothing is uploaded.</small>
        </label>
      ) : (
        <p className="rom-name">
          {romName} <button type="button" onClick={run}>Run diagnostics</button>
        </p>
      )}

      {live ? (
        <section className="live-team">
          <div className="live-team__meta">
            <span>Live team ({POLL_INTERVAL_MS} ms)</span>
            <span>Route: {live.route ?? "—"}</span>
            <span>Badges: {live.badges}</span>
            <span>Level cap: {levelCapForBadges(live.badges) ?? "—"}</span>
            {live.inWildBattle ? (
              <span className="tag">
                Wild encounter: dex {live.wildEncounterDex ?? "?"}
              </span>
            ) : null}
          </div>
          <TeamStrip
            party={live.party}
            pairs={[]}
            player="a"
            levelCap={levelCapForBadges(live.badges)}
          />

          <div className="faints">
            <strong>Faints detected: {faints.length}</strong>
            {faints.length > 0 ? (
              <ul>
                {faints.map((entry, index) => (
                  <li key={`${entry}-${index}`}>{entry}</li>
                ))}
              </ul>
            ) : (
              <p>
                None yet. A faint is recorded the moment HP hits 0 — the team
                above still shows live HP, so whiting out will heal it back.
                In a real run the pair stays dead regardless.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {steps ? (
        <table className="pairs__table">
          <thead>
            <tr>
              <th />
              <th>Check</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => (
              <tr key={step.name} className={step.ok ? "" : "row--pending"}>
                <td>{step.ok ? "✓" : "✕"}</td>
                <td className="row__route">{step.name}</td>
                <td>{step.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
