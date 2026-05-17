export type USMaritalStatus = 'single' | 'married';

export type USPersonKind = 'adult' | 'dependent';

/**
 * Person-level fields that the wizard surfaces uniformly across apps. Apps that
 * do not collect a flag should leave it `undefined`; the adapters treat
 * `undefined` differently from `false` (omitted vs. explicitly set).
 */
export interface USPersonFlags {
  isDisabled?: boolean;
  isBlind?: boolean;
  isFullTimeStudent?: boolean;
  isPregnant?: boolean;
  needsCare?: boolean;
}

export interface USPersonIncomes {
  /** Wages and salaries; "employment_income" in PolicyEngine US. */
  employmentIncome?: number;
  selfEmploymentIncome?: number;
  socialSecurityIncome?: number;
  ssiAmount?: number;
  ssdiAmount?: number;
  pensionIncome?: number;
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
