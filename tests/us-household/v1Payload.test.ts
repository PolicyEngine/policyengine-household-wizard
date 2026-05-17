import { describe, expect, it } from 'vitest';
import { addPerson, createBlankDraft } from '@/us-household/draft';
import { toV1HouseholdPayload } from '@/us-household/adapters/v1Payload';

function singleAdult() {
  let draft = createBlankDraft(2026);
  draft.state = 'CA';
  draft.maritalStatus = 'single';
  draft = addPerson(draft, 'adult', { age: 30, employmentIncome: 50000 });
  return draft;
}

describe('toV1HouseholdPayload', () => {
  it('builds a single-adult payload with state_name and one tax unit', () => {
    const envelope = toV1HouseholdPayload(singleAdult());
    expect(envelope.country_id).toBe('us');
    const data = envelope.data;

    expect(Object.keys(data.people)).toEqual(['adult-1']);
    expect(data.people['adult-1']).toEqual({
      age: { '2026': 30 },
      employment_income: { '2026': 50000 },
    });

    expect(data.tax_units).toEqual({ tax_unit: { members: ['adult-1'] } });
    expect(data.families).toEqual({ family: { members: ['adult-1'] } });
    expect(data.spm_units).toEqual({ spm_unit: { members: ['adult-1'] } });

    expect(data.households).toEqual({
      household: {
        members: ['adult-1'],
        state_name: { '2026': 'CA' },
      },
    });
    expect(data.marital_units).toEqual({});
  });

  it('includes county when set', () => {
    let draft = singleAdult();
    draft = { ...draft, county: 'ALAMEDA_COUNTY_CA' };
    const envelope = toV1HouseholdPayload(draft);
    expect(envelope.data.households?.household).toMatchObject({
      county: { '2026': 'ALAMEDA_COUNTY_CA' },
    });
  });

  it('marks dependents with is_tax_unit_dependent', () => {
    let draft = singleAdult();
    draft = addPerson(draft, 'dependent', { age: 8 });
    const envelope = toV1HouseholdPayload(draft);
    expect(envelope.data.people['dependent-1']).toEqual({
      age: { '2026': 8 },
      is_tax_unit_dependent: { '2026': true },
    });
  });

  it('passes through person flags as PolicyEngine variables', () => {
    let draft = singleAdult();
    draft = {
      ...draft,
      people: draft.people.map((person) =>
        person.id === 'adult-1'
          ? {
              ...person,
              isDisabled: true,
              isBlind: false,
              isFullTimeStudent: true,
              isPregnant: true,
              needsCare: true,
              ssiAmount: 600,
              ssdiAmount: 1200,
            }
          : person,
      ),
    };
    const envelope = toV1HouseholdPayload(draft);
    expect(envelope.data.people['adult-1']).toMatchObject({
      is_disabled: { '2026': true },
      is_blind: { '2026': false },
      is_full_time_student: { '2026': true },
      is_pregnant: { '2026': true },
      is_incapable_of_self_care: { '2026': true },
      ssi: { '2026': 600 },
      social_security_disability: { '2026': 1200 },
    });
  });

  it('uses verbose group keys when requested', () => {
    const envelope = toV1HouseholdPayload(singleAdult(), { groupKeyStyle: 'verbose' });
    expect(envelope.data.households).toHaveProperty('your household');
    expect(envelope.data.tax_units).toHaveProperty('your tax unit');
    expect(envelope.data.families).toHaveProperty('your family');
  });

  it('omits state_name when state is null', () => {
    let draft = singleAdult();
    draft = { ...draft, state: null };
    const envelope = toV1HouseholdPayload(draft);
    expect(envelope.data.households?.household.state_name).toBeUndefined();
  });

  it('populates marital_units when includeMaritalUnit is true', () => {
    let draft = singleAdult();
    draft.maritalStatus = 'married';
    draft = addPerson(draft, 'adult', { age: 28 });
    const envelope = toV1HouseholdPayload(draft, { includeMaritalUnit: true });
    expect(envelope.data.marital_units).toEqual({
      marital_unit: { members: ['adult-1', 'adult-2'] },
    });
  });

  it('sets the envelope label when provided', () => {
    const envelope = toV1HouseholdPayload(singleAdult(), { label: 'Test household' });
    expect(envelope.label).toBe('Test household');
  });
});
