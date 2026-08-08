import { useCallback, useRef, useState } from "react";
import { MAX_PLAYER_NAME } from "@pokeshare/shared";
import { copyText, pairsUrl, playUrl, streamUrl } from "../lib/links.js";

/**
 * Join code and the links that go with it.
 *
 * Everything here is one click during a stream, when there is no time to be
 * assembling URLs by hand: the code copies for reading out on voice chat, the
 * invite link copies for the partner, and the display views open directly.
 */
export interface RunBarProps {
  readonly joinCode: string;
  /** Omitted on spectator views, which have no name to set. */
  readonly onNameChange?: (name: string) => void;
  readonly name?: string;
}

export function RunBar({ joinCode, name, onNameChange }: RunBarProps) {
  const [copied, setCopied] = useState<string | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flash = useCallback((label: string) => {
    setCopied(label);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(undefined), 1600);
  }, []);

  const copy = useCallback(
    (text: string, label: string) => {
      void copyText(text).then((ok) => flash(ok ? label : "Copy failed"));
    },
    [flash],
  );

  const open = (url: string) => globalThis.open(url, "_blank", "noopener");

  return (
    <div className="runbar">
      <button
        type="button"
        className="runbar__code"
        title="Click to copy the join code"
        onClick={() => copy(joinCode, "Code copied")}
      >
        <span className="runbar__label">Join code</span>
        <strong>{joinCode}</strong>
      </button>

      <button
        type="button"
        onClick={() => copy(playUrl(joinCode), "Invite link copied")}
      >
        Copy invite link
      </button>

      <button type="button" onClick={() => open(streamUrl(joinCode))}>
        Stream view ↗
      </button>

      <button type="button" onClick={() => open(pairsUrl(joinCode))}>
        Pairs view ↗
      </button>

      {/* Also copyable, since the OBS box wants a URL rather than a new tab. */}
      <button
        type="button"
        onClick={() => copy(streamUrl(joinCode), "Stream URL copied")}
      >
        Copy stream URL
      </button>

      {onNameChange ? (
        <label className="runbar__name">
          <span className="runbar__label">Your name</span>
          <input
            value={name ?? ""}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Player A"
            maxLength={MAX_PLAYER_NAME}
            aria-label="Your display name"
          />
        </label>
      ) : null}

      <span className="runbar__flash" role="status" aria-live="polite">
        {copied ?? ""}
      </span>
    </div>
  );
}
