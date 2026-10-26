import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { UK_CHILD_AGE_MESSAGE } from '@/uk-household/children';
import { addChild, createBlankDraft, createTypicalDraft, setChildCount, updateHead, updatePartner } from '@/uk-household/draft';
import type { UKHouseholdDraft } from '@/uk-household/types';
import { UK_HOUSEHOLD_LIMITS, UK_POLICY_YEARS, isComplete, validate } from '@/uk-household/validate';
import { draftArb, yearArb } from './arbitraries';
import { POLICY_YEARS } from './reference/householdImpactApi';

const options = { year: 2027 };
const codes = (draft: UKHouseholdDraft, opts: Parameters<typeof validate>[1] = options) =>
  validate(draft, opts).issues.map((issue) => issue.code);

describe('validate', () => {
  it('accepts the typical draft in every policy year', () => {
    for (const year of POLICY_YEARS) {
      expect(validate(createTypicalDraft(), { year })).toEqual({ ok: true, issues: [] });
    }
  });

  it('asks a blank draft for every choice and the age', () => {
    expect(codes(createBlankDraft())).toEqual([
      'region.required',
      'tenure.required',
      'councilTaxBand.required',
      'claimsUniversalCredit.required',
      'head.age.required',
    ]);
  });

  it('checks the year and the salary year', () => {
    const draft = createTypicalDraft();
    expect(codes(draft, { year: 2032 })).toEqual(['year.unsupported']);
    expect(codes(draft, { year: 2025 })).toEqual(['year.unsupported', 'salaryYear.afterYear']);
    expect(codes(draft, { year: 2027.5 })).toEqual(['year.unsupported']);
    expect(codes({ ...draft, salaryYear: 2028 })).toEqual(['salaryYear.afterYear']);
    expect(codes({ ...draft, salaryYear: 2025 })).toEqual(['salaryYear.unsupported']);
    expect(codes({ ...draft, salaryYear: 2027 })).toEqual([]);
    // An app covering other years names them
    expect(codes(draft, { year: 2032, years: [2026, 2032] })).toEqual([]);
    expect(codes(draft, { year: 2027, years: [2026, 2028] })).toEqual(['year.unsupported']);
  });

  it('covers the household impact API’s policy years unless told otherwise', () => {
    expect(UK_POLICY_YEARS).toEqual(POLICY_YEARS);
  });

  it('refuses unknown codes', () => {
    const draft = {
      ...createTypicalDraft(),
      region: 'ATLANTIS',
      tenure: 'SQUATTING',
      councilTaxBand: 'J',
    } as unknown as UKHouseholdDraft;
    expect(codes(updateHead(draft, { studentLoanPlan: 'PLAN_3' as never }))).toEqual([
      'region.invalid',
      'tenure.invalid',
      'councilTaxBand.invalid',
      'head.studentLoanPlan.invalid',
    ]);
  });

  it('takes adults from 16 to 100, in whole years', () => {
    const draft = createTypicalDraft();
    expect(codes(updateHead(draft, { age: 16 }))).toEqual([]);
    expect(codes(updateHead(draft, { age: 100 }))).toEqual([]);
    expect(codes(updateHead(draft, { age: 15 }))).toEqual(['head.age.outOfRange']);
    expect(codes(updateHead(draft, { age: 101 }))).toEqual(['head.age.outOfRange']);
    expect(codes(updateHead(draft, { age: 30.5 }))).toEqual(['head.age.notWhole']);
    expect(codes(updateHead(draft, { age: null }))).toEqual(['head.age.required']);
  });

  it('checks a partner’s answers only with a partner', () => {
    const draft = updatePartner(createTypicalDraft(), { age: 12, employmentIncome: -1, privatePensionIncome: Number.NaN });
    expect(codes(draft)).toEqual([]);
    expect(codes({ ...draft, hasPartner: true })).toEqual([
      'partner.age.outOfRange',
      'partner.employmentIncome.negative',
      'partner.privatePensionIncome.notANumber',
    ]);
  });

  it('bounds every amount at the API’s limits', () => {
    const draft = createTypicalDraft();
    const max = UK_HOUSEHOLD_LIMITS.maxAmount;
    expect(codes(updateHead(draft, { employmentIncome: max }))).toEqual([]);
    expect(codes(updateHead(draft, { employmentIncome: max + 1 }))).toEqual(['head.employmentIncome.tooLarge']);
    expect(codes(updateHead(draft, { dividendIncome: -0.01 }))).toEqual(['head.dividendIncome.negative']);
    expect(codes(updateHead(draft, { savingsInterestIncome: Number.POSITIVE_INFINITY }))).toEqual([
      'head.savingsInterestIncome.notANumber',
    ]);
    expect(codes(updateHead(draft, { propertyIncome: null as never }))).toEqual(['head.propertyIncome.required']);
    expect(codes({ ...draft, spending: { petrol: 100_001, diesel: 0, electricity: 100_001 } })).toEqual([
      'spending.petrol.tooLarge',
      'spending.electricity.tooLarge',
    ]);
  });

  it('leaves a private pension and electricity optional', () => {
    const draft = updateHead(createTypicalDraft(), { privatePensionIncome: undefined });
    expect(codes({ ...draft, spending: { petrol: 0, diesel: 0 } })).toEqual([]);
    expect(codes(updateHead(draft, { privatePensionIncome: null }))).toEqual([]);
  });

  it('checks rent only when renting, and childcare only with children', () => {
    const renter = createTypicalDraft();
    expect(codes({ ...renter, monthlyRent: -5 })).toEqual(['monthlyRent.negative']);
    expect(codes({ ...renter, monthlyRent: 100_001 })).toEqual(['monthlyRent.tooLarge']);
    expect(codes({ ...renter, monthlyRent: null })).toEqual([]);
    expect(codes({ ...renter, tenure: 'OWNED_OUTRIGHT', monthlyRent: -5 })).toEqual([]);
    expect(codes({ ...renter, monthlyChildcare: 10_001 })).toEqual([]);
    expect(codes({ ...addChild(renter, { age: 3 }), monthlyChildcare: 10_001 })).toEqual(['monthlyChildcare.tooLarge']);
  });

  it('takes up to ten children from 0 to 19, in whole years', () => {
    const draft = createTypicalDraft();
    expect(codes(setChildCount(draft, 10))).toEqual([]);
    expect(codes(setChildCount(draft, 11))).toEqual(['children.tooMany']);
    const children = [{ age: 0 }, { age: 19 }, { age: 20 }, { age: -1 }, { age: 2.5 }, { age: null }];
    const result = validate({ ...draft, children }, options);
    expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['children[2].age.tooOld', 'children[2].age'],
      ['children[3].age.negative', 'children[3].age'],
      ['children[4].age.notWhole', 'children[4].age'],
      ['children[5].age.required', 'children[5].age'],
    ]);
    expect(result.issues[0].message).toBe(UK_CHILD_AGE_MESSAGE);
  });

  it('checks a State Pension only as entered and at State Pension age in the year', () => {
    const draft = updateHead(createTypicalDraft(), { statePension: -1 });
    expect(codes(draft)).toEqual([]);
    expect(codes(updateHead(draft, { age: 66 }), { year: 2027 })).toEqual([]);
    expect(codes(updateHead(draft, { age: 66 }), { year: 2026 })).toEqual(['head.statePension.negative']);
    expect(codes(updateHead(draft, { age: 67, statePension: 100_001 }))).toEqual(['head.statePension.tooLarge']);
    expect(codes(updateHead(draft, { age: 67, statePension: null }))).toEqual([]);
    const table = { years: { '2027': { state_pension_age: 30, full_new_state_pension: 1 } } };
    expect(codes(draft, { year: 2027, statePension: table })).toEqual(['head.statePension.negative']);
    const couple = updatePartner({ ...createTypicalDraft(), hasPartner: true }, { age: 70, statePension: 100_001 });
    expect(codes(couple)).toEqual(['partner.statePension.tooLarge']);
    expect(codes({ ...couple, hasPartner: false })).toEqual([]);
  });

  it('gives each issue a code under its path and a message, and ok only without issues', () => {
    fc.assert(
      fc.property(draftArb(), yearArb, (draft, year) => {
        const result = validate(draft, { year });
        expect(result.ok).toBe(result.issues.length === 0);
        expect(isComplete(draft, { year })).toBe(result.ok);
        for (const issue of result.issues) {
          expect(issue.code.startsWith(`${issue.path}.`)).toBe(true);
          expect(issue.message.length).toBeGreaterThan(0);
        }
        expect(new Set(result.issues.map((issue) => issue.code)).size).toBe(result.issues.length);
      }),
      { numRuns: 1000 },
    );
  });

  it('never reads answers the calculation ignores', () => {
    fc.assert(
      fc.property(draftArb(), draftArb(), yearArb, (draft, other, year) => {
        const opts = { year };
        const single = { ...draft, hasPartner: false };
        expect(validate({ ...single, partner: other.partner }, opts)).toEqual(validate(single, opts));
        const owner = { ...draft, tenure: 'OWNED_OUTRIGHT' as const };
        expect(validate({ ...owner, monthlyRent: other.monthlyRent }, opts)).toEqual(validate(owner, opts));
        const childless = { ...draft, children: [] };
        expect(validate({ ...childless, monthlyChildcare: other.monthlyChildcare }, opts)).toEqual(
          validate(childless, opts),
        );
      }),
      { numRuns: 500 },
    );
  });
});
