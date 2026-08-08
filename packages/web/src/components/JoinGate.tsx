import { useState, type FormEvent } from "react";
import { normaliseJoinCode, rememberRunInUrl } from "../lib/links.js";

export interface JoinGateProps {
  readonly title: string;
  readonly description: string;
  readonly onJoin: (code: string) => void;
}

/** Code entry for the views that can only ever join: /stream and /pairs. */
export function JoinGate({ title, description, onJoin }: JoinGateProps) {
  const [code, setCode] = useState("");
  const normalised = normaliseJoinCode(code);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!normalised) return;
    rememberRunInUrl(normalised);
    onJoin(normalised);
  };

  return (
    <div className="landing">
      <h1>{title}</h1>
      <p>{description}</p>

      <form className="join" onSubmit={submit}>
        <input
          className="join__code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="K7QP2M"
          aria-label="Join code"
          autoFocus
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={12}
        />
        <button type="submit" disabled={!normalised}>
          Join
        </button>
      </form>
    </div>
  );
}
