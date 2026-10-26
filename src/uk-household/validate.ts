import { UK_CHILD_AGE_MESSAGE, UK_OLDEST_CHILD_AGE } from './children';
import { isRenting, isUKCouncilTaxBand, isUKRegion, isUKStudentLoanPlan, isUKTenure } from './codes';
import { atStatePensionAge, statePensionEntered, type UKStatePensionTable } from './statePension';
import type { UKHouseholdDraft, ValidationIssue, ValidationResult } from './types';

/**
 * The bounds the Autumn Budget 2026 dashboard's household impact API puts on
 * each answer (`HouseholdAnswersRequest` in its src/uk_budget_data/api.py),
 * which `validate()` applies. Amounts are pounds a year unless named monthly.
 */
export const UK_HOUSEHOLD_LIMITS = {
  adultAge: { min: 16, max: 100 },
  childAge: { min: 0, max: UK_OLDEST_CHILD_AGE },
  maxChildren: 10,
  /** Incomes and salary sacrifice. */
  maxAmount: 10_000_000,
  maxMonthlyRent: 100_000,
  maxMonthlyChildcare: 10_000,
  /** Petrol, diesel and electricity. */
  maxSpending: 100_000,
  maxStatePension: 100_000,
} as const;

export interface UKValidateOptions {
  /**
   * The policy year (2027 is 2027-28). Ages are taken in this year, State
   * Pension age is this year's, and salaries are grown to it.
   */
  year: number;
  /** The policy years the calculation covers; left out, any year. */
  years?: readonly number[];
  /** State Pension ages by year; left out, `UK_STATE_PENSION`. */
  statePension?: UKStatePensionTable;
}

const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const pounds = (amount: number) => `£${amount.toLocaleString('en-GB')}`;

/**
 * Check a draft for the calculation in `options.year`. Every issue is an
 * answer the calculation needs and lacks, or one the household impact API
 * would refuse, so a draft that passes builds a request within the API's
 * bounds (`UK_HOUSEHOLD_LIMITS`). An answer the calculation does not read
 * (rent when not renting, a partner's answers without a partner, a State
 * Pension under State Pension age) is not checked.
 */
