import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FLAG_KEYS,
  INCOME_KEYS,
  deserializeDraft,
  serializeDraft,
} from '@/us-household/serialize';
import { US_STATES } from '@/us-household/states';
import type {
  USHouseholdDraft,
  USPersonDraft,
  USPersonFlags,
  USPersonIncomes,
} from '@/us-household/types';
import {
  deserializeDraft as deserializeDraft010,
  serializeDraft as serializeDraft010,
} from './legacy/serialize-0.1.0';

/**
 * Invariants of the URL codec over arbitrary drafts. `legacy/serialize-0.1.0`
 * is the codec as published in 0.1.0.
 *
 * 1. Round trip: decoding an encoded draft returns every person field (kind,
 *    age, flags, amounts) and every household field. Ids are reassigned in
 *    order, `label` and `extras` are dropped, -0 reads as 0, and values outside
 *    the declared types read as unset. Household fields keep their 0.1 rules:
 *    empty `state`, `county` and `zip` read as unset, and the generator uses
 *    whole years and valid marital statuses, the only ones the format carries.
 * 2. Canonical form: re-encoding a decoded link gives the same string.
 * 3. Purity: encoding is deterministic and leaves the draft unchanged.
 * 4. 0.1 links: a link written by 0.1.0 decodes to what it carries, and any
 *    string of 0.1 tokens with whole numbers decodes exactly as in 0.1.0. A
 *    0.1.0 string amount that spells a newer key is the one disclosed
 *    exception, pinned in serialize.test.ts.
 * 5. Newer links in 0.1.0: the 0.1.0 decoder reads a current link as it read
 *    the 0.1.0 link for the same draft, plus explicit zero amounts.
 * 6. Same bytes: for drafts 0.1 could express, the current encoder writes the
 *    0.1.0 string.
 */

const RUNS = { numRuns: 500 };

const INCOME_FIELDS = Object.keys(INCOME_KEYS) as Array<keyof USPersonIncomes>;
const FLAG_FIELDS = Object.keys(FLAG_KEYS) as Array<keyof USPersonFlags>;
const INCOME_FIELDS_010: Array<keyof USPersonIncomes> = [
  'employmentIncome',
  'ssiAmount',
  'ssdiAmount',
];
const KEYS_010 = ['e', 's', 'd', 'D', 'B', 'S', 'P', 'C'];
const KEYS_SINCE_010 = Object.values(INCOME_KEYS).filter((key) => !KEYS_010.includes(key));

// Whole dollars, cents, zero, -0, losses, and extreme magnitudes that String()
// writes in exponent notation.
const finiteNumberArb = fc.oneof(
  fc.integer({ min: -1_000_000, max: 10_000_000 }),
  fc.integer({ min: -100_000_000, max: 1_000_000_000 }).map((cents) => cents / 100),
  fc.constantFrom(0, -0),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
);

interface DraftArbOptions {
  /** Add values outside the declared types, which must read as unset. */
  wrongTypes?: boolean;
  /** Only what 0.1 could write: nonzero `e`, `s`, `d` and `true` flags. */
  only010?: boolean;
}

function draftArb({ wrongTypes = false, only010 = false }: DraftArbOptions = {}) {
  const unset = wrongTypes ? fc.constantFrom(undefined, null) : fc.constant(undefined);
  const amountArb = only010
    ? fc.oneof(fc.constant(undefined), finiteNumberArb.filter((value) => value !== 0))
    : fc.oneof(
        { weight: 3, arbitrary: unset },
        { weight: 6, arbitrary: finiteNumberArb },
        {
          weight: 1,
          arbitrary: wrongTypes
            ? fc.constantFrom<unknown>(Number.NaN, Infinity, -Infinity, '500', true)
            : fc.constantFrom(Number.NaN, Infinity, -Infinity),
        },
      );
  const flagArb = only010
    ? fc.constantFrom(undefined, true)
    : fc.oneof(unset, fc.boolean(), wrongTypes ? fc.constantFrom<unknown>(1, 'yes') : unset);
  const ageArb = only010
    ? fc.oneof(fc.constant(null), finiteNumberArb)
    : fc.oneof(
        fc.constant(null),
        fc.integer({ min: 0, max: 120 }),
        finiteNumberArb,
        fc.constantFrom(Number.NaN, Infinity),
      );
  const incomeFields = only010 ? INCOME_FIELDS_010 : INCOME_FIELDS;

  const personArb = fc
    .record({
      id: fc.string(),
      kind: fc.constantFrom<USPersonDraft['kind']>('adult', 'dependent'),
      age: ageArb,
      label: fc.option(fc.string(), { nil: undefined }),
      extras: fc.option(fc.dictionary(fc.string(), fc.jsonValue()), { nil: undefined }),
      amounts: fc.tuple(...incomeFields.map(() => amountArb)),
      flags: fc.tuple(...FLAG_FIELDS.map(() => flagArb)),
    })
    .map(({ amounts, flags, ...rest }) => {
      const person: Record<string, unknown> = { ...rest };
      incomeFields.forEach((field, index) => {
        person[field] = amounts[index];
      });
      FLAG_FIELDS.forEach((field, index) => {
        person[field] = flags[index];
      });
      return person as unknown as USPersonDraft;
    });

  // Real codes plus arbitrary Unicode text, which URLSearchParams must escape.
  const textArb = fc.option(
    fc.oneof(
      fc.constantFrom(...US_STATES.map((state) => state.code)),
      fc.string({ unit: 'grapheme' }),
    ),
    { nil: null },
  );

  return fc.record({
    state: textArb,
    county: textArb,
    zip: textArb,
    maritalStatus: fc.constantFrom<USHouseholdDraft['maritalStatus']>(null, 'single', 'married'),
    year: fc.maxSafeInteger(),
    people: fc.array(personArb, { maxLength: 6 }),
    extras: fc.option(fc.dictionary(fc.string(), fc.jsonValue()), { nil: undefined }),
  }).map((draft) => ({ ...draft }) as USHouseholdDraft);
}

