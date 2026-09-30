import { toAmount } from '../amount';
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
   * If true, puts the first two adults in one marital unit. Off by default for
   * compatibility. With `marital_units: {}`, policyengine-core gives each
   * person their own marital unit, so a married couple gets individual SSI
   * rates instead of the couple rate; pass true for married drafts.
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

/*
 * Variables PolicyEngine US computes must be sent for every person or for no
 * one. policyengine-core stores one array per variable and period for a whole
 * entity: the first person with an input allocates it, filled with the
 * variable's default, so everyone without an input holds that default and the
 * formula never runs for them. A `{year: null}` value does not help, because
 * policyengine-core skips it. So each person gets input variables, which
 * have no formula and whose stored default is what the model would use
 * anyway, plus computed variables only when every person has an answer. The
 * exceptions are `employment_income` and `self_employment_income`, computed
 * totals that policyengine-us's Simulation moves onto `*_before_lsr` inputs
 * (reviewed in `REVIEWED_PARTIAL_COMPUTED` in the invariant tests).
 *
 * - `is_tax_unit_dependent` comes from `kind`, which every person has.
 * - `isFullTimeStudent` is sent as the input `is_full_time_college_student`,
 *   not the computed `is_full_time_student`.
 * - `ssi` is sent only when every person has an `ssiAmount`; an entered 0 is
 *   also sent as the input `takes_up_ssi_if_eligible: false`.
 *
 * `tests/us-household/v1PayloadInvariants.test.ts` checks this against the
 * PolicyEngine US variable graph.
 */

/**
 * Person flags and the PolicyEngine US variables they set. Exported for tests
 * and tooling; not part of the package entry points. Only true and false are
 * sent; anything else (such as null in a JSON draft) counts as not answered.
 *
 * `is_full_time_student` is computed as `is_full_time_college_student` or
 * `is_in_k12_school`, and the model counts everyone aged 5 to 17 as a K-12
 * student. So `isFullTimeStudent` is sent as full-time college enrollment,
 * and only from `COLLEGE_MIN_AGE`: sending it for a child would make them a
 * college student (for example, for New Jersey's exemption for dependents
 * attending college), and sending the computed total would take K-12 status
 * away from every other child in the household.
 */
export const FLAG_TO_VARIABLE: Readonly<Record<keyof USPersonFlags, string>> = {
  isDisabled: 'is_disabled',
  isBlind: 'is_blind',
  isFullTimeStudent: 'is_full_time_college_student',
  isPregnant: 'is_pregnant',
  needsCare: 'is_incapable_of_self_care',
};

/**
 * The youngest age at which `isFullTimeStudent` is sent. PolicyEngine US's
 * `is_in_k12_school` covers ages 5 to 17, so a full-time student aged 18 or
 * over is taken to be in college. A person with no age is sent the flag,
 * because the model then assumes an adult age.
 */
export const COLLEGE_MIN_AGE = 18;

/**
 * An entered 0 in `ssiAmount` is sent as this variable, set to false. It is an
 * input (default true), so it sets that person's SSI to 0 without affecting
 * anyone else. In policyengine-us 1.764.6 only `ssi` reads it; later versions
 * also read it in a county General Relief rule.
 */
export const SSI_TAKE_UP_VARIABLE = 'takes_up_ssi_if_eligible';

/**
 * Person income fields and the PolicyEngine US variables they set. Exported
 * for tests and tooling; not part of the package entry points.
 *
 * Where PolicyEngine US defines a variable as the sum of components (`adds`),
 * an input on the total replaces that sum: components sent alongside it are
 * left out of the total and everything computed from it, and components not
 * sent read as zero where rules use them directly. `social_security` adds
 * retirement, disability, survivors, and dependents benefits, so
 * `socialSecurityIncome` sets `social_security_retirement` and `ssdiAmount`
 * sets `social_security_disability`; the model sums them.
 *
 * Likewise `taxable_pension_income` adds public and private pensions, and
 * state rules read those components. `publicPensionIncome` and
 * `privatePensionIncome` set them. A pension of unknown source
 * (`pensionIncome`) is sent as private. Fields that share a variable are
 * summed. Numeric strings are read as numbers and other amounts that are not
 * finite numbers are skipped, so a bad value in one field cannot corrupt a
 * shared sum.
 *
 * `ssi` is computed, so `ssiAmount` follows the household rule above: the
 * amounts are sent as `ssi` for everyone when every person has one, and
 * otherwise the model computes everyone's SSI. `validate()` asks for the
 * missing amounts in that case.
 *
 * `tests/us-household/v1PayloadInvariants.test.ts` checks this mapping against
 * the PolicyEngine US variable graph, including the few totals that are safe
 * to set directly.
 */
