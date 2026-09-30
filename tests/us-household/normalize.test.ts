import { describe, expect, it } from 'vitest';
import { normalizeLegacyDraft } from '@/us-household/normalize';

describe('normalizeLegacyDraft', () => {
  it('maps filing status to marital status (Coverage Compass shape)', () => {
    const legacy = {
      filingStatus: 'married_jointly',
      zipCode: '94703',
      age: 35,
      partnerAge: 33,
      childAges: [6, 4],
    };
    const draft = normalizeLegacyDraft(legacy);
    expect(draft.maritalStatus).toBe('married');
    expect(draft.state).toBe('CA'); // derived from ZIP
    expect(draft.zip).toBe('94703');
    expect(draft.people).toHaveLength(4);
    expect(draft.people[0]).toMatchObject({ kind: 'adult', age: 35, id: 'adult-1' });
    expect(draft.people[1]).toMatchObject({ kind: 'adult', age: 33, id: 'adult-2' });
    expect(draft.people[2]).toMatchObject({ kind: 'dependent', age: 6, id: 'dependent-1' });
    expect(draft.people[3]).toMatchObject({ kind: 'dependent', age: 4, id: 'dependent-2' });
  });

  it('maps cliff-watch JOINT / SEPARATE filing status to married', () => {
    const joint = normalizeLegacyDraft({
      filing_status: 'JOINT',
      state: 'CA',
      people: [
        { kind: 'adult', age: 30 },
        { kind: 'adult', age: 28 },
      ],
    });
    expect(joint.maritalStatus).toBe('married');

    const separate = normalizeLegacyDraft({
      filing_status: 'SEPARATE',
      state: 'NY',
      people: [{ kind: 'adult', age: 30 }],
    });
    expect(separate.maritalStatus).toBe('married');
  });

  it('treats head of household as single but keeps dependents', () => {
    const draft = normalizeLegacyDraft({
      filingStatus: 'head_of_household',
      state: 'NY',
      age: 30,
      childAges: [2],
    });
    expect(draft.maritalStatus).toBe('single');
    expect(draft.state).toBe('NY');
    expect(draft.people.filter((p) => p.kind === 'adult')).toHaveLength(1);
    expect(draft.people.filter((p) => p.kind === 'dependent')).toHaveLength(1);
  });

  it('handles cliff-watch shape (people array, marital_status, snake_case flags)', () => {
    const legacy = {
      state: 'TX',
      marital_status: 'MARRIED',
      people: [
        {
          kind: 'adult',
          age: 40,
          is_disabled: true,
          earned_income: 50000,
        },
        { kind: 'adult', age: 38, earned_income: 25000 },
        { kind: 'child', age: 9, is_full_time_student: true },
      ],
    };
    const draft = normalizeLegacyDraft(legacy);
    expect(draft.maritalStatus).toBe('married');
    expect(draft.state).toBe('TX');
    expect(draft.people).toHaveLength(3);
    expect(draft.people[0]).toMatchObject({
      kind: 'adult',
      age: 40,
      isDisabled: true,
      employmentIncome: 50000,
    });
    expect(draft.people[1]).toMatchObject({
      kind: 'adult',
      age: 38,
      employmentIncome: 25000,
    });
    expect(draft.people[2]).toMatchObject({
      kind: 'dependent',
      age: 9,
      isFullTimeStudent: true,
    });
  });

  it('keeps a legacy pension of unknown source out of the public and private fields', () => {
    const draft = normalizeLegacyDraft({
      state: 'NY',
      marital_status: 'MARRIED',
      people: [
        { kind: 'adult', age: 68, pension_income_annual: '24000' },
        { kind: 'adult', age: 66, public_pension_income_annual: 9000, privatePensionIncome: 4000 },
      ],
    });
    const camel = normalizeLegacyDraft({
      state: 'NY',
      marital_status: 'UNMARRIED',
      people: [
        {
          kind: 'adult',
          age: 70,
          pensionIncome: 1000,
          publicPensionIncome: 2000,
          private_pension_income_annual: 3000,
        },
      ],
    });
    expect(camel.people[0]).toMatchObject({
      pensionIncome: 1000,
      publicPensionIncome: 2000,
      privatePensionIncome: 3000,
    });
    expect(draft.people[0].pensionIncome).toBe(24000);
    expect(draft.people[0].publicPensionIncome).toBeUndefined();
    expect(draft.people[0].privatePensionIncome).toBeUndefined();
    expect(draft.people[1].pensionIncome).toBeUndefined();
    expect(draft.people[1]).toMatchObject({
      publicPensionIncome: 9000,
      privatePensionIncome: 4000,
    });
  });

  it("reads cliff-watch's default SSI of 0 as not entered", () => {
    // cliff-watch writes ssi_amount 0 for everyone and sends SSI only when it
    // is positive. Read as an entered 0, it would stop the model from
    // computing anyone's SSI.
    const draft = normalizeLegacyDraft({
      state: 'CA',
      marital_status: 'MARRIED',
      people: [
        { kind: 'adult', age: 70, ssi_amount: 0 },
        { kind: 'adult', age: 70, ssi_amount: '600' },
      ],
    });
    expect(draft.people[0].ssiAmount).toBeUndefined();
    expect(draft.people[1].ssiAmount).toBe(600);

    const camel = normalizeLegacyDraft({
      state: 'CA',
      marital_status: 'UNMARRIED',
      people: [{ kind: 'adult', age: 70, ssiAmount: 0 }],
    });
    expect(camel.people[0].ssiAmount).toBe(0);
  });

  it('resolves a free-text county to its enum code', () => {
    const draft = normalizeLegacyDraft({
      state: 'CA',
      county: 'Alameda',
      filingStatus: 'single',
      age: 30,
    });
    expect(draft.county).toBe('ALAMEDA_COUNTY_CA');
  });

  it('passes through a canonical county code unchanged', () => {
    const draft = normalizeLegacyDraft({
      state: 'CA',
      county: 'ORANGE_COUNTY_CA',
      filingStatus: 'single',
      age: 30,
    });
    expect(draft.county).toBe('ORANGE_COUNTY_CA');
  });

  it('drops an unknown county silently', () => {
    const draft = normalizeLegacyDraft({
      state: 'CA',
      county: 'Atlantis',
      filingStatus: 'single',
      age: 30,
    });
    expect(draft.county).toBeNull();
  });

  it('returns a blank draft for non-object input', () => {
    const blank = normalizeLegacyDraft(null);
    expect(blank.state).toBeNull();
    expect(blank.people).toEqual([]);
  });

  it('adds a partner placeholder when marital status is married but no partner was provided', () => {
    const draft = normalizeLegacyDraft({
      filingStatus: 'married_jointly',
      state: 'WA',
      age: 28,
    });
    expect(draft.maritalStatus).toBe('married');
    expect(draft.people).toHaveLength(2);
    expect(draft.people[1]).toMatchObject({ kind: 'adult', age: null });
  });

  it('trims extra adults when status is single', () => {
    const draft = normalizeLegacyDraft({
      filingStatus: 'single',
      state: 'OR',
      people: [
        { kind: 'adult', age: 30 },
        { kind: 'adult', age: 28 },
        { kind: 'child', age: 5 },
      ],
    });
    expect(draft.maritalStatus).toBe('single');
    expect(draft.people.filter((p) => p.kind === 'adult')).toHaveLength(1);
    expect(draft.people.filter((p) => p.kind === 'dependent')).toHaveLength(1);
  });
});
