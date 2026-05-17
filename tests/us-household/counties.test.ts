import { describe, expect, it } from 'vitest';
import {
  getCountiesByState,
  getCountyName,
  isCountyCode,
  resolveCountyCode,
} from '@/us-household/counties';

describe('getCountiesByState', () => {
  it('returns sorted counties for a known state', () => {
    const counties = getCountiesByState('CA');
    expect(counties.length).toBeGreaterThan(50);
    const names = counties.map((c) => c.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
    expect(names).toContain('Alameda County');
    expect(names).toContain('Los Angeles County');
  });

  it('returns an empty array for unknown or null state', () => {
    expect(getCountiesByState('XX')).toEqual([]);
    expect(getCountiesByState(null)).toEqual([]);
  });
});

describe('isCountyCode', () => {
  it('returns true for known county codes', () => {
    expect(isCountyCode('ALAMEDA_COUNTY_CA')).toBe(true);
  });
  it('returns false for unknown or non-strings', () => {
    expect(isCountyCode('NOT_A_COUNTY')).toBe(false);
    expect(isCountyCode(null)).toBe(false);
    expect(isCountyCode(42)).toBe(false);
  });
});

describe('getCountyName', () => {
  it('returns the display name without state suffix', () => {
    expect(getCountyName('ALAMEDA_COUNTY_CA')).toBe('Alameda County');
  });
  it('returns null for unknown', () => {
    expect(getCountyName('UNKNOWN_ATLANTIS')).toBeNull();
  });
});

describe('resolveCountyCode', () => {
  it('resolves "Alameda" to ALAMEDA_COUNTY_CA', () => {
    expect(resolveCountyCode('CA', 'Alameda')).toBe('ALAMEDA_COUNTY_CA');
  });
  it('resolves "Alameda County" (with suffix) the same way', () => {
    expect(resolveCountyCode('CA', 'Alameda County')).toBe('ALAMEDA_COUNTY_CA');
  });
  it('passes through canonical codes unchanged', () => {
    expect(resolveCountyCode('CA', 'ORANGE_COUNTY_CA')).toBe('ORANGE_COUNTY_CA');
  });
  it('returns null when state is missing or county is unknown', () => {
    expect(resolveCountyCode(null, 'Alameda')).toBeNull();
    expect(resolveCountyCode('CA', null)).toBeNull();
    expect(resolveCountyCode('CA', 'Atlantis')).toBeNull();
  });
});
