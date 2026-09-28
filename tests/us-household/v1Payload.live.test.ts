// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toV1HouseholdSituation } from '@/us-household/adapters/v1Payload';
import { addPerson, createBlankDraft } from '@/us-household/draft';
import type { USPersonIncomes } from '@/us-household/types';

/**
 * Differential check against the live PolicyEngine API: the model's Social
 * Security total must equal the sum of the draft's Social Security fields.
 * Skipped unless POLICYENGINE_LIVE_API=1, because it needs the network:
 *
 *   bun run test:live
 */

const CALCULATE_URL = 'https://api.policyengine.org/us/calculate';
const YEAR = 2026;
const OUTPUTS = ['social_security', 'social_security_retirement', 'social_security_disability'];

const CASES: Array<{ name: string; incomes: USPersonIncomes }> = [
  { name: 'retirement and SSDI', incomes: { socialSecurityIncome: 12000, ssdiAmount: 6000 } },
  { name: 'retirement only', incomes: { socialSecurityIncome: 12000 } },
  { name: 'SSDI only', incomes: { ssdiAmount: 6000 } },
];

describe.skipIf(process.env.POLICYENGINE_LIVE_API !== '1')(
  'toV1HouseholdSituation against api.policyengine.org',
  () => {
    it.each(CASES)(
      '$name: social_security equals the sum of the entered benefits',
      async ({ incomes }) => {
        let draft = createBlankDraft(YEAR);
        draft = { ...draft, state: 'TX', maritalStatus: 'single' };
        draft = addPerson(draft, 'adult', { age: 67, ...incomes });

        const situation = toV1HouseholdSituation(draft);
        const person = situation.people['adult-1'];
        for (const variable of OUTPUTS) {
          person[variable] ??= { [YEAR]: null };
        }

        const response = await fetch(CALCULATE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ household: situation }),
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          result: { people: Record<string, Record<string, Record<string, number>>> };
        };
        const result = body.result.people['adult-1'];

        const retirement = incomes.socialSecurityIncome ?? 0;
        const disability = incomes.ssdiAmount ?? 0;
        expect(result.social_security_retirement[YEAR]).toBe(retirement);
        expect(result.social_security_disability[YEAR]).toBe(disability);
        expect(result.social_security[YEAR]).toBe(retirement + disability);
      },
      60_000,
    );
  },
);
