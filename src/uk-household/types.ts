export type { ValidationIssue, ValidationResult } from '../validation';

/**
 * policyengine-uk's `Region` codes: the nine English regions, Wales, Scotland
 * and Northern Ireland (its `UNKNOWN` is left out).
 */
export type UKRegion =
  | 'NORTH_EAST'
  | 'NORTH_WEST'
  | 'YORKSHIRE'
  | 'EAST_MIDLANDS'
  | 'WEST_MIDLANDS'
  | 'EAST_OF_ENGLAND'
  | 'LONDON'
  | 'SOUTH_EAST'
  | 'SOUTH_WEST'
  | 'WALES'
  | 'SCOTLAND'
  | 'NORTHERN_IRELAND';

/** policyengine-uk's `TenureType` codes. The first three are renting. */
export type UKTenure =
  | 'RENT_PRIVATELY'
  | 'RENT_FROM_COUNCIL'
  | 'RENT_FROM_HA'
  | 'OWNED_WITH_MORTGAGE'
  | 'OWNED_OUTRIGHT';

/** policyengine-uk's `StudentLoanPlan` codes. */
export type UKStudentLoanPlan = 'NONE' | 'PLAN_1' | 'PLAN_2' | 'PLAN_4' | 'PLAN_5' | 'POSTGRADUATE';

/**
 * policyengine-uk's `CouncilTaxBand` codes; band I is Wales's. Northern
 * Ireland has domestic rates instead, and the household impact API estimates
 * no Council Tax there.
 */
export type UKCouncilTaxBand = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';

/**
 * One adult's answers. Amounts are pounds a year.
 *
 * Ages are in the policy year being calculated: a calculation for 2028-29
 * takes the age then, and does not age anyone from another year. Employment
 * income is the other way round: it is entered for the draft's `salaryYear`
 * and grown from there.
 */
export interface UKAdultDraft {
  /** Age in whole years in the policy year. `null` means not answered. */
  age: number | null;
  /** Gross earnings from employment in the draft's `salaryYear`. */
  employmentIncome: number;
  /**
   * Private and workplace pensions in payment, before tax, not counting the
   * State Pension. `null` or left out means none.
   */
  privatePensionIncome?: number | null;
  /**
   * The State Pension in the policy year (not grown like earnings). `null`
   * means the full new State Pension for that year. Calculations read it only
   * from State Pension age in the policy year (`atStatePensionAge`).
   */
  statePension: number | null;
  /** App-controlled fields; the shared adapters ignore them. */
  extras?: Record<string, unknown>;
}

/**
 * The household's head: the person answering ("you"). The dashboard's form
 * asks these for the head only, so they are not on the partner (the
 * household impact API also takes a partner's student loan plan; the request
 * leaves it out, so the API's default, `NONE`, applies).
 */
export interface UKHeadDraft extends UKAdultDraft {
  studentLoanPlan: UKStudentLoanPlan;
  /** Pension contributions made by salary sacrifice. */
  salarySacrificePensionContributions: number;
  dividendIncome: number;
  savingsInterestIncome: number;
  /** Net income from property (rent received). */
  propertyIncome: number;
}

export interface UKChildDraft {
  /**
   * Age in whole years in the policy year. policyengine-uk counts a child
   * under 16 as a dependant, and a 16- to 19-year-old only in full-time
   * non-advanced education (`inEducation`). Someone of 20 or over is not a
   * child for Child Benefit or Universal Credit; `validate()` refuses them.
   */
  age: number | null;
  /**
   * From 16 to 19: whether they are in full-time non-advanced education
   * (school or college, not university or an apprenticeship). Anything but
   * `false`, including leaving it out, counts as yes. Not read under 16.
   */
  inEducation?: boolean;
  extras?: Record<string, unknown>;
}

/** Household spending, pounds a year. */
export interface UKHouseholdSpending {
  petrol: number;
  diesel: number;
  /**
   * Domestic electricity, including VAT. `null` or left out means the
   * calculation's own default, the average UK household's
   * (`UK_DEFAULT_SPENDING.electricity`).
   */
  electricity?: number | null;
}

/**
 * A UK household: a head, an optional partner and their children, as one
 * benefit unit, plus where and how they live.
 *
 * The policy year is not part of the draft. Apps choose it apart from the
 * answers (the Autumn Budget dashboard's year pill reruns the same answers),
 * so `validate()` and the adapters take it as an option.
 */
export interface UKHouseholdDraft {
  /**
   * The year `employmentIncome` amounts are entered for. The household
   * impact API grows them to the policy year with the OBR average earnings
   * index, so this year must not be after the policy year.
   */
  salaryYear: number;
  /** `null` means not answered. */
  region: UKRegion | null;
  head: UKHeadDraft;
  /** Whether the head lives with a partner. */
  hasPartner: boolean;
  /**
   * The partner's answers. They are kept while `hasPartner` is false, so
   * turning it back on restores them; calculations read them only with a
   * partner.
   */
  partner: UKAdultDraft;
  /** Dependent children, in the order apps show them ("Child 1", ...). */
  children: UKChildDraft[];
  /** `null` means not answered. */
  tenure: UKTenure | null;
  /**
   * Rent a month, read only when renting. `null` means the region's average
   * private rent (`regionalRent`).
   */
  monthlyRent: number | null;
  /** `null` means not answered. */
  councilTaxBand: UKCouncilTaxBand | null;
  /**
   * Whether the household would claim Universal Credit if entitled. `null`
   * means not answered.
   */
  claimsUniversalCredit: boolean | null;
  /** Paid childcare a month, for all children together; read only with children. */
  monthlyChildcare: number;
  spending: UKHouseholdSpending;
  /** App-controlled household-level fields; the shared adapters ignore them. */
  extras?: Record<string, unknown>;
}
