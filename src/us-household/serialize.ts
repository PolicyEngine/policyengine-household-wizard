import { createBlankDraft } from './draft';
import type { USHouseholdDraft, USPersonDraft } from './types';

/**
 * Compact URL-safe serialization for the household draft. The format is
 * stable: each app gets the same query-string shape, which lets us deep-link
 * across apps that share the wizard.
 *
 * Format example: `state=CA&county=ALAMEDA_COUNTY_CA&marital=married&year=2026
 *                  &p=adult:35:e50000,adult:33:e20000,dep:6`
 *
 * Fields are pipe-separated within each person; people are comma-separated.
 * Income/flag keys are single letters to keep the URL short:
 *   - `e` = employmentIncome
 *   - `s` = ssiAmount
 *   - `d` = ssdiAmount
 *   - `D` = isDisabled
 *   - `B` = isBlind
 *   - `S` = isFullTimeStudent
 *   - `P` = isPregnant
 *   - `C` = needsCare
 */

const FLAG_KEYS: Array<[keyof USPersonDraft, string]> = [
  ['isDisabled', 'D'],
  ['isBlind', 'B'],
  ['isFullTimeStudent', 'S'],
  ['isPregnant', 'P'],
  ['needsCare', 'C'],
];

const INCOME_KEYS: Array<[keyof USPersonDraft, string]> = [
  ['employmentIncome', 'e'],
  ['ssiAmount', 's'],
  ['ssdiAmount', 'd'],
];

function serializePerson(person: USPersonDraft): string {
  const segments: string[] = [
    person.kind === 'adult' ? 'adult' : 'dep',
    person.age === null || person.age === undefined ? '' : String(person.age),
  ];
  for (const [key, letter] of INCOME_KEYS) {
    const value = person[key] as number | undefined;
    if (value !== undefined && value !== null && value !== 0) {
      segments.push(`${letter}${value}`);
    }
  }
  for (const [key, letter] of FLAG_KEYS) {
    if (person[key]) {
      segments.push(letter);
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
  const ageRaw = parts[1] ?? '';
  const age = ageRaw === '' ? null : Number.parseInt(ageRaw, 10);
  const person: USPersonDraft = {
    id: `${kind === 'adult' ? 'adult' : 'dependent'}-?`,
    kind,
    age: Number.isFinite(age) ? (age as number) : null,
  };
  for (let i = 2; i < parts.length; i += 1) {
    const token = parts[i];
    if (token.length === 0) continue;
    const letter = token[0];
    const rest = token.slice(1);
    const incomeMatch = INCOME_KEYS.find(([, l]) => l === letter);
    if (incomeMatch) {
      const value = Number.parseInt(rest, 10);
      if (Number.isFinite(value)) {
        (person as unknown as Record<string, unknown>)[incomeMatch[0]] = value;
      }
      continue;
    }
    const flagMatch = FLAG_KEYS.find(([, l]) => l === letter);
    if (flagMatch) {
      (person as unknown as Record<string, unknown>)[flagMatch[0]] = true;
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
