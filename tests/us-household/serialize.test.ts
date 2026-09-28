import { describe, expect, it } from 'vitest';
import { addPerson, createBlankDraft } from '@/us-household/draft';
import { INCOME_KEYS, deserializeDraft, serializeDraft } from '@/us-household/serialize';
import type { USHouseholdDraft } from '@/us-household/types';
import {
  deserializeDraft as deserializeDraft010,
  serializeDraft as serializeDraft010,
} from './legacy/serialize-0.1.0';

describe('serialize / deserialize round-trip', () => {
  it('preserves state, county, marital status, year, and people', () => {
    let draft = createBlankDraft(2026);
    draft.state = 'CA';
    draft.county = 'ALAMEDA_COUNTY_CA';
    draft.zip = '94703';
    draft.maritalStatus = 'married';
    draft = addPerson(draft, 'adult', { age: 35, employmentIncome: 50000 });
    draft = addPerson(draft, 'adult', { age: 33 });
    draft = addPerson(draft, 'dependent', { age: 6, isFullTimeStudent: true });

    const round = deserializeDraft(serializeDraft(draft));

    expect(round.state).toBe('CA');
    expect(round.county).toBe('ALAMEDA_COUNTY_CA');
    expect(round.zip).toBe('94703');
    expect(round.maritalStatus).toBe('married');
    expect(round.year).toBe(2026);
    expect(round.people).toHaveLength(3);
    expect(round.people[0]).toMatchObject({
      id: 'adult-1',
      kind: 'adult',
      age: 35,
      employmentIncome: 50000,
    });
    expect(round.people[2]).toMatchObject({
      id: 'dependent-1',
      kind: 'dependent',
      age: 6,
      isFullTimeStudent: true,
    });
  });

  it('writes explicit zero amounts and false flags, and omits unset fields', () => {
    let draft = createBlankDraft(2026);
    draft.state = 'CA';
    draft.maritalStatus = 'single';
    draft = addPerson(draft, 'adult', { age: 30, employmentIncome: 0, isDisabled: false });
    draft = addPerson(draft, 'dependent', { age: 4 });
    const query = serializeDraft(draft);
    expect(new URLSearchParams(query).get('p')).toBe('adult:30:e0:-D,dep:4');
    expect(deserializeDraft(query).people[0]).toStrictEqual({
      id: 'adult-1',
      kind: 'adult',
      age: 30,
      employmentIncome: 0,
      isDisabled: false,
    });
  });

  it('handles missing query gracefully', () => {
    const draft = deserializeDraft('');
    expect(draft.state).toBeNull();
    expect(draft.people).toEqual([]);
  });

  it('ignores unknown person tokens', () => {
    const draft = deserializeDraft('state=CA&p=adult:30:Z9999');
    expect(draft.people).toHaveLength(1);
    expect(draft.people[0]).toMatchObject({ kind: 'adult', age: 30 });
  });

  const amountKeys = Object.entries(INCOME_KEYS).map(([field, key]) => ({ field, key }));

  it.each(amountKeys)('ignores `-$key` amount tokens', ({ field, key }) => {
    expect(deserializeDraft(`p=adult:30:-${key}7`).people[0]).toStrictEqual({
      id: 'adult-1',
      kind: 'adult',
      age: 30,
    });
    expect(deserializeDraft(`p=adult:30:${key}50:-${key}7`).people[0]).toStrictEqual({
      id: 'adult-1',
      kind: 'adult',
      age: 30,
      [field]: 50,
    });
  });

  it('lets the last token win when a key repeats', () => {
    expect(deserializeDraft('p=adult:30:D:-D').people[0].isDisabled).toBe(false);
    expect(deserializeDraft('p=adult:30:-D:D').people[0].isDisabled).toBe(true);
    expect(deserializeDraft('p=adult:30:se5:se-7').people[0].selfEmploymentIncome).toBe(-7);
  });

  it('reads household fields as 0.1 did: whole years, known marital statuses', () => {
    const draft = deserializeDraft('state=&marital=divorced&year=2026.9');
    expect(draft.state).toBeNull();
    expect(draft.maritalStatus).toBeNull();
    expect(draft.year).toBe(2026);
  });

  it('reads the second field as the age, never as a token', () => {
    expect(deserializeDraft('p=adult:e50000:D').people[0]).toStrictEqual({
      id: 'adult-1',
      kind: 'adult',
      age: null,
      isDisabled: true,
    });
  });
});

