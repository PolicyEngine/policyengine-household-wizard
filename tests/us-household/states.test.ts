import { describe, expect, it } from 'vitest';
import { getStateFromZip, getStateName, isUSStateCode, US_STATES } from '@/us-household/states';

describe('US_STATES', () => {
  it('includes all 50 states plus DC', () => {
    expect(US_STATES).toHaveLength(51);
    expect(US_STATES.find((s) => s.code === 'DC')).toBeDefined();
  });

  it('codes are unique and uppercase', () => {
    const codes = US_STATES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => c === c.toUpperCase())).toBe(true);
  });
});

describe('isUSStateCode', () => {
  it('returns true for known codes', () => {
    expect(isUSStateCode('CA')).toBe(true);
    expect(isUSStateCode('DC')).toBe(true);
  });
  it('returns false for unknown values', () => {
    expect(isUSStateCode('XX')).toBe(false);
    expect(isUSStateCode(null)).toBe(false);
    expect(isUSStateCode(42)).toBe(false);
  });
});

describe('getStateName', () => {
  it('returns the full state name', () => {
    expect(getStateName('CA')).toBe('California');
    expect(getStateName('DC')).toBe('District of Columbia');
  });
  it('returns null for unknown or empty', () => {
    expect(getStateName('XX')).toBeNull();
    expect(getStateName('')).toBeNull();
    expect(getStateName(null)).toBeNull();
  });
});

describe('getStateFromZip', () => {
  it('maps well-known ZIPs to their states', () => {
    expect(getStateFromZip('94703')).toBe('CA'); // Berkeley
    expect(getStateFromZip('10001')).toBe('NY'); // Manhattan
    expect(getStateFromZip('20500')).toBe('DC'); // White House
    expect(getStateFromZip('60601')).toBe('IL'); // Chicago Loop
    expect(getStateFromZip('99501')).toBe('AK'); // Anchorage
  });
  it('handles 9-digit ZIPs by using the first five digits', () => {
    expect(getStateFromZip('94703-1234')).toBe('CA');
  });
  it('returns null for short or invalid inputs', () => {
    expect(getStateFromZip('')).toBeNull();
    expect(getStateFromZip('1')).toBeNull();
    expect(getStateFromZip(null)).toBeNull();
  });
});
