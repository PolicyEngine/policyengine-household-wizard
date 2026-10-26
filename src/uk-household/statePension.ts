/**
 * State Pension age and the full new State Pension by policy year, as a
 * table of the same shape as the Autumn Budget 2026 dashboard's
 * `src/uk_budget_data/state_pension.json`, so an app can pass its own copy.
 */
export interface UKStatePensionYear {
  /** The youngest whole age policyengine-uk places over State Pension age in the year. */
  state_pension_age: number;
  /** The full new State Pension, pounds a year. */
  full_new_state_pension: number;
}

export interface UKStatePensionTable {
  years: Readonly<Record<string, UKStatePensionYear>>;
}

/**
 * The default table: the dashboard's state_pension.json at cc15d50e, which
 * its tests/test_household_impact.py checks against policyengine-uk 2.132.6
 * (the version its lockfile pins). The age is the youngest whole age the
 * model's `is_SP_age` counts for a person entered by age alone; the amount is
 * `gov.dwp.state_pension.new_state_pension.amount` times 52, to the penny.
 * Both change with the model: an app that carries a copy checked against its
 * own model should pass that copy instead.
 */
export const UK_STATE_PENSION: UKStatePensionTable = {
  years: {
    '2026': { state_pension_age: 66, full_new_state_pension: 12547.6 },
    '2027': { state_pension_age: 67, full_new_state_pension: 13036.97 },
    '2028': { state_pension_age: 67, full_new_state_pension: 13362.92 },
    '2029': { state_pension_age: 67, full_new_state_pension: 13696.98 },
    '2030': { state_pension_age: 67, full_new_state_pension: 14039.42 },
    '2031': { state_pension_age: 67, full_new_state_pension: 14390.39 },
  },
};

/**
 * State Pension age and the full new State Pension in `year`: the table's
 * row for that year, else for the first later year it has, else its last.
 * So a year before the table (or 0, which apps use to compare answers without
 * a year) takes its first row.
 */
export function statePensionFor(
  year: number,
  table: UKStatePensionTable = UK_STATE_PENSION,
): { age: number; full: number } {
  const known = Object.keys(table.years)
    .map(Number)
    .sort((a, b) => a - b);
  const nearest = known.find((known) => known >= year) ?? known[known.length - 1];
  const row = table.years[String(nearest)];
  return { age: row.state_pension_age, full: row.full_new_state_pension };
}

/**
 * Whether someone of `age` in `year` is at State Pension age. An unanswered
 * age (`null`) is not.
 */
export function atStatePensionAge(
  age: number | null | undefined,
  year: number,
  table: UKStatePensionTable = UK_STATE_PENSION,
): boolean {
  return (age as number) >= statePensionFor(year, table).age;
}

/** Whether a State Pension amount was entered: a finite number; `null` is the full rate. */
export const statePensionEntered = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
