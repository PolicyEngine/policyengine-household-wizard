import { describe, expect, it } from 'vitest';
import {
  NOT_A_TIPPED_OCCUPATION,
  TIPPED_OCCUPATIONS,
  getTippedOccupation,
  isTippedOccupationCode,
  toTippedOccupationCode,
} from '@/us-household/tippedOccupations';

describe('TIPPED_OCCUPATIONS', () => {
  it('lists the 71 occupations of the final regulations, once each, in code order', () => {
    // 26 CFR 1.224-1(h), Table 1 (T.D. 10044, IRB 2026-18).
    const codes = TIPPED_OCCUPATIONS.map((occupation) => occupation.code);
    expect(codes).toHaveLength(71);
    expect(new Set(codes).size).toBe(71);
    expect(codes).toEqual([...codes].sort((a, b) => a - b));
    expect(codes).not.toContain(NOT_A_TIPPED_OCCUPATION);
  });

  it('has the per-category counts of the final table', () => {
    const counts: Record<string, number> = {};
    for (const { category } of TIPPED_OCCUPATIONS) {
      counts[category] = (counts[category] ?? 0) + 1;
    }
    expect(counts).toEqual({
      'Beverage and food service': 10,
      'Entertainment and events': 11,
      'Hospitality and guest services': 4,
      'Home services': 9,
      'Personal services': 10,
      'Personal appearance and wellness': 11,
      'Recreation and instruction': 6,
      'Transportation and delivery': 10,
    });
  });

  it('numbers each category from 1 within its hundred', () => {
    const byHundred = new Map<number, number[]>();
    for (const { code } of TIPPED_OCCUPATIONS) {
      const hundred = Math.floor(code / 100);
      byHundred.set(hundred, [...(byHundred.get(hundred) ?? []), code % 100]);
    }
    for (const offsets of byHundred.values()) {
      expect(offsets).toEqual(offsets.map((_, index) => index + 1));
    }
  });

  it('uses sentence case labels', () => {
    for (const { label, category } of TIPPED_OCCUPATIONS) {
      for (const text of [label, category]) {
        expect(text[0]).toBe(text[0].toUpperCase());
        expect(text.slice(1)).toBe(text.slice(1).toLowerCase());
      }
    }
  });

  it('carries the titles the final regulations changed or added', () => {
    expect(getTippedOccupation(103)?.label).toBe('Food or beverage servers, non-restaurant');
    expect(getTippedOccupation(506)?.label).toBe('Pet and show animal caretakers');
    expect(getTippedOccupation(509)?.label).toBe('Visual artists');
    expect(getTippedOccupation(510)?.label).toBe('Floral designers');
    expect(getTippedOccupation(606)?.label).toBe('Eyebrow and eyelash technicians');
    expect(getTippedOccupation(810)?.label).toBe('Gas pump attendant');
    expect(getTippedOccupation(811)).toBeUndefined();
  });
});

describe('toTippedOccupationCode', () => {
  it('accepts listed codes and 0, as numbers or numeric strings', () => {
    expect(toTippedOccupationCode(101)).toBe(101);
    expect(toTippedOccupationCode('810')).toBe(810);
    expect(toTippedOccupationCode(0)).toBe(0);
    expect(Object.is(toTippedOccupationCode(-0), 0)).toBe(true);
    expect(toTippedOccupationCode('0')).toBe(0);
  });

  it('reads anything else as not answered', () => {
    for (const value of [undefined, null, '', ' ', 'abc', 100, 999, 101.5, -101, NaN, true]) {
      expect(toTippedOccupationCode(value)).toBeUndefined();
    }
    expect(isTippedOccupationCode(0)).toBe(false);
    expect(isTippedOccupationCode('101')).toBe(false);
  });
});
