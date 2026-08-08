import type { PartyMemberState, SoulLinkPair } from "@pokeshare/shared";

/**
 * Sprite by National Dex number, with a readable fallback.
 *
 * No sprite assets ship yet; drop PNGs into `public/sprites/<dex>.png` and they
 * light up with no code change. Until then the monogram keeps the layout honest
 * rather than showing a broken image on stream.
 */
function Sprite({ dex, name }: { dex: number | undefined; name: string }) {
  if (dex === undefined) {
    return <div className="sprite sprite--unknown">?</div>;
  }
  return (
    <img
      className="sprite"
      src={`/sprites/${dex}.png`}
      alt={name}
      onError={(event) => {
        const img = event.currentTarget;
        img.style.display = "none";
        img.insertAdjacentHTML(
          "afterend",
          `<div class="sprite sprite--fallback">${dex}</div>`,
        );
      }}
    />
  );
}

export interface SlotProps {
  readonly member: PartyMemberState | undefined;
  /** The pair this Pokemon belongs to, if it has been linked. */
  readonly pair: SoulLinkPair | undefined;
  readonly overLevelCap: boolean;
}

export function PartySlot({ member, pair, overLevelCap }: SlotProps) {
  if (!member) return <div className="slot slot--empty" />;

  const dead = pair?.status === "dead";
  const hpFraction = member.maxHp > 0 ? member.currentHp / member.maxHp : 0;
  const hpState = hpFraction === 0 ? "empty" : hpFraction < 0.34 ? "low" : "ok";

  return (
    <div
      className={[
        "slot",
        dead ? "slot--dead" : "",
        member.currentHp === 0 ? "slot--fainted" : "",
        pair?.status === "pending" ? "slot--pending" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Sprite dex={member.nationalDex} name={member.nickname} />
      <div className="slot__body">
        <div className="slot__name">
          {member.nickname}
          {member.isShiny ? <span className="shiny">★</span> : null}
        </div>
        <div className={`slot__level ${overLevelCap ? "over-cap" : ""}`}>
          Lv {member.level}
        </div>
        <div className="hp">
          <div className={`hp__fill hp__fill--${hpState}`} style={{ width: `${hpFraction * 100}%` }} />
        </div>
        <div className="slot__hp-text">
          {member.currentHp}/{member.maxHp}
        </div>
      </div>
      {pair ? <div className="slot__link" title={`Linked on ${pair.route}`}>⛓ {pair.route}</div> : null}
      {dead ? <div className="slot__cross">✕</div> : null}
    </div>
  );
}

export interface TeamStripProps {
  readonly party: readonly PartyMemberState[];
  readonly pairs: readonly SoulLinkPair[];
  readonly player: "a" | "b";
  readonly levelCap: number | undefined;
}

/** Six slots, always. A fixed shape keeps the stream layout from reflowing. */
export function TeamStrip({ party, pairs, player, levelCap }: TeamStripProps) {
  const pairByPid = new Map<number, SoulLinkPair>();
  for (const pair of pairs) {
    const half = pair[player];
    if (half) pairByPid.set(half.pid, pair);
  }

  return (
    <div className="team">
      {Array.from({ length: 6 }, (_, index) => {
        const member = party[index];
        return (
          <PartySlot
            key={member?.pid ?? `empty-${index}`}
            member={member}
            pair={member ? pairByPid.get(member.pid) : undefined}
            overLevelCap={
              member !== undefined &&
              levelCap !== undefined &&
              member.level > levelCap
            }
          />
        );
      })}
    </div>
  );
}
