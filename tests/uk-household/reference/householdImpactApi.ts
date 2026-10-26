/**
 * What the dashboard's household impact API refuses, transcribed from
 * `HouseholdImpactRequest` and `HouseholdAnswersRequest` in
 * PolicyEngine/uk-autumn-budget-dashboard-2026's src/uk_budget_data/api.py
 * (at cc15d50e9c01520e7d77dc5a70b17f3fc258f9b6): field types, bounds,
 * literal sets, the policy years and the salary year rule. pydantic reads a
 * JSON number with no fractional part as an int, refuses null for a
 * required field, and refuses unknown fields (`extra: forbid`). Measure ids
 * are not checked here (the API checks them against its registry).
 */
const POLICY_YEARS = [2026, 2027, 2028, 2029, 2030, 2031];
const REGIONS = [
  'NORTH_EAST', 'NORTH_WEST', 'YORKSHIRE', 'EAST_MIDLANDS', 'WEST_MIDLANDS', 'EAST_OF_ENGLAND',
  'LONDON', 'SOUTH_EAST', 'SOUTH_WEST', 'WALES', 'SCOTLAND', 'NORTHERN_IRELAND',
];
const TENURES = ['OWNED_OUTRIGHT', 'OWNED_WITH_MORTGAGE', 'RENT_PRIVATELY', 'RENT_FROM_COUNCIL', 'RENT_FROM_HA'];
const PLANS = ['NONE', 'PLAN_1', 'PLAN_2', 'PLAN_4', 'PLAN_5', 'POSTGRADUATE'];
const BANDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const MAX_AMOUNT = 10_000_000;

type Field = { kind: 'int' | 'float' | 'bool' | 'literal'; min?: number; max?: number; values?: string[]; optional?: boolean };

const HOUSEHOLD: Record<string, Field> = {
  age: { kind: 'int', min: 16, max: 100 },
  employment_income: { kind: 'float', min: 0, max: MAX_AMOUNT },
  student_loan_plan: { kind: 'literal', values: PLANS },
  has_partner: { kind: 'bool' },
  partner_age: { kind: 'int', min: 16, max: 100 },
  partner_employment_income: { kind: 'float', min: 0, max: MAX_AMOUNT },
  partner_student_loan_plan: { kind: 'literal', values: PLANS },
  region: { kind: 'literal', values: REGIONS },
  claims_universal_credit: { kind: 'bool' },
  tenure: { kind: 'literal', values: TENURES },
  monthly_rent: { kind: 'float', min: 0, max: 100_000 },
  council_tax: { kind: 'float', min: 0, max: 100_000, optional: true },
  council_tax_band: { kind: 'literal', values: BANDS },
  monthly_childcare: { kind: 'float', min: 0, max: 10_000 },
  salary_year: { kind: 'int' },
  dividend_income: { kind: 'float', min: 0, max: MAX_AMOUNT },
  savings_interest_income: { kind: 'float', min: 0, max: MAX_AMOUNT },
  property_income: { kind: 'float', min: 0, max: MAX_AMOUNT },
  private_pension_income: { kind: 'float', min: 0, max: MAX_AMOUNT },
  partner_private_pension_income: { kind: 'float', min: 0, max: MAX_AMOUNT },
  petrol_spending: { kind: 'float', min: 0, max: 100_000 },
  diesel_spending: { kind: 'float', min: 0, max: 100_000 },
  electricity_spending: { kind: 'float', min: 0, max: 100_000 },
  salary_sacrifice_pension_contributions: { kind: 'float', min: 0, max: MAX_AMOUNT },
  state_pension: { kind: 'float', min: 0, max: 100_000, optional: true },
  partner_state_pension: { kind: 'float', min: 0, max: 100_000, optional: true },
};

function fieldRefusal(name: string, field: Field, value: unknown): string | null {
  if (value === null) return field.optional ? null : `${name}: null`;
  switch (field.kind) {
    case 'bool':
      return typeof value === 'boolean' ? null : `${name}: not a boolean`;
    case 'literal':
      return typeof value === 'string' && field.values!.includes(value) ? null : `${name}: not one of the choices`;
    case 'int':
    case 'float': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${name}: not a number`;
      if (field.kind === 'int' && !Number.isInteger(value)) return `${name}: not a whole number`;
      if (field.min !== undefined && value < field.min) return `${name}: below ${field.min}`;
      if (field.max !== undefined && value > field.max) return `${name}: above ${field.max}`;
      return null;
    }
  }
}

/** The reasons the API would refuse a request body (sent as JSON), or none. */
export function apiRefusals(body: unknown): string[] {
  // The API sees the JSON text: undefined fields are left out
  const request = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  const refusals: string[] = [];
  for (const key of Object.keys(request)) {
    if (!['year', 'policies', 'household', 'include'].includes(key)) refusals.push(`${key}: unknown field`);
  }
  const year = request.year;
  if (typeof year !== 'number' || !Number.isInteger(year) || !POLICY_YEARS.includes(year)) refusals.push('year: not a policy year');
  if (request.policies !== undefined && request.policies !== null) {
    if (!Array.isArray(request.policies) || request.policies.length === 0) refusals.push('policies: none');
  }
  if (Array.isArray(request.include)) {
    for (const part of request.include) if (part !== 'by_policy' && part !== 'sweep') refusals.push('include: unknown part');
  }
  const household = (request.household ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(household)) {
    if (key === 'children') continue;
    const field = HOUSEHOLD[key];
    if (!field) {
      refusals.push(`household.${key}: unknown field`);
      continue;
    }
    const refusal = fieldRefusal(`household.${key}`, field, value);
    if (refusal) refusals.push(refusal);
  }
  const children = household.children ?? [];
  if (!Array.isArray(children)) refusals.push('household.children: not a list');
  else {
    if (children.length > 10) refusals.push('household.children: more than 10');
    children.forEach((child: Record<string, unknown>, index: number) => {
      for (const key of Object.keys(child)) {
        if (key !== 'age' && key !== 'in_education') refusals.push(`children.${index}.${key}: unknown field`);
      }
      const age = fieldRefusal(`children.${index}.age`, { kind: 'int', min: 0, max: 19 }, child.age);
      if (age) refusals.push(age);
      if (child.in_education !== undefined && child.in_education !== null && typeof child.in_education !== 'boolean') {
        refusals.push(`children.${index}.in_education: not a boolean`);
      }
    });
  }
  const salaryYear = household.salary_year ?? 2026;
  if (typeof salaryYear === 'number' && !POLICY_YEARS.includes(salaryYear)) refusals.push('household.salary_year: not a policy year');
  if (typeof salaryYear === 'number' && typeof year === 'number' && salaryYear > year) {
    refusals.push('household.salary_year: after year');
  }
  return refusals;
}

export { BANDS, PLANS, POLICY_YEARS, REGIONS, TENURES };
