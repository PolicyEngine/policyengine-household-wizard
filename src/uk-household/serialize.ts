import { isUKCouncilTaxBand, isUKRegion, isUKStudentLoanPlan, isUKTenure } from './codes';
import { createBlankDraft } from './draft';
import type { UKAdultDraft, UKChildDraft, UKHeadDraft, UKHouseholdDraft } from './types';

/**
 * A compact, URL-safe form of a UK household draft, so apps that share the
 * model can link to the same household. The keys are stable:
 *
 *   sy=2026&region=LONDON&tenure=RENT_PRIVATELY&rent=1500&band=D&uc=1
 *   &you=34:e42000:lPLAN_2&hp=1&partner=33:e28000&c=7,17n
 *   &petrol=620&diesel=340&elec=1040&cc=400
 *
 * - `sy`: the salary year; `region`, `tenure`, `band`: codes; `uc`: 1 or 0
 *   for claiming Universal Credit. Unanswered choices are left out.
 * - `rent`: monthly rent, left out for the regional average (`null`).
 * - `you` and `partner`: the age (empty when unanswered), then
 *   colon-separated tokens, each a letter and a number: `e` employment
 *   income, `p` private pension, `s` State Pension (left out for the full
 *   rate), and for `you` only `x` salary sacrifice, `d` dividends, `i` savings
 *   interest, `r` property income and `l` the student loan plan (a code).
 *   Amounts of 0 and a plan of `NONE` are left out. `partner` is written
 *   whenever it holds answers, with or without a partner (`hp=1`).
 * - `c`: each child's age (empty when unanswered), comma-separated, with `y`
 *   or `n` after it once their education is answered.
 * - `petrol`, `diesel`, `cc` (childcare a month): left out when 0; `elec`:
 *   left out for the default (`null`).
 *
 * `extras` are not written, nor is an age, year or amount that is not a
 * finite number: it comes back blank, and the salary year as the default
 * year. A child missing from the list (a hole or `null`) is written as an
 * unanswered child, and an education answer other than true or false is
 * not written. A private pension or electricity left out (`undefined`)
 * comes back as 0 or `null`, which mean the same. Unknown codes in a link
 * are read as unanswered (a plan as `NONE`), and an amount that is not a
 * number keeps its blank value.
 */

type NumberKey<T> = { [K in keyof T]-?: T[K] extends number | null | undefined ? K : never }[keyof T];

const ADULT_TOKENS: Array<[NumberKey<UKAdultDraft>, string]> = [
  ['employmentIncome', 'e'],
  ['privatePensionIncome', 'p'],
  ['statePension', 's'],
];

const HEAD_TOKENS: Array<[NumberKey<UKHeadDraft>, string]> = [
  ['salarySacrificePensionContributions', 'x'],
  ['dividendIncome', 'd'],
  ['savingsInterestIncome', 'i'],
  ['propertyIncome', 'r'],
];

const PLAN_TOKEN = 'l';

const blank = createBlankDraft();

// Only a finite number is written; anything else reads back blank
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

// An age as written: empty when unanswered (or not a finite number)
const writeAge = (age: unknown) => (isFiniteNumber(age) ? String(age) : '');

function writeAdult(adult: UKAdultDraft, tokens: Array<[string, string]>): string {
  const record = adult as unknown as Record<string, unknown>;
  const segments = [writeAge(adult.age)];
  for (const [key, letter] of tokens) {
    const value = record[key];
    if (!isFiniteNumber(value)) continue;
    // The State Pension's blank is null (the full rate), so its 0 is an answer
    if (value === 0 && key !== 'statePension') continue;
    segments.push(`${letter}${value}`);
  }
  return segments.join(':');
}

// A finite number, or undefined; -0 is read as 0, as it is written
function readNumber(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  return value === 0 ? 0 : value;
}

function readAdult<T extends UKAdultDraft>(raw: string, base: T, tokens: Array<[string, string]>): T {
  const [ageText = '', ...rest] = raw.split(':');
  const adult = { ...base };
  const fields = adult as unknown as Record<string, unknown>;
  adult.age = readNumber(ageText) ?? null;
  for (const token of rest) {
    const letter = token[0];
    const text = token.slice(1);
    if (letter === PLAN_TOKEN && 'studentLoanPlan' in base) {
      (adult as unknown as UKHeadDraft).studentLoanPlan = isUKStudentLoanPlan(text) ? text : 'NONE';
      continue;
    }
    const match = tokens.find(([, l]) => l === letter);
    const value = readNumber(text);
    if (match && value !== undefined) fields[match[0]] = value;
  }
  return adult;
}