function finiteOrUndefined(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value === 0 ? 0 : value;
}

/** The draft a link decodes to, given how each person field is read back. */
function decodedShape(
  draft: USHouseholdDraft,
  readPerson: (person: USPersonDraft) => Partial<USPersonDraft>,
): USHouseholdDraft {
  const counts = { adult: 0, dependent: 0 };
  return {
    state: draft.state || null,
    county: draft.county || null,
    zip: draft.zip || null,
    maritalStatus: draft.maritalStatus,
    year: draft.year,
    people: draft.people.map((person) => {
      counts[person.kind] += 1;
      return {
        id: `${person.kind}-${counts[person.kind]}`,
        kind: person.kind,
        age: null,
        ...readPerson(person),
      };
    }),
  };
}

function withoutUndefined(fields: Record<string, unknown>): Partial<USPersonDraft> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<USPersonDraft>;
}

/** Invariant 1: what the current encoder carries for each person. */
function expectedRoundTrip(draft: USHouseholdDraft): USHouseholdDraft {
  return decodedShape(draft, (person) =>
    withoutUndefined({
      age: finiteOrUndefined(person.age) ?? null,
      ...Object.fromEntries(INCOME_FIELDS.map((field) => [field, finiteOrUndefined(person[field])])),
      ...Object.fromEntries(
        FLAG_FIELDS.map((field) => [
          field,
          typeof person[field] === 'boolean' ? person[field] : undefined,
        ]),
      ),
    }),
  );
}

/**
 * Invariant 4: what a 0.1.0 link carries. 0.1.0 wrote `String(value)` for
 * `e`, `s` and `d` unless the value was unset or zero, and a flag key when the
 * flag was truthy.
 */
function expectedFrom010Link(draft: USHouseholdDraft): USHouseholdDraft {
  const read = (value: unknown) => finiteOrUndefined(Number.parseFloat(String(value)));
  return decodedShape(draft, (person) =>
    withoutUndefined({
      age: person.age === null || person.age === undefined ? null : (read(person.age) ?? null),
      ...Object.fromEntries(
        INCOME_FIELDS_010.map((field) => {
          const value = person[field] as unknown;
          const written = value !== undefined && value !== null && value !== 0;
          return [field, written ? read(value) : undefined];
        }),
      ),
      ...Object.fromEntries(FLAG_FIELDS.map((field) => [field, person[field] ? true : undefined])),
    }),
  );
}

