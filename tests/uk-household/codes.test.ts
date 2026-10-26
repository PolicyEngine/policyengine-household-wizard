import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { UK_CHILD_AGE_MESSAGE, UK_OLDEST_CHILD_AGE, UK_YOUNG_PERSON_AGE, asksEducation } from '@/uk-household/children';
import {
  UK_COUNCIL_TAX_BANDS,
  UK_REGIONS,
  UK_RENTING_TENURES,
  UK_STUDENT_LOAN_PLANS,
  UK_TENURES,
  getRegionName,
  isRenting,
  isUKCouncilTaxBand,
  isUKRegion,
  isUKStudentLoanPlan,
  isUKTenure,
} from '@/uk-household/codes';
import {
  UK_AVERAGE_RENT,
  UK_DEFAULT_SALARY,
  UK_DEFAULT_SOURCES,
  UK_DEFAULT_SPENDING,
  UK_REGIONAL_RENT,
  UK_SALARY_YEAR,
  regionalRent,
  regionalRentMonth,
} from '@/uk-household/defaults';
import { BANDS, PLANS, REGIONS, TENURES } from './reference/householdImpactApi';
import { CHILD_AGE_MESSAGE, DEFAULT_SPENDING, REGIONAL_RENT, SALARY_YEAR } from './reference/dashboardRequest';

const PROTOTYPE_KEYS = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'];

describe('codes', () => {
  it('has the household impact API’s choices, each once', () => {
    const regions = UK_REGIONS.map((region) => region.code);
    expect([...regions].sort()).toEqual([...REGIONS].sort());
    expect([...UK_TENURES].sort()).toEqual([...TENURES].sort());
    expect([...UK_STUDENT_LOAN_PLANS].sort()).toEqual([...PLANS].sort());
    expect([...UK_COUNCIL_TAX_BANDS]).toEqual(BANDS);
    for (const list of [regions, UK_TENURES, UK_STUDENT_LOAN_PLANS, UK_COUNCIL_TAX_BANDS]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('lists the regions in policyengine-uk’s order with its labels', () => {
    expect(UK_REGIONS.map((region) => region.code)).toEqual(REGIONS);
    expect(getRegionName('YORKSHIRE')).toBe('Yorkshire and the Humber');
    expect(getRegionName('NORTHERN_IRELAND')).toBe('Northern Ireland');
    expect(getRegionName('ATLANTIS')).toBe('ATLANTIS');
  });

  it('recognises its own codes and nothing else', () => {
    for (const { code } of UK_REGIONS) expect(isUKRegion(code)).toBe(true);
    for (const tenure of UK_TENURES) expect(isUKTenure(tenure)).toBe(true);
    for (const plan of UK_STUDENT_LOAN_PLANS) expect(isUKStudentLoanPlan(plan)).toBe(true);
    for (const band of UK_COUNCIL_TAX_BANDS) expect(isUKCouncilTaxBand(band)).toBe(true);
    const known = new Set<unknown>([...REGIONS, ...TENURES, ...PLANS, ...BANDS]);
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constantFrom(...PROTOTYPE_KEYS), fc.anything()), (value) => {
        fc.pre(!known.has(value));
        expect(isUKRegion(value) || isUKTenure(value) || isUKStudentLoanPlan(value) || isUKCouncilTaxBand(value)).toBe(
          false,
        );
      }),
    );
  });

  it('treats exactly the three rented tenures as renting', () => {
    expect([...UK_RENTING_TENURES].sort()).toEqual(['RENT_FROM_COUNCIL', 'RENT_FROM_HA', 'RENT_PRIVATELY']);
    for (const tenure of UK_TENURES) expect(isRenting(tenure)).toBe(tenure.startsWith('RENT_'));
    for (const other of [null, undefined, '', 'rent_privately', ...PROTOTYPE_KEYS]) expect(isRenting(other)).toBe(false);
  });
});

describe('defaults', () => {
  it('are the dashboard’s, with their sources', () => {
    expect(UK_REGIONAL_RENT).toEqual(REGIONAL_RENT);
    expect(UK_DEFAULT_SPENDING).toEqual(DEFAULT_SPENDING);
    expect(UK_SALARY_YEAR).toBe(SALARY_YEAR);
    // The ASHE 2026 provisional median, £34,229, to the nearest £100
    expect(UK_DEFAULT_SALARY).toBe(Math.round(34229 / 100) * 100);
    for (const source of Object.values(UK_DEFAULT_SOURCES)) {
      expect(source.url).toMatch(/^https:\/\/www\.ons\.gov\.uk\//);
      expect(source.statistic).not.toBe('');
      expect(source.publication).toMatch(/^ONS, /);
    }
  });

  it('give every region its own average rent, and the UK’s to anything else', () => {
    expect(Object.keys(UK_REGIONAL_RENT).sort()).toEqual([...REGIONS].sort());
    for (const { code } of UK_REGIONS) expect(regionalRent(code)).toBe(UK_REGIONAL_RENT[code]);
    for (const other of [null, undefined, '', 'ATLANTIS', 42, ...PROTOTYPE_KEYS]) {
      expect(regionalRent(other)).toBe(UK_AVERAGE_RENT);
    }
    expect(regionalRentMonth('NORTHERN_IRELAND')).toBe('July 2026');
    for (const { code } of UK_REGIONS.filter((region) => region.code !== 'NORTHERN_IRELAND')) {
      expect(regionalRentMonth(code)).toBe('September 2026');
    }
  });
});

describe('children', () => {
  it('asks about education from 16 to 19 only', () => {
    expect(UK_YOUNG_PERSON_AGE).toBe(16);
    expect(UK_OLDEST_CHILD_AGE).toBe(19);
    expect(UK_CHILD_AGE_MESSAGE).toBe(CHILD_AGE_MESSAGE);
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 40 }), (age) => {
        expect(asksEducation(age)).toBe(age >= 16 && age <= 19);
      }),
    );
    expect(asksEducation(null)).toBe(false);
    expect(asksEducation(undefined)).toBe(false);
  });
});
