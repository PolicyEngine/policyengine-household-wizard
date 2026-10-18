import { toAmount } from './amount';
import { isUSStateCode } from './states';
import { isCountyCode } from './counties';
import { toTippedOccupationCode } from './tippedOccupations';
import type {
  USHouseholdDraft,
  USPersonDraft,
  USPersonExpenses,
  ValidationIssue,
  ValidationResult,
} from './types';

const EXPENSE_LABELS: Readonly<Record<keyof USPersonExpenses, string>> = {
  charitableCashDonations: 'Charitable cash donations',
  mortgageInterest: 'Mortgage interest',
  realEstateTaxes: 'Real estate taxes',
};

/**
 * "adult 2" or "dependent 1": people are numbered within their kind, in draft
 * order, matching the labels apps show.
 */
function personLabel(people: USPersonDraft[], index: number): string {
  const { kind } = people[index];
  const ordinal = people.slice(0, index + 1).filter((person) => person.kind === kind).length;
  return `${kind} ${ordinal}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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

  // An `ssi` amount sent for one person stops PolicyEngine US from computing
  // SSI for everyone else. So the V1 adapter sends entered amounts only when
  // everyone has one (0 included), and the missing ones are asked for here.
  const someoneReceivesSsi = draft.people.some((person) => {
    const amount = toAmount(person.ssiAmount);
    return amount !== undefined && amount !== 0;
  });

  draft.people.forEach((person, index) => {
    const label = personLabel(draft.people, index);
    if (requireAges && (person.age === null || person.age === undefined)) {
      issues.push({
        code: 'person.age.required',
        path: `people[${index}].age`,
        message: `Age is required for ${label}.`,
      });
    }

    for (const [field, fieldLabel] of Object.entries(EXPENSE_LABELS)) {
      const amount = toAmount(person[field as keyof USPersonExpenses]);
      if (amount !== undefined && amount < 0) {
        issues.push({
          code: `person.${field}.negative`,
          path: `people[${index}].${field}`,
          message: `${fieldLabel} for ${label} cannot be negative.`,
        });
      }
    }

    const wages = toAmount(person.employmentIncome);
    if (wages !== undefined && wages < 0) {
      issues.push({
        code: 'person.employmentIncome.negative',
        path: `people[${index}].employmentIncome`,
        message: `Wages for ${label} cannot be negative.`,
      });
    }

    const tips = toAmount(person.tipIncome);
    if (tips !== undefined && tips < 0) {
      issues.push({
        code: 'person.tipIncome.negative',
        path: `people[${index}].tipIncome`,
        message: `Tips for ${label} cannot be negative.`,
      });
    }

    // The V1 adapter sends only listed codes and 0, so any other answer would
    // be dropped silently. Without an answer, the model reads 0 and tips get
    // no deduction; apps that do not ask about the deduction can treat
    // `person.tippedOccupationCode.requiredWithTips` as a warning.
    const occupationCode = person.tippedOccupationCode as unknown;
    const answeredOccupation =
      occupationCode !== undefined &&
      occupationCode !== null &&
      !(typeof occupationCode === 'string' && occupationCode.trim() === '');
    if (answeredOccupation && toTippedOccupationCode(occupationCode) === undefined) {
      issues.push({
        code: 'person.tippedOccupationCode.invalid',
        path: `people[${index}].tippedOccupationCode`,
        message: `Tipped occupation code ${String(occupationCode)} for ${label} is not on the Treasury list.`,
      });
    } else if (!answeredOccupation && tips !== undefined && tips > 0) {
      issues.push({
        code: 'person.tippedOccupationCode.requiredWithTips',
        path: `people[${index}].tippedOccupationCode`,
        message: `Tipped occupation is required for ${label} because they receive tips. Enter 0 if it is not on the Treasury list.`,
      });
    }

    if (someoneReceivesSsi && toAmount(person.ssiAmount) === undefined) {
      issues.push({
        code: 'person.ssiAmount.requiredWhenAnyReceives',
        path: `people[${index}].ssiAmount`,
        message: `SSI is required for ${label} because someone in the household receives SSI. Enter 0 if they receive none.`,
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
          message: `${capitalize(label)} is older than 23; confirm they qualify.`,
        });
      }
      if (person.kind === 'adult' && person.age < 14) {
        issues.push({
          code: 'person.age.adultTooYoung',
          path: `people[${index}].age`,
          message: `${capitalize(label)} is younger than 14.`,
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
