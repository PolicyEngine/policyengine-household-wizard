import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toHouseholdImpactRequest, type HouseholdImpactRequest } from '@/uk-household/adapters/householdImpactRequest';
import { createTypicalDraft, updatePartner } from '@/uk-household/draft';
import type { UKHouseholdDraft } from '@/uk-household/types';
import fixtures from '../fixtures/uk/dashboard-households.json' with { type: 'json' };
import { age, draftArb, includeArb, policiesArb, yearArb } from './arbitraries';
import { answersFromDraft } from './reference/dashboardAnswers';
import { buildHouseholdRequest } from './reference/dashboardRequest';
import { apiRefusals } from './reference/householdImpactApi';

/**
 * A differential test: `toHouseholdImpactRequest` against the Autumn Budget
 * 2026 dashboard's own request builder, copied verbatim into
 * reference/dashboardRequest.ts from before the dashboard took its household
 * model from this package. Both must give the same JSON text, byte for byte,
 * because the dashboard keys its caches on that text.
 */

type Fixture = { name: string; year: number; policies: string[]; include: Array<'by_policy' | 'sweep'>; draft: unknown; request: unknown };
const FIXTURES = fixtures.fixtures as Fixture[];

type Options = { year: number; policies: string[]; include?: string[] };
// The reference is untyped JavaScript; its result has the request's shape
const buildDashboardRequest = buildHouseholdRequest as unknown as (inputs: unknown, options: Options) => HouseholdImpactRequest;
const dashboard = (draft: UKHouseholdDraft, options: Options) => buildDashboardRequest(answersFromDraft(draft), options);

/** The age the API takes for `partner_age`. */
const acceptedAge = (value: unknown) => Number.isInteger(value) && (value as number) >= 16 && (value as number) <= 100;

/**
 * Drafts the dashboard's form can hold: salaries for 2026 (the form asks for
 * nothing else), and children's ages as whole numbers, since the form keeps
 * them as text ("5, 3") that it reads with parseInt.
 */
const formDraft = draftArb({ salaryYears: fc.constant(2026), childAges: fc.integer({ min: 0, max: 25 }) });

describe('the dashboard’s request builder', () => {
  it.each(FIXTURES)('$name: the reference copy gives the captured request', (fixture) => {
    const body = dashboard(fixture.draft as UKHouseholdDraft, fixture);
    expect(JSON.stringify(body)).toBe(JSON.stringify(fixture.request));
  });
});

describe('toHouseholdImpactRequest against the dashboard', () => {
  it('gives the same text for every draft the form holds, but a partner age it never sends', () => {
    let partnerAgeLeftOut = 0;
    fc.assert(
      fc.property(formDraft, yearArb, policiesArb, includeArb, (draft, year, policies, include) => {
        const ours = toHouseholdImpactRequest(draft, { year, policies, include });
        const theirs = dashboard(draft, { year, policies, include });
        if (draft.hasPartner || acceptedAge(draft.partner.age)) {
          expect(JSON.stringify(ours)).toBe(JSON.stringify(theirs));
          return;
        }
        // The one intended difference: without a partner, the dashboard sent
        // whatever partner age the form held, and the API refused the whole
        // request for one it does not take (it reads the age only with a
        // partner). The package leaves such an age out.
        partnerAgeLeftOut += 1;
        expect(ours.household).not.toHaveProperty('partner_age');
        expect(apiRefusals(theirs).some((refusal) => refusal.startsWith('household.partner_age'))).toBe(true);
        const { partner_age: _, ...household } = theirs.household;
        expect(JSON.stringify(ours)).toBe(JSON.stringify({ ...theirs, household }));
      }),
      { numRuns: 3000 },
    );
    expect(partnerAgeLeftOut).toBeGreaterThan(0);
  });

  it('gives the same text for drafts near the form’s defaults', () => {
    // Fewer free fields, so most generated drafts are ones people enter
    const near = fc.record({
      age: age(16, 100),
      partnerAge: age(16, 100),
      hasPartner: fc.boolean(),
      children: fc.array(fc.integer({ min: 0, max: 19 }), { maxLength: 4 }),
    });
    fc.assert(
      fc.property(near, yearArb, ({ age: headAge, partnerAge, hasPartner, children }, year) => {
        const base = createTypicalDraft();
        const draft = {
          ...updatePartner(base, { age: partnerAge ?? 30 }),
          head: { ...base.head, age: headAge },
          hasPartner,
          children: children.map((childAge) => ({ age: childAge })),
        };
        expect(JSON.stringify(toHouseholdImpactRequest(draft, { year, policies: ['a'] }))).toBe(
          JSON.stringify(dashboard(draft, { year, policies: ['a'] })),
        );
      }),
      { numRuns: 1000 },
    );
  });

  it('uses the UK average rent for a region named after an object’s built-ins, where the dashboard broke', () => {
    // The dashboard looked the region up on a plain object, so "constructor"
    // read Object; the API refuses both requests for the region anyway
    const draft = { ...createTypicalDraft(), region: 'constructor' } as unknown as UKHouseholdDraft;
    const ours = toHouseholdImpactRequest(draft, { year: 2027, policies: ['a'] });
    const theirs = dashboard(draft, { year: 2027, policies: ['a'] });
    expect(ours.household.monthly_rent).toBe(1406);
    expect(theirs.household.monthly_rent).not.toBe(1406);
    expect(apiRefusals(ours)).toContain('household.region: literal_error');
  });
});
