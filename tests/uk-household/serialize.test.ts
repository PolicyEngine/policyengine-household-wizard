import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createBlankDraft, createTypicalDraft, updateHead, updatePartner } from '@/uk-household/draft';
import { deserializeDraft, serializeDraft } from '@/uk-household/serialize';
import type { UKHouseholdDraft } from '@/uk-household/types';
import { draftArb } from './arbitraries';

const KEYS = ['sy', 'region', 'tenure', 'rent', 'band', 'uc', 'you', 'hp', 'partner', 'c', 'petrol', 'diesel', 'elec', 'cc'];

describe('serializeDraft', () => {
  it('writes the typical draft in a few keys', () => {
    expect(serializeDraft(createTypicalDraft())).toBe(
      'sy=2026&region=NORTH_WEST&tenure=RENT_PRIVATELY&band=D&uc=1&you=30%3Ae34200&partner=30%3Ae34200' +
        '&petrol=620&diesel=340&elec=1040',
    );
    expect(serializeDraft(createBlankDraft())).toBe('sy=2026&you=');
  });

  it('reads the form its documentation gives', () => {
    const draft = deserializeDraft(
      'sy=2026&region=LONDON&tenure=RENT_PRIVATELY&rent=1500&band=D&uc=1' +
        '&you=34:e42000:lPLAN_2&hp=1&partner=33:e28000&c=7,17n' +
        '&petrol=620&diesel=340&elec=1040&cc=400',
    );
    expect(draft).toEqual({
      ...createBlankDraft(),
      region: 'LONDON',
      tenure: 'RENT_PRIVATELY',
      monthlyRent: 1500,
      councilTaxBand: 'D',
      claimsUniversalCredit: true,
      head: { ...createBlankDraft().head, age: 34, employmentIncome: 42000, studentLoanPlan: 'PLAN_2' },
      hasPartner: true,
      partner: { ...createBlankDraft().partner, age: 33, employmentIncome: 28000 },
      children: [{ age: 7 }, { age: 17, inEducation: false }],
      monthlyChildcare: 400,
      spending: { petrol: 620, diesel: 340, electricity: 1040 },
    });
  });

  it('keeps a State Pension of 0, which is an answer, apart from the full rate', () => {
    const zero = updateHead(createTypicalDraft(), { age: 70, statePension: 0 });
    expect(deserializeDraft(serializeDraft(zero)).head.statePension).toBe(0);
    expect(deserializeDraft(serializeDraft(createTypicalDraft())).head.statePension).toBeNull();
  });

  it('keeps a partner’s answers when the partner is switched off', () => {
    const draft = updatePartner(createTypicalDraft(), { age: 44, employmentIncome: 51000 });
    const round = deserializeDraft(serializeDraft(draft));
    expect(round.hasPartner).toBe(false);
    expect(round.partner).toEqual(draft.partner);
  });

  it('round-trips every draft, reading a private pension or electricity left out as 0 or null', () => {
    // A private pension of null or undefined is written as none and read as
    // 0, and electricity left out is read as null: each means the same, and
    // gives the same request (householdImpactRequest.test.ts)
    const canonical = (draft: UKHouseholdDraft): UKHouseholdDraft => ({
      ...draft,
      head: { ...draft.head, privatePensionIncome: draft.head.privatePensionIncome ?? 0 },
      partner: { ...draft.partner, privatePensionIncome: draft.partner.privatePensionIncome ?? 0 },
      spending: { ...draft.spending, electricity: draft.spending.electricity ?? null },
    });
    let leftOut = 0;
    fc.assert(
      fc.property(draftArb(), (draft) => {
        if (draft.head.privatePensionIncome == null || draft.spending.electricity === undefined) leftOut += 1;
        // toEqual: fast-check builds some records without a prototype
        expect(deserializeDraft(serializeDraft(draft))).toEqual(canonical(draft));
      }),
      { numRuns: 1000 },
    );
    expect(leftOut).toBeGreaterThan(0);
  });

  it('is idempotent, and reads a URLSearchParams as its text', () => {
    fc.assert(
      fc.property(draftArb(), (draft) => {
        const text = serializeDraft(draft);
        expect(serializeDraft(deserializeDraft(text))).toBe(text);
        expect(deserializeDraft(new URLSearchParams(text))).toEqual(deserializeDraft(text));
      }),
      { numRuns: 500 },
    );
  });

  it('reads a private pension or electricity left out as 0 or the default', () => {
    const draft = updateHead(createTypicalDraft(), { privatePensionIncome: undefined });
    const round = deserializeDraft(serializeDraft({ ...draft, spending: { petrol: 1, diesel: 2 } }));
    expect(round.head.privatePensionIncome).toBe(0);
    expect(round.spending).toEqual({ petrol: 1, diesel: 2, electricity: null });
  });

  it('leaves out an age, year or amount that is not a finite number, so it reads back blank', () => {
    const typical = createTypicalDraft();
    const draft: UKHouseholdDraft = {
      ...typical,
      salaryYear: Number.NaN,
      tenure: 'RENT_PRIVATELY',
      monthlyRent: Number.NaN,
      head: { ...typical.head, age: Infinity, employmentIncome: -Infinity },
      children: [{ age: Number.NaN }],
      monthlyChildcare: Infinity,
      spending: { petrol: Infinity, diesel: Number.NaN, electricity: Number.NaN },
    };
    const link = serializeDraft(draft);
    expect(link).not.toMatch(/NaN|Infinity/);
    expect(new URLSearchParams(link).has('sy')).toBe(false);
    const round = deserializeDraft(link);
    expect(round.salaryYear).toBe(createBlankDraft().salaryYear);
    expect(round.monthlyRent).toBeNull();
    expect(round.head.age).toBeNull();
    expect(round.children).toEqual([{ age: null }]);
    expect(round.monthlyChildcare).toBe(0);
    expect(round.spending).toEqual({ petrol: 0, diesel: 0, electricity: null });
  });

  it('writes a child missing from the list as an unanswered one', () => {
    const children: UKHouseholdDraft['children'] = [];
    children[1] = { age: 7, inEducation: false };
    const link = serializeDraft({ ...createTypicalDraft(), children });
    expect(new URLSearchParams(link).get('c')).toBe(',7n');
    expect(deserializeDraft(link).children).toEqual([{ age: null }, { age: 7, inEducation: false }]);
  });

  it('does not write extras', () => {
    const draft: UKHouseholdDraft = { ...createTypicalDraft(), extras: { secret: 'x' } };
    expect(serializeDraft(draft)).not.toContain('secret');
    expect(deserializeDraft(serializeDraft(draft))).toEqual(createTypicalDraft());
  });

  it('reads unknown codes as unanswered, and an amount that is not a number as blank', () => {
    const draft = deserializeDraft(
      'region=ATLANTIS&tenure=constructor&band=J&uc=yes&you=abc:eNaN:lPLAN_9:q5&partner=:e1e400&c=x,,5y&rent=&petrol=Infinity',
    );
    expect(draft.region).toBeNull();
    expect(draft.tenure).toBeNull();
    expect(draft.councilTaxBand).toBeNull();
    expect(draft.claimsUniversalCredit).toBeNull();
    expect(draft.head).toEqual({ ...createBlankDraft().head, age: null, studentLoanPlan: 'NONE' });
    expect(draft.partner).toEqual(createBlankDraft().partner);
    expect(draft.children).toEqual([{ age: null }, { age: null }, { age: 5, inEducation: true }]);
    expect(draft.monthlyRent).toBeNull();
    expect(draft.spending.petrol).toBe(0);
  });

  it('never throws on any link, and always gives a draft of the right shape', () => {
    const value = fc.oneof(fc.string(), fc.stringMatching(/^[0-9:a-zA-Z,.\-_+eE]*$/));
    const query = fc
      .array(fc.tuple(fc.oneof(fc.constantFrom(...KEYS), fc.string()), value), { maxLength: 20 })
      .map((pairs) => new URLSearchParams(pairs).toString());
    fc.assert(
      fc.property(fc.oneof(query, fc.string()), (text) => {
        const draft = deserializeDraft(text);
        const blank = createBlankDraft();
        expect(Object.keys(draft).sort()).toEqual(Object.keys(blank).sort());
        expect(Object.keys(draft.head).sort()).toEqual(Object.keys(blank.head).sort());
        expect(Object.keys(draft.partner).sort()).toEqual(Object.keys(blank.partner).sort());
        for (const amount of [
          draft.head.employmentIncome,
          draft.head.dividendIncome,
          draft.partner.employmentIncome,
          draft.spending.petrol,
          draft.monthlyChildcare,
        ]) {
          expect(Number.isFinite(amount)).toBe(true);
        }
        expect(() => serializeDraft(draft)).not.toThrow();
        // What a link reads back to, it writes back to
        expect(deserializeDraft(serializeDraft(draft))).toEqual(draft);
      }),
      { numRuns: 1000 },
    );
  });
});
