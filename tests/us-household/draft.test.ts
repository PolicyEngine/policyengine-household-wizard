import { describe, expect, it } from 'vitest';
import {
  addPerson,
  applyMaritalStatusChange,
  cloneDraft,
  createBlankDraft,
  createPerson,
  getAdults,
  getDependents,
  removePerson,
  updatePerson,
} from '@/us-household/draft';

describe('createBlankDraft', () => {
  it('has no defaults for state, county, marital status, or people', () => {
    const draft = createBlankDraft();
    expect(draft.state).toBeNull();
    expect(draft.county).toBeNull();
    expect(draft.zip).toBeNull();
    expect(draft.maritalStatus).toBeNull();
    expect(draft.people).toEqual([]);
  });

  it('defaults year to the current UTC year unless overridden', () => {
    const draft = createBlankDraft();
    expect(draft.year).toBe(new Date().getUTCFullYear());

    const overridden = createBlankDraft(2030);
    expect(overridden.year).toBe(2030);
  });
});

describe('createPerson', () => {
  it('mints ids based on the existing person count', () => {
    const draft = createBlankDraft();
    const adult = createPerson('adult', draft.people);
    expect(adult.id).toBe('adult-1');
    expect(adult.kind).toBe('adult');
    expect(adult.age).toBeNull();

    const next = [adult];
    const second = createPerson('adult', next);
    expect(second.id).toBe('adult-2');
  });

  it('mints dependent ids separately from adults', () => {
    const adult = createPerson('adult', []);
    const dep = createPerson('dependent', [adult]);
    expect(dep.id).toBe('dependent-1');
  });
});

describe('addPerson / removePerson / updatePerson', () => {
  it('appends a person to the draft', () => {
    const draft = addPerson(createBlankDraft(), 'adult', { age: 35 });
    expect(draft.people).toHaveLength(1);
    expect(draft.people[0]).toMatchObject({ id: 'adult-1', kind: 'adult', age: 35 });
  });

  it('removes by id', () => {
    let draft = createBlankDraft();
    draft = addPerson(draft, 'adult');
    draft = addPerson(draft, 'dependent', { age: 8 });
    draft = removePerson(draft, 'adult-1');
    expect(draft.people).toHaveLength(1);
    expect(draft.people[0].id).toBe('dependent-1');
  });

  it('merges partial updates by id', () => {
    let draft = addPerson(createBlankDraft(), 'adult', { age: 40 });
    draft = updatePerson(draft, 'adult-1', { isDisabled: true });
    expect(draft.people[0]).toMatchObject({ age: 40, isDisabled: true });
  });
});

describe('applyMaritalStatusChange', () => {
  it('adds a partner when switching to married with one adult', () => {
    let draft = createBlankDraft();
    draft = addPerson(draft, 'adult', { age: 35 });
    draft = applyMaritalStatusChange(draft, 'married');
    expect(draft.maritalStatus).toBe('married');
    expect(getAdults(draft)).toHaveLength(2);
    expect(getAdults(draft)[1].age).toBeNull(); // partner age unset by default
  });

  it('drops extra adults when switching to single', () => {
    let draft = createBlankDraft();
    draft = addPerson(draft, 'adult', { age: 35 });
    draft = addPerson(draft, 'adult', { age: 33 });
    draft = applyMaritalStatusChange(draft, 'single');
    expect(draft.maritalStatus).toBe('single');
    expect(getAdults(draft)).toHaveLength(1);
  });

  it('is a no-op when the status is unchanged', () => {
    let draft = applyMaritalStatusChange(createBlankDraft(), 'single');
    const previous = draft;
    draft = applyMaritalStatusChange(draft, 'single');
    expect(draft).toBe(previous);
  });
});

describe('cloneDraft', () => {
  it('deep clones nested people and extras', () => {
    let draft = createBlankDraft();
    draft = addPerson(draft, 'adult', { age: 30, extras: { hint: 'primary' } });
    draft.extras = { source: 'wizard' };
    const cloned = cloneDraft(draft);
    expect(cloned).not.toBe(draft);
    expect(cloned.people).not.toBe(draft.people);
    expect(cloned.people[0]).not.toBe(draft.people[0]);
    expect(cloned.people[0].extras).not.toBe(draft.people[0].extras);
    expect(cloned).toEqual(draft);
  });
});

describe('selectors', () => {
  it('split adults and dependents by kind', () => {
    let draft = createBlankDraft();
    draft = addPerson(draft, 'adult');
    draft = addPerson(draft, 'dependent', { age: 5 });
    draft = addPerson(draft, 'adult', { age: 30 });
    expect(getAdults(draft).map((p) => p.id)).toEqual(['adult-1', 'adult-2']);
    expect(getDependents(draft).map((p) => p.id)).toEqual(['dependent-1']);
  });
});
