import type { EncounterAdvice } from "@pokeshare/shared";

const HEADLINE: Record<EncounterAdvice["verdict"], string> = {
  catchable: "Catch Available",
  route_taken: "Route already used",
  route_void: "Route voided",
  dupe: "Dupe — re-roll",
  species_clash: "Species clash — re-roll",
};

/**
 * Verdict on the wild Pokemon currently on screen, pinned over the game.
 *
 * Shown only during a wild battle, because that is the only moment it can
 * change a decision: throw a ball, or run and look for another encounter.
 */
export function EncounterOverlay({
  advice,
}: {
  advice: EncounterAdvice | undefined;
}) {
  if (!advice) return null;

  // Only ever the blocker. The wild Pokemon is on screen directly behind this
  // overlay, so its sprite would be redundant -- and when something blocks the
  // catch, it would contradict text naming a different Pokemon.
  const { blockerDex, blockerNickname, message } = advice;

  return (
    <div
      className={`encounter encounter--${advice.rerollNeeded ? "bad" : "good"}`}
      role="status"
      aria-live="polite"
    >
      <div className="encounter__headline">{HEADLINE[advice.verdict]}</div>
      {message ? <div className="encounter__detail">{message}</div> : null}
      {blockerDex !== undefined ? (
        <img
          className="encounter__sprite"
          src={`/sprites/${blockerDex}.png`}
          alt={blockerNickname ?? ""}
          title={blockerNickname ?? ""}
          onError={(event) => {
            event.currentTarget.style.visibility = "hidden";
          }}
        />
      ) : null}
    </div>
  );
}
