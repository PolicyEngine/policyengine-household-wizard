import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  UK_STATE_PENSION,
  atStatePensionAge,
  statePensionEntered,
  statePensionFor,
  type UKStatePensionTable,
} from '@/uk-household/statePension';
import {
  atStatePensionAge as dashboardAtStatePensionAge,
  statePensionFor as dashboardStatePensionFor,
} from './reference/dashboardRequest';

const years = Object.keys(UK_STATE_PENSION.years).map(Number);

describe('statePensionFor', () => {
  it('reads each year’s row', () => {
    expect(years).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
    expect(statePensionFor(2026)).toEqual({ age: 66, full: 12547.6 });
    expect(statePensionFor(2027)).toEqual({ age: 67, full: 13036.97 });
    expect(statePensionFor(2031)).toEqual({ age: 67, full: 14390.39 });
  });

  it('takes the first later row before the table, and the last after it', () => {
    expect(statePensionFor(0)).toEqual(statePensionFor(2026));
    expect(statePensionFor(2025)).toEqual(statePensionFor(2026));
    expect(statePensionFor(2032)).toEqual(statePensionFor(2031));
    expect(statePensionFor(2026.5)).toEqual(statePensionFor(2027));
  });

  it('agrees with the dashboard’s for every year', () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer({ min: -10, max: 2100 }), fc.double({ noNaN: true })), (year) => {
        expect(statePensionFor(year)).toEqual(dashboardStatePensionFor(year));
        for (const age of [null, 0, 65, 66, 67, 68, 100]) {
          expect(atStatePensionAge(age, year)).toBe(dashboardAtStatePensionAge(age, year));
        }
      }),
    );
  });

  it('never lowers State Pension age or the full rate from one year to the next', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2000, max: 2100 }), fc.integer({ min: 0, max: 50 }), (year, later) => {
        const a = statePensionFor(year);
        const b = statePensionFor(year + later);
        expect(b.age).toBeGreaterThanOrEqual(a.age);
        expect(b.full).toBeGreaterThanOrEqual(a.full);
      }),
    );
  });

  it('reads a table it is given, whatever order its years are in', () => {
    const table: UKStatePensionTable = {
      years: {
        '2040': { state_pension_age: 68, full_new_state_pension: 20000 },
        '2030': { state_pension_age: 67, full_new_state_pension: 15000 },
      },
    };
    expect(statePensionFor(2026, table)).toEqual({ age: 67, full: 15000 });
    expect(statePensionFor(2035, table)).toEqual({ age: 68, full: 20000 });
    expect(statePensionFor(2050, table)).toEqual({ age: 68, full: 20000 });
    expect(atStatePensionAge(67, 2035, table)).toBe(false);
    expect(atStatePensionAge(68, 2035, table)).toBe(true);
  });
});

describe('atStatePensionAge', () => {
  it('counts from State Pension age in the year, never for an unanswered age', () => {
    expect(atStatePensionAge(66, 2026)).toBe(true);
    expect(atStatePensionAge(65, 2026)).toBe(false);
    expect(atStatePensionAge(66, 2027)).toBe(false);
    expect(atStatePensionAge(67, 2027)).toBe(true);
    expect(atStatePensionAge(null, 2027)).toBe(false);
    expect(atStatePensionAge(undefined, 2027)).toBe(false);
  });
});

describe('statePensionEntered', () => {
  it('is true for a finite number only; null is the full rate', () => {
    expect(statePensionEntered(0)).toBe(true);
    expect(statePensionEntered(9000.5)).toBe(true);
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, '9000', {}]) {
      expect(statePensionEntered(value)).toBe(false);
    }
  });
});
