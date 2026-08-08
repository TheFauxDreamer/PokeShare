import {
  displayName,
  type PlayerId,
  type RunState,
  type SoulLinkPair,
} from "@pokeshare/shared";
import { useState } from "react";
import { JoinGate } from "../components/JoinGate.js";
import { RunBar } from "../components/RunBar.js";
import { useRun } from "../lib/useRun.js";

/**
 * The players' second screen: every pair, its faint status, and the route it
 * was caught on. Also carries the confirm queue and the manual overrides, so
 * it never has to occupy capture space.
 */

function statusLabel(pair: SoulLinkPair): string {
  switch (pair.status) {
    case "alive":
      return pair.a && pair.b ? "Linked" : "Waiting for partner";
    case "pending":
      return `Faint — confirm (${pair.triggeredBy?.toUpperCase() ?? "?"})`;
    case "dead":
      return "Dead";
    case "void":
      return "No encounter";
  }
}

/**
 * Manual override for auto-pairing.
 *
 * Auto-pairing keys on route, which is right almost always — but a gift
 * Pokemon, a static encounter or a mis-detected route can attach the wrong one.
 * The plan promises an override for every automatic decision; this is it.
 *
 * Choices come from each player's *current party*, because that is the only set
 * the server can verify a PID against.
 */
function RepairControl({
  pair,
  state,
  onRepair,
}: {
  pair: SoulLinkPair;
  state: RunState | undefined;
  onRepair: (player: PlayerId, pid: number) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!state) return null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} title="Re-pair">
        Re-pair
      </button>
    );
  }

  return (
    <span className="repair">
      {(["a", "b"] as const).map((player) => (
        <select
          key={player}
          aria-label={`Re-pair ${displayName(player, state.names?.[player])}`}
          defaultValue=""
          onChange={(event) => {
            const pid = Number(event.target.value);
            if (Number.isFinite(pid) && event.target.value !== "") {
              onRepair(player, pid);
              setOpen(false);
            }
          }}
        >
          <option value="">
            {displayName(player, state.names?.[player])}…
          </option>
          {(state.players?.[player]?.party ?? []).map((member) => (
            <option key={member.pid} value={member.pid}>
              {member.nickname} · Lv {member.level}
            </option>
          ))}
        </select>
      ))}
      <button type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}

export function PairsView({ joinCode }: { joinCode: string | undefined }) {
  const [code, setCode] = useState(joinCode);
  if (!code) {
    return (
      <JoinGate
        title="Soul links"
        description="Enter the run's join code to see every pair, its faint status and the route it was caught on."
        onJoin={setCode}
      />
    );
  }
  return <ConnectedPairsView joinCode={code} />;
}

function ConnectedPairsView({ joinCode }: { joinCode: string }) {
  // Separate scope: the second screen is a spectator, not a player.
  const run = useRun(joinCode, undefined, { scope: "pairs" });
  const state = run.state;

  return (
    <div className="pairs">
      <header className="pairs__header">
        <h1>Soul links</h1>
        <div className="pairs__meta">
          <span className={`status status--${run.status}`}>{run.status}</span>
          {state?.randomised ? <span className="tag">Randomised</span> : null}
          <span>Deaths: {state?.deaths ?? 0}</span>
          <span>Level cap: {state?.levelCap ?? "—"}</span>
        </div>
      </header>

      {state ? <RunBar joinCode={state.joinCode} /> : null}

      {run.error ? <p className="error">{run.error}</p> : null}

      {state && (state.warnings?.length ?? 0) > 0 ? (
        <ul className="warnings">
          {state.warnings!.map((warning, index) => (
            <li key={`${warning.kind}-${warning.route}-${index}`} className={`warning warning--${warning.kind}`}>
              <strong>{warning.kind === "dupes" ? "Dupes" : "Species"}</strong>{" "}
              {warning.message}
            </li>
          ))}
        </ul>
      ) : null}

      <table className="pairs__table">
        <thead>
          <tr>
            <th>Route</th>
            <th>{displayName("a", state?.names?.a)}</th>
            <th>{displayName("b", state?.names?.b)}</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(state?.pairs ?? []).map((pair) => (
            <tr key={pair.id} className={`row row--${pair.status}`}>
              <td className="row__route">{pair.route}</td>
              <td className={pair.a?.fainted ? "fainted" : ""}>
                {pair.a ? `${pair.a.nickname} · Lv ${pair.a.level}` : "—"}
              </td>
              <td className={pair.b?.fainted ? "fainted" : ""}>
                {pair.b ? `${pair.b.nickname} · Lv ${pair.b.level}` : "—"}
              </td>
              <td>{statusLabel(pair)}</td>
              <td className="row__actions">
                <RepairControl
                  pair={pair}
                  state={state}
                  onRepair={(player, pid) =>
                    run.send({ type: "repair_pair", pairId: pair.id, player, pid })
                  }
                />
                {pair.status === "pending" ? (
                  <button
                    type="button"
                    className="confirm"
                    onClick={() =>
                      run.send({ type: "confirm_death", pairId: pair.id })
                    }
                  >
                    Confirm death
                  </button>
                ) : null}
                {pair.status !== "void" ? (
                  <button
                    type="button"
                    onClick={() =>
                      run.send({ type: "void_route", route: pair.route })
                    }
                  >
                    No encounter
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
          {(state?.pairs?.length ?? 0) === 0 ? (
            <tr>
              <td colSpan={5} className="empty">
                No encounters yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
