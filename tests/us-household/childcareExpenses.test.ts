import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import fixture from '../fixtures/childcare-expenses.json' with { type: 'json' };
import { cloneDraft, createBlankDraft } from '@/us-household/draft';
import { normalizeLegacyDraft } from '@/us-household/normalize';
import { deserializeDraft, serializeDraft } from '@/us-household/serialize';
import { toV1HouseholdSituation } from '@/us-household/adapters/v1Payload';
import { validate } from '@/us-household/validate';
import type { USHouseholdDraft } from '@/us-household/types';
import graph from './data/policyengine-us-variable-graph.json' with { type: 'json' };

const draft = fixture.draft as USHouseholdDraft;
const VARIABLE = 'spm_unit_pre_subsidy_childcare_expenses';

describe('household childcare expenses', () => {
  it('sends an annual household total once, on the SPM unit', () => {
    const situation = toV1HouseholdSituation(draft);
    expect(situation.spm_units?.spm_unit).toEqual({
      members: ['adult-1', 'dependent-1'],
      [VARIABLE]: { '2026': 3000 },
    });
    expect(Object.values(situation.people).every((person) => !(VARIABLE in person))).toBe(true);
    expect(graph.variables).toHaveProperty(VARIABLE, {
      entity: 'spm_unit',
      isInputVariable: true,
      defaultValue: 0,
      adds: [],
      subtracts: [],
    });
  });

  it('leaves blank drafts and their payloads unchanged', () => {
    expect(createBlankDraft()).not.toHaveProperty('childcareExpenses');
    const { childcareExpenses: _, ...without } = draft;
    expect(toV1HouseholdSituation(without).spm_units?.spm_unit).not.toHaveProperty(VARIABLE);
    expect(serializeDraft(without)).not.toContain('childcare=');
  });

  it.each([0, 3000, 1234.56])('keeps %s through cloning, normalization, and links', (value) => {
    const entered = { ...draft, childcareExpenses: value };
    expect(cloneDraft(entered).childcareExpenses).toBe(value);
    expect(normalizeLegacyDraft(entered).childcareExpenses).toBe(value);
    expect(deserializeDraft(serializeDraft(entered)).childcareExpenses).toBe(value);
    expect(validate(entered).ok).toBe(true);
  });

  it.each([-1, -3000])('rejects a negative amount %s', (value) => {
    expect(validate({ ...draft, childcareExpenses: value })).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        {
          code: 'childcareExpenses.negative',
          path: 'childcareExpenses',
          message: expect.any(String),
        },
      ]),
    });
  });

  it.each([NaN, Infinity, -Infinity])('rejects and never sends nonfinite amount %s', (value) => {
    const entered = { ...draft, childcareExpenses: value };
    expect(validate(entered)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        {
          code: 'childcareExpenses.invalid',
          path: 'childcareExpenses',
          message: expect.any(String),
        },
      ]),
    });
    expect(toV1HouseholdSituation(entered).spm_units?.spm_unit).not.toHaveProperty(VARIABLE);
  });

  it('preserves the model input through links without duplicating it or mutating the draft', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 2024, max: 2030 }),
        fc.integer({ min: 1, max: 5 }),
        (cents, year, children) => {
          const entered = {
            ...draft,
            year,
            childcareExpenses: cents / 100,
            people: [
              draft.people[0],
              ...Array.from({ length: children }, (_, index) => ({
                id: `dependent-${index + 1}`,
                kind: 'dependent' as const,
                age: index + 2,
              })),
            ],
          };
          const before = structuredClone(entered);
          const direct = toV1HouseholdSituation(entered);
          const round = toV1HouseholdSituation(deserializeDraft(serializeDraft(entered)));
          expect(Object.values(direct.spm_units ?? {})[0][VARIABLE]).toEqual({
            [year]: cents / 100,
          });
          expect(round).toEqual(direct);
          expect(Object.values(direct.people).every((person) => !(VARIABLE in person))).toBe(true);
          expect(entered).toEqual(before);
          expect(toV1HouseholdSituation(entered)).toEqual(direct);
        },
      ),
    );
  });
});
