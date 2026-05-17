import countiesByState from './data/counties-by-state.json' with { type: 'json' };

export interface County {
  /** PolicyEngine US county enum code (e.g. "ALAMEDA_COUNTY_CA"). */
  code: string;
  /** Display name without the trailing state segment (e.g. "Alameda County"). */
  name: string;
}

const DATA = countiesByState as Record<string, County[]>;

/**
 * Counties grouped by two-letter state code, sorted by name. The data ships
 * inline with the package so the wizard can render a county dropdown without
 * any network call.
 *
 * To refresh from PolicyEngine US metadata, run `bun run regenerate-counties`.
 */
export function getCountiesByState(stateCode: string | null | undefined): County[] {
  if (!stateCode) {
    return [];
  }
  return DATA[stateCode] ?? [];
}

const COUNTY_CODES: Set<string> = new Set(
  Object.values(DATA)
    .flat()
    .map((county) => county.code),
);

const COUNTY_NAMES_BY_STATE: Map<string, Map<string, string>> = new Map(
  Object.entries(DATA).map(([stateCode, list]) => [
    stateCode,
    new Map(list.map((county) => [normalizeName(county.name), county.code])),
  ]),
);

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bcounty\b|\bparish\b|\bborough\b|\bcensus area\b|\bmunicipality\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isCountyCode(value: unknown): value is string {
  return typeof value === 'string' && COUNTY_CODES.has(value);
}

export function getCountyName(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  for (const list of Object.values(DATA)) {
    for (const county of list) {
      if (county.code === code) {
        return county.name;
      }
    }
  }
  return null;
}

/**
 * Resolve a free-text county name (legacy input shape used by Coverage Compass
 * and others) to a PolicyEngine county code. Matching is case-insensitive and
 * ignores common suffixes like "County", "Parish", "Borough".
 */
export function resolveCountyCode(
  stateCode: string | null | undefined,
  countyInput: string | null | undefined,
): string | null {
  if (!stateCode || !countyInput) {
    return null;
  }

  // If the caller already passed a known county code, return it unchanged.
  if (isCountyCode(countyInput)) {
    return countyInput;
  }

  const lookup = COUNTY_NAMES_BY_STATE.get(stateCode);
  if (!lookup) {
    return null;
  }
  const key = normalizeName(countyInput);
  if (!key) {
    return null;
  }
  return lookup.get(key) ?? null;
}

export { DATA as _rawCountyData };
