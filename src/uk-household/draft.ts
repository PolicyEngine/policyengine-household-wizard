import { UK_NEW_CHILD_AGE } from './children';
import { UK_DEFAULT_SALARY, UK_DEFAULT_SPENDING, UK_SALARY_YEAR } from './defaults';
import type { UKAdultDraft, UKChildDraft, UKHeadDraft, UKHouseholdDraft } from './types';

/**
 * A draft with nothing chosen: no region, ages, tenure, Council Tax band or
 * Universal Credit answer, no partner or children, and amounts at zero. The
 * app must capture each unanswered field before `validate()` accepts it.
 * Rent, the State Pension and electricity start at their "left as prefilled"
 * value (`null`).
 */
export function createBlankDraft(salaryYear: number = UK_SALARY_YEAR): UKHouseholdDraft {
  return {
    salaryYear,
    region: null,
    head: {
      age: null,
      employmentIncome: 0,
      privatePensionIncome: 0,
      statePension: null,
      studentLoanPlan: 'NONE',
      salarySacrificePensionContributions: 0,
      dividendIncome: 0,
      savingsInterestIncome: 0,
      propertyIncome: 0,
    },
    hasPartner: false,
    partner: { age: null, employmentIncome: 0, privatePensionIncome: 0, statePension: null },
    children: [],
    tenure: null,
    monthlyRent: null,
    councilTaxBand: null,
    claimsUniversalCredit: null,
    monthlyChildcare: 0,
    spending: { petrol: 0, diesel: 0, electricity: null },
  };
}

/**
 * A draft with every answer at a typical value: the Autumn Budget 2026
 * dashboard's starting answers. The salary, rent and spending are statistics
 * (`UK_DEFAULT_SOURCES`); the rest are the dashboard's choices:
 * - a single adult of 30 (and, if a partner is added, a partner of 30 on the
 *   median salary) in the North West, renting privately at the region's
 *   average rent (`monthlyRent: null`);
 * - no student loan: policyengine-uk's repayment depends on the plan and
 *   income alone (the balance only caps a year's repayment);
 * - Council Tax band D, the band the dashboard suggests when unsure;
 * - claiming the Universal Credit the household is due;
 * - the full new State Pension at State Pension age (`statePension: null`);
 * - no other income, salary sacrifice, pensions or childcare.
 */
export function createTypicalDraft(salaryYear: number = UK_SALARY_YEAR): UKHouseholdDraft {
  return {
    salaryYear,
    region: 'NORTH_WEST',
    head: {
      age: 30,
      employmentIncome: UK_DEFAULT_SALARY,
      privatePensionIncome: 0,
      statePension: null,
      studentLoanPlan: 'NONE',
      salarySacrificePensionContributions: 0,
      dividendIncome: 0,
      savingsInterestIncome: 0,
      propertyIncome: 0,
    },
    hasPartner: false,
    partner: { age: 30, employmentIncome: UK_DEFAULT_SALARY, privatePensionIncome: 0, statePension: null },
    children: [],
    tenure: 'RENT_PRIVATELY',
    monthlyRent: null,
    councilTaxBand: 'D',
    claimsUniversalCredit: true,
    monthlyChildcare: 0,
    spending: {
      petrol: UK_DEFAULT_SPENDING.petrol,
      diesel: UK_DEFAULT_SPENDING.diesel,
      electricity: UK_DEFAULT_SPENDING.electricity,
    },
  };
}

const cloneExtras = (extras: Record<string, unknown> | undefined) =>
  extras ? { extras: structuredClone(extras) } : {};

/** A deep copy: changing it never changes the original. */
export function cloneDraft(draft: UKHouseholdDraft): UKHouseholdDraft {
  return {
    ...draft,
    head: { ...draft.head, ...cloneExtras(draft.head.extras) },
    partner: { ...draft.partner, ...cloneExtras(draft.partner.extras) },
    children: draft.children.map((child) => ({ ...child, ...cloneExtras(child.extras) })),
    spending: { ...draft.spending },
    ...cloneExtras(draft.extras),
  };
}

export function updateHead(draft: UKHouseholdDraft, changes: Partial<UKHeadDraft>): UKHouseholdDraft {
  return { ...draft, head: { ...draft.head, ...changes } };
}

export function updatePartner(draft: UKHouseholdDraft, changes: Partial<UKAdultDraft>): UKHouseholdDraft {
  return { ...draft, partner: { ...draft.partner, ...changes } };
}

export function addChild(draft: UKHouseholdDraft, child: Partial<UKChildDraft> = {}): UKHouseholdDraft {
  return { ...draft, children: [...draft.children, { age: null, ...child }] };
}

export function removeChild(draft: UKHouseholdDraft, index: number): UKHouseholdDraft {
  return { ...draft, children: draft.children.filter((_, i) => i !== index) };
}

export function updateChild(
  draft: UKHouseholdDraft,
  index: number,
  changes: Partial<UKChildDraft>,
): UKHouseholdDraft {
  return {
    ...draft,
    children: draft.children.map((child, i) => (i === index ? { ...child, ...changes } : child)),
  };
}

/**
 * Keep the first `count` children, or add children of `newChildAge` until
 * there are `count`. A form with a "number of children" question uses this.
 */
export function setChildCount(
  draft: UKHouseholdDraft,
  count: number,
  newChildAge: number = UK_NEW_CHILD_AGE,
): UKHouseholdDraft {
  const children = draft.children.slice(0, Math.max(0, count));
  while (children.length < count) children.push({ age: newChildAge });
  return { ...draft, children };
}
