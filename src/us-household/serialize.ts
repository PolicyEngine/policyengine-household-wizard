import { createBlankDraft } from './draft';
import type { USHouseholdDraft, USPersonDraft, USPersonFlags, USPersonIncomes } from './types';

/**
 * Compact URL-safe serialization for the household draft. The format is
 * stable: each app gets the same query-string shape, which lets us deep-link
 * across apps that share the wizard.
 *
 * Format example: `state=CA&county=ALAMEDA_COUNTY_CA&marital=married&year=2026
 *                  &p=adult:35:e50000:se-1200.5,adult:33:e20000:-D,dep:6:S`
 *
 * People are comma-separated. Each person is colon-separated: kind (`adult` or
 * `dep`), age (empty when unset), then one token per set field. An amount
 * token is its key followed by the number (`e50000`, `se-1200.5`, `e0`). A
 * flag token is its key for `true` (`D`) or `-` and its key for `false` (`-D`).
 *
 * Amount keys:
 *   - `e`       = employmentIncome
 *   - `s`       = ssiAmount
 *   - `d`       = ssdiAmount
 *   - `se`      = selfEmploymentIncome
 *   - `ss`      = socialSecurityIncome
 *   - `pen`     = pensionIncome
 *   - `penpub`  = publicPensionIncome
 *   - `penpriv` = privatePensionIncome
 *   - `div`     = dividendIncome
 *   - `int`     = taxableInterestIncome
 *   - `rent`    = rentalIncome
 *   - `uc`      = unemploymentCompensation
 *   - `cs`      = childSupportReceived
 *   - `misc`    = miscellaneousIncome
 *
 * Flag keys:
 *   - `D` = isDisabled
 *   - `B` = isBlind
 *   - `S` = isFullTimeStudent
 *   - `P` = isPregnant
 *   - `C` = needsCare
 *
 * A token's key is the longest key it starts with, so `se50` is
 * self-employment income, not SSI. If a key repeats, the last token wins.
 * Unknown tokens are ignored, and so is an amount token with a leading `-`.
 *
 * Numbers are written with `String()` and read with `parseFloat`, so every
 * finite amount or age decodes to the number that was encoded, including
 * zero, negatives and fractions (`-0` becomes `0`). Only values of the
 * declared types are written: finite numbers for ages and amounts, booleans
 * for flags. Anything else is treated as unset. Person ids are reassigned in
 * order (`adult-1`, `dependent-1`, …); `label` and `extras` are not encoded.
 * Household fields work as in 0.1: empty `state`, `county` and `zip` are not
 * written, a `marital` other than `single` or `married` reads as unset, and
 * `year` is read with `parseInt`, so only whole years round-trip.
 *
 * Compatibility:
 *   - Keys never change meaning. A new field gets a new key made of ASCII
 *     letters, lowercase for amounts, that does not start with a flag letter.
 *   - Version 0.1 wrote only `e`, `s`, `d` and `true` flags, and skipped zero
 *     amounts. Its links decode as before, except that fractions and exponents
 *     are kept: 0.1 read `e50000.75` as 50000. The one other difference comes
 *     from values outside the types: 0.1 wrote a string amount as is, so
 *     `ssiAmount: 'e5'` became `se5`, which now reads as self-employment income.
 *   - A 0.1 decoder reads the first letter of each token and ignores every
 *     token added since: none starts with a flag letter, and in `se`, `ss`
 *     and `div` a letter, not a number, follows the amount key. So 0.1 still
 *     reads `e`, `s`, `d` and `true` flags from newer links.
 */

/** Typed over every income field, so a new field fails typecheck until it has a key. */
export const INCOME_KEYS: Record<keyof Required<USPersonIncomes>, string> = {
  employmentIncome: 'e',
  ssiAmount: 's',
  ssdiAmount: 'd',
  selfEmploymentIncome: 'se',
  socialSecurityIncome: 'ss',
  pensionIncome: 'pen',
  publicPensionIncome: 'penpub',
  privatePensionIncome: 'penpriv',
  dividendIncome: 'div',
  taxableInterestIncome: 'int',
  rentalIncome: 'rent',
  unemploymentCompensation: 'uc',
  childSupportReceived: 'cs',
  miscellaneousIncome: 'misc',
};

