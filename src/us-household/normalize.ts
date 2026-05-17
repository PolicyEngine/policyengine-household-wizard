import { resolveCountyCode } from './counties';
import { getStateFromZip, isUSStateCode } from './states';
import { DEFAULT_HOUSEHOLD_YEAR, createBlankDraft } from './draft';
import type {
  USHouseholdDraft,
  USMaritalStatus,
  USPersonDraft,
  USPersonKind,
} from './types';

/**
 * Map a legacy filing status to marital status. This is intentionally
 * one-directional: the shared draft only carries marital status because the
 * issue calls out asking users marital status (not filing status) in UI.
 */
function filingStatusToMaritalStatus(value: unknown): USMaritalStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.toLowerCase();
  if (normalized.includes('married') && !normalized.includes('separately')) {
    return 'married';
  }
  if (normalized === 'married_jointly' || normalized === 'married_separately') {
    return 'married';
  }
  if (normalized === 'mfj' || normalized === 'mfs') {
    return 'married';
  }
  if (
    normalized === 'single' ||
    normalized === 'head_of_household' ||
    normalized === 'hoh' ||
    normalized === 'widowed' ||
    normalized === 'qualifying_widower' ||
    normalized === 'qualifying_widow_widower'
  ) {
    return 'single';
  }
  return null;
}

interface LegacyPerson {
  age?: number | string | null;
  kind?: USPersonKind | 'child';
  isDisabled?: boolean;
  is_disabled?: boolean;
  isBlind?: boolean;
  is_blind?: boolean;
  isFullTimeStudent?: boolean;
  is_full_time_student?: boolean;
  isPregnant?: boolean;
  is_pregnant?: boolean;
  needsCare?: boolean;
  is_incapable_of_self_care?: boolean;
  earned_income?: number;
  employment_income?: number;
  employmentIncome?: number;
  self_employment_income_annual?: number;
  ssi_amount?: number;
  ssdi_amount?: number;
  ssiAmount?: number;
  ssdiAmount?: number;
  social_security_annual?: number;
}

interface LegacyDraftShape {
  state?: string | null;
  county?: string | null;
  zip?: string | null;
  zipCode?: string | null;
  maritalStatus?: string | null;
  marital_status?: string | null;
  filingStatus?: string | null;
  filing_status?: string | null;
  people?: LegacyPerson[];
  childAges?: Array<number | string | null>;
  child_ages?: Array<number | string | null>;
  age?: number | string | null;
  partnerAge?: number | string | null;
  spouseAge?: number | string | null;
  year?: number;
}

function coerceAge(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return null;
}

function coerceNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Boolean(value);
}

function normalizePerson(
  legacy: LegacyPerson,
  ordinal: number,
  kind: USPersonKind,
): USPersonDraft {
  const id =
    kind === 'adult' ? `adult-${ordinal}` : `dependent-${ordinal}`;
  return {
    id,
    kind,
    age: coerceAge(legacy.age),
    isDisabled: coerceBoolean(legacy.isDisabled ?? legacy.is_disabled),
    isBlind: coerceBoolean(legacy.isBlind ?? legacy.is_blind),
    isFullTimeStudent: coerceBoolean(
      legacy.isFullTimeStudent ?? legacy.is_full_time_student,
    ),
    isPregnant: coerceBoolean(legacy.isPregnant ?? legacy.is_pregnant),
    needsCare: coerceBoolean(legacy.needsCare ?? legacy.is_incapable_of_self_care),
    employmentIncome:
      coerceNumber(legacy.employmentIncome) ??
      coerceNumber(legacy.employment_income) ??
      coerceNumber(legacy.earned_income),
    selfEmploymentIncome: coerceNumber(legacy.self_employment_income_annual),
    ssiAmount: coerceNumber(legacy.ssiAmount ?? legacy.ssi_amount),
    ssdiAmount: coerceNumber(legacy.ssdiAmount ?? legacy.ssdi_amount),
    socialSecurityIncome: coerceNumber(legacy.social_security_annual),
  };
}

