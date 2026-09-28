import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import graph from './data/policyengine-us-variable-graph.json' with { type: 'json' };
import {
  FLAG_TO_VARIABLE,
  INCOME_TO_VARIABLE,
  toV1HouseholdPayload,
  type ToV1PayloadOptions,
} from '@/us-household/adapters/v1Payload';
import { US_STATES } from '@/us-household/states';
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
 * alongside it is ignored: `social_security` plus `social_security_disability`
 * used to drop SSDI.
 */

interface GraphNode {
  entity: string;
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
  taxable_pension_income:
    'No draft field sets its public or private components. State rules that read one component see zero.',
};

const INCOME_FIELDS = Object.keys(INCOME_TO_VARIABLE) as Array<keyof USPersonIncomes>;
const FLAG_FIELDS = Object.keys(FLAG_TO_VARIABLE) as Array<keyof USPersonFlags>;
const INCOME_VARIABLES = new Set(Object.values(INCOME_TO_VARIABLE));

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

// Amounts may be absent, null (drafts parsed from JSON), zero, or negative
// (self-employment losses).
const amountArb = fc.oneof(
  { weight: 3, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 6, arbitrary: fc.integer({ min: -100_000, max: 5_000_000 }) },
);

const personArb = fc
  .record({
    kind: fc.constantFrom<USPersonDraft['kind']>('adult', 'dependent'),
    age: fc.option(fc.integer({ min: 0, max: 120 }), { nil: null }),
    flags: fc.tuple(...FLAG_FIELDS.map(() => fc.option(fc.boolean(), { nil: undefined }))),
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

  it('carries every entered amount into exactly one variable', () => {
    fc.assert(
      fc.property(draftArb, (draft) => {
        for (const { person, record } of personVariables(draft)) {
          const entered = INCOME_FIELDS.map((field) => person[field])
            .filter((value): value is number => value !== undefined && value !== null)
            .sort((a, b) => a - b);
          const sent = Object.entries(record)
            .filter(([variable]) => INCOME_VARIABLES.has(variable))
            .map(([, byYear]) => byYear?.[String(draft.year)] as number)
            .sort((a, b) => a - b);
          expect(sent).toEqual(entered);
        }
      }),
    );
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
