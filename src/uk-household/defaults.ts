import type { UKRegion } from './types';

/**
 * Typical answers, with their sources, for apps that start every answer at a
 * typical value (the Autumn Budget 2026 dashboard does). `createTypicalDraft()`
 * puts them together.
 */

export interface UKDefaultSource {
  /** What the figure is. */
  statistic: string;
  /** The publication and table it comes from. */
  publication: string;
  url: string;
}

/**
 * The year salaries are entered for. The latest median salary (below) is for
 * April 2026, so a form that asks for "salary in 2026" can start from it.
 */
export const UK_SALARY_YEAR = 2026;

/**
 * The UK median salary, rounded: ONS, Annual Survey of Hours and Earnings
 * (ASHE) 2026 provisional, Table 6.7a "Annual pay - Gross", all employee jobs,
 * UK: median £34,229 in April 2026 (employees on adult rates in the same job
 * for more than a year), rounded to £34,200.
 */
export const UK_DEFAULT_SALARY = 34200;

/** A sentence for forms that prefill the salary (the dashboard's hint). */
export const UK_DEFAULT_SALARY_NOTE =
  '£34,200 is the UK median salary in April 2026 (ONS Annual Survey of Hours and Earnings, provisional).';

/**
 * Average monthly private rent by region: ONS, Price Index of Private Rents
 * (PIPR), September 2026 (Northern Ireland: July 2026, its latest month),
 * published 21 October 2026.
 */
export const UK_REGIONAL_RENT: Readonly<Record<UKRegion, number>> = {
  NORTH_EAST: 790,
  NORTH_WEST: 975,
  YORKSHIRE: 869,
  EAST_MIDLANDS: 928,
  WEST_MIDLANDS: 983,
  EAST_OF_ENGLAND: 1298,
  LONDON: 2338,
  SOUTH_EAST: 1438,
  SOUTH_WEST: 1251,
  WALES: 848,
  SCOTLAND: 1011,
  NORTHERN_IRELAND: 879,
};

/** The UK's average monthly private rent in the same release. */
export const UK_AVERAGE_RENT = 1406;

/** The month each region's average rent is for. */
export const regionalRentMonth = (region: unknown): string =>
  region === 'NORTHERN_IRELAND' ? 'July 2026' : 'September 2026';

/**
 * The region's average monthly private rent, or the UK's for anything that
 * is not a region code (`null` included).
 */
export function regionalRent(region: unknown): number {
  return typeof region === 'string' && Object.prototype.hasOwnProperty.call(UK_REGIONAL_RENT, region)
    ? UK_REGIONAL_RENT[region as UKRegion]
    : UK_AVERAGE_RENT;
}

/**
 * Average household spending, pounds a year: ONS, Family Spending in the UK,
 * FYE 2025, Workbook 1, Table A1, average weekly household spending times 52,
 * rounded to £10. Petrol £11.90 a week (£620 a year), diesel £6.50 (£340),
 * electricity (line 4.4.1) £20.00 (£1,040, the household impact API's own
 * default for electricity).
 */
export const UK_DEFAULT_SPENDING = {
  petrol: 620,
  diesel: 340,
  electricity: 1040,
} as const;

export const UK_DEFAULT_SOURCES: Readonly<Record<'salary' | 'rent' | 'spending', UKDefaultSource>> = {
  salary: {
    statistic: 'Median gross annual pay, all employee jobs, UK, April 2026 (provisional): £34,229',
    publication: 'ONS, Annual Survey of Hours and Earnings 2026, Table 6.7a',
    url: 'https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/agegroupashetable6',
  },
  rent: {
    statistic: 'Average monthly private rent by region, September 2026 (Northern Ireland: July 2026)',
    publication: 'ONS, Price Index of Private Rents, published 21 October 2026',
    url: 'https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics',
  },
  spending: {
    statistic: 'Average weekly household spending on petrol, diesel and electricity, FYE 2025',
    publication: 'ONS, Family Spending in the UK, FYE 2025, Workbook 1, Table A1',
    url: 'https://www.ons.gov.uk/peoplepopulationandcommunity/personalandhouseholdfinances/expenditure/datasets/familyspendingworkbook1detailedexpenditureandtrends',
  },
};