/**
 * Best-effort normalization from legacy household shapes (cliff-watch's people
 * array, Coverage Compass's flat fields, ad-hoc test fixtures) into the shared
 * draft contract. Unknown fields are dropped silently; apps that need to keep
 * extras should hand-edit the result.
 */
export function normalizeLegacyDraft(
  raw: unknown,
  options: { year?: number } = {},
): USHouseholdDraft {
  if (!raw || typeof raw !== 'object') {
    return createBlankDraft(options.year);
  }
  const legacy = raw as LegacyDraftShape;
  const draft = createBlankDraft(options.year ?? legacy.year ?? DEFAULT_HOUSEHOLD_YEAR);

  // Location.
  if (typeof legacy.state === 'string' && isUSStateCode(legacy.state)) {
    draft.state = legacy.state;
  } else if (legacy.zipCode || legacy.zip) {
    const derived = getStateFromZip(legacy.zip ?? legacy.zipCode ?? null);
    if (derived) {
      draft.state = derived;
    }
  }
  draft.zip = legacy.zip ?? legacy.zipCode ?? null;

  if (legacy.county) {
    draft.county = resolveCountyCode(draft.state, legacy.county);
  }

  // Marital status — prefer explicit, fall back to filing status mapping.
  const explicit =
    legacy.maritalStatus ?? legacy.marital_status ?? null;
  if (typeof explicit === 'string') {
    const lower = explicit.toLowerCase();
    if (lower === 'married' || lower === 'unmarried' || lower === 'single') {
      draft.maritalStatus = lower === 'married' ? 'married' : 'single';
    } else {
      draft.maritalStatus = filingStatusToMaritalStatus(explicit);
    }
  } else {
    const filing = legacy.filingStatus ?? legacy.filing_status;
    draft.maritalStatus = filingStatusToMaritalStatus(filing);
  }

  // People — accept either a people array or coverage-compass-style flat fields.
  if (Array.isArray(legacy.people) && legacy.people.length > 0) {
    let adultCount = 0;
    let dependentCount = 0;
    draft.people = legacy.people.map((legacyPerson) => {
      const kind = legacyPerson.kind === 'child' ? 'dependent' : legacyPerson.kind ?? 'adult';
      if (kind === 'adult') {
        adultCount += 1;
        return normalizePerson(legacyPerson, adultCount, 'adult');
      }
      dependentCount += 1;
      return normalizePerson(legacyPerson, dependentCount, 'dependent');
    });
  } else {
    const adults: USPersonDraft[] = [];
    if (legacy.age !== undefined && legacy.age !== null) {
      adults.push({
        id: 'adult-1',
        kind: 'adult',
        age: coerceAge(legacy.age),
      });
    }
    const partnerAge = legacy.partnerAge ?? legacy.spouseAge;
    if (draft.maritalStatus === 'married' && partnerAge !== undefined && partnerAge !== null) {
      adults.push({
        id: 'adult-2',
        kind: 'adult',
        age: coerceAge(partnerAge),
      });
    }
    const dependents: USPersonDraft[] = [];
    const childAges = legacy.childAges ?? legacy.child_ages;
    if (Array.isArray(childAges)) {
      childAges.forEach((childAge, index) => {
        dependents.push({
          id: `dependent-${index + 1}`,
          kind: 'dependent',
          age: coerceAge(childAge),
        });
      });
    }
    draft.people = [...adults, ...dependents];
  }

  // If marital status is married but only one adult, add a partner with blank
  // age so the wizard can prompt for it. If single but extra adults, trim.
  const adults = draft.people.filter((person) => person.kind === 'adult');
  if (draft.maritalStatus === 'married' && adults.length < 2) {
    draft.people = [
      ...draft.people,
      { id: 'adult-2', kind: 'adult', age: null },
    ];
  } else if (draft.maritalStatus === 'single' && adults.length > 1) {
    const [keep] = adults;
    const dependents = draft.people.filter((person) => person.kind === 'dependent');
    draft.people = [keep, ...dependents];
  }

  return draft;
}