describe('serializeDraft / deserializeDraft invariants', () => {
  it('1. round-trips every person and household field', () => {
    fc.assert(
      fc.property(draftArb({ wrongTypes: true }), (draft) => {
        expect(deserializeDraft(serializeDraft(draft))).toStrictEqual(expectedRoundTrip(draft));
      }),
      RUNS,
    );
  });

  it('2. re-encodes a decoded link to the same string', () => {
    fc.assert(
      fc.property(draftArb({ wrongTypes: true }), (draft) => {
        const query = serializeDraft(draft);
        expect(serializeDraft(deserializeDraft(query))).toBe(query);
      }),
      RUNS,
    );
  });

  it('3. encodes deterministically without changing the draft', () => {
    fc.assert(
      fc.property(draftArb({ wrongTypes: true }), (draft) => {
        const before = structuredClone(draft);
        const first = serializeDraft(draft);
        expect(serializeDraft(draft)).toBe(first);
        // `extras` from fc.dictionary has a null prototype and structuredClone
        // does not keep it, so compare values rather than prototypes.
        expect(draft).toEqual(before);
      }),
      RUNS,
    );
  });

  it('4a. decodes a link written by 0.1.0 to what the link carries', () => {
    fc.assert(
      fc.property(draftArb({ wrongTypes: true }), (draft) => {
        expect(deserializeDraft(serializeDraft010(draft))).toStrictEqual(
          expectedFrom010Link(draft),
        );
      }),
      RUNS,
    );
  });

  it('4b. decodes any string of 0.1 tokens with whole numbers exactly as 0.1.0 did', () => {
    // Hand-edited links included: junk letters, unknown keys, empty fields,
    // repeated keys, numbers after flag letters, `-` before amount keys, and
    // tokens in the age slot.
    const tokenArb = fc
      .tuple(
        fc.constantFrom(...KEYS_010, '-e', '-s', '-d', 'x', 'E', 'Z', ''),
        fc.oneof(fc.constant(''), fc.integer().map(String)),
        fc.stringMatching(/^[A-Za-z]{0,3}$/),
      )
      .map((parts) => parts.join(''))
      .filter((token) => !KEYS_SINCE_010.some((key) => token.startsWith(key)));
    const personArb = fc
      .tuple(
        fc.constantFrom('adult', 'dep', 'child', ''),
        fc.oneof(
          fc.constant(''),
          fc.integer().map(String),
          fc.stringMatching(/^\d{1,3}[a-z]{0,2}$/),
          tokenArb,
        ),
        fc.array(tokenArb, { maxLength: 6 }),
      )
      .map(([kind, age, tokens]) => [kind, age, ...tokens].join(':'));
    const queryArb = fc
      .tuple(
        fc.constantFrom('', 'state=CA&', 'state=TX&marital=married&year=2027&'),
        fc.array(personArb, { maxLength: 5 }),
      )
      .map(([prefix, people]) => `${prefix}p=${people.join(',')}`);

    fc.assert(
      fc.property(queryArb, (query) => {
        expect(deserializeDraft(query)).toStrictEqual(deserializeDraft010(query));
      }),
      RUNS,
    );
  });

  it('5. lets the 0.1.0 decoder read a current link as it read the 0.1.0 link', () => {
    fc.assert(
      fc.property(draftArb(), (draft) => {
        const expected = deserializeDraft010(serializeDraft010(draft));
        draft.people.forEach((person, index) => {
          for (const field of INCOME_FIELDS_010) {
            if (person[field] === 0) {
              expected.people[index][field] = 0;
            }
          }
        });
        expect(deserializeDraft010(serializeDraft(draft))).toStrictEqual(expected);
      }),
      RUNS,
    );
  });

  it('6. writes the 0.1.0 string for drafts 0.1 could express', () => {
    fc.assert(
      fc.property(draftArb({ only010: true }), (draft) => {
        expect(serializeDraft(draft)).toBe(serializeDraft010(draft));
      }),
      RUNS,
    );
  });
});

describe('URL keys', () => {
  it('keep their meaning', () => {
    expect(INCOME_KEYS).toMatchObject({
      employmentIncome: 'e',
      ssiAmount: 's',
      ssdiAmount: 'd',
      selfEmploymentIncome: 'se',
      socialSecurityIncome: 'ss',
      pensionIncome: 'pen',
      dividendIncome: 'div',
      taxableInterestIncome: 'int',
      rentalIncome: 'rent',
      unemploymentCompensation: 'uc',
      childSupportReceived: 'cs',
      miscellaneousIncome: 'misc',
    });
    expect(FLAG_KEYS).toStrictEqual({
      isDisabled: 'D',
      isBlind: 'B',
      isFullTimeStudent: 'S',
      isPregnant: 'P',
      needsCare: 'C',
    });
  });

  it('are unique, lowercase letters for amounts and one capital letter per flag', () => {
    const keys = [...Object.values(INCOME_KEYS), ...Object.values(FLAG_KEYS)];
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of Object.values(INCOME_KEYS)) {
      expect(key).toMatch(/^[a-z]+$/);
    }
    for (const key of Object.values(FLAG_KEYS)) {
      expect(key).toMatch(/^[A-Z]$/);
    }
  });

  it.each(KEYS_SINCE_010)('`%s` tokens are ignored by the 0.1.0 decoder', (key) => {
    for (const value of ['0', '12', '-12.5', '1e+21']) {
      const [person] = deserializeDraft010(`p=adult:30:${key}${value}`).people;
      expect(person).toStrictEqual({ id: 'adult-1', kind: 'adult', age: 30 });
    }
  });

  it.each(Object.values(FLAG_KEYS))('`-%s` is ignored by the 0.1.0 decoder', (key) => {
    const [person] = deserializeDraft010(`p=adult:30:-${key}`).people;
    expect(person).toStrictEqual({ id: 'adult-1', kind: 'adult', age: 30 });
  });
});
