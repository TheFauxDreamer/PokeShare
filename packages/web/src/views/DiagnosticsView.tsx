import { useCallback, useRef, useState } from "react";
import { diagnoseSaveState, type DiagnosticStep } from "../lib/diagnostics.js";
import { createEmulator, readRawState, type Emulator } from "../lib/emulator.js";

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

  const loadRom = useCallback(async (file: File) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      emulatorRef.current ??= await createEmulator(canvas);
      await emulatorRef.current.loadRom(file);
      setRomName(file.name);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
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

      <canvas ref={canvasRef} className="play__canvas" width={240} height={160} />

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
