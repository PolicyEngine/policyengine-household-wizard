import { describe, expect, it } from 'vitest';
import * as root from '@/index';
import * as uk from '@/uk-household';
import * as adapters from '@/uk-household/adapters';

describe('uk-household exports', () => {
  it('exports the model from policyengine-household-wizard/uk-household', () => {
    for (const name of [
      'UK_REGIONS',
      'UK_TENURES',
      'UK_RENTING_TENURES',
      'UK_STUDENT_LOAN_PLANS',
      'UK_COUNCIL_TAX_BANDS',
      'UK_SALARY_YEAR',
      'UK_DEFAULT_SALARY',
      'UK_DEFAULT_SOURCES',
      'UK_DEFAULT_SPENDING',
      'UK_REGIONAL_RENT',
      'UK_AVERAGE_RENT',
      'UK_STATE_PENSION',
      'UK_HOUSEHOLD_LIMITS',
      'UK_OLDEST_CHILD_AGE',
      'UK_YOUNG_PERSON_AGE',
      'UK_CHILD_AGE_MESSAGE',
      'createBlankDraft',
      'createTypicalDraft',
      'validate',
      'serializeDraft',
      'deserializeDraft',
      'statePensionFor',
      'toHouseholdImpactRequest',
    ]) {
      expect(uk).toHaveProperty(name);
    }
  });

  it('exports the request adapter from policyengine-household-wizard/uk-household/adapters', () => {
    expect(Object.keys(adapters).sort()).toEqual(['monthlyRentFor', 'toHouseholdImpactRequest']);
    expect(adapters.toHouseholdImpactRequest).toBe(uk.toHouseholdImpactRequest);
  });

  it('keeps the root export the US model’s, whose names the UK model shares', () => {
    expect(root.createBlankDraft).not.toBe(uk.createBlankDraft);
    expect(root).not.toHaveProperty('UK_REGIONS');
  });
});
