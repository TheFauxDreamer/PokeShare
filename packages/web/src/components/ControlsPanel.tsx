import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_BINDINGS,
  FAST_FORWARD_LABEL,
  DEFAULT_FAST_FORWARD_MULTIPLIER,
  GBA_INPUTS,
  codeToSdlKeyName,
  conflictFor,
  saveBindings,
  type Bindings,
  type GbaInput,
} from "../lib/input.js";

const SPEEDS = [2, 4, 8, 16] as const;

export interface ControlsPanelProps {
  readonly bindings: Bindings;
  readonly onChange: (bindings: Bindings) => void;
  readonly multiplier: number;
  readonly onMultiplierChange: (multiplier: number) => void;
  /** True while fast-forward is engaged, for the indicator. */
  readonly fastForwarding: boolean;
  readonly onToggleFastForward: () => void;
}

/**
 * Rebinding and speed controls.
 *
 * Rebinding captures a real key press rather than offering a dropdown, because
 * the emulator needs an SDL key name and only a live `KeyboardEvent.code` can
 * be translated to one reliably.
 */
export function ControlsPanel({
  bindings,
  onChange,
  multiplier,
  onMultiplierChange,
  fastForwarding,
  onToggleFastForward,
}: ControlsPanelProps) {
  const [capturing, setCapturing] = useState<GbaInput | undefined>();
  const [problem, setProblem] = useState<string | undefined>();

  const commit = useCallback(
    (next: Bindings) => {
      saveBindings(next);
      onChange(next);
    },
    [onChange],
  );

  // While capturing, swallow every key so the emulator does not also act on it.
  useEffect(() => {
    if (!capturing) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.code === "Escape") {
        setCapturing(undefined);
        setProblem(undefined);
        return;
      }

      const sdlKey = codeToSdlKeyName(event.code);
      if (!sdlKey) {
        setProblem(`${event.code} has no SDL equivalent — pick another key.`);
        return;
      }

      const clash = conflictFor(bindings, sdlKey, capturing);
      if (clash) {
        setProblem(`${sdlKey} is already bound to ${clash}.`);
        return;
      }

      commit({ ...bindings, [capturing]: sdlKey });
      setCapturing(undefined);
      setProblem(undefined);
    };

    // Capture phase, so this runs before the emulator's own listener.
    globalThis.addEventListener("keydown", onKeyDown, true);
    return () => globalThis.removeEventListener("keydown", onKeyDown, true);
  }, [capturing, bindings, commit]);

  return (
    <details className="controls-panel">
      <summary>
        Controls
        {fastForwarding ? <span className="ff-badge">▶▶ {multiplier}×</span> : null}
      </summary>

      <div className="bindings">
        {GBA_INPUTS.map((input) => (
          <button
            key={input}
            type="button"
            className={`binding ${capturing === input ? "binding--capturing" : ""}`}
            onClick={() => {
              setCapturing(input);
              setProblem(undefined);
            }}
          >
            <span className="binding__input">{input}</span>
            <span className="binding__key">
              {capturing === input ? "press a key…" : bindings[input]}
            </span>
          </button>
        ))}
      </div>

      {problem ? <p className="error">{problem}</p> : null}
      {capturing ? <p className="controls">Esc to cancel.</p> : null}

      <div className="speed">
        <button
          type="button"
          className={fastForwarding ? "speed--on" : ""}
          onClick={onToggleFastForward}
        >
          {fastForwarding ? "▶▶ Fast-forward ON" : "▶ Normal speed"}
        </button>
        <span>
          <kbd>{FAST_FORWARD_LABEL}</kbd> toggles. Speed:
        </span>
        {SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            className={multiplier === speed ? "speed--on" : ""}
            onClick={() => onMultiplierChange(speed)}
          >
            {speed}×
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => {
          commit({ ...DEFAULT_BINDINGS });
          onMultiplierChange(DEFAULT_FAST_FORWARD_MULTIPLIER);
        }}
      >
        Reset to defaults
      </button>
    </details>
  );
}
