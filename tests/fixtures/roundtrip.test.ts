import { describe, expect, it } from 'vitest';
import singleAdult from './single-adult.json' with { type: 'json' };
import marriedAdults from './married-adults.json' with { type: 'json' };
import adultWithChild from './adult-with-child.json' with { type: 'json' };
import disabledPerson from './disabled-person.json' with { type: 'json' };
import student from './student.json' with { type: 'json' };
import countyCase from './county-case.json' with { type: 'json' };

import { isComplete } from '@/us-household/validate';
import { normalizeLegacyDraft } from '@/us-household/normalize';
import { serializeDraft, deserializeDraft } from '@/us-household/serialize';
import { toV1HouseholdPayload } from '@/us-household/adapters/v1Payload';
import type { USHouseholdDraft } from '@/us-household/types';

interface Fixture {
  name: string;
  draft: USHouseholdDraft;
}

const FIXTURES: Fixture[] = [
  singleAdult as Fixture,
  marriedAdults as Fixture,
  adultWithChild as Fixture,
  disabledPerson as Fixture,
  student as Fixture,
  countyCase as Fixture,
];

describe('US household fixtures', () => {
  it.each(FIXTURES)('$name: completes validation', ({ draft }) => {
    expect(isComplete(draft)).toBe(true);
  });

  it.each(FIXTURES)('$name: round-trips through URL serialization', ({ draft }) => {
    const round = deserializeDraft(serializeDraft(draft));
    expect(round.state).toBe(draft.state);
    expect(round.county).toBe(draft.county);
    expect(round.maritalStatus).toBe(draft.maritalStatus);
    expect(round.year).toBe(draft.year);
    expect(round.people).toHaveLength(draft.people.length);
    draft.people.forEach((person, index) => {
      expect(round.people[index]).toMatchObject({
        kind: person.kind,
        age: person.age,
      });
    });
  });

  it.each(FIXTURES)('$name: yields a valid V1 envelope', ({ draft }) => {
    const envelope = toV1HouseholdPayload(draft);
    expect(envelope.country_id).toBe('us');
    expect(envelope.data.people).toBeDefined();
    expect(Object.keys(envelope.data.people)).toHaveLength(draft.people.length);
    expect(envelope.data.households).toBeDefined();
    if (draft.state) {
      const householdGroup = Object.values(envelope.data.households!)[0];
      expect(householdGroup.state_name).toEqual({ [String(draft.year)]: draft.state });
    }
  });

  it.each(FIXTURES)('$name: normalizes from cliff-watch-style legacy input', ({ draft }) => {
    // Build a legacy-style input mirroring cliff-watch's shape and check we
    // recover the same draft shape after normalization.
    const legacy = {
      state: draft.state,
      county: draft.county,
      marital_status: draft.maritalStatus === 'married' ? 'MARRIED' : 'UNMARRIED',
      people: draft.people.map((person) => ({
        kind: person.kind === 'adult' ? 'adult' : 'child',
        age: person.age,
        is_disabled: person.isDisabled,
        is_full_time_student: person.isFullTimeStudent,
        is_pregnant: person.isPregnant,
        is_blind: person.isBlind,
        is_incapable_of_self_care: person.needsCare,
        earned_income: person.employmentIncome,
        ssi_amount: person.ssiAmount,
        ssdi_amount: person.ssdiAmount,
      })),
      year: draft.year,
    };

    const normalized = normalizeLegacyDraft(legacy);
    expect(normalized.state).toBe(draft.state);
    expect(normalized.maritalStatus).toBe(draft.maritalStatus);
    expect(normalized.county).toBe(draft.county);
    expect(normalized.people).toHaveLength(draft.people.length);
    normalized.people.forEach((person, index) => {
      const expected = draft.people[index];
      expect(person.kind).toBe(expected.kind);
      expect(person.age).toBe(expected.age);
      expect(person.isDisabled ?? false).toBe(expected.isDisabled ?? false);
      expect(person.isFullTimeStudent ?? false).toBe(expected.isFullTimeStudent ?? false);
      expect(person.employmentIncome).toBe(expected.employmentIncome);
    });
  });
});
