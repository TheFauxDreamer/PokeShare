import type { SoulLinkPair } from "@pokeshare/shared";
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

export function PairsView({ joinCode }: { joinCode: string | undefined }) {
  const run = useRun(joinCode);
  const state = run.state;

  return (
    <div className="pairs">
      <header className="pairs__header">
        <h1>Soul links</h1>
        <div className="pairs__meta">
          <span className={`status status--${run.status}`}>{run.status}</span>
          {state ? <span>Join code {state.joinCode}</span> : null}
          {state?.randomised ? <span className="tag">Randomised</span> : null}
          <span>Deaths: {state?.deaths ?? 0}</span>
          <span>Level cap: {state?.levelCap ?? "—"}</span>
        </div>
      </header>

      {run.error ? <p className="error">{run.error}</p> : null}

      {state && state.warnings.length > 0 ? (
        <ul className="warnings">
          {state.warnings.map((warning, index) => (
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
            <th>Player A</th>
            <th>Player B</th>
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
          {(state?.pairs.length ?? 0) === 0 ? (
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
