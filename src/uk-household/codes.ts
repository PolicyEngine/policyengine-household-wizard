import type { UKCouncilTaxBand, UKRegion, UKStudentLoanPlan, UKTenure } from './types';

export interface UKRegionOption {
  code: UKRegion;
  /** policyengine-uk's own label for the region. */
  name: string;
}

/** The regions, in policyengine-uk's order, with its labels. */
export const UK_REGIONS: readonly UKRegionOption[] = [
  { code: 'NORTH_EAST', name: 'North East' },
  { code: 'NORTH_WEST', name: 'North West' },
  { code: 'YORKSHIRE', name: 'Yorkshire and the Humber' },
  { code: 'EAST_MIDLANDS', name: 'East Midlands' },
  { code: 'WEST_MIDLANDS', name: 'West Midlands' },
  { code: 'EAST_OF_ENGLAND', name: 'East of England' },
  { code: 'LONDON', name: 'London' },
  { code: 'SOUTH_EAST', name: 'South East' },
  { code: 'SOUTH_WEST', name: 'South West' },
  { code: 'WALES', name: 'Wales' },
  { code: 'SCOTLAND', name: 'Scotland' },
  { code: 'NORTHERN_IRELAND', name: 'Northern Ireland' },
];

export const UK_TENURES: readonly UKTenure[] = [
  'RENT_PRIVATELY',
  'RENT_FROM_COUNCIL',
  'RENT_FROM_HA',
  'OWNED_WITH_MORTGAGE',
  'OWNED_OUTRIGHT',
];

/** The tenures that pay rent: rent is read only for these. */
export const UK_RENTING_TENURES: readonly UKTenure[] = ['RENT_PRIVATELY', 'RENT_FROM_COUNCIL', 'RENT_FROM_HA'];

export const UK_STUDENT_LOAN_PLANS: readonly UKStudentLoanPlan[] = [
  'NONE',
  'PLAN_1',
  'PLAN_2',
  'PLAN_4',
  'PLAN_5',
  'POSTGRADUATE',
];

export const UK_COUNCIL_TAX_BANDS: readonly UKCouncilTaxBand[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

const has = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

export const isUKRegion = (value: unknown): value is UKRegion =>
  has(
    UK_REGIONS.map((region) => region.code),
    value,
  );
export const isUKTenure = (value: unknown): value is UKTenure => has(UK_TENURES, value);
export const isUKStudentLoanPlan = (value: unknown): value is UKStudentLoanPlan =>
  has(UK_STUDENT_LOAN_PLANS, value);
export const isUKCouncilTaxBand = (value: unknown): value is UKCouncilTaxBand =>
  has(UK_COUNCIL_TAX_BANDS, value);

/** Whether a tenure pays rent. Anything else, unknown codes included, does not. */
export const isRenting = (tenure: unknown): boolean => has(UK_RENTING_TENURES, tenure);

/** policyengine-uk's label for a region, or the code itself if unknown. */
export function getRegionName(code: string): string {
  return UK_REGIONS.find((region) => region.code === code)?.name ?? code;
}
