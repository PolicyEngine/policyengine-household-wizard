import { isUSStateCode } from './states';
import { isCountyCode } from './counties';
import type { USHouseholdDraft, ValidationIssue, ValidationResult } from './types';

export interface ValidateOptions {
  /**
   * If true, require a county selection in addition to state. Apps where the
   * county affects results (e.g. local taxes) can opt into this.
   */
  requireCounty?: boolean;
  /** If true, require every person to have an age set. Defaults to true. */
  requireAges?: boolean;
}

export function validate(
  draft: USHouseholdDraft,
  options: ValidateOptions = {},
): ValidationResult {
  const { requireCounty = false, requireAges = true } = options;
  const issues: ValidationIssue[] = [];

  if (!draft.state) {
    issues.push({
      code: 'state.required',
      path: 'state',
      message: 'State is required.',
    });
  } else if (!isUSStateCode(draft.state)) {
    issues.push({
      code: 'state.invalid',
      path: 'state',
      message: `Unknown state code "${draft.state}".`,
    });
  }

  if (requireCounty && !draft.county) {
    issues.push({
      code: 'county.required',
      path: 'county',
      message: 'County is required.',
    });
  } else if (draft.county && !isCountyCode(draft.county)) {
    issues.push({
      code: 'county.invalid',
      path: 'county',
      message: `Unknown county code "${draft.county}".`,
    });
  }

  if (!draft.maritalStatus) {
    issues.push({
      code: 'maritalStatus.required',
      path: 'maritalStatus',
      message: 'Marital status is required.',
    });
  }

  const adults = draft.people.filter((person) => person.kind === 'adult');
  if (adults.length === 0) {
    issues.push({
      code: 'people.adults.required',
      path: 'people',
      message: 'At least one adult is required.',
    });
  }

  if (draft.maritalStatus === 'married' && adults.length < 2) {
    issues.push({
      code: 'people.adults.marriedRequiresTwo',
      path: 'people',
      message: 'Married households need two adults.',
    });
  }

  draft.people.forEach((person, index) => {
    if (requireAges && (person.age === null || person.age === undefined)) {
      issues.push({
        code: 'person.age.required',
        path: `people[${index}].age`,
        message: `Age is required for ${person.kind === 'adult' ? `adult ${index + 1}` : `dependent ${index + 1}`}.`,
      });
    }

    if (person.age !== null && person.age !== undefined) {
      if (!Number.isFinite(person.age) || person.age < 0 || person.age > 120) {
        issues.push({
          code: 'person.age.outOfRange',
          path: `people[${index}].age`,
          message: 'Age must be between 0 and 120.',
        });
      }
      if (person.kind === 'dependent' && person.age >= 24) {
        // PolicyEngine's tax dependent definition tops out around 24; flag
        // older dependents so the app can ask the user to confirm. We only
        // warn, not fail; some state benefit rules accept older dependents.
        // This issue is reported with a distinct code so apps can downgrade.
        issues.push({
          code: 'person.age.dependentTooOld',
          path: `people[${index}].age`,
          message: `Dependent ${index + 1} is older than 23; confirm they qualify.`,
        });
      }
      if (person.kind === 'adult' && person.age < 14) {
        issues.push({
          code: 'person.age.adultTooYoung',
          path: `people[${index}].age`,
          message: `Adult ${index + 1} is younger than 14.`,
        });
      }
    }
  });

  if (!Number.isFinite(draft.year) || draft.year < 1900 || draft.year > 2200) {
    issues.push({
      code: 'year.invalid',
      path: 'year',
      message: `Year ${draft.year} is out of range.`,
    });
  }

  if (issues.length === 0) {
    return { ok: true, issues: [] as never[] };
  }
  return { ok: false, issues };
}

export function isComplete(draft: USHouseholdDraft, options: ValidateOptions = {}): boolean {
  return validate(draft, options).ok;
}
