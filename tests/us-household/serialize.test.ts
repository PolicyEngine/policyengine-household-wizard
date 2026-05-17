import { describe, expect, it } from 'vitest';
import { addPerson, createBlankDraft, updatePerson } from '@/us-household/draft';
import { deserializeDraft, serializeDraft } from '@/us-household/serialize';

describe('serialize / deserialize round-trip', () => {
  it('preserves state, county, marital status, year, and people', () => {
    let draft = createBlankDraft(2026);
    draft.state = 'CA';
    draft.county = 'ALAMEDA_COUNTY_CA';
    draft.zip = '94703';
    draft.maritalStatus = 'married';
    draft = addPerson(draft, 'adult', { age: 35, employmentIncome: 50000 });
    draft = addPerson(draft, 'adult', { age: 33 });
    draft = addPerson(draft, 'dependent', { age: 6, isFullTimeStudent: true });

    const round = deserializeDraft(serializeDraft(draft));

    expect(round.state).toBe('CA');
    expect(round.county).toBe('ALAMEDA_COUNTY_CA');
    expect(round.zip).toBe('94703');
    expect(round.maritalStatus).toBe('married');
    expect(round.year).toBe(2026);
    expect(round.people).toHaveLength(3);
    expect(round.people[0]).toMatchObject({
      id: 'adult-1',
      kind: 'adult',
      age: 35,
      employmentIncome: 50000,
    });
    expect(round.people[2]).toMatchObject({
      id: 'dependent-1',
      kind: 'dependent',
      age: 6,
      isFullTimeStudent: true,
    });
  });

  it('omits zero or unset income fields from the serialization', () => {
    let draft = createBlankDraft(2026);
    draft.state = 'CA';
    draft.maritalStatus = 'single';
    draft = addPerson(draft, 'adult', { age: 30, employmentIncome: 0 });
    const query = serializeDraft(draft);
    expect(query).not.toContain('e0'); // no zero income token
    expect(query).toContain('p=adult%3A30');
  });

  it('handles missing query gracefully', () => {
    const draft = deserializeDraft('');
    expect(draft.state).toBeNull();
    expect(draft.people).toEqual([]);
  });

  it('ignores unknown person tokens', () => {
    const draft = deserializeDraft('state=CA&p=adult:30:Z9999');
    expect(draft.people).toHaveLength(1);
    expect(draft.people[0]).toMatchObject({ kind: 'adult', age: 30 });
  });
});
