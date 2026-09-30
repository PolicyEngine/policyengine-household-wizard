import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import graph from './data/policyengine-us-variable-graph.json' with { type: 'json' };
import {
  COLLEGE_MIN_AGE,
  FLAG_TO_VARIABLE,
  INCOME_TO_VARIABLE,
  SSI_TAKE_UP_VARIABLE,
  toV1HouseholdPayload,
  type ToV1PayloadOptions,
} from '@/us-household/adapters/v1Payload';
import { US_STATES } from '@/us-household/states';
import { validate } from '@/us-household/validate';
import type {
  USHouseholdDraft,
  USPersonDraft,
  USPersonFlags,
  USPersonIncomes,
} from '@/us-household/types';

/**
 * Invariants of `toV1HouseholdPayload` over arbitrary drafts, checked against
 * a snapshot of the PolicyEngine US variable graph
 * (`bun run regenerate-variable-graph` refreshes it).
 *
 * PolicyEngine US computes some variables as the sum of components (`adds`,
 * `subtracts`). An input on such a total replaces the sum, so a component sent
 * alongside it is left out of the total: `social_security` plus
 * `social_security_disability` used to leave SSDI out of Social Security.
 *
 * policyengine-core stores one array per variable and period for a whole
 * entity. The first person with an input on a computed variable allocates it,
 * filled with the variable's default, so the formula never runs for anyone
 * else: `ssi` sent for one person zeroed everyone else's SSI. So a computed
 * variable goes to every person or to no one, and only with values people
 * entered.
 */

interface GraphNode {
  entity: string;
  isInputVariable: boolean;
  defaultValue: unknown;
  adds: string[];
  subtracts: string[];
}

const VARIABLES: Record<string, GraphNode> = graph.variables;
const REGENERATE_HINT = 'run `bun run regenerate-variable-graph` after changing the adapter';

/**
 * Totals the adapter sets directly, and why each one drops no input. Adding a
 * mapping to another total fails the tests below until it is reviewed here.
 */
const REVIEWED_TOTAL_INPUTS: Record<string, string> = {
  employment_income:
    "policyengine-us's Simulation moves this input onto employment_income_before_lsr.",
  self_employment_income:
    "policyengine-us's Simulation moves this input onto self_employment_income_before_lsr.",
};

/**
 * Variables that more than one draft field sets, and why. The adapter sums
 * those fields. Mapping another field onto a variable already in use fails the
 * tests below until it is reviewed here.
 */
const REVIEWED_SHARED_VARIABLES: Record<
  string,
  { fields: Array<keyof USPersonIncomes>; reason: string }
> = {
  taxable_private_pension_income: {
    fields: ['pensionIncome', 'privatePensionIncome'],
    reason:
      'A pension of unknown source is sent as private. Sending the taxable_pension_income ' +
      'total instead would leave both components at zero for the state rules that read them.',
  },
};

/**
 * Computed variables the adapter may send for only some people, and why no one
 * else is held at a stored default. Sending another computed variable for some
 * people only fails the tests below until it is reviewed here.
 */
const REVIEWED_PARTIAL_COMPUTED: Record<string, string> = {
  employment_income:
    "policyengine-us's Simulation moves the whole array onto employment_income_before_lsr, " +
    'an input whose default (0) is what a person without an amount would have.',
  self_employment_income:
    "policyengine-us's Simulation moves the whole array onto self_employment_income_before_lsr, " +
    'an input whose default (0) is what a person without an amount would have.',
};

/**
 * Input variables whose default is not simply "none" (false or 0), and why a
 * person the adapter sends nothing for should hold it.
 */
const REVIEWED_INPUT_DEFAULTS: Record<string, { value: unknown; reason: string }> = {
  age: {
    value: 40,
    reason: 'The model age for a person sent without one. validate() requires ages by default.',
  },
  [SSI_TAKE_UP_VARIABLE]: {
    value: true,
    reason: 'A person without an SSI answer may take up SSI; only an entered 0 sends false.',
  },
};

type DraftField = keyof USPersonFlags | keyof USPersonIncomes | 'age' | 'kind';

