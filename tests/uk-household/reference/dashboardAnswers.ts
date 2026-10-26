// @ts-nocheck
/**
 * The Autumn Budget 2026 dashboard's form answers for a draft: a copy of
 * `answersFromDraft` in its src/utils/householdDraft.js, so the parity tests
 * can feed a draft to the dashboard's own request builder
 * (dashboardRequest.ts). The form takes salaries for 2026 only, so drafts
 * compared this way have `salaryYear` 2026.
 */
export function answersFromDraft(draft) {
  return {
    current_age: draft.head.age,
    current_salary: draft.head.employmentIncome,
    region: draft.region,
    tenure: draft.tenure,
    monthly_rent: draft.monthlyRent,
    student_loan_plan: draft.head.studentLoanPlan,
    has_partner: draft.hasPartner,
    partner_age: draft.partner.age,
    partner_salary: draft.partner.employmentIncome,
    children_ages: draft.children.map((child) => child.age).join(", "),
    children_in_education: draft.children.map((child) => child.inEducation !== false),
    claims_universal_credit: draft.claimsUniversalCredit,
    council_tax_band: draft.councilTaxBand,
    salary_sacrifice_per_year: draft.head.salarySacrificePensionContributions,
    petrol_spending_per_year: draft.spending.petrol,
    diesel_spending_per_year: draft.spending.diesel,
    electricity_spending_per_year: draft.spending.electricity,
    dividends_per_year: draft.head.dividendIncome,
    savings_interest_per_year: draft.head.savingsInterestIncome,
    property_income_per_year: draft.head.propertyIncome,
    private_pension_per_year: draft.head.privatePensionIncome,
    partner_private_pension_per_year: draft.partner.privatePensionIncome,
    monthly_childcare: draft.monthlyChildcare,
    state_pension_per_year: draft.head.statePension,
    partner_state_pension_per_year: draft.partner.statePension,
  };
}
