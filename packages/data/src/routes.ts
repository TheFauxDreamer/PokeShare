import type { MapSecTable } from "./games.js";
import { EMERALD_MAPSEC, FRLG_MAPSEC, RS_MAPSEC } from "./mapsec.generated.js";

const TABLES: Record<MapSecTable, Readonly<Record<number, string>>> = {
  RS: RS_MAPSEC,
  EMERALD: EMERALD_MAPSEC,
  FRLG: FRLG_MAPSEC,
};

/**
 * Resolve a `regionMapSectionId` to a human route name ("Route 103").
 *
 * This is the key Soul Link pairs on, which is why it is derived from the
 * region map section rather than the map group/number: MAPSEC granularity is
 * exactly "one route", so every sub-map of Petalburg Woods collapses to a
 * single encounter location automatically.
 *
 * Returns `undefined` for unknown ids so callers can distinguish "not a
 * pairable location" from a genuine name.
 */
export function routeName(
  table: MapSecTable,
  mapSecId: number,
): string | undefined {
  return TABLES[table][mapSecId];
}

export { EMERALD_MAPSEC, FRLG_MAPSEC, RS_MAPSEC };
