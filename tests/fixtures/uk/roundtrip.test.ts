import { describe, expect, it } from 'vitest';
import fixtures from './dashboard-households.json' with { type: 'json' };
import { toHouseholdImpactRequest } from '@/uk-household/adapters/householdImpactRequest';
import { deserializeDraft, serializeDraft } from '@/uk-household/serialize';
import type { UKHouseholdDraft } from '@/uk-household/types';
import { validate } from '@/uk-household/validate';

/**
 * The Autumn Budget 2026 dashboard's households (its starting answers, its
 * example households and edge cases of its form), each with the request that
 * dashboard's own code gave for it (see the file's `_note`).
 */
interface Fixture {
  name: string;
  year: number;
  policies: string[];
  include: Array<'by_policy' | 'sweep'>;
  draft: UKHouseholdDraft;
  request: unknown;
}

const FIXTURES = fixtures.fixtures as unknown as Fixture[];
const POLICY_YEARS = [2026, 2027, 2028, 2029, 2030, 2031];

/** Edge cases the form allows and the API refuses, with what validate() says. */
const REFUSED: Record<string, string[]> = {
  'edge:child of 20': ['children[0].age.tooOld'],
  'edge:unknown region': ['region.invalid'],
};

const options = ({ year, policies, include }: Fixture) => ({ year, policies, include });
const accepted = FIXTURES.filter((fixture) => !(fixture.name in REFUSED));

describe('UK household fixtures', () => {
  it('has the dashboard’s starting answers and every example household', () => {
    const names = FIXTURES.map((fixture) => fixture.name);
    expect(names).toContain('defaults');
    expect(names.filter((name) => name.startsWith('example:'))).toHaveLength(8);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(FIXTURES)('$name: builds the request the dashboard did, byte for byte', (fixture) => {
    const body = toHouseholdImpactRequest(fixture.draft, options(fixture));
    expect(JSON.stringify(body)).toBe(JSON.stringify(fixture.request));
  });

  it.each(FIXTURES)('$name: validates as the API would', (fixture) => {
    const result = validate(fixture.draft, { year: fixture.year, years: POLICY_YEARS });
    expect(result.issues.map((issue) => issue.code)).toEqual(REFUSED[fixture.name] ?? []);
  });

  it.each(accepted)('$name: gives the same request after a round trip through a link', (fixture) => {
    const round = deserializeDraft(serializeDraft(fixture.draft));
    expect(JSON.stringify(toHouseholdImpactRequest(round, options(fixture)))).toBe(JSON.stringify(fixture.request));
    expect(serializeDraft(round)).toBe(serializeDraft(fixture.draft));
  });
});
