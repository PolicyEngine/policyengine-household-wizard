import fc from 'fast-check';
import {
  UK_COUNCIL_TAX_BANDS,
  UK_REGIONS,
  UK_STUDENT_LOAN_PLANS,
  UK_TENURES,
} from '@/uk-household/codes';
import type {
  UKAdultDraft,
  UKChildDraft,
  UKHeadDraft,
  UKHouseholdDraft,
} from '@/uk-household/types';

/**
 * Drafts of every shape the type allows, with finite amounts: whole pounds
 * and pennies, from 0 to a little past the API's bounds, and ages beyond the
 * bounds `validate()` applies, so the properties see refused drafts too.
 * -0 is read as 0 (a URL cannot tell them apart).
 */
const positiveZero = (value: number) => (value === 0 ? 0 : value);

export const amount = (max: number) =>
  fc.oneof(
    fc.constant(0),
    fc.integer({ min: 0, max }),
    fc.double({ min: 0, max, noNaN: true, noDefaultInfinity: true }).map(positiveZero),
    fc.integer({ min: 0, max: max * 100 }).map((pennies) => pennies / 100),
  );

/** An optional amount: a number, `null` or `undefined`, which mean the same. */
const optionalAmount = (max: number) =>
  fc.oneof(
    { arbitrary: amount(max), weight: 8 },
    { arbitrary: fc.constant(null), weight: 1 },
    { arbitrary: fc.constant(undefined), weight: 1 },
  );

export const age = (min: number, max: number) => fc.option(fc.integer({ min, max }), { nil: null });

export const regionArb = fc.option(fc.constantFrom(...UK_REGIONS.map((region) => region.code)), { nil: null });
export const tenureArb = fc.option(fc.constantFrom(...UK_TENURES), { nil: null });
export const bandArb = fc.option(fc.constantFrom(...UK_COUNCIL_TAX_BANDS), { nil: null });
export const planArb = fc.constantFrom(...UK_STUDENT_LOAN_PLANS);

export const adultArb = (ages = age(0, 110)): fc.Arbitrary<UKAdultDraft> =>
  fc.record({
    age: ages,
    employmentIncome: amount(600_000),
    privatePensionIncome: optionalAmount(250_000),
    statePension: fc.option(amount(30_000), { nil: null }),
  });

export const headArb = (ages = age(0, 110)): fc.Arbitrary<UKHeadDraft> =>
  fc
    .tuple(
      adultArb(ages),
      fc.record({
        studentLoanPlan: planArb,
        salarySacrificePensionContributions: amount(70_000),
        dividendIncome: amount(120_000),
        savingsInterestIncome: amount(120_000),
        propertyIncome: amount(120_000),
      }),
    )
    .map(([adult, rest]) => ({ ...adult, ...rest }));

export const childArb = (ages: fc.Arbitrary<number | null> = age(0, 22)): fc.Arbitrary<UKChildDraft> =>
  fc.record({ age: ages, inEducation: fc.boolean() }, { requiredKeys: ['age'] });

export interface DraftArbOptions {
  /** Ages for both adults. */
  adultAges?: fc.Arbitrary<number | null>;
  childAges?: fc.Arbitrary<number | null>;
  salaryYears?: fc.Arbitrary<number>;
  maxChildren?: number;
}

export const draftArb = ({
  adultAges = age(0, 110),
  childAges = age(0, 22),
  salaryYears = fc.integer({ min: 2025, max: 2032 }),
  maxChildren = 12,
}: DraftArbOptions = {}): fc.Arbitrary<UKHouseholdDraft> =>
  fc.record({
    salaryYear: salaryYears,
    region: regionArb,
    head: headArb(adultAges),
    hasPartner: fc.boolean(),
    partner: adultArb(adultAges),
    children: fc.array(childArb(childAges), { maxLength: maxChildren }),
    tenure: tenureArb,
    monthlyRent: fc.option(amount(120_000), { nil: null }),
    councilTaxBand: bandArb,
    claimsUniversalCredit: fc.option(fc.boolean(), { nil: null }),
    monthlyChildcare: amount(12_000),
    spending: fc.record({
      petrol: amount(120_000),
      diesel: amount(120_000),
      electricity: optionalAmount(120_000),
    }),
  });

/** Policy years around the dashboard's 2026 to 2031, and 0. */
export const yearArb = fc.constantFrom(0, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032);
export const policiesArb = fc.array(fc.constantFrom('road_fuel_vat_cut', 'two_child_limit', 'a', 'b'), {
  maxLength: 4,
});
export const includeArb = fc.constantFrom<Array<'by_policy' | 'sweep'>>([], ['sweep'], ['by_policy'], [
  'by_policy',
  'sweep',
]);