export const INCOME_TO_VARIABLE: Readonly<Record<keyof USPersonIncomes, string>> = {
  employmentIncome: 'employment_income',
  selfEmploymentIncome: 'self_employment_income',
  socialSecurityIncome: 'social_security_retirement',
  ssiAmount: 'ssi',
  ssdiAmount: 'social_security_disability',
  pensionIncome: 'taxable_private_pension_income',
  publicPensionIncome: 'taxable_public_pension_income',
  privatePensionIncome: 'taxable_private_pension_income',
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

  // Every person has a kind, so every person carries this computed variable.
  record.is_tax_unit_dependent = yearMap(year, person.kind === 'dependent');

  // Children's student status comes from the model's K-12 age rule.
  const age = toAmount(person.age);
  const belowCollegeAge = age !== undefined && age < COLLEGE_MIN_AGE;
  for (const [draftKey, variable] of Object.entries(FLAG_TO_VARIABLE)) {
    const value = (person as USPersonDraft)[draftKey as keyof USPersonFlags];
    if (draftKey === 'isFullTimeStudent' && belowCollegeAge) {
      continue;
    }
    if (typeof value === 'boolean') {
      record[variable] = yearMap(year, value);
    }
  }

  for (const [draftKey, variable] of Object.entries(INCOME_TO_VARIABLE)) {
    const value = toAmount((person as USPersonDraft)[draftKey as keyof USPersonIncomes]);
    if (value !== undefined && draftKey !== 'ssiAmount') {
      const sharedWith = record[variable]?.[year];
      const total = typeof sharedWith === 'number' ? sharedWith + value : value;
      record[variable] = yearMap(year, total);
    }
  }

  return record;
}

/**
 * Build the PolicyEngine API V1 household payload for a draft. Everyone shares
 * one family, tax unit, SPM unit and household. Check the draft with
 * `validate()` first:
 *
 * - A person with no age is sent without one, and PolicyEngine US then uses
 *   its default age of 40 (`validate()` requires ages by default).
 * - SSI amounts are sent only when every person has one. If some are
 *   missing, the entered amounts are dropped and the model computes
 *   everyone's SSI (`validate()` reports `person.ssiAmount.requiredWhenAnyReceives`).
 */
export function toV1HouseholdPayload(
  draft: USHouseholdDraft,
  options: ToV1PayloadOptions = {},
): V1HouseholdEnvelope {
  const { groupKeyStyle = 'short', includeMaritalUnit = false, label = null } = options;
  const keys = groupKeyStyle === 'verbose' ? VERBOSE_KEYS : SHORT_KEYS;
  const year = String(draft.year);

  const memberIds = draft.people.map((person) => person.id);

  // `ssi` goes to everyone or no one; see the note above FLAG_TO_VARIABLE.
  const ssiAmounts = draft.people.map((person) => toAmount(person.ssiAmount));
  const sendSsi =
    ssiAmounts.every((amount) => amount !== undefined) &&
    ssiAmounts.some((amount) => amount !== 0);

  const people: V1PersonCollection = {};
  draft.people.forEach((person, index) => {
    const record = buildPersonVariables(person, year);
    const ssiAmount = ssiAmounts[index];
    if (ssiAmount === 0) {
      record[SSI_TAKE_UP_VARIABLE] = yearMap(year, false);
    }
    if (sendSsi && ssiAmount !== undefined) {
      record[INCOME_TO_VARIABLE.ssiAmount] = yearMap(year, ssiAmount);
    }
    people[person.id] = record;
  });

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
