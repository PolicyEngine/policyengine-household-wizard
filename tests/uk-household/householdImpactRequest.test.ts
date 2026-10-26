import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { monthlyRentFor, toHouseholdImpactRequest } from '@/uk-household/adapters/householdImpactRequest';
import { asksEducation } from '@/uk-household/children';
import { isRenting } from '@/uk-household/codes';
import { UK_DEFAULT_SPENDING, regionalRent } from '@/uk-household/defaults';
import { cloneDraft, createBlankDraft, createTypicalDraft, updateHead, updatePartner } from '@/uk-household/draft';
import { deserializeDraft, serializeDraft } from '@/uk-household/serialize';
import { atStatePensionAge, statePensionEntered, type UKStatePensionTable } from '@/uk-household/statePension';
import { UK_HOUSEHOLD_LIMITS, validate } from '@/uk-household/validate';
import { adultArb, draftArb, includeArb, policiesArb, yearArb } from './arbitraries';
import { API, MEASURE_IDS, apiRefusals } from './reference/householdImpactApi';

/**
 * The household impact request's invariants, for every draft. The request
 * is what the Autumn Budget 2026 dashboard sends to its household API, so
 * these are the rules a household's answers follow into the calculation.
 */

/** The keys of `household`, in the order the request always has them. */
const HOUSEHOLD_KEYS = [
  'age',
  'employment_income',
  'has_partner',
  'partner_age',
  'partner_employment_income',
  'children',
  'region',
  'claims_universal_credit',
  'tenure',
  'monthly_rent',
  'dividend_income',
  'savings_interest_income',
  'private_pension_income',
  'partner_private_pension_income',
  'property_income',
  'petrol_spending',
  'diesel_spending',
  'electricity_spending',
  'salary_sacrifice_pension_contributions',
  'student_loan_plan',
  'council_tax_band',
  'monthly_childcare',
  'salary_year',
  'state_pension',
  'partner_state_pension',
];
const OPTIONAL_KEYS = new Set(['partner_age', 'state_pension', 'partner_state_pension']);

const request = fc.record({ draft: draftArb(), year: yearArb, policies: policiesArb, include: includeArb });
const NUM_RUNS = { numRuns: 500 };

