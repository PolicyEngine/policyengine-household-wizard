// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  toV1HouseholdSituation,
  type ToV1PayloadOptions,
} from '@/us-household/adapters/v1Payload';
import { addPerson, createBlankDraft } from '@/us-household/draft';
import { normalizeLegacyDraft } from '@/us-household/normalize';
import type { USHouseholdDraft, USPersonDraft, USPersonIncomes } from '@/us-household/types';

/**
 * Differential checks against the live PolicyEngine API: the model's totals
 * must equal the sums of the draft fields that feed them, and one person's
 * answers must not change what the model computes for anyone else. Skipped
 * unless POLICYENGINE_LIVE_API=1, because they need the network:
 *
 *   bun run test:live
 */

const CALCULATE_URL = 'https://api.policyengine.org/us/calculate';
const YEAR = 2026;

type Values = Record<string, number>;

/**
 * Posts a draft and returns the requested outputs for every person and for
 * the tax unit. Outputs are requested without overwriting the inputs the
 * adapter sent.
 */
async function calculateDraft(
  draft: USHouseholdDraft,
  personOutputs: string[],
  taxUnitOutputs: string[] = [],
  options: ToV1PayloadOptions = {},
): Promise<{ people: Record<string, Values>; taxUnit: Values }> {
  const situation = toV1HouseholdSituation(draft, options);
  for (const person of Object.values(situation.people)) {
    for (const variable of personOutputs) {
      person[variable] ??= { [YEAR]: null };
    }
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
    people: Object.fromEntries(
      Object.entries(body.result.people).map(([id, record]) => [id, pick(record, personOutputs)]),
    ),
    taxUnit: pick(Object.values(body.result.tax_units)[0], taxUnitOutputs),
  };
}

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
  const { people, taxUnit } = await calculateDraft(draft, personOutputs, taxUnitOutputs);
  return { person: people['adult-1'], taxUnit };
}

function household(
  state: string,
  maritalStatus: 'single' | 'married',
  people: Array<Pick<USPersonDraft, 'kind'> & Partial<USPersonDraft>>,
): USHouseholdDraft {
  let draft = createBlankDraft(YEAR);
  draft = { ...draft, state, maritalStatus };
  for (const { kind, ...person } of people) {
    draft = addPerson(draft, kind, person);
  }
  return draft;
}

/** Two adults aged 70 with no income in CA: the model gives each SSI. */
function ssiCouple(first: number | undefined, second: number | undefined) {
  return household('CA', 'married', [
    { kind: 'adult', age: 70, ssiAmount: first },
    { kind: 'adult', age: 70, ssiAmount: second },
  ]);
}

