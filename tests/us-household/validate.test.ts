import { describe, expect, it } from 'vitest';
import { addPerson, createBlankDraft } from '@/us-household/draft';
import { isComplete, validate } from '@/us-household/validate';

function completeMarried() {
  let draft = createBlankDraft(2026);
  draft.state = 'CA';
  draft.maritalStatus = 'married';
  draft = addPerson(draft, 'adult', { age: 32 });
  draft = addPerson(draft, 'adult', { age: 30 });
  return draft;
}

describe('validate', () => {
  it('reports missing state, marital status, and at least one adult', () => {
    const result = validate(createBlankDraft(2026));
    expect(result.ok).toBe(false);
    const codes = (!result.ok ? result.issues : []).map((issue) => issue.code);
    expect(codes).toContain('state.required');
    expect(codes).toContain('maritalStatus.required');
    expect(codes).toContain('people.adults.required');
  });

  it('flags unknown state codes', () => {
    let draft = completeMarried();
    draft = { ...draft, state: 'ZZ' };
    const result = validate(draft);
    expect(result.ok).toBe(false);
    expect((!result.ok ? result.issues : []).map((i) => i.code)).toContain('state.invalid');
  });

  it('requires two adults when married', () => {
    let draft = completeMarried();
    draft = { ...draft, people: draft.people.slice(0, 1) };
    const result = validate(draft);
    expect(result.ok).toBe(false);
    expect((!result.ok ? result.issues : []).map((i) => i.code)).toContain(
      'people.adults.marriedRequiresTwo',
    );
  });

  it('flags missing ages and out-of-range ages', () => {
    let draft = createBlankDraft(2026);
    draft.state = 'CA';
    draft.maritalStatus = 'single';
    draft = addPerson(draft, 'adult', { age: null });
    draft = addPerson(draft, 'dependent', { age: 200 });

    const result = validate(draft);
    expect(result.ok).toBe(false);
    const codes = (!result.ok ? result.issues : []).map((i) => i.code);
    expect(codes).toContain('person.age.required');
    expect(codes).toContain('person.age.outOfRange');
  });

  it('warns when a dependent is older than 23', () => {
    let draft = createBlankDraft(2026);
    draft.state = 'CA';
    draft.maritalStatus = 'single';
    draft = addPerson(draft, 'adult', { age: 50 });
    draft = addPerson(draft, 'dependent', { age: 25 });

    const result = validate(draft);
    expect(result.ok).toBe(false);
    expect((!result.ok ? result.issues : []).map((i) => i.code)).toContain(
      'person.age.dependentTooOld',
    );
  });

  it('requires county only when requireCounty is set', () => {
    const draft = completeMarried();
    expect(validate(draft).ok).toBe(true);
    expect(validate(draft, { requireCounty: true }).ok).toBe(false);
  });

  it('returns ok for a complete married draft', () => {
    expect(isComplete(completeMarried())).toBe(true);
  });

  it('skips age requirement when requireAges is false', () => {
    let draft = createBlankDraft(2026);
    draft.state = 'CA';
    draft.maritalStatus = 'single';
    draft = addPerson(draft, 'adult', { age: null });
    expect(validate(draft, { requireAges: false }).ok).toBe(true);
  });
});