const INCOME_FIELDS = Object.keys(INCOME_TO_VARIABLE) as Array<keyof USPersonIncomes>;
const FLAG_FIELDS = Object.keys(FLAG_TO_VARIABLE) as Array<keyof USPersonFlags>;
const INCOME_VARIABLES = new Set(Object.values(INCOME_TO_VARIABLE));
const FLAG_VARIABLES = new Set(Object.values(FLAG_TO_VARIABLE));

/** The draft fields each person variable the adapter can send comes from. */
const SOURCES: Record<string, DraftField[]> = {
  age: ['age'],
  is_tax_unit_dependent: ['kind'],
  [SSI_TAKE_UP_VARIABLE]: ['ssiAmount'],
};
for (const [field, variable] of [
  ...Object.entries(FLAG_TO_VARIABLE),
  ...Object.entries(INCOME_TO_VARIABLE),
]) {
  SOURCES[variable] = [...(SOURCES[variable] ?? []), field as DraftField];
}

/**
 * Whether a person answered a field. Written independently of the adapter's
 * parsing so the tests check that `validate()` and the adapter agree with it.
 */
function isEntered(person: USPersonDraft, field: DraftField): boolean {
  const value = (person as unknown as Record<string, unknown>)[field];
  if (field === 'kind') {
    return true;
  }
  if (field === 'age') {
    return value !== null && value !== undefined;
  }
  if ((FLAG_FIELDS as string[]).includes(field)) {
    return typeof value === 'boolean';
  }
  return amountOf(value) !== undefined;
}

function amountOf(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function nodeOf(variable: string): GraphNode {
  const node = VARIABLES[variable];
  if (!node) {
    throw new Error(`${variable} is missing from the variable graph: ${REGENERATE_HINT}`);
  }
  return node;
}

function componentsOf(variable: string, found = new Set<string>()): Set<string> {
  const node = nodeOf(variable);
  for (const child of [...node.adds, ...node.subtracts]) {
    if (!found.has(child)) {
      found.add(child);
      componentsOf(child, found);
    }
  }
  return found;
}

function isTotal(variable: string): boolean {
  const node = nodeOf(variable);
  return node.adds.length > 0 || node.subtracts.length > 0;
}

// Amounts may be absent, null (drafts parsed from JSON), zero, negative
// (self-employment losses), not finite (a form that parsed bad input), or
// strings from a form.
const amountArb = fc.oneof(
  { weight: 3, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Infinity, -Infinity) },
  { weight: 1, arbitrary: fc.constantFrom('600', '0', '', ' ', 'abc') },
  { weight: 2, arbitrary: fc.constant(0) },
  { weight: 6, arbitrary: fc.integer({ min: -100_000, max: 5_000_000 }) },
);

// Flags may be absent, null (drafts parsed from JSON), or answered.
const flagArb = fc.constantFrom(undefined, null, true, false);

const personArb = fc
  .record({
    kind: fc.constantFrom<USPersonDraft['kind']>('adult', 'dependent'),
    age: fc.option(fc.integer({ min: 0, max: 120 }), { nil: null }),
    flags: fc.tuple(...FLAG_FIELDS.map(() => flagArb)),
    incomes: fc.tuple(...INCOME_FIELDS.map(() => amountArb)),
  })
  .map(({ kind, age, flags, incomes }) => {
    const person: Record<string, unknown> = { kind, age };
    FLAG_FIELDS.forEach((field, index) => {
      person[field] = flags[index];
    });
    INCOME_FIELDS.forEach((field, index) => {
      person[field] = incomes[index];
    });
    return person as Omit<USPersonDraft, 'id'>;
  });

const draftArb: fc.Arbitrary<USHouseholdDraft> = fc
  .record({
    state: fc.option(fc.constantFrom(...US_STATES.map((state) => state.code)), { nil: null }),
    maritalStatus: fc.option(fc.constantFrom<'single' | 'married'>('single', 'married'), {
      nil: null,
    }),
    year: fc.integer({ min: 2020, max: 2035 }),
    people: fc.array(personArb, { minLength: 1, maxLength: 6 }),
  })
  .map(({ people, ...rest }) => ({
    ...rest,
    county: null,
    zip: null,
    people: people.map((person, index) => ({ ...person, id: `person-${index + 1}` })),
  }));

