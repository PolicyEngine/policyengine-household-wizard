export type USMaritalStatus = 'single' | 'married';

/**
 * `'dependent'` means claimed as a tax dependent by someone in the household;
 * `'adult'` means not claimed. Choose it from the user's answer, not from age.
 * The V1 adapter sends it for every person as `is_tax_unit_dependent`.
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
 * that `pensionIncome` and `privatePensionIncome` share one and are summed.
 */
export interface USPersonIncomes {
  /** Wages and salaries; "employment_income" in PolicyEngine US. */
  employmentIncome?: number;
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
  /** "qualified_dividend_income" in PolicyEngine US. */
  dividendIncome?: number;
  taxableInterestIncome?: number;
  rentalIncome?: number;
  unemploymentCompensation?: number;
  childSupportReceived?: number;
  miscellaneousIncome?: number;
}

export interface USPersonDraft extends USPersonFlags, USPersonIncomes {
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