describe('toHouseholdImpactRequest', () => {
  it('sends the typical draft as the dashboard always has', () => {
    const body = toHouseholdImpactRequest(createTypicalDraft(), { year: 2027, policies: ['road_fuel_vat_cut'] });
    expect(body).toEqual({
      year: 2027,
      policies: ['road_fuel_vat_cut'],
      household: {
        age: 30,
        employment_income: 34200,
        has_partner: false,
        partner_age: 30,
        partner_employment_income: 0,
        children: [],
        region: 'NORTH_WEST',
        claims_universal_credit: true,
        tenure: 'RENT_PRIVATELY',
        monthly_rent: 975,
        dividend_income: 0,
        savings_interest_income: 0,
        private_pension_income: 0,
        partner_private_pension_income: 0,
        property_income: 0,
        petrol_spending: 620,
        diesel_spending: 340,
        electricity_spending: 1040,
        salary_sacrifice_pension_contributions: 0,
        student_loan_plan: 'NONE',
        council_tax_band: 'D',
        monthly_childcare: 0,
        salary_year: 2026,
      },
      include: [],
    });
  });

  it('has its keys in one fixed order, with only the optional ones left out', () => {
    fc.assert(
      fc.property(request, ({ draft, year, policies, include }) => {
        const body = toHouseholdImpactRequest(draft, { year, policies, include });
        expect(Object.keys(body)).toEqual(['year', 'policies', 'household', 'include']);
        const keys = Object.keys(body.household);
        expect(keys).toEqual(HOUSEHOLD_KEYS.filter((key) => keys.includes(key)));
        for (const key of HOUSEHOLD_KEYS) {
          if (!OPTIONAL_KEYS.has(key)) expect(keys).toContain(key);
        }
      }),
      NUM_RUNS,
    );
  });

  it('copies the policies and stages, never shares them, and leaves the draft as it was', () => {
    fc.assert(
      fc.property(request, ({ draft, year, policies, include }) => {
        const before = JSON.stringify(draft);
        const body = toHouseholdImpactRequest(draft, { year, policies, include });
        expect(body.policies).toEqual(policies);
        expect(body.policies).not.toBe(policies);
        expect(body.include).toEqual(include);
        expect(body.include).not.toBe(include);
        expect(JSON.stringify(draft)).toBe(before);
        // Deterministic: a copy of the draft gives the same text
        expect(JSON.stringify(toHouseholdImpactRequest(cloneDraft(draft), { year, policies, include }))).toBe(
          JSON.stringify(body),
        );
      }),
      NUM_RUNS,
    );
  });

  it("reads none of a partner's answers without a partner, except an age the API takes", () => {
    fc.assert(
      fc.property(request, adultArb(), ({ draft, year, policies, include }, other) => {
        const single = { ...draft, hasPartner: false };
        const a = toHouseholdImpactRequest(single, { year, policies, include }).household;
        const b = toHouseholdImpactRequest({ ...single, partner: other }, { year, policies, include }).household;
        expect(a.partner_employment_income).toBe(0);
        expect(a.partner_private_pension_income).toBe(0);
        expect(a).not.toHaveProperty('partner_state_pension');
        const { partner_age: ageA, ...restA } = a;
        const { partner_age: ageB, ...restB } = b;
        expect(restA).toEqual(restB);
        // The age goes only when it is one the API takes
        for (const [age, sent] of [
          [single.partner.age, ageA],
          [other.age, ageB],
        ]) {
          const accepted = Number.isInteger(age) && (age as number) >= 16 && (age as number) <= 100;
          expect(sent).toBe(accepted ? age : undefined);
        }
      }),
      NUM_RUNS,
    );
  });

  it("sends a partner's answers with a partner", () => {
    fc.assert(
      fc.property(request, ({ draft, year, policies, include }) => {
        const couple = { ...draft, hasPartner: true };
        const household = toHouseholdImpactRequest(couple, { year, policies, include }).household;
        expect(household.has_partner).toBe(true);
        expect(household.partner_age).toBe(couple.partner.age);
        expect(household.partner_employment_income).toBe(couple.partner.employmentIncome);
        expect(household.partner_private_pension_income).toBe(couple.partner.privatePensionIncome ?? 0);
      }),
      NUM_RUNS,
    );
  });

  it('sends rent only when renting, as entered or the regional average', () => {
    fc.assert(
      fc.property(request, ({ draft, year, policies }) => {
        const { monthly_rent } = toHouseholdImpactRequest(draft, { year, policies }).household;
        if (!isRenting(draft.tenure)) expect(monthly_rent).toBe(0);
        else if (draft.monthlyRent === null) expect(monthly_rent).toBe(regionalRent(draft.region));
        else expect(monthly_rent).toBe(draft.monthlyRent);
        expect(monthly_rent).toBe(isRenting(draft.tenure) ? monthlyRentFor(draft) : 0);
      }),
      NUM_RUNS,
    );
  });

  it('sends childcare only with children', () => {
    fc.assert(
      fc.property(request, ({ draft, year, policies }) => {
        const { monthly_childcare, children } = toHouseholdImpactRequest(draft, { year, policies }).household;
        expect(children).toHaveLength(draft.children.length);
        expect(monthly_childcare).toBe(draft.children.length ? draft.monthlyChildcare : 0);
      }),
      NUM_RUNS,
    );
  });

  it('asks about education from 16 to 19 only, yes unless answered no', () => {
    fc.assert(
      fc.property(request, ({ draft, year, policies }) => {
        const { children } = toHouseholdImpactRequest(draft, { year, policies }).household;
        children.forEach((child, index) => {
          const entered = draft.children[index];
          expect(child.age).toBe(entered.age);
          if (asksEducation(entered.age)) expect(child.in_education).toBe(entered.inEducation !== false);
          else expect(child).not.toHaveProperty('in_education');
        });
      }),
      NUM_RUNS,
    );
  });

  it('sends a State Pension only as entered and only at State Pension age in the year', () => {
    fc.assert(
      fc.property(request, ({ draft, year, policies }) => {
        const household = toHouseholdImpactRequest(draft, { year, policies }).household;
        const head = statePensionEntered(draft.head.statePension) && atStatePensionAge(draft.head.age, year);
        expect('state_pension' in household).toBe(head);
        if (head) expect(household.state_pension).toBe(draft.head.statePension);
        const partner =
          draft.hasPartner &&
          statePensionEntered(draft.partner.statePension) &&
          atStatePensionAge(draft.partner.age, year);
        expect('partner_state_pension' in household).toBe(partner);
      }),
      NUM_RUNS,
    );
  });

  it('takes State Pension ages from the table it is given', () => {
    const table: UKStatePensionTable = { years: { '2027': { state_pension_age: 60, full_new_state_pension: 1 } } };
    const draft = updateHead(createTypicalDraft(), { age: 62, statePension: 9000 });
    const options = { year: 2027, policies: ['a'] };
    expect(toHouseholdImpactRequest(draft, options).household).not.toHaveProperty('state_pension');
    expect(toHouseholdImpactRequest(draft, { ...options, statePension: table }).household.state_pension).toBe(9000);
  });

  it('defaults a private pension to 0 and electricity to the average household', () => {
    const draft = updatePartner(
      updateHead(createTypicalDraft(), { privatePensionIncome: undefined }),
      { privatePensionIncome: null },
    );
    const household = toHouseholdImpactRequest(
      { ...draft, hasPartner: true, spending: { ...draft.spending, electricity: null } },
      { year: 2027, policies: ['a'] },
    ).household;
    expect(household.private_pension_income).toBe(0);
    expect(household.partner_private_pension_income).toBe(0);
    expect(household.electricity_spending).toBe(UK_DEFAULT_SPENDING.electricity);
  });

  it('gives the same request for a draft and for its URL form', () => {
    fc.assert(
      fc.property(request, ({ draft, year, policies, include }) => {
        const round = deserializeDraft(serializeDraft(draft));
        expect(JSON.stringify(toHouseholdImpactRequest(round, { year, policies, include }))).toBe(
          JSON.stringify(toHouseholdImpactRequest(draft, { year, policies, include })),
        );
      }),
      NUM_RUNS,
    );
  });

  it('builds a request the API accepts from every draft validate() accepts', () => {
    // Drafts near the bounds, so many pass: ages either side of the API's,
    // salaries for years either side of its policy years. The API's check is
    // its whole request check: every field's type, bound and choice, and its
    // year, salary year and measure validators (the mirror gives pydantic's
    // verdict on every case apiMirror.test.ts holds)
    const near = draftArb({
      adultAges: fc.option(fc.integer({ min: 14, max: 102 }), { nil: null }),
      childAges: fc.option(fc.integer({ min: 0, max: 21 }), { nil: null }),
      salaryYears: fc.oneof(
        { arbitrary: fc.constant(2026), weight: 3 },
        { arbitrary: fc.constantFrom(2025, 2027, 2031, 2032), weight: 1 },
      ),
    });
    const years = fc.oneof({ arbitrary: fc.constantFrom(...API.choices.policy_years), weight: 3 }, { arbitrary: yearArb, weight: 1 });
    const measures = fc.subarray([...MEASURE_IDS], { minLength: 1 });
    let accepted = 0;
    fc.assert(
      fc.property(near, years, measures, includeArb, (draft, year, policies, include) => {
        const body = toHouseholdImpactRequest(draft, { year, policies, include });
        if (validate(draft, { year }).ok) {
          accepted += 1;
          expect(apiRefusals(body)).toEqual([]);
        }
      }),
      { numRuns: 3000 },
    );
    // The property ran on accepted drafts, not only refused ones
    expect(accepted).toBeGreaterThan(50);
  });

  it('refuses nothing the API accepts in the typical and blank drafts once answered', () => {
    const blank = {
      ...createBlankDraft(),
      region: 'WALES' as const,
      tenure: 'OWNED_OUTRIGHT' as const,
      councilTaxBand: 'I' as const,
      claimsUniversalCredit: false,
      head: { ...createBlankDraft().head, age: 40 },
    };
    for (const draft of [createTypicalDraft(), blank]) {
      expect(validate(draft, { year: 2027 })).toEqual({ ok: true, issues: [] });
      // A blank partner's unanswered age is left out, so a single person's
      // request is not refused for it
      expect(apiRefusals(toHouseholdImpactRequest(draft, { year: 2027, policies: [MEASURE_IDS[0]] }))).toEqual([]);
    }
  });

  it('applies the bounds the API’s request models set', () => {
    const household = API.schema.$defs!.HouseholdAnswersRequest.properties!;
    const child = API.schema.$defs!.HouseholdChildRequest.properties!;
    // The bounds of a field, Optional or not
    const bounds = (field: (typeof household)[string]) => {
      const schema = field.anyOf?.[0] ?? field;
      return { min: schema.minimum, max: schema.maximum };
    };
    const limits = UK_HOUSEHOLD_LIMITS;
    expect(bounds(household.age)).toEqual(limits.adultAge);
    expect(bounds(household.partner_age)).toEqual(limits.adultAge);
    expect(bounds(child.age)).toEqual(limits.childAge);
    expect(household.children.maxItems).toBe(limits.maxChildren);
    const amounts = {
      maxAmount: [
        'employment_income',
        'partner_employment_income',
        'private_pension_income',
        'partner_private_pension_income',
        'dividend_income',
        'savings_interest_income',
        'property_income',
        'salary_sacrifice_pension_contributions',
      ],
      maxMonthlyRent: ['monthly_rent'],
      maxMonthlyChildcare: ['monthly_childcare'],
      maxSpending: ['petrol_spending', 'diesel_spending', 'electricity_spending'],
      maxStatePension: ['state_pension', 'partner_state_pension'],
    } as const;
    for (const [limit, fields] of Object.entries(amounts)) {
      for (const field of fields) {
        expect({ field, ...bounds(household[field]) }).toEqual({ field, min: 0, max: limits[limit as keyof typeof amounts] });
      }
    }
  });
});