const optionsArb: fc.Arbitrary<ToV1PayloadOptions> = fc.record({
  groupKeyStyle: fc.constantFrom<'short' | 'verbose'>('short', 'verbose'),
  includeMaritalUnit: fc.boolean(),
});

function personVariables(draft: USHouseholdDraft, options?: ToV1PayloadOptions) {
  const { people } = toV1HouseholdPayload(draft, options).data;
  return draft.people.map((person) => ({ person, record: people[person.id] }));
}

function carriers(draft: USHouseholdDraft, variable: string): string[] {
  return personVariables(draft)
    .filter(({ record }) => variable in record)
    .map(({ person }) => person.id);
}

function withoutSsi(record: Record<string, unknown>) {
  const { [INCOME_TO_VARIABLE.ssiAmount]: _ssi, ...rest } = record;
  return rest;
}

describe('toV1HouseholdPayload invariants', () => {
  it('has a variable graph snapshot whose components are all present', () => {
    for (const [name, node] of Object.entries(VARIABLES)) {
      for (const child of [...node.adds, ...node.subtracts]) {
        expect(VARIABLES, `${name} -> ${child}: ${REGENERATE_HINT}`).toHaveProperty(child);
      }
    }
  });

  it('emits only PolicyEngine US variables on the matching entity', () => {
    fc.assert(
      fc.property(draftArb, optionsArb, (draft, options) => {
        const { data } = toV1HouseholdPayload(draft, options);
        for (const record of Object.values(data.people)) {
          for (const variable of Object.keys(record)) {
            expect(VARIABLES[variable]?.entity, `${variable}: ${REGENERATE_HINT}`).toBe('person');
          }
        }
        for (const record of Object.values(data.households ?? {})) {
          for (const variable of Object.keys(record).filter((key) => key !== 'members')) {
            expect(VARIABLES[variable]?.entity, `${variable}: ${REGENERATE_HINT}`).toBe(
              'household',
            );
          }
        }
      }),
    );
  });

  it('never sends a variable together with one of its components', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        for (const { record } of personVariables(draft)) {
          const sent = Object.keys(record);
          for (const total of sent) {
            const shadowed = sent.filter((other) => componentsOf(total).has(other));
            expect(shadowed, `${total} overrides the components sent with it`).toEqual([]);
          }
        }
      }),
    );
  });

  it('sets a total directly only when it is reviewed', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        for (const { record } of personVariables(draft)) {
          for (const variable of Object.keys(record).filter(isTotal)) {
            expect(REVIEWED_TOTAL_INPUTS, `${variable} is a total`).toHaveProperty(variable);
          }
        }
      }),
    );
  });

  it('maps several fields to one variable only when it is reviewed', () => {
    const fieldsByVariable = new Map<string, string[]>();
    for (const [field, variable] of Object.entries(INCOME_TO_VARIABLE)) {
      fieldsByVariable.set(variable, [...(fieldsByVariable.get(variable) ?? []), field]);
    }
    const shared = Object.fromEntries(
      [...fieldsByVariable]
        .filter(([, fields]) => fields.length > 1)
        .map(([variable, fields]) => [variable, [...fields].sort()]),
    );
    const reviewed = Object.fromEntries(
      Object.entries(REVIEWED_SHARED_VARIABLES).map(([variable, { fields }]) => [
        variable,
        [...fields].sort(),
      ]),
    );
    expect(shared).toEqual(reviewed);
  });

  it('carries every entered amount other than SSI into its variable', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        for (const { person, record } of personVariables(draft)) {
          const entered: Record<string, number> = {};
          for (const field of INCOME_FIELDS.filter((name) => name !== 'ssiAmount')) {
            const value = amountOf(person[field]);
            if (value !== undefined) {
              const variable = INCOME_TO_VARIABLE[field];
              entered[variable] = (entered[variable] ?? 0) + value;
            }
          }
          const sent = Object.fromEntries(
            Object.entries(withoutSsi(record))
              .filter(([variable]) => INCOME_VARIABLES.has(variable))
              .map(([variable, byYear]) => [
                variable,
                (byYear as Record<string, unknown>)?.[String(draft.year)],
              ]),
          );
          expect(sent).toEqual(entered);
        }
      }),
    );
  });

  it('sends a computed variable for every person or for no one', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const sent = new Set(personVariables(draft).flatMap(({ record }) => Object.keys(record)));
        for (const variable of sent) {
          if (nodeOf(variable).isInputVariable || variable in REVIEWED_PARTIAL_COMPUTED) {
            continue;
          }
          expect(carriers(draft, variable), `${variable} is computed`).toEqual(
            draft.people.map((person) => person.id),
          );
        }
      }),
    );
  });

  it('sends a person only variables for fields they answered', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        for (const { person, record } of personVariables(draft)) {
          for (const variable of Object.keys(record)) {
            const sources = SOURCES[variable] ?? [];
            expect(
              sources.some((field) => isEntered(person, field)),
              `${person.id} carries ${variable} without answering ${sources.join(' or ')}`,
            ).toBe(true);
          }
        }
      }),
    );
  });

  it("never lets one person's answers change another person's variables, except SSI", () => {
    // SSI is the one household-wide answer: see the SSI property below.
    fc.assert(
      fc.property(draftArb, (draft) => {
        for (const { person, record } of personVariables(draft)) {
          const alone = toV1HouseholdPayload({ ...draft, people: [person] }).data.people[
            person.id
          ];
          expect(withoutSsi(record)).toEqual(withoutSsi(alone));
        }
      }),
    );
  });

  it('sends SSI amounts only when every person has one, and each 0 as no take-up', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const year = String(draft.year);
        const amounts = draft.people.map((person) => amountOf(person.ssiAmount));
        const complete = amounts.every((amount) => amount !== undefined);
        const anyReceives = amounts.some((amount) => amount !== undefined && amount !== 0);
        personVariables(draft).forEach(({ record }, index) => {
          const amount = amounts[index];
          expect(record.ssi).toEqual(
            complete && anyReceives ? { [year]: amount } : undefined,
          );
          expect(record[SSI_TAKE_UP_VARIABLE]).toEqual(
            amount === 0 ? { [year]: false } : undefined,
          );
        });
      }),
    );
  });

  it('asks for SSI in validate() exactly when the adapter leaves out an entered amount', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const enteredAmounts = draft.people.some((person) => {
          const amount = amountOf(person.ssiAmount);
          return amount !== undefined && amount !== 0;
        });
        const sentAmounts = personVariables(draft).some(({ record }) => 'ssi' in record);
        const expected =
          enteredAmounts && !sentAmounts
            ? draft.people.flatMap((person, index) =>
                isEntered(person, 'ssiAmount') ? [] : [`people[${index}].ssiAmount`],
              )
            : [];
        const result = validate(draft);
        const flagged = (result.ok ? [] : result.issues)
          .filter((issue) => issue.code === 'person.ssiAmount.requiredWhenAnyReceives')
          .map((issue) => issue.path);
        expect(flagged).toEqual(expected);
      }),
    );
  });

  it('sends the student flag only as college enrollment, and not for children', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        const year = String(draft.year);
        for (const { person, record } of personVariables(draft)) {
          expect(record).not.toHaveProperty('is_full_time_student');
          const child = typeof person.age === 'number' && person.age < COLLEGE_MIN_AGE;
          const flag = person.isFullTimeStudent;
          expect(record[FLAG_TO_VARIABLE.isFullTimeStudent]).toEqual(
            typeof flag === 'boolean' && !child ? { [year]: flag } : undefined,
          );
        }
      }),
    );
  });

  it('sends only input variables whose default matches a blank answer', () => {
    for (const variable of Object.keys(SOURCES)) {
      const node = nodeOf(variable);
      if (!node.isInputVariable) {
        continue;
      }
      const expected =
        REVIEWED_INPUT_DEFAULTS[variable]?.value ?? (FLAG_VARIABLES.has(variable) ? false : 0);
      expect(node.defaultValue, `${variable}'s default: ${REGENERATE_HINT}`).toEqual(expected);
    }
  });

  it('is deterministic and leaves the draft unchanged', () => {
    fc.assert(
      fc.property(draftArb, optionsArb, (draft, options) => {
        const before = structuredClone(draft);
        const first = toV1HouseholdPayload(draft, options);
        const second = toV1HouseholdPayload(draft, options);
        expect(second).toEqual(first);
        expect(draft).toEqual(before);
      }),
    );
  });
});
