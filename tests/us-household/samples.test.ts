import { describe, expect, it } from 'vitest';
import * as root from '../../src';
import * as us from '../../src/us-household';
import catalog from '../../src/us-household/samples/catalog.json';
import { drawUsSampleHousehold, getUsSampleHousehold } from '../../src/us-household/samples';
import { toV1HouseholdSituation } from '../../src/us-household/adapters/v1Payload';

describe('US sample households', () => {
  it('retains a sampled dependent’s student and disability status in a V1 calculation', () => {
    // The pinned source has both flags for the 21-year-old dependent in NJ slot 15.
    const sample = drawUsSampleHousehold({ stateCode: 'NJ', random: () => 15.5 / 32 });
    const dependent = sample.draft.people[2];
    expect(dependent).toMatchObject({ kind: 'dependent', age: 21, isFullTimeStudent: true, isDisabled: true });
    expect(toV1HouseholdSituation(sample.draft).people[dependent.id]).toMatchObject({
      is_full_time_college_student: { 2024: true },
      is_disabled: { 2024: true },
    });
  });

  it('returns every state slot as a valid independent wizard draft, preserving the source fields', () => {
    for (const [stateCode, { households }] of Object.entries(catalog.states)) {
      households.forEach((profile, index) => {
        const sample = drawUsSampleHousehold({
          stateCode, random: () => (index + 0.5) / households.length,
        });
        expect(sample.id).toBe(`${stateCode}-${index}`);
        expect(sample.stateCode).toBe(stateCode);
        expect(getUsSampleHousehold(sample.id)).toEqual(sample);
        expect(sample.draft).toMatchObject({
          state: stateCode,
          maritalStatus: profile.maritalStatus,
          year: catalog.provenance.year,
          county: null, zip: null,
        });
        expect(sample.draft.people.map(({ id, ...fields }) => fields)).toEqual(profile.people);
        const personIds = sample.draft.people.map(({ id }) => id);
        expect(new Set(personIds).size).toBe(personIds.length);
        expect(us.validate(sample.draft).issues, sample.id).toEqual([]);
      });
    }
  });

  it('uses eligible household mass across states and gives slots in each state equal mass', () => {
    const states = Object.entries(catalog.states);
    const totalWeight = states.reduce((sum, [, state]) => sum + state.populationWeight, 0);
    let precedingWeight = 0;
    for (const [stateCode, state] of states) {
      for (let index = 0; index < state.households.length; index++) {
        const withinState = (index + 0.5) / state.households.length;
        const draw = (precedingWeight + state.populationWeight * withinState) / totalWeight;
        expect(drawUsSampleHousehold({ random: () => draw }).id).toBe(`${stateCode}-${index}`);
      }
      precedingWeight += state.populationWeight;
    }
  });

  it('keeps edits and redrawing from changing the catalog', () => {
    const options = { stateCode: 'CA', random: () => 0 };
    const first = drawUsSampleHousehold(options);
    const before = structuredClone(first);
    first.draft.people[0].age = 999;
    first.draft.people.length = 0;
    first.provenance.dataset = 'changed';
    expect(drawUsSampleHousehold(options)).toEqual(before);
    const next = drawUsSampleHousehold({ ...options, excludeId: before.id });
    expect(next.stateCode).toBe('CA');
    expect(next.id).not.toBe(before.id);
  });

  it('rejects unsupported states and invalid random numbers', () => {
    expect(() => drawUsSampleHousehold({ stateCode: 'XX' })).toThrow(RangeError);
    for (const value of [-0.1, 1, NaN, Infinity]) {
      expect(() => drawUsSampleHousehold({ random: () => value })).toThrow(RangeError);
    }
  });

  it('looks up a fresh draft without changing the catalog or inventing unknown slots', () => {
    const drawn = drawUsSampleHousehold({ stateCode: 'NJ', random: () => 15.5 / 32 });
    const reopened = getUsSampleHousehold(drawn.id)!;
    reopened.draft.people[2].isDisabled = false;
    reopened.provenance.year = 1900;
    expect(getUsSampleHousehold(drawn.id)).toEqual(drawn);
    for (const unknown of ['', 'nj-15', 'XX-0', 'NJ-32', 'NJ-15x']) {
      expect(getUsSampleHousehold(unknown)).toBeUndefined();
    }
  });

  it('keeps the sample catalog behind its own import path', () => {
    expect(root).not.toHaveProperty('drawUsSampleHousehold');
    expect(us).not.toHaveProperty('drawUsSampleHousehold');
    expect(root).not.toHaveProperty('getUsSampleHousehold');
    expect(us).not.toHaveProperty('getUsSampleHousehold');
  });
});
