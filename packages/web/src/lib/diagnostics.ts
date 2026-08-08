/**
 * Step-by-step diagnosis of the save-state read path.
 *
 * The read path has never touched a real ROM, and when it first does, a failure
 * anywhere in the chain would otherwise surface as "no party". This walks each
 * link separately and says exactly which one broke and what to do about it.
 *
 * Deliberately pure -- it takes the state bytes, not the emulator -- so every
 * branch is unit-testable against fixtures.
 */

import {
  MAP_HEADER_REGION_MAPSEC_OFFSET,
  layoutForGameCode,
  routeName,
  type GameLayout,
} from "@pokeshare/data";
import {
  PARTY_SLOT_SIZE,
  memoryFromSaveState,
  parsePartySlot,
  readBadges,
  readParty,
  SAVESTATE_SIZE,
  saveStateGameCode,
  saveStateVersion,
} from "@pokeshare/gba";

export interface DiagnosticStep {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

function step(name: string, ok: boolean, detail: string): DiagnosticStep {
  return { name, ok, detail };
}

/** A PNG-wrapped state starts with the standard PNG magic. */
function looksLikePng(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

export function diagnoseSaveState(bytes: Uint8Array): DiagnosticStep[] {
  const steps: DiagnosticStep[] = [];

  if (looksLikePng(bytes)) {
    steps.push(
      step(
        "State format",
        false,
        "State is PNG-wrapped. SAVESTATE_SCREENSHOT (bit 0) must be off — " +
          "call _saveStateSlot(slot, 0) rather than saveState(slot).",
      ),
    );
    return steps;
  }

  steps.push(
    step(
      "State size",
      bytes.length >= SAVESTATE_SIZE,
      `${bytes.length} bytes (need at least ${SAVESTATE_SIZE})`,
    ),
  );
  if (bytes.length < SAVESTATE_SIZE) return steps;

  let version: number;
  try {
    version = saveStateVersion(bytes);
    steps.push(step("State magic", true, `mGBA state version ${version}`));
  } catch (error) {
    steps.push(
      step(
        "State magic",
        false,
        error instanceof Error ? error.message : String(error),
      ),
    );
    return steps;
  }

  const gameCode = saveStateGameCode(bytes);
  const layout = layoutForGameCode(gameCode);
  steps.push(
    step(
      "Game identified",
      layout !== undefined,
      layout
        ? `${gameCode} — ${layout.name}`
        : `Unrecognised game code "${gameCode}". Gen 3 only ` +
          "(BPEE/BPRE/BPGE/AXVE/AXPE); randomised ROMs keep their base header.",
    ),
  );
  if (!layout) return steps;

  const memory = memoryFromSaveState(bytes);
  steps.push(
    step(
      "Party region",
      true,
      layout.playerParty >= 0x03000000
        ? `IWRAM at 0x${layout.playerParty.toString(16)} (Ruby/Sapphire)`
        : `EWRAM at 0x${layout.playerParty.toString(16)}`,
    ),
  );

  const declared = memory.readU8(layout.playerPartyCount);
  const countOk = declared >= 1 && declared <= 6;
  steps.push(
    step(
      "Party count",
      countOk,
      countOk
        ? `${declared} Pokémon`
        : `Read ${declared}, expected 1-6. Either no party yet, or the ` +
          "address table is wrong for this ROM revision.",
    ),
  );

  steps.push(...diagnoseParty(memory, layout, declared));

  const mapSecId = memory.readU8(
    layout.mapHeader + MAP_HEADER_REGION_MAPSEC_OFFSET,
  );
  const route = routeName(layout.mapSecTable, mapSecId);
  steps.push(
    step(
      "Current route",
      route !== undefined,
      route
        ? `${route} (MAPSEC ${mapSecId})`
        : `MAPSEC ${mapSecId} is not in the ${layout.mapSecTable} table — ` +
          "encounters here will not pair until it is identified.",
    ),
  );

  try {
    const badges = readBadges(memory, layout);
    steps.push(
      step(
        "Badges",
        badges >= 0 && badges <= 8,
        `${badges} badge(s). Cross-check against the in-game trainer card — ` +
          "this is the least-verified read in the system.",
      ),
    );
  } catch (error) {
    steps.push(
      step(
        "Badges",
        false,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  return steps;
}

function diagnoseParty(
  memory: ReturnType<typeof memoryFromSaveState>,
  layout: GameLayout,
  declared: number,
): DiagnosticStep[] {
  const count = Math.min(Math.max(declared, 0), 6);
  if (count === 0) return [];

  let checksumFailures = 0;
  for (let slot = 0; slot < count; slot += 1) {
    const raw = memory.readBytes(
      layout.playerParty + slot * PARTY_SLOT_SIZE,
      PARTY_SLOT_SIZE,
    );
    const mon = parsePartySlot(raw);
    if (mon && !mon.checksumValid) checksumFailures += 1;
  }

  const steps: DiagnosticStep[] = [
    step(
      "Checksums",
      checksumFailures === 0,
      checksumFailures === 0
        ? `All ${count} slot(s) validate`
        : `${checksumFailures}/${count} slots failed. The party address is ` +
          "almost certainly wrong — a correct address effectively never fails.",
    ),
  ];

  const party = readParty(memory, layout);
  steps.push(
    step(
      "Party parsed",
      party.length === count,
      party
        .map(
          (m) =>
            `${m.nickname} (dex ${m.nationalDex ?? "?"}) Lv${m.level} ${m.currentHp}/${m.maxHp}`,
        )
        .join(" · ") || "empty",
    ),
  );
  return steps;
}
