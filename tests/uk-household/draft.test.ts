import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addChild,
  cloneDraft,
  createBlankDraft,
  createTypicalDraft,
  removeChild,
  setChildCount,
  updateChild,
  updateHead,
  updatePartner,
} from '@/uk-household/draft';
import { UK_NEW_CHILD_AGE } from '@/uk-household/children';
import type { UKHouseholdDraft } from '@/uk-household/types';
import fixtures from '../fixtures/uk/dashboard-households.json' with { type: 'json' };
import { draftArb } from './arbitraries';

const dashboardDefaults = fixtures.fixtures.find((fixture) => fixture.name === 'defaults')!.draft;

describe('createTypicalDraft', () => {
  it('is the dashboard’s starting answers', () => {
    expect(createTypicalDraft()).toEqual(dashboardDefaults);
  });

  it('takes a salary year, and gives a new draft each time', () => {
    expect(createTypicalDraft(2027).salaryYear).toBe(2027);
    const a = createTypicalDraft();
    const b = createTypicalDraft();
    expect(a).toEqual(b);
    expect(a.head).not.toBe(b.head);
    expect(a.children).not.toBe(b.children);
    expect(a.spending).not.toBe(b.spending);
  });
});

describe('createBlankDraft', () => {
  it('leaves every choice and age unanswered, and amounts at zero', () => {
    const draft = createBlankDraft();
    expect(draft).toMatchObject({
      salaryYear: 2026,
      region: null,
      tenure: null,
      councilTaxBand: null,
      claimsUniversalCredit: null,
      hasPartner: false,
      children: [],
      monthlyRent: null,
      monthlyChildcare: 0,
      spending: { petrol: 0, diesel: 0, electricity: null },
    });
    expect(draft.head).toEqual({
      age: null,
      employmentIncome: 0,
      privatePensionIncome: 0,
      statePension: null,
      studentLoanPlan: 'NONE',
      salarySacrificePensionContributions: 0,
      dividendIncome: 0,
      savingsInterestIncome: 0,
      propertyIncome: 0,
    });
    expect(draft.partner).toEqual({ age: null, employmentIncome: 0, privatePensionIncome: 0, statePension: null });
    expect(createBlankDraft(2028).salaryYear).toBe(2028);
  });
});

describe('cloneDraft', () => {
  it('copies deeply: changing the copy never changes the original', () => {
    fc.assert(
      fc.property(draftArb(), (generated) => {
        const draft: UKHouseholdDraft = {
          ...generated,
          extras: { note: { text: 'a' } },
          head: { ...generated.head, extras: { list: [1] } },
        };
        const before = structuredClone(draft);
        const copy = cloneDraft(draft);
        expect(copy).toEqual(draft);
        copy.head.age = 99;
        copy.partner.employmentIncome = 1;
        copy.spending.petrol = 1;
        copy.children.push({ age: 1 });
        (copy.extras!.note as { text: string }).text = 'b';
        (copy.head.extras!.list as number[]).push(2);
        expect(draft).toEqual(before);
      }),
      { numRuns: 200 },
    );
  });
});

describe('updates', () => {
  it('return a new draft and leave the one given as it was', () => {
    fc.assert(
      fc.property(draftArb(), (draft) => {
        const before = structuredClone(draft);
        const updated = [
          updateHead(draft, { age: 40 }),
          updatePartner(draft, { employmentIncome: 1 }),
          addChild(draft, { age: 3 }),
          removeChild(draft, 0),
          updateChild(draft, 0, { inEducation: false }),
          setChildCount(draft, 3),
        ];
        for (const next of updated) expect(next).not.toBe(draft);
        expect(draft).toEqual(before);
      }),
      { numRuns: 200 },
    );
  });

  it('change only what they name', () => {
    const draft = createTypicalDraft();
    expect(updateHead(draft, { age: 40 }).head).toEqual({ ...draft.head, age: 40 });
    expect(updatePartner(draft, { age: 41 }).partner).toEqual({ ...draft.partner, age: 41 });
    const withChildren = addChild(addChild(draft, { age: 3 }), { age: 17, inEducation: false });
    expect(withChildren.children).toEqual([{ age: 3 }, { age: 17, inEducation: false }]);
    expect(addChild(draft).children).toEqual([{ age: null }]);
    expect(removeChild(withChildren, 0).children).toEqual([{ age: 17, inEducation: false }]);
    expect(updateChild(withChildren, 1, { inEducation: true }).children[1]).toEqual({ age: 17, inEducation: true });
    expect(updateChild(withChildren, 5, { age: 1 }).children).toEqual(withChildren.children);
  });
});

describe('setChildCount', () => {
  it('keeps the first children, or adds new ones, to the count', () => {
    fc.assert(
      fc.property(draftArb(), fc.integer({ min: -3, max: 15 }), (draft, count) => {
        const next = setChildCount(draft, count);
        const expected = Math.max(0, count);
        expect(next.children).toHaveLength(expected);
        const kept = Math.min(expected, draft.children.length);
        expect(next.children.slice(0, kept)).toEqual(draft.children.slice(0, kept));
        for (const child of next.children.slice(kept)) expect(child).toEqual({ age: UK_NEW_CHILD_AGE });
      }),
    );
    expect(setChildCount(createTypicalDraft(), 2, 9).children).toEqual([{ age: 9 }, { age: 9 }]);
  });
});
