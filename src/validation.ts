/** One problem `validate()` found in a draft. Shared by the country models. */
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
