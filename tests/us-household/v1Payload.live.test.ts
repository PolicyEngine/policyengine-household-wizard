// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toV1HouseholdSituation } from '@/us-household/adapters/v1Payload';
import { addPerson, createBlankDraft } from '@/us-household/draft';
import type { USPersonIncomes } from '@/us-household/types';

/**
 * Differential checks against the live PolicyEngine API: the model's totals
 * must equal the sums of the draft fields that feed them. Skipped unless
 * POLICYENGINE_LIVE_API=1, because they need the network:
 *
 *   bun run test:live
 */

const CALCULATE_URL = 'https://api.policyengine.org/us/calculate';
const YEAR = 2026;

type Values = Record<string, number>;

/** Posts a one-adult household aged 67 and returns the requested outputs. */
async function calculate(
  state: string,
  incomes: USPersonIncomes,
  personOutputs: string[],
  taxUnitOutputs: string[] = [],
): Promise<{ person: Values; taxUnit: Values }> {
  let draft = createBlankDraft(YEAR);
  draft = { ...draft, state, maritalStatus: 'single' };
  draft = addPerson(draft, 'adult', { age: 67, ...incomes });

  const situation = toV1HouseholdSituation(draft);
  const person = situation.people['adult-1'];
  for (const variable of personOutputs) {
    person[variable] ??= { [YEAR]: null };
  }
  const taxUnit = Object.values(situation.tax_units ?? {})[0];
  for (const variable of taxUnitOutputs) {
    taxUnit[variable] = { [YEAR]: null };
  }

  const response = await fetch(CALCULATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ household: situation }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result: {
      people: Record<string, Record<string, Record<string, number>>>;
      tax_units: Record<string, Record<string, Record<string, number>>>;
    };
  };
  const pick = (record: Record<string, Record<string, number>>, names: string[]) =>
    Object.fromEntries(names.map((name) => [name, record[name][YEAR]]));
  return {
    person: pick(body.result.people['adult-1'], personOutputs),
    taxUnit: pick(Object.values(body.result.tax_units)[0], taxUnitOutputs),
  };
}

const SOCIAL_SECURITY_CASES: Array<{ name: string; incomes: USPersonIncomes }> = [
  { name: 'retirement and SSDI', incomes: { socialSecurityIncome: 12000, ssdiAmount: 6000 } },
  { name: 'retirement only', incomes: { socialSecurityIncome: 12000 } },
  { name: 'SSDI only', incomes: { ssdiAmount: 6000 } },
];

const PENSION_CASES: Array<{ name: string; incomes: USPersonIncomes }> = [
  { name: 'public only', incomes: { publicPensionIncome: 30000 } },
  { name: 'private only', incomes: { privatePensionIncome: 30000 } },
  { name: 'unknown source only', incomes: { pensionIncome: 30000 } },
  {
    name: 'all three',
    incomes: { publicPensionIncome: 20000, privatePensionIncome: 10000, pensionIncome: 5000 },
  },
];

describe.skipIf(process.env.POLICYENGINE_LIVE_API !== '1')(
  'toV1HouseholdSituation against api.policyengine.org',
  () => {
    it.each(SOCIAL_SECURITY_CASES)(
      '$name: social_security equals the sum of the entered benefits',
      async ({ incomes }) => {
        const { person } = await calculate('TX', incomes, [
          'social_security',
          'social_security_retirement',
          'social_security_disability',
        ]);
        const retirement = incomes.socialSecurityIncome ?? 0;
        const disability = incomes.ssdiAmount ?? 0;
        expect(person.social_security_retirement).toBe(retirement);
        expect(person.social_security_disability).toBe(disability);
        expect(person.social_security).toBe(retirement + disability);
      },
      60_000,
    );

    it.each(PENSION_CASES)(
      '$name: pension components hold the entered amounts and add up to the total',
      async ({ incomes }) => {
        const { person, taxUnit } = await calculate(
          'TX',
          incomes,
          [
            'taxable_pension_income',
            'taxable_public_pension_income',
            'taxable_private_pension_income',
          ],
          ['adjusted_gross_income'],
        );
        const publicPension = incomes.publicPensionIncome ?? 0;
        const privatePension = (incomes.privatePensionIncome ?? 0) + (incomes.pensionIncome ?? 0);
        expect(person.taxable_public_pension_income).toBe(publicPension);
        expect(person.taxable_private_pension_income).toBe(privatePension);
        expect(person.taxable_pension_income).toBe(publicPension + privatePension);
        expect(taxUnit.adjusted_gross_income).toBe(publicPension + privatePension);
      },
      60_000,
    );

    it('applies a public pension subtraction to public pensions only', async () => {
      // Minnesota's public pension subtraction reads
      // taxable_public_pension_income. Under the old mapping to the
      // taxable_pension_income total, it saw zero for every pension.
      const outputs = ['mn_public_pension_subtraction'];
      const publicPension = await calculate('MN', { publicPensionIncome: 30000 }, [], outputs);
      const unknownSource = await calculate('MN', { pensionIncome: 30000 }, [], outputs);
      expect(publicPension.taxUnit.mn_public_pension_subtraction).toBeGreaterThan(0);
      expect(unknownSource.taxUnit.mn_public_pension_subtraction).toBe(0);
    }, 60_000);
  },
);