// The couple's SSI rate needs the marital unit. Assert on ssi only: in CA the
// state supplement tops up SSI, so net income hides the difference.
const COUPLE: ToV1PayloadOptions = { includeMaritalUnit: true };

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

    it("does not zero one adult's SSI when the other reports theirs", async () => {
      // Before this fix, adult 1 reporting 600 sent `ssi` for adult 1 only,
      // and adult 2's SSI came back 0 instead of the model's amount.
      const unset = await calculateDraft(ssiCouple(undefined, undefined), ['ssi'], [], COUPLE);
      const modeled = unset.people['adult-2'].ssi;
      expect(modeled).toBeGreaterThan(0);
      expect(unset.people['adult-1'].ssi).toBe(modeled);

      const oneReported = await calculateDraft(ssiCouple(600, undefined), ['ssi'], [], COUPLE);
      expect(oneReported.people['adult-2'].ssi).toBe(modeled);
      expect(oneReported.people['adult-1'].ssi).toBe(modeled);

      const bothReported = await calculateDraft(ssiCouple(600, 0), ['ssi'], [], COUPLE);
      expect(bothReported.people['adult-1'].ssi).toBe(600);
      expect(bothReported.people['adult-2'].ssi).toBe(0);

      const oneZero = await calculateDraft(ssiCouple(undefined, 0), ['ssi'], [], COUPLE);
      expect(oneZero.people['adult-1'].ssi).toBe(modeled);
      expect(oneZero.people['adult-2'].ssi).toBe(0);
    }, 120_000);

    it("reads cliff-watch's default SSI of 0 as blank", async () => {
      const draft = normalizeLegacyDraft({
        state: 'CA',
        marital_status: 'MARRIED',
        year: YEAR,
        people: [
          { kind: 'adult', age: 70, ssi_amount: 0 },
          { kind: 'adult', age: 70, ssi_amount: 0 },
        ],
      });
      const { people } = await calculateDraft(draft, ['ssi'], [], COUPLE);
      expect(people['adult-1'].ssi).toBeGreaterThan(0);
      expect(people['adult-2'].ssi).toBeGreaterThan(0);
    }, 60_000);

    it("keeps children's K-12 status when an older child is a full-time student", async () => {
      // Before this fix the 19-year-old's flag was sent as is_full_time_student
      // for them only, which stored false for the 10-year-old.
      const draft = household('CA', 'single', [
        { kind: 'adult', age: 40, employmentIncome: 20000 },
        { kind: 'dependent', age: 19, isFullTimeStudent: true },
        { kind: 'dependent', age: 10 },
      ]);
      const { people } = await calculateDraft(draft, ['is_full_time_student']);
      expect(people['dependent-1'].is_full_time_student).toBe(true);
      expect(people['dependent-2'].is_full_time_student).toBe(true);
      expect(people['adult-1'].is_full_time_student).toBe(false);
    }, 60_000);

    it('sends the student flag as college enrollment from the age K-12 ends', async () => {
      const draft = household('CA', 'single', [
        { kind: 'adult', age: 45 },
        { kind: 'dependent', age: 17, isFullTimeStudent: true },
        { kind: 'dependent', age: 18, isFullTimeStudent: true },
      ]);
      const outputs = ['is_full_time_student', 'is_full_time_college_student', 'is_in_k12_school'];
      const { people } = await calculateDraft(draft, outputs);
      expect(people['dependent-1']).toEqual({
        is_full_time_student: true,
        is_full_time_college_student: false,
        is_in_k12_school: true,
      });
      expect(people['dependent-2']).toEqual({
        is_full_time_student: true,
        is_full_time_college_student: true,
        is_in_k12_school: false,
      });
    }, 60_000);

    it("does not give a flagged child New Jersey's college exemption", async () => {
      const draft = (isFullTimeStudent: boolean) =>
        household('NJ', 'single', [
          { kind: 'adult', age: 40, employmentIncome: 60000 },
          { kind: 'dependent', age: 16, isFullTimeStudent },
        ]);
      const outputs = ['nj_dependents_attending_college_exemption'];
      const flagged = await calculateDraft(draft(true), [], outputs);
      const unflagged = await calculateDraft(draft(false), [], outputs);
      expect(flagged.taxUnit).toEqual(unflagged.taxUnit);
    }, 60_000);

    it('counts only people of kind dependent as dependents, with or without a child', async () => {
      // Before this fix is_tax_unit_dependent was sent for dependents only, so
      // adults were stored as non-dependents only when a child was listed.
      // With no child, the model made the adult who is neither head nor
      // spouse (the 43-year-old; head and spouse are the two oldest) a
      // dependent, and the tax unit counted one dependent.
      const adults: Array<Pick<USPersonDraft, 'kind'> & Partial<USPersonDraft>> = [
        { kind: 'adult', age: 45 },
        { kind: 'adult', age: 43 },
        { kind: 'adult', age: 70 },
      ];
      const outputs = ['tax_unit_count_dependents'];
      const withoutChild = await calculateDraft(household('CA', 'married', adults), [], outputs);
      const withChild = await calculateDraft(
        household('CA', 'married', [...adults, { kind: 'dependent', age: 8 }]),
        [],
        outputs,
      );
      expect(withoutChild.taxUnit.tax_unit_count_dependents).toBe(0);
      expect(withChild.taxUnit.tax_unit_count_dependents).toBe(1);
    }, 60_000);
  },
);
