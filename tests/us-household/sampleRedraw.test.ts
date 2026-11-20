import { expect, it, vi } from 'vitest';
import { drawUsSampleHousehold } from '../../src/us-household/samples';

vi.mock('../../src/us-household/samples/catalog.json', () => {
  const profile = (age: number) => ({
    maritalStatus: 'single',
    people: [{ kind: 'adult', age, employmentIncome: 20000 }],
  });
  return { default: {
    provenance: { year: 2024, dataset: 'test', buildId: 'test', url: '' },
    states: {
      VA: { populationWeight: 3, households: [
        profile(20),
        { maritalStatus: 'single', people: [{ age: 20, employmentIncome: 20000, kind: 'adult' }] },
        profile(85),
      ] },
      DC: { populationWeight: 1, households: [profile(20)] },
    },
  } };
});

it('redraws a visibly different household and keeps matching profiles in other states', () => {
  const previous = drawUsSampleHousehold({ stateCode: 'VA', random: () => 0.5 });
  expect(previous.id).toBe('VA-1');
  expect(drawUsSampleHousehold({ excludeId: previous.id, random: () => 0 }).id).toBe('VA-2');
  expect(drawUsSampleHousehold({ excludeId: previous.id, random: () => 0.5 }).id).toBe('DC-0');
});

it('still fills a draft if only the previous profile exists in a state', () => {
  const sample = drawUsSampleHousehold({ stateCode: 'DC', excludeId: 'DC-0', random: () => 0 });
  expect(sample.id).toBe('DC-0');
  expect(sample.draft.people[0].age).toBe(20);
});
