export type USMaritalStatus = 'single' | 'married';

/**
 * `'dependent'` means claimed as a tax dependent by someone in the household;
 * `'adult'` means not claimed. Choose it from the user's answer, not from age.
 * The V1 adapter sends it for every person as `is_tax_unit_dependent`. It puts
 * everyone in one tax unit, where PolicyEngine US makes the two oldest adults
 * head and spouse. Any other adult is then neither head, spouse nor
 * dependent, and their income counts in the unit's gross income.
 */
export type USPersonKind = 'adult' | 'dependent';

/**
 * Person-level fields that the wizard surfaces uniformly across apps. Apps that
 * do not collect a flag should leave it `undefined`. The V1 adapter sends only
 * `true` and `false`; for these flags `false` and `undefined` give the same
 * model results, and the difference matters to review screens and links.
 */
export interface USPersonFlags {
  isDisabled?: boolean;
  isBlind?: boolean;
  /**
   * Full-time student at any level. PolicyEngine US counts everyone aged 5 to
   * 17 as a K-12 student by age, so the V1 adapter sends this only from age 18,
   * as full-time college enrollment ("is_full_time_college_student"). Rules
   * for college students (for example SNAP's student rule and New Jersey's
   * exemption for dependents attending college) then count that person.
   */
  isFullTimeStudent?: boolean;
  isPregnant?: boolean;
  needsCare?: boolean;
}

/**
 * Annual amounts in dollars. Fields are additive, so an amount belongs in
 * exactly one field. Each field sets its own PolicyEngine US variable, except
 * that `pensionIncome` and `privatePensionIncome` share one and are summed,
 * and `tipIncome` is also added to wages.
 */
export interface USPersonIncomes {
  /**
   * Wages and salaries, not counting tips entered in `tipIncome`;
   * "employment_income" in PolicyEngine US.
   */
  employmentIncome?: number;
  /**
   * Tips received as an employee; "tip_income" in PolicyEngine US.
   * PolicyEngine US counts tips as part of wages (`employment_income` is
   * wages "including tips and commissions"), and income and payroll taxes
   * read `employment_income`. A few rules read `tip_income` on its own, such
   * as the federal deduction for qualified tips (2025-2028) and Georgia's cash
   * tip exclusion. So the V1 adapter sends these tips both as `tip_income` and
   * added to `employment_income`. Tips can count for the deduction only with a
   * listed `tippedOccupationCode`. A self-employed worker's tips belong in
   * `selfEmploymentIncome`, which the adapter does not send as `tip_income`.
   */
  tipIncome?: number;
  /** "self_employment_income" in PolicyEngine US. */
  selfEmploymentIncome?: number;
  /**
   * Social Security retirement benefits; "social_security_retirement" in
   * PolicyEngine US. Put SSDI in `ssdiAmount`, not here: the model adds the two
   * to get total Social Security. Survivors or dependents benefits entered here
   * count as retirement benefits.
   */
  socialSecurityIncome?: number;
  /**
   * Reported Supplemental Security Income; "ssi" in PolicyEngine US. It
   * replaces the model's own SSI calculation, and that works for a whole
   * household only: an `ssi` input for one person would stop the model from
   * computing everyone else's. So the V1 adapter sends amounts only when every
   * person has one, and `validate()` asks for the missing ones. Enter 0 for a
   * person who receives none; a 0 is always sent, as
   * "takes_up_ssi_if_eligible" false. Leave it blank to let the model compute
   * a person's SSI.
   */
  ssiAmount?: number;
  /** Social Security Disability Insurance; "social_security_disability" in PolicyEngine US. */
  ssdiAmount?: number;
  /**
   * Taxable pension income whose source the user did not give. The V1 adapter
   * adds it to `privatePensionIncome`. Some states' rules in PolicyEngine US
   * apply only to government pensions (for example, Arizona's public pension
   * exclusion and Minnesota's public pension subtraction), so ask for
   * `publicPensionIncome` when the app can. The adapter never sets the
   * `taxable_pension_income` total: that would leave both components at zero,
   * so rules that read either component would see nothing.
   */
  pensionIncome?: number;
  /**
   * Taxable pension income from a government employer;
   * "taxable_public_pension_income" in PolicyEngine US. PolicyEngine US also
   * has a separate `taxable_federal_pension_income` input, read by West
   * Virginia's public pension subtraction and (from 2.6.14) Indiana's civil
   * service annuity deduction; the adapter does not set it.
   */
  publicPensionIncome?: number;
  /**
   * Taxable pension income from a non-government employer;
   * "taxable_private_pension_income" in PolicyEngine US.
   */
  privatePensionIncome?: number;
  /** Qualified dividends; "qualified_dividend_income" in PolicyEngine US. */
  dividendIncome?: number;
  /**
   * Ordinary dividends that are not qualified;
   * "non_qualified_dividend_income" in PolicyEngine US. Form 1099-DIV's
   * ordinary dividends (box 1a) are the sum of this and `dividendIncome`
   * (box 1b).
   */
  nonQualifiedDividendIncome?: number;
  /**
   * Net gains on assets held one year or less, negative for a net loss;
   * "short_term_capital_gains" in PolicyEngine US.
   */
  shortTermCapitalGains?: number;
  /**
   * Net gains on assets held more than one year, negative for a net loss;
   * "long_term_capital_gains" in PolicyEngine US. That variable is computed as
   * gains before behavioral responses plus the response, and PolicyEngine US's
   * Simulation moves an input on it onto
   * `long_term_capital_gains_before_response`, as it does for wages.
   */
  longTermCapitalGains?: number;
  taxableInterestIncome?: number;
  rentalIncome?: number;
  unemploymentCompensation?: number;
  childSupportReceived?: number;
  miscellaneousIncome?: number;
}