describe('URL format', () => {
  // Every field, with zeros, losses, cents and false flags.
  const everyField: USHouseholdDraft = {
    state: 'NY',
    county: null,
    zip: null,
    maritalStatus: 'single',
    year: 2026,
    people: [
      {
        id: 'adult-1',
        kind: 'adult',
        age: 67,
        employmentIncome: 0,
        ssiAmount: 0,
        ssdiAmount: 14400.5,
        selfEmploymentIncome: -3200.75,
        socialSecurityIncome: 24000,
        pensionIncome: 12000,
        publicPensionIncome: 30000,
        privatePensionIncome: -0.5,
        dividendIncome: 850.25,
        taxableInterestIncome: 0.01,
        rentalIncome: -400,
        unemploymentCompensation: 0,
        childSupportReceived: 3600,
        miscellaneousIncome: 125,
        isDisabled: true,
        isBlind: false,
        isFullTimeStudent: false,
        isPregnant: false,
        needsCare: true,
      },
      {
        id: 'dependent-1',
        kind: 'dependent',
        age: 15,
        childSupportReceived: 0,
        isDisabled: false,
        isFullTimeStudent: true,
      },
    ],
  };
  const everyFieldQuery =
    'state=NY&marital=single&year=2026&p=adult%3A67%3Ae0%3As0%3Ad14400.5%3Ase-3200.75' +
    '%3Ass24000%3Apen12000%3Apenpub30000%3Apenpriv-0.5%3Adiv850.25%3Aint0.01' +
    '%3Arent-400%3Auc0%3Acs3600%3Amisc125' +
    '%3AD%3A-B%3A-S%3A-P%3AC%2Cdep%3A15%3Acs0%3A-D%3AS';

  it('writes a pinned string for a draft with every field', () => {
    expect(serializeDraft(everyField)).toBe(everyFieldQuery);
  });

  it('reads the pinned string back to the same draft', () => {
    expect(deserializeDraft(everyFieldQuery)).toStrictEqual(everyField);
  });

  it('reads the example in the serialize.ts header', () => {
    const draft = deserializeDraft(
      'state=CA&county=ALAMEDA_COUNTY_CA&marital=married&year=2026' +
        '&p=adult:35:e50000:se-1200.5,adult:33:e20000:-D,dep:6:S',
    );
    expect(draft.people).toStrictEqual([
      { id: 'adult-1', kind: 'adult', age: 35, employmentIncome: 50000, selfEmploymentIncome: -1200.5 },
      { id: 'adult-2', kind: 'adult', age: 33, employmentIncome: 20000, isDisabled: false },
      { id: 'dependent-1', kind: 'dependent', age: 6, isFullTimeStudent: true },
    ]);
  });
});

describe('links written by 0.1.0', () => {
  // Every field 0.1.0 wrote: e, s, d (including a loss), every flag, an unset age.
  const draft010: USHouseholdDraft = {
    state: 'CA',
    county: 'ALAMEDA_COUNTY_CA',
    zip: '94703',
    maritalStatus: 'married',
    year: 2026,
    people: [
      {
        id: 'adult-1',
        kind: 'adult',
        age: 35,
        employmentIncome: 50000,
        ssiAmount: 9432,
        ssdiAmount: 18000,
        isDisabled: true,
        isBlind: true,
      },
      { id: 'adult-2', kind: 'adult', age: 33, employmentIncome: -1500, isPregnant: true },
      { id: 'dependent-1', kind: 'dependent', age: 6, isFullTimeStudent: true, needsCare: true },
      { id: 'dependent-2', kind: 'dependent', age: null },
    ],
  };
  const link010 =
    'state=CA&county=ALAMEDA_COUNTY_CA&zip=94703&marital=married&year=2026' +
    '&p=adult%3A35%3Ae50000%3As9432%3Ad18000%3AD%3AB%2Cadult%3A33%3Ae-1500%3AP' +
    '%2Cdep%3A6%3AS%3AC%2Cdep%3A';

  it('pins the link 0.1.0 wrote', () => {
    expect(serializeDraft010(draft010)).toBe(link010);
  });

  it('decodes it to the same draft as 0.1.0', () => {
    expect(deserializeDraft(link010)).toStrictEqual(draft010);
    expect(deserializeDraft(link010)).toStrictEqual(deserializeDraft010(link010));
  });

  it('decodes it with unescaped separators', () => {
    expect(deserializeDraft(decodeURIComponent(link010))).toStrictEqual(draft010);
  });

  it('still writes the same link for that draft', () => {
    expect(serializeDraft(draft010)).toBe(link010);
  });

  it('reads a string amount 0.1.0 wrote as is under the key it now spells', () => {
    // Outside the declared types, so disclosed rather than prevented:
    // `s` + 'e5' is `se5`, self-employment income since this version.
    const draft = { ...createBlankDraft(2026), people: [] } as USHouseholdDraft;
    draft.people.push({ id: 'a', kind: 'adult', age: 30, ssiAmount: 'e5' as unknown as number });
    const link = serializeDraft010(draft);
    expect(new URLSearchParams(link).get('p')).toBe('adult:30:se5');
    expect(deserializeDraft010(link).people[0]).toStrictEqual({ id: 'adult-1', kind: 'adult', age: 30 });
    expect(deserializeDraft(link).people[0]).toStrictEqual({
      id: 'adult-1',
      kind: 'adult',
      age: 30,
      selfEmploymentIncome: 5,
    });
  });

  it('keeps the cents and exponents that 0.1.0 dropped', () => {
    // `%2B` is the `+` of `1e+21`; a bare `+` in a query string reads as a space.
    const link = 'p=adult:30:e50000.75:s1e%2B21:d5e-7';
    expect(deserializeDraft010(link).people[0]).toMatchObject({
      employmentIncome: 50000,
      ssiAmount: 1,
      ssdiAmount: 5,
    });
    expect(deserializeDraft(link).people[0]).toMatchObject({
      employmentIncome: 50000.75,
      ssiAmount: 1e21,
      ssdiAmount: 5e-7,
    });
  });
});
