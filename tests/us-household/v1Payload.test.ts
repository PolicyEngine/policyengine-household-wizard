import { describe, expect, it } from 'vitest';
import { addPerson, createBlankDraft, updatePerson } from '@/us-household/draft';
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
      is_tax_unit_dependent: { '2026': false },
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

  it('sends is_tax_unit_dependent for every person, from their kind', () => {
    // is_tax_unit_dependent is computed (not head and not spouse). Sending it
    // for dependents only gave every adult a stored false whenever a
    // dependent was listed, and left the formula to decide otherwise, so a
    // third adult's status depended on whether a child was in the draft.
    let draft = singleAdult();
    draft = addPerson(draft, 'dependent', { age: 8 });
    const { people } = toV1HouseholdPayload(draft).data;
    expect(people['dependent-1']).toEqual({
      age: { '2026': 8 },
      is_tax_unit_dependent: { '2026': true },
    });
    expect(people['adult-1'].is_tax_unit_dependent).toEqual({ '2026': false });
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
      is_full_time_college_student: { '2026': true },
      is_pregnant: { '2026': true },
      is_incapable_of_self_care: { '2026': true },
      ssi: { '2026': 600 },
      social_security_disability: { '2026': 1200 },
    });
  });

  it('sends the student flag as college enrollment, from age 18 only', () => {
    // is_full_time_student is computed as college or K-12 (ages 5 to 17).
    // Sending it for one person gave everyone else a stored false, so a
    // flagged college student took K-12 status away from their siblings.
    let draft = singleAdult();
    draft = addPerson(draft, 'dependent', { age: 19, isFullTimeStudent: true });
    draft = addPerson(draft, 'dependent', { age: 17, isFullTimeStudent: true });
    draft = addPerson(draft, 'dependent', { age: 10, isFullTimeStudent: false });
    draft = addPerson(draft, 'dependent', { age: 8 });
    draft = addPerson(draft, 'adult', { age: null, isFullTimeStudent: true });
    const { people } = toV1HouseholdPayload(draft).data;

    for (const record of Object.values(people)) {
      expect(record).not.toHaveProperty('is_full_time_student');
    }
    expect(people['dependent-1'].is_full_time_college_student).toEqual({ '2026': true });
    expect(people['dependent-2']).not.toHaveProperty('is_full_time_college_student');
    expect(people['dependent-3']).not.toHaveProperty('is_full_time_college_student');
    // With no age the model assumes an adult, so the answer is kept.
    expect(people['adult-2'].is_full_time_college_student).toEqual({ '2026': true });
  });

  it('sends only true and false for flags', () => {
    const draft = updatePerson(singleAdult(), 'adult-1', {
      isDisabled: null as unknown as boolean,
      isBlind: false,
    });
    const person = toV1HouseholdPayload(draft).data.people['adult-1'];
    expect(person).not.toHaveProperty('is_disabled');
    expect(person.is_blind).toEqual({ '2026': false });
  });

  describe('SSI', () => {
    function couple(first: number | undefined, second: number | undefined) {
      let draft = createBlankDraft(2026);
      draft = { ...draft, state: 'CA', maritalStatus: 'married' };
      draft = addPerson(draft, 'adult', { age: 70, ssiAmount: first });
      draft = addPerson(draft, 'adult', { age: 70, ssiAmount: second });
      return toV1HouseholdPayload(draft).data.people;
    }

    it('leaves SSI to the model when only some people have an amount', () => {
      // An ssi input for one person gives everyone else a stored 0: live, a
      // couple aged 70 in CA got 8,946 each, but 600 and 0 once the first
      // reported 600.
      const people = couple(600, undefined);
      expect(people['adult-1']).not.toHaveProperty('ssi');
      expect(people['adult-2']).not.toHaveProperty('ssi');
    });

    it('sends every amount once everyone has one', () => {
      const people = couple(600, 0);
      expect(people['adult-1'].ssi).toEqual({ '2026': 600 });
      expect(people['adult-2'].ssi).toEqual({ '2026': 0 });
    });

    it('sends an entered 0 as not taking up SSI, for that person only', () => {
      const people = couple(0, undefined);
      expect(people['adult-1'].takes_up_ssi_if_eligible).toEqual({ '2026': false });
      expect(people['adult-2']).not.toHaveProperty('takes_up_ssi_if_eligible');
      expect(people['adult-1']).not.toHaveProperty('ssi');
      expect(people['adult-2']).not.toHaveProperty('ssi');
    });

    it('needs no ssi input when everyone entered 0', () => {
      const people = couple(0, 0);
      for (const record of Object.values(people)) {
        expect(record).not.toHaveProperty('ssi');
        expect(record.takes_up_ssi_if_eligible).toEqual({ '2026': false });
      }
    });
  });

  it('keeps SSDI when Social Security retirement benefits are also entered', () => {
    // policyengine-us computes `social_security` as the sum of its retirement,
    // disability, survivors, and dependents components. Sending the total as
    // an input skips that sum, so a separately sent `social_security_disability`
    // was left out of the total (12,000 instead of 18,000).
    const draft = updatePerson(singleAdult(), 'adult-1', {
      age: 67,
      employmentIncome: undefined,
      socialSecurityIncome: 12000,
      ssdiAmount: 6000,
    });
    const person = toV1HouseholdPayload(draft).data.people['adult-1'];
    expect(person).not.toHaveProperty('social_security');
    expect(person).toEqual({
      age: { '2026': 67 },
      is_tax_unit_dependent: { '2026': false },
      social_security_retirement: { '2026': 12000 },
      social_security_disability: { '2026': 6000 },
    });
  });

  it('sends pensions as their public and private components, never the total', () => {
    // policyengine-us computes `taxable_pension_income` as the sum of its
    // public and private components, and state rules read the components
    // (Minnesota's public pension subtraction, Missouri's pension deductions,
    // New York's pension exclusion). Sending the total left both at zero.
    const draft = updatePerson(singleAdult(), 'adult-1', {
      age: 67,
      employmentIncome: undefined,
      publicPensionIncome: 20000,
      privatePensionIncome: 10000,
    });
    const person = toV1HouseholdPayload(draft).data.people['adult-1'];
    expect(person).not.toHaveProperty('taxable_pension_income');
    expect(person).toEqual({
      age: { '2026': 67 },
      is_tax_unit_dependent: { '2026': false },
      taxable_public_pension_income: { '2026': 20000 },
      taxable_private_pension_income: { '2026': 10000 },
    });
  });

  it('sends a pension of unknown source as private pension income', () => {
    const draft = updatePerson(singleAdult(), 'adult-1', {
      age: 67,
      employmentIncome: undefined,
      pensionIncome: 30000,
    });
    expect(toV1HouseholdPayload(draft).data.people['adult-1']).toEqual({
      age: { '2026': 67 },
      is_tax_unit_dependent: { '2026': false },
      taxable_private_pension_income: { '2026': 30000 },
    });
  });

  it('adds a pension of unknown source to a private pension', () => {
    const draft = updatePerson(singleAdult(), 'adult-1', {
      age: 67,
      employmentIncome: undefined,
      pensionIncome: 5000,
      publicPensionIncome: 20000,
      privatePensionIncome: 10000,
    });
    expect(toV1HouseholdPayload(draft).data.people['adult-1']).toEqual({
      age: { '2026': 67 },
      is_tax_unit_dependent: { '2026': false },
      taxable_public_pension_income: { '2026': 20000 },
      taxable_private_pension_income: { '2026': 15000 },
    });
  });

  it('skips an amount that is not a finite number instead of summing it', () => {
    // Summing would turn NaN + 12000 into NaN, which JSON sends as null, and
    // the valid private pension would be lost.
    const draft = updatePerson(singleAdult(), 'adult-1', {
      age: 67,
      employmentIncome: Number.NaN,
      pensionIncome: Number.NaN,
      privatePensionIncome: 12000,
      publicPensionIncome: Infinity,
    });
    expect(toV1HouseholdPayload(draft).data.people['adult-1']).toEqual({
      age: { '2026': 67 },
      is_tax_unit_dependent: { '2026': false },
      taxable_private_pension_income: { '2026': 12000 },
    });
  });

  it('reads a numeric string as a number instead of concatenating it', () => {
    // Without conversion, 5000 + '12000' concatenated to '500012000'.
    const draft = updatePerson(singleAdult(), 'adult-1', {
      age: 67,
      employmentIncome: undefined,
      pensionIncome: 5000,
      privatePensionIncome: '12000' as unknown as number,
      publicPensionIncome: ' ' as unknown as number,
    });
    expect(toV1HouseholdPayload(draft).data.people['adult-1']).toEqual({
      age: { '2026': 67 },
      is_tax_unit_dependent: { '2026': false },
      taxable_private_pension_income: { '2026': 17000 },
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