export const FLAG_KEYS: Record<keyof Required<USPersonFlags>, string> = {
  isDisabled: 'D',
  isBlind: 'B',
  isFullTimeStudent: 'S',
  isPregnant: 'P',
  needsCare: 'C',
};

const INCOME_ENTRIES = Object.entries(INCOME_KEYS) as Array<[keyof USPersonIncomes, string]>;
const FLAG_ENTRIES = Object.entries(FLAG_KEYS) as Array<[keyof USPersonFlags, string]>;

type TokenKey =
  | { key: string; field: keyof USPersonIncomes; isFlag: false }
  | { key: string; field: keyof USPersonFlags; isFlag: true };

const KEYS_LONGEST_FIRST: TokenKey[] = [
  ...INCOME_ENTRIES.map(([field, key]): TokenKey => ({ key, field, isFlag: false })),
  ...FLAG_ENTRIES.map(([field, key]): TokenKey => ({ key, field, isFlag: true })),
].sort((a, b) => b.key.length - a.key.length);

function formatNumber(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}

function parseNumber(raw: string): number | null {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function serializePerson(person: USPersonDraft): string {
  const segments: string[] = [
    person.kind === 'adult' ? 'adult' : 'dep',
    formatNumber(person.age) ?? '',
  ];
  for (const [field, key] of INCOME_ENTRIES) {
    const value = formatNumber(person[field]);
    if (value !== null) {
      segments.push(`${key}${value}`);
    }
  }
  for (const [field, key] of FLAG_ENTRIES) {
    if (person[field] === true) {
      segments.push(key);
    } else if (person[field] === false) {
      segments.push(`-${key}`);
    }
  }
  return segments.join(':');
}

function parsePerson(raw: string): USPersonDraft | null {
  const parts = raw.split(':');
  if (parts.length === 0) {
    return null;
  }
  const kindToken = parts[0];
  const kind = kindToken === 'adult' ? 'adult' : kindToken === 'dep' ? 'dependent' : null;
  if (!kind) {
    return null;
  }
  const person: USPersonDraft = {
    id: `${kind === 'adult' ? 'adult' : 'dependent'}-?`,
    kind,
    age: parseNumber(parts[1] ?? ''),
  };
  for (let i = 2; i < parts.length; i += 1) {
    const token = parts[i];
    const negated = token.startsWith('-');
    const body = negated ? token.slice(1) : token;
    const match = KEYS_LONGEST_FIRST.find(({ key }) => body.startsWith(key));
    if (!match) continue;
    if (match.isFlag) {
      person[match.field] = !negated;
    } else if (!negated) {
      const value = parseNumber(body.slice(match.key.length));
      if (value !== null) {
        person[match.field] = value;
      }
    }
  }
  return person;
}

export function serializeDraft(draft: USHouseholdDraft): string {
  const params = new URLSearchParams();
  if (draft.state) params.set('state', draft.state);
  if (draft.county) params.set('county', draft.county);
  if (draft.zip) params.set('zip', draft.zip);
  if (draft.maritalStatus) params.set('marital', draft.maritalStatus);
  params.set('year', String(draft.year));
  if (draft.people.length > 0) {
    params.set('p', draft.people.map(serializePerson).join(','));
  }
  return params.toString();
}

export function deserializeDraft(query: string | URLSearchParams): USHouseholdDraft {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query;
  const draft = createBlankDraft();

  const state = params.get('state');
  if (state) draft.state = state;

  const county = params.get('county');
  if (county) draft.county = county;

  const zip = params.get('zip');
  if (zip) draft.zip = zip;

  const marital = params.get('marital');
  if (marital === 'married' || marital === 'single') {
    draft.maritalStatus = marital;
  }

  const yearRaw = params.get('year');
  if (yearRaw) {
    const year = Number.parseInt(yearRaw, 10);
    if (Number.isFinite(year)) {
      draft.year = year;
    }
  }

  const peopleRaw = params.get('p');
  if (peopleRaw) {
    let adultCount = 0;
    let dependentCount = 0;
    draft.people = peopleRaw
      .split(',')
      .map(parsePerson)
      .filter((person): person is USPersonDraft => person !== null)
      .map((person) => {
        if (person.kind === 'adult') {
          adultCount += 1;
          return { ...person, id: `adult-${adultCount}` };
        }
        dependentCount += 1;
        return { ...person, id: `dependent-${dependentCount}` };
      });
  }

  return draft;
}
