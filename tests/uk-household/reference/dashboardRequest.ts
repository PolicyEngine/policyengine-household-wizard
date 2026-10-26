// @ts-nocheck
/**
 * A verbatim copy of the Autumn Budget 2026 dashboard's request builder
 * (PolicyEngine/uk-autumn-budget-dashboard-2026 at
 * cc15d50e9c01520e7d77dc5a70b17f3fc258f9b6: buildHouseholdRequest and its
 * helpers from src/utils/householdImpactApi.js, the defaults it reads from
 * src/utils/householdDefaults.js, and src/uk_budget_data/state_pension.json),
 * before that dashboard took its household model from this package. The
 * parity tests check `toHouseholdImpactRequest` against it. Only the imports
 * are changed (inlined); do not edit it to match the package.
 */

const statePensionTable = {
  years: {
    "2026": { state_pension_age: 66, full_new_state_pension: 12547.6 },
    "2027": { state_pension_age: 67, full_new_state_pension: 13036.97 },
    "2028": { state_pension_age: 67, full_new_state_pension: 13362.92 },
    "2029": { state_pension_age: 67, full_new_state_pension: 13696.98 },
    "2030": { state_pension_age: 67, full_new_state_pension: 14039.42 },
    "2031": { state_pension_age: 67, full_new_state_pension: 14390.39 },
  },
};

/** Average monthly private rent by region (ONS PIPR, September 2026). */
export const REGIONAL_RENT = {
  NORTH_EAST: 790,
  NORTH_WEST: 975,
  YORKSHIRE: 869,
  EAST_MIDLANDS: 928,
  WEST_MIDLANDS: 983,
  EAST_OF_ENGLAND: 1298,
  LONDON: 2338,
  SOUTH_EAST: 1438,
  SOUTH_WEST: 1251,
  WALES: 848,
  SCOTLAND: 1011,
  // July 2026, Northern Ireland's latest month
  NORTHERN_IRELAND: 879,
};

/** The region's average private rent; the UK's (£1,406) for an unknown region. */
export const regionalRent = (region) => REGIONAL_RENT[region] ?? 1406;

/** Average household spending a year (ONS Family Spending, FYE 2025). */
export const DEFAULT_SPENDING = {
  petrol: 620,
  diesel: 340,
  electricity: 1040,
};

/** The year the wizard's salary is entered for; the server grows it. */
export const SALARY_YEAR = 2026;

/** The requests of a calculation: the headline, then the detail parts. */
export const HEADLINE_INCLUDE = [];

export function statePensionFor(year) {
  const years = statePensionTable.years;
  const known = Object.keys(years).map(Number).sort((a, b) => a - b);
  const nearest = known.find((y) => y >= year) ?? known[known.length - 1];
  const row = years[String(known.includes(year) ? year : nearest)];
  return { age: row.state_pension_age, full: row.full_new_state_pension };
}

/** Whether someone of `age` is at State Pension age in `year`. */
export const atStatePensionAge = (age, year) => age >= statePensionFor(year).age;

export const OLDEST_CHILD_AGE = 19;
/** From this age, whether a child is in full-time non-advanced education
 * decides whether they count. */
export const YOUNG_PERSON_AGE = 16;

/** What the form says, and the API is told, about a child of 20 or over. */
export const CHILD_AGE_MESSAGE =
  "Children are 0 to 19. Someone aged 20 or over is not a dependant for Child Benefit or Universal Credit, so leave them out.";

/**
 * Children's ages from the wizard's text ("5, 3, 1"). An age of 20 or over
 * is kept, not dropped, so the calculation refuses it with a message
 * (`CHILD_AGE_MESSAGE`) rather than leaving the child out silently.
 */
export function parseChildrenAges(value) {
  if (!value || String(value).trim() === "") return [];
  return String(value)
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n >= 0);
}

/** Whether a child of `age` is asked about education (16 to 19). */
export const asksEducation = (age) => age >= YOUNG_PERSON_AGE && age <= OLDEST_CHILD_AGE;

/**
 * Each child as the API takes them: their age, and from 16 to 19 whether
 * they are in full-time non-advanced education (school or college), as
 * answered, yes until answered.
 */
export function childrenForRequest(inputs) {
  const education = Array.isArray(inputs.children_in_education) ? inputs.children_in_education : [];
  return parseChildrenAges(inputs.children_ages).map((age, index) =>
    asksEducation(age) ? { age, in_education: education[index] !== false } : { age },
  );
}

const RENTING = new Set(["RENT_PRIVATELY", "RENT_FROM_COUNCIL", "RENT_FROM_HA"]);
export const isRenting = (tenure) => RENTING.has(tenure);

/**
 * The request body for the wizard's answers.
 *
 * @param {Object} inputs - The wizard's state (HouseholdCalculator)
 * @param {{ year: number, policies: string[], include?: string[] }} options
 */
export function buildHouseholdRequest(inputs, { year, policies, include = HEADLINE_INCLUDE }) {
  const children = childrenForRequest(inputs);
  const renting = isRenting(inputs.tenure);
  return {
    year,
    policies: [...policies],
    household: {
      age: inputs.current_age,
      employment_income: inputs.current_salary,
      has_partner: Boolean(inputs.has_partner),
      partner_age: inputs.partner_age,
      partner_employment_income: inputs.has_partner ? inputs.partner_salary : 0,
      children,
      region: inputs.region,
      claims_universal_credit: Boolean(inputs.claims_universal_credit),
      tenure: inputs.tenure,
      // Left as prefilled (null), the region's average private rent
      monthly_rent: renting ? monthlyRent(inputs) : 0,
      dividend_income: inputs.dividends_per_year,
      savings_interest_income: inputs.savings_interest_per_year,
      private_pension_income: inputs.private_pension_per_year ?? 0,
      partner_private_pension_income: inputs.has_partner ? (inputs.partner_private_pension_per_year ?? 0) : 0,
      property_income: inputs.property_income_per_year,
      petrol_spending: inputs.petrol_spending_per_year,
      diesel_spending: inputs.diesel_spending_per_year,
      electricity_spending: inputs.electricity_spending_per_year ?? DEFAULT_SPENDING.electricity,
      salary_sacrifice_pension_contributions: inputs.salary_sacrifice_per_year,
      student_loan_plan: inputs.student_loan_plan,
      // The API estimates Council Tax from the band and the region's average
      // Band D (none in Northern Ireland, which has domestic rates)
      council_tax_band: inputs.council_tax_band,
      // Childcare only counts with children
      monthly_childcare: children.length ? inputs.monthly_childcare : 0,
      salary_year: SALARY_YEAR,
      // The State Pension only as entered: left as prefilled, the API uses
      // the full new State Pension for the year
      ...(statePensionEntered(inputs.state_pension_per_year) && atStatePensionAge(inputs.current_age, year)
        ? { state_pension: inputs.state_pension_per_year }
        : {}),
      ...(inputs.has_partner &&
      statePensionEntered(inputs.partner_state_pension_per_year) &&
      atStatePensionAge(inputs.partner_age, year)
        ? { partner_state_pension: inputs.partner_state_pension_per_year }
        : {}),
    },
    include: [...include],
  };
}

/** The rent a month: as entered, else the region's average private rent. */
export const monthlyRent = (inputs) =>
  typeof inputs.monthly_rent === "number" && Number.isFinite(inputs.monthly_rent)
    ? inputs.monthly_rent
    : regionalRent(inputs.region);

const statePensionEntered = (value) => typeof value === "number" && Number.isFinite(value);
