import type {
  USHouseholdDraft,
  USPersonDraft,
  USPersonFlags,
  USPersonIncomes,
} from '../types';

/**
 * The shape of a PolicyEngine US "situation" / household-creation payload at
 * the wire level. Variables are year-keyed; person/group keys are arbitrary
 * strings (callers pick them).
 */
export type V1ValueMap = Record<string, number | string | boolean | null>;
export type V1FieldValue = V1ValueMap | string[] | undefined;

/**
 * A person record carries only year-keyed variable maps. `members` belongs on
 * group records, never on people.
 */
export type V1PersonRecord = Record<string, V1ValueMap | undefined>;

/**
 * A group record always carries `members` plus zero-or-more year-keyed
 * variable maps.
 */
export type V1GroupRecord = { members: string[] } & Record<string, V1FieldValue>;

export type V1EntityRecord = V1PersonRecord | V1GroupRecord;
export type V1PersonCollection = Record<string, V1PersonRecord>;
export type V1GroupCollection = Record<string, V1GroupRecord>;
/** @deprecated Prefer V1PersonCollection or V1GroupCollection. */
export type V1EntityCollection = Record<string, V1EntityRecord>;

export interface V1HouseholdSituation {
  people: V1PersonCollection;
  families?: V1GroupCollection;
  marital_units?: V1GroupCollection;
  tax_units?: V1GroupCollection;
  spm_units?: V1GroupCollection;
  households?: V1GroupCollection;
}

/**
 * Matches policyengine-app-v2's `V1HouseholdCreateEnvelope` so `fromUSDraft`
 * adapters can pass the envelope straight into `Household.fromV1CreationPayload`.
 */
export interface V1HouseholdEnvelope {
  country_id: 'us';
  label?: string | null;
  data: V1HouseholdSituation;
}

export interface ToV1PayloadOptions {
  /**
   * Optional override for group keys. Defaults to short, lower-case keys
   * (`"household"`, `"tax_unit"`, etc.). Pass `"verbose"` for `"your household"`
   * style names compatible with app-v2's builder.
   */
  groupKeyStyle?: 'short' | 'verbose';
  /**
   * If true, attaches member ids to the marital unit. Off by default because
   * cliff-watch and other consumers send `marital_units: {}` and have it work.
   */
  includeMaritalUnit?: boolean;
  /**
   * Optional label for the envelope. Surfaces as `label` on the V1
   * creation/metadata response.
   */
  label?: string | null;
}

const SHORT_KEYS = {
  household: 'household',
  family: 'family',
  taxUnit: 'tax_unit',
  spmUnit: 'spm_unit',
  maritalUnit: 'marital_unit',
} as const;

const VERBOSE_KEYS = {
  household: 'your household',
  family: 'your family',
  taxUnit: 'your tax unit',
  spmUnit: 'your household', // app-v2 uses the same label for SPM unit
  maritalUnit: 'your marital unit',
} as const;

const FLAG_TO_VARIABLE: Record<keyof USPersonFlags, string> = {
  isDisabled: 'is_disabled',
  isBlind: 'is_blind',
  isFullTimeStudent: 'is_full_time_student',
  isPregnant: 'is_pregnant',
  needsCare: 'is_incapable_of_self_care',
};

const INCOME_TO_VARIABLE: Record<keyof USPersonIncomes, string> = {
  employmentIncome: 'employment_income',
  selfEmploymentIncome: 'self_employment_income',
  socialSecurityIncome: 'social_security',
  ssiAmount: 'ssi',
  ssdiAmount: 'social_security_disability',
  pensionIncome: 'taxable_pension_income',
  dividendIncome: 'qualified_dividend_income',
  taxableInterestIncome: 'taxable_interest_income',
  rentalIncome: 'rental_income',
  unemploymentCompensation: 'unemployment_compensation',
  childSupportReceived: 'child_support_received',
  miscellaneousIncome: 'miscellaneous_income',
};

function yearMap(year: string, value: number | string | boolean): V1ValueMap {
  return { [year]: value };
}

function buildPersonVariables(person: USPersonDraft, year: string): V1PersonRecord {
  const record: V1PersonRecord = {};

  if (person.age !== null && person.age !== undefined) {
    record.age = yearMap(year, person.age);
  }

  if (person.kind === 'dependent') {
    record.is_tax_unit_dependent = yearMap(year, true);
  }

  for (const [draftKey, variable] of Object.entries(FLAG_TO_VARIABLE)) {
    const value = (person as USPersonDraft)[draftKey as keyof USPersonFlags];
    if (value !== undefined) {
      record[variable] = yearMap(year, value);
    }
  }

  for (const [draftKey, variable] of Object.entries(INCOME_TO_VARIABLE)) {
    const value = (person as USPersonDraft)[draftKey as keyof USPersonIncomes];
    if (value !== undefined && value !== null) {
      record[variable] = yearMap(year, value);
    }
  }

  return record;
}

export function toV1HouseholdPayload(
  draft: USHouseholdDraft,
  options: ToV1PayloadOptions = {},
): V1HouseholdEnvelope {
  const { groupKeyStyle = 'short', includeMaritalUnit = false, label = null } = options;
  const keys = groupKeyStyle === 'verbose' ? VERBOSE_KEYS : SHORT_KEYS;
  const year = String(draft.year);

  const memberIds = draft.people.map((person) => person.id);

  const people: V1PersonCollection = {};
  for (const person of draft.people) {
    people[person.id] = buildPersonVariables(person, year);
  }

  const householdRecord: V1GroupRecord = {
    members: [...memberIds],
  };
  if (draft.state) {
    householdRecord.state_name = yearMap(year, draft.state);
  }
  if (draft.county) {
    householdRecord.county = yearMap(year, draft.county);
  }

  const families: V1GroupCollection = {
    [keys.family]: { members: [...memberIds] },
  };
  const taxUnits: V1GroupCollection = {
    [keys.taxUnit]: { members: [...memberIds] },
  };
  const spmUnits: V1GroupCollection = {
    [keys.spmUnit]: { members: [...memberIds] },
  };
  const households: V1GroupCollection = {
    [keys.household]: householdRecord,
  };

  const maritalUnits: V1GroupCollection = {};
  if (includeMaritalUnit) {
    const adults = draft.people.filter((person) => person.kind === 'adult');
    maritalUnits[keys.maritalUnit] = {
      members: adults.slice(0, 2).map((person) => person.id),
    };
  }

  return {
    country_id: 'us',
    label,
    data: {
      people,
      families,
      marital_units: maritalUnits,
      tax_units: taxUnits,
      spm_units: spmUnits,
      households,
    },
  };
}

/**
 * Convenience that returns just the inner `V1HouseholdSituation` — useful for
 * callers that POST to `/calculate` or otherwise need the situation directly
 * without the envelope wrapper.
 */
export function toV1HouseholdSituation(
  draft: USHouseholdDraft,
  options: ToV1PayloadOptions = {},
): V1HouseholdSituation {
  return toV1HouseholdPayload(draft, options).data;
}