/**
 * Annual amounts paid, in dollars, that PolicyEngine US deducts or credits.
 * Each field sets one PolicyEngine US input variable. Federal deductions sum
 * the tax unit's amounts, so an app that asks about a shared expense once can
 * put it on one adult, ideally the one who pays it or owns the home. Some
 * state rules read a person's own amount: Montana caps real estate taxes per
 * person, and homestead or elderly property tax reductions in Kentucky, Ohio,
 * South Carolina, Mississippi and Tennessee read the owner's (Kentucky) or the
 * head's or spouse's real estate taxes.
 */
export interface USPersonExpenses {
  /** Gifts of cash to charity; "charitable_cash_donations" in PolicyEngine US. */
  charitableCashDonations?: number;
  /**
   * Interest paid on a home mortgage; "home_mortgage_interest" in PolicyEngine
   * US. Not "mortgage_interest": that is a computed total of deductible and
   * non-deductible interest, and the federal interest deduction ignores an
   * input on it.
   */
  mortgageInterest?: number;
  /** Real estate (property) taxes paid; "real_estate_taxes" in PolicyEngine US. */
  realEstateTaxes?: number;
}

/** Work details that rules read alongside income. */
export interface USPersonOccupation {
  /**
   * Treasury Tipped Occupation Code for the occupation in which the person
   * received `tipIncome` (see `TIPPED_OCCUPATIONS`), or 0 if it is not a
   * listed occupation; "treasury_tipped_occupation_code" in PolicyEngine US.
   * Only tips from a listed occupation qualify for the federal deduction for
   * qualified tips. Leave it unset if the user was not asked: PolicyEngine US
   * then reads 0, so tips get no deduction.
   */
  tippedOccupationCode?: number;
}

export interface USPersonDraft
  extends USPersonFlags,
    USPersonIncomes,
    USPersonExpenses,
    USPersonOccupation {
  /** Stable identifier — used as the person key in the API payload. */
  id: string;
  kind: USPersonKind;
  /** Age in whole years. `null` means the user has not entered a value yet. */
  age: number | null;
  /** Optional human-friendly label for review screens. */
  label?: string;
  /**
   * App-controlled fields the wizard core does not understand. Adapters that
   * own the app's payload can read this map; the shared US adapters ignore it.
   */
  extras?: Record<string, unknown>;
}

export interface USHouseholdDraft {
  /** Two-letter state code (e.g. "CA"). `null` means the user has not picked. */
  state: string | null;
  /** PolicyEngine county enum code (e.g. "ALAMEDA_COUNTY_CA"). */
  county: string | null;
  /** Optional ZIP code captured at intake. Used to derive `state` when set. */
  zip: string | null;
  /**
   * Marital status — explicitly NOT filing status. Apps that need a filing
   * status must derive it (e.g. from presence of dependents).
   */
  maritalStatus: USMaritalStatus | null;
  /**
   * People in the household. Adults and dependents share the same shape; kind
   * differentiates them. Order is significant for UI labels ("Adult 1", etc.).
   */
  people: USPersonDraft[];
  /** Year the household is being modeled for. */
  year: number;
  /** App-controlled household-level fields ignored by the shared adapters. */
  extras?: Record<string, unknown>;
}

export interface ValidationIssue {
  /** Stable identifier for the rule (e.g. "state.required"). */
  code: string;
  /** Path into the draft (dotted), e.g. "state" or "people[1].age". */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; issues: never[] }
  | { ok: false; issues: ValidationIssue[] };