export function validate(draft: UKHouseholdDraft, options: UKValidateOptions): ValidationResult {
  const { year, years, statePension } = options;
  const limits = UK_HOUSEHOLD_LIMITS;
  const issues: ValidationIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });

  if (!isWhole(year) || (years && !years.includes(year))) {
    add('year.unsupported', 'year', `${String(year)} is not a year this calculation covers.`);
  }
  if (!isWhole(draft.salaryYear) || (years && !years.includes(draft.salaryYear))) {
    add('salaryYear.unsupported', 'salaryYear', `Salaries cannot be entered for ${String(draft.salaryYear)}.`);
  } else if (isWhole(year) && draft.salaryYear > year) {
    add(
      'salaryYear.afterYear',
      'salaryYear',
      `Salaries are entered for ${draft.salaryYear}, after ${year}; they can only be grown forward.`,
    );
  }

  const choice = (path: string, label: string, value: unknown, known: (value: unknown) => boolean) => {
    if (value === null || value === undefined) add(`${path}.required`, path, `${label} is required.`);
    else if (!known(value)) add(`${path}.invalid`, path, `Unknown ${label.toLowerCase()} "${String(value)}".`);
  };
  choice('region', 'Region', draft.region, isUKRegion);
  choice('tenure', 'Housing', draft.tenure, isUKTenure);
  choice('councilTaxBand', 'Council Tax band', draft.councilTaxBand, isUKCouncilTaxBand);
  if (typeof draft.claimsUniversalCredit !== 'boolean') {
    add('claimsUniversalCredit.required', 'claimsUniversalCredit', 'Whether the household claims Universal Credit is required.');
  }

  // An amount the request sends as it is: required, a number, from 0 to max
  const amount = (path: string, label: string, value: unknown, max: number, { optional = false } = {}) => {
    if (value === null || value === undefined) {
      if (!optional) add(`${path}.required`, path, `${label} is required.`);
    } else if (!isFiniteNumber(value)) {
      add(`${path}.notANumber`, path, `${label} must be a number.`);
    } else if (value < 0) {
      add(`${path}.negative`, path, `${label} cannot be negative.`);
    } else if (value > max) {
      add(`${path}.tooLarge`, path, `${label} cannot be more than ${pounds(max)}.`);
    }
  };

  const age = (path: string, label: string, value: unknown) => {
    if (value === null || value === undefined) add(`${path}.required`, path, `${label} is required.`);
    else if (!isWhole(value)) add(`${path}.notWhole`, path, `${label} must be a whole number of years.`);
    else if (value < limits.adultAge.min || value > limits.adultAge.max) {
      add(`${path}.outOfRange`, path, `${label} must be from ${limits.adultAge.min} to ${limits.adultAge.max}.`);
    }
  };

  const { head, partner } = draft;
  age('head.age', 'Your age', head.age);
  amount('head.employmentIncome', 'Your salary', head.employmentIncome, limits.maxAmount);
  amount('head.privatePensionIncome', 'Your private pension', head.privatePensionIncome, limits.maxAmount, {
    optional: true,
  });
  amount('head.dividendIncome', 'Dividends', head.dividendIncome, limits.maxAmount);
  amount('head.savingsInterestIncome', 'Savings interest', head.savingsInterestIncome, limits.maxAmount);
  amount('head.propertyIncome', 'Property income', head.propertyIncome, limits.maxAmount);
  amount(
    'head.salarySacrificePensionContributions',
    'Salary sacrifice',
    head.salarySacrificePensionContributions,
    limits.maxAmount,
  );
  if (!isUKStudentLoanPlan(head.studentLoanPlan)) {
    add('head.studentLoanPlan.invalid', 'head.studentLoanPlan', `Unknown student loan plan "${String(head.studentLoanPlan)}".`);
  }
  // The State Pension is read only as entered (null is the full rate) and
  // only from State Pension age in the year
  if (statePensionEntered(head.statePension) && atStatePensionAge(head.age, year, statePension)) {
    amount('head.statePension', 'Your State Pension', head.statePension, limits.maxStatePension);
  }

  if (draft.hasPartner) {
    age('partner.age', "Your partner's age", partner.age);
    amount('partner.employmentIncome', "Your partner's salary", partner.employmentIncome, limits.maxAmount);
    amount(
      'partner.privatePensionIncome',
      "Your partner's private pension",
      partner.privatePensionIncome,
      limits.maxAmount,
      { optional: true },
    );
    if (statePensionEntered(partner.statePension) && atStatePensionAge(partner.age, year, statePension)) {
      amount('partner.statePension', "Your partner's State Pension", partner.statePension, limits.maxStatePension);
    }
  }

  if (draft.children.length > limits.maxChildren) {
    add('children.tooMany', 'children', `At most ${limits.maxChildren} children can be entered.`);
  }
  draft.children.forEach((child, index) => {
    const path = `children[${index}].age`;
    const label = `Child ${index + 1}'s age`;
    if (child.age === null || child.age === undefined) add(`${path}.required`, path, `${label} is required.`);
    else if (!isWhole(child.age)) add(`${path}.notWhole`, path, `${label} must be a whole number of years.`);
    else if (child.age < limits.childAge.min) add(`${path}.negative`, path, `${label} cannot be negative.`);
    else if (child.age > limits.childAge.max) add(`${path}.tooOld`, path, UK_CHILD_AGE_MESSAGE);
  });

  if (isRenting(draft.tenure)) {
    amount('monthlyRent', 'Rent', draft.monthlyRent, limits.maxMonthlyRent, { optional: true });
  }
  if (draft.children.length > 0) {
    amount('monthlyChildcare', 'Childcare', draft.monthlyChildcare, limits.maxMonthlyChildcare);
  }
  amount('spending.petrol', 'Petrol spending', draft.spending?.petrol, limits.maxSpending);
  amount('spending.diesel', 'Diesel spending', draft.spending?.diesel, limits.maxSpending);
  amount('spending.electricity', 'Electricity spending', draft.spending?.electricity, limits.maxSpending, {
    optional: true,
  });

  if (issues.length === 0) {
    return { ok: true, issues: [] as never[] };
  }
  return { ok: false, issues };
}

export function isComplete(draft: UKHouseholdDraft, options: UKValidateOptions): boolean {
  return validate(draft, options).ok;
}
