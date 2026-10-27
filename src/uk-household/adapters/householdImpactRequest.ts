import { asksEducation } from '../children';
import { isRenting } from '../codes';
import { UK_DEFAULT_SPENDING, regionalRent } from '../defaults';
import {
  atStatePensionAge,
  statePensionEntered,
  type UKStatePensionTable,
} from '../statePension';
import { UK_HOUSEHOLD_LIMITS } from '../validate';
import type { UKHouseholdDraft } from '../types';

/**
 * The request body of the Autumn Budget 2026 dashboard's household impact
 * API (`POST /api/household-impact`, `HouseholdImpactRequest` in
 * PolicyEngine/uk-autumn-budget-dashboard-2026's src/uk_budget_data/api.py).
 * The API refuses unknown fields with a 422, and reads the `partner_*`
 * fields only when `has_partner` is true.
 */
export interface HouseholdImpactChild {
  age: number;
  /** Sent from 16 to 19 only. */
  in_education?: boolean;
}

export interface HouseholdImpactHousehold {
  age: number;
  employment_income: number;
  has_partner: boolean;
  /** Left out without a partner when the draft's is not an age the API takes. */
  partner_age?: number;
  partner_employment_income: number;
  children: HouseholdImpactChild[];
  region: string;
  claims_universal_credit: boolean;
  tenure: string;
  monthly_rent: number;
  dividend_income: number;
  savings_interest_income: number;
  private_pension_income: number;
  partner_private_pension_income: number;
  property_income: number;
  petrol_spending: number;
  diesel_spending: number;
  electricity_spending: number;
  salary_sacrifice_pension_contributions: number;
  student_loan_plan: string;
  council_tax_band: string;
  monthly_childcare: number;
  salary_year: number;
  state_pension?: number;
  partner_state_pension?: number;
}

/** The slower parts of a calculation, asked for apart from the headline. */
export type HouseholdImpactPart = 'by_policy' | 'sweep';

export interface HouseholdImpactRequest {
  year: number;
  policies: string[];
  household: HouseholdImpactHousehold;
  include: HouseholdImpactPart[];
}

export interface ToHouseholdImpactRequestOptions {
  /** The policy year (2027 is 2027-28). */
  year: number;
  /**
   * The measures to compare the household under, sent as given: at least
   * one, each an id the API knows (it refuses an empty list and an unknown
   * id).
   */
  policies: readonly string[];
  /** The slower parts to compute besides the headline; none by default. */
  include?: readonly HouseholdImpactPart[];
  /** State Pension ages by year; left out, `UK_STATE_PENSION`. */
  statePension?: UKStatePensionTable;
}

const { adultAge } = UK_HOUSEHOLD_LIMITS;

/** An age the API's `partner_age` field takes: a whole number from 16 to 100. */
const isAcceptedAge = (age: unknown) =>
  typeof age === 'number' && Number.isInteger(age) && age >= adultAge.min && age <= adultAge.max;

/**
 * The household impact API's request for a draft.
 *
 * Answers go as they are, so `validate()` first: the API refuses what it
 * flags. The rules the request applies:
 * - the partner's salary and pension are sent only with a partner, as 0
 *   otherwise. The partner's age is sent even without one, as the dashboard
 *   always has (the API reads it only with a partner); without a partner, an
 *   age the API would refuse (unanswered, or not a whole number from 16 to
 *   100) is left out, so it cannot fail a single person's request;
 * - children from 16 to 19 carry whether they are in full-time non-advanced
 *   education, yes unless answered `false`;
 * - rent only when renting, as entered or else the region's average private
 *   rent; 0 otherwise;
 * - childcare only with children; 0 otherwise;
 * - a private pension left out is 0, and electricity left out is the
 *   average household's (`UK_DEFAULT_SPENDING.electricity`);
 * - a State Pension only as entered and at State Pension age in `year`;
 *   left as prefilled (`null`), the API uses the full new State Pension.
 *
 * The keys come in a fixed order, so `JSON.stringify` of two requests for
 * the same answers gives the same text (apps key caches on it).
 */
export function toHouseholdImpactRequest(
  draft: UKHouseholdDraft,
  { year, policies, include = [], statePension }: ToHouseholdImpactRequestOptions,
): HouseholdImpactRequest {
  const { head, partner, hasPartner } = draft;
  const children = draft.children.map((child) =>
    asksEducation(child.age)
      ? { age: child.age as number, in_education: child.inEducation !== false }
      : { age: child.age as number },
  );
  const renting = isRenting(draft.tenure);
  return {
    year,
    policies: [...policies],
    household: {
      age: head.age as number,
      employment_income: head.employmentIncome,
      has_partner: Boolean(hasPartner),
      ...(hasPartner || isAcceptedAge(partner.age) ? { partner_age: partner.age as number } : {}),
      partner_employment_income: hasPartner ? partner.employmentIncome : 0,
      children,
      region: draft.region as string,
      claims_universal_credit: Boolean(draft.claimsUniversalCredit),
      tenure: draft.tenure as string,
      monthly_rent: renting ? monthlyRentFor(draft) : 0,
      dividend_income: head.dividendIncome,
      savings_interest_income: head.savingsInterestIncome,
      private_pension_income: head.privatePensionIncome ?? 0,
      partner_private_pension_income: hasPartner ? (partner.privatePensionIncome ?? 0) : 0,
      property_income: head.propertyIncome,
      petrol_spending: draft.spending.petrol,
      diesel_spending: draft.spending.diesel,
      electricity_spending: draft.spending.electricity ?? UK_DEFAULT_SPENDING.electricity,
      salary_sacrifice_pension_contributions: head.salarySacrificePensionContributions,
      student_loan_plan: head.studentLoanPlan,
      council_tax_band: draft.councilTaxBand as string,
      monthly_childcare: children.length ? draft.monthlyChildcare : 0,
      salary_year: draft.salaryYear,
      ...(statePensionEntered(head.statePension) && atStatePensionAge(head.age, year, statePension)
        ? { state_pension: head.statePension }
        : {}),
      ...(hasPartner &&
      statePensionEntered(partner.statePension) &&
      atStatePensionAge(partner.age, year, statePension)
        ? { partner_state_pension: partner.statePension }
        : {}),
    },
    include: [...include],
  };
}

/** The rent a month: as entered, else the region's average private rent. */
export function monthlyRentFor(draft: Pick<UKHouseholdDraft, 'monthlyRent' | 'region'>): number {
  return typeof draft.monthlyRent === 'number' && Number.isFinite(draft.monthlyRent)
    ? draft.monthlyRent
    : regionalRent(draft.region);
}