// A missing child (a hole in the list, or null) is written as an unanswered one
function writeChild(child: UKChildDraft | null | undefined): string {
  const age = writeAge(child?.age);
  const education = child?.inEducation === true ? 'y' : child?.inEducation === false ? 'n' : '';
  return `${age}${education}`;
}

function readChild(raw: string): UKChildDraft {
  const last = raw.slice(-1);
  const answered = last === 'y' || last === 'n';
  const child: UKChildDraft = { age: readNumber(answered ? raw.slice(0, -1) : raw) ?? null };
  if (answered) child.inEducation = last === 'y';
  return child;
}

const sameAdult = (a: UKAdultDraft, b: UKAdultDraft) =>
  a.age === b.age &&
  a.employmentIncome === b.employmentIncome &&
  (a.privatePensionIncome ?? 0) === (b.privatePensionIncome ?? 0) &&
  a.statePension === b.statePension;

export function serializeDraft(draft: UKHouseholdDraft): string {
  const params = new URLSearchParams();
  if (isFiniteNumber(draft.salaryYear)) params.set('sy', String(draft.salaryYear));
  if (draft.region) params.set('region', draft.region);
  if (draft.tenure) params.set('tenure', draft.tenure);
  if (isFiniteNumber(draft.monthlyRent)) params.set('rent', String(draft.monthlyRent));
  if (draft.councilTaxBand) params.set('band', draft.councilTaxBand);
  if (typeof draft.claimsUniversalCredit === 'boolean') params.set('uc', draft.claimsUniversalCredit ? '1' : '0');

  let you = writeAdult(draft.head, [...ADULT_TOKENS, ...HEAD_TOKENS]);
  if (draft.head.studentLoanPlan && draft.head.studentLoanPlan !== 'NONE') {
    you += `:${PLAN_TOKEN}${draft.head.studentLoanPlan}`;
  }
  params.set('you', you);
  if (draft.hasPartner) params.set('hp', '1');
  if (draft.hasPartner || !sameAdult(draft.partner, blank.partner)) {
    params.set('partner', writeAdult(draft.partner, ADULT_TOKENS));
  }
  if (draft.children.length > 0) params.set('c', Array.from(draft.children, writeChild).join(','));

  const { petrol, diesel, electricity } = draft.spending;
  if (isFiniteNumber(petrol) && petrol !== 0) params.set('petrol', String(petrol));
  if (isFiniteNumber(diesel) && diesel !== 0) params.set('diesel', String(diesel));
  if (isFiniteNumber(electricity)) params.set('elec', String(electricity));
  if (isFiniteNumber(draft.monthlyChildcare) && draft.monthlyChildcare !== 0) {
    params.set('cc', String(draft.monthlyChildcare));
  }
  return params.toString();
}

export function deserializeDraft(query: string | URLSearchParams): UKHouseholdDraft {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query;
  const draft = createBlankDraft();
  const number = (key: string) => {
    const raw = params.get(key);
    return raw === null ? undefined : readNumber(raw);
  };

  const salaryYear = number('sy');
  if (salaryYear !== undefined) draft.salaryYear = salaryYear;
  const region = params.get('region');
  draft.region = isUKRegion(region) ? region : null;
  const tenure = params.get('tenure');
  draft.tenure = isUKTenure(tenure) ? tenure : null;
  draft.monthlyRent = number('rent') ?? null;
  const band = params.get('band');
  draft.councilTaxBand = isUKCouncilTaxBand(band) ? band : null;
  const uc = params.get('uc');
  draft.claimsUniversalCredit = uc === '1' ? true : uc === '0' ? false : null;

  const you = params.get('you');
  if (you !== null) draft.head = readAdult(you, draft.head, [...ADULT_TOKENS, ...HEAD_TOKENS]);
  draft.hasPartner = params.get('hp') === '1';
  const partner = params.get('partner');
  if (partner !== null) draft.partner = readAdult(partner, draft.partner, ADULT_TOKENS);
  const children = params.get('c');
  if (children !== null) draft.children = children.split(',').map(readChild);

  draft.spending = {
    petrol: number('petrol') ?? 0,
    diesel: number('diesel') ?? 0,
    electricity: number('elec') ?? null,
  };
  draft.monthlyChildcare = number('cc') ?? 0;
  return draft;
}
