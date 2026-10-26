export type {
  UKAdultDraft,
  UKChildDraft,
  UKCouncilTaxBand,
  UKHeadDraft,
  UKHouseholdDraft,
  UKHouseholdSpending,
  UKRegion,
  UKStudentLoanPlan,
  UKTenure,
  ValidationIssue,
  ValidationResult,
} from './types';

export {
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
  type UKRegionOption,
} from './codes';

export {
  UK_AVERAGE_RENT,
  UK_DEFAULT_SALARY,
  UK_DEFAULT_SALARY_NOTE,
  UK_DEFAULT_SOURCES,
  UK_DEFAULT_SPENDING,
  UK_REGIONAL_RENT,
  UK_SALARY_YEAR,
  regionalRent,
  regionalRentMonth,
  type UKDefaultSource,
} from './defaults';

export {
  UK_STATE_PENSION,
  atStatePensionAge,
  statePensionEntered,
  statePensionFor,
  type UKStatePensionTable,
  type UKStatePensionYear,
} from './statePension';

export {
  UK_CHILD_AGE_MESSAGE,
  UK_NEW_CHILD_AGE,
  UK_OLDEST_CHILD_AGE,
  UK_YOUNG_PERSON_AGE,
  asksEducation,
} from './children';

export {
  addChild,
  cloneDraft,
  createBlankDraft,
  createTypicalDraft,
  removeChild,
  setChildCount,
  updateChild,
  updateHead,
  updatePartner,
} from './draft';

export { UK_HOUSEHOLD_LIMITS, UK_POLICY_YEARS, isComplete, validate, type UKValidateOptions } from './validate';
export { deserializeDraft, serializeDraft } from './serialize';

export * from './adapters';
