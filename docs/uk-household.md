# UK household model

Import the model from `policyengine-household-wizard/uk-household` and the
request adapter from `policyengine-household-wizard/uk-household/adapters`
(the first re-exports the second). The root export stays the US model's,
because the two share names such as `createBlankDraft` and `validate`.

The model is the one the Autumn Budget 2026 dashboard
(PolicyEngine/uk-autumn-budget-dashboard-2026) asks its household questions
with, so every app that shares it describes a UK household the same way. Apps
own their layout, questions and copy; the package owns what a household is.

```ts
import {
  createTypicalDraft,
  updateHead,
  validate,
  serializeDraft,
  toHouseholdImpactRequest,
} from 'policyengine-household-wizard/uk-household';

const draft = updateHead(createTypicalDraft(), { age: 41, employmentIncome: 52000 });
const result = validate(draft, { year: 2027 });
if (result.ok) {
  const body = toHouseholdImpactRequest(draft, { year: 2027, policies: ['road_fuel_vat_cut'] });
  // POST body to the dashboard's /api/household-impact
}
const link = `?${serializeDraft(draft)}`;
```

## The draft

`UKHouseholdDraft` has one adult answering (`head`), an optional partner, and
children. The partner's answers are kept when `hasPartner` is off, so a form
that switches the partner off and on again keeps them; nothing reads them
without a partner.

| Field | Meaning |
| --- | --- |
| `salaryYear` | The year salaries are entered for (`UK_SALARY_YEAR`, 2026). The policy year is not in the draft: one household is compared across years. |
| `region` | A `UKRegion` code, in policyengine-uk's order (`UK_REGIONS`, with its labels). |
| `head`, `partner` | `age`, `employmentIncome`, `privatePensionIncome`, `statePension`. `head` adds `studentLoanPlan`, `salarySacrificePensionContributions`, `dividendIncome`, `savingsInterestIncome` and `propertyIncome`. |
| `children` | Each child's `age` (0 to 19) and, from 16, `inEducation` (full-time non-advanced education; yes until answered). |
| `tenure`, `monthlyRent` | Rent is read only for the three rented tenures; `null` is the region's average private rent. |
| `councilTaxBand` | A to I (Wales has I). |
| `claimsUniversalCredit` | Whether the household claims the Universal Credit it is due. |
| `monthlyChildcare` | Read only with children. |
| `spending` | `petrol` and `diesel` a year, and `electricity` (`null` is the average household's). |

A `statePension` of `null` is the full new State Pension; a number, 0
included, is what the person gets. It is read only from State Pension age in
the policy year.

`createBlankDraft()` leaves every choice and age unanswered, for forms that
ask everything. `createTypicalDraft()` is the dashboard's starting answers.
`cloneDraft`, `updateHead`, `updatePartner`, `addChild`, `removeChild`,
`updateChild` and `setChildCount` return new drafts and never change the one
given.

## Defaults and their sources

| Default | Value | Source (`UK_DEFAULT_SOURCES`) |
| --- | --- | --- |
| `UK_DEFAULT_SALARY` | £34,200 | ONS ASHE 2026 provisional, Table 6.7a: median £34,229, April 2026 |
| `UK_REGIONAL_RENT` | £790 (North East) to £2,338 (London) a month | ONS Price Index of Private Rents, September 2026 (Northern Ireland: July 2026), published 21 October 2026 |
| `UK_AVERAGE_RENT` | £1,406 a month | The same release, UK |
| `UK_DEFAULT_SPENDING` | Petrol £620, diesel £340, electricity £1,040 a year | ONS Family Spending FYE 2025, Workbook 1, Table A1 (weekly spending times 52) |

The rest of the typical draft (age 30, the North West, renting privately,
band D, claiming Universal Credit, no student loan) are the dashboard's
choices, listed on `createTypicalDraft`.

## Validation

`validate(draft, { year, years?, statePension? })` returns
`{ ok, issues }`, each issue a `code`, the `path` of the answer and a
`message`. It checks only what the calculation reads, against the bounds the
household impact API applies (`UK_HOUSEHOLD_LIMITS`), so a draft that passes
builds a request the API accepts. Pass `years` (the policy years the app
covers) to check the year itself.

| Code | When |
| --- | --- |
| `year.unsupported` | The year is not a whole number, or not in `years`. |
| `salaryYear.unsupported`, `salaryYear.afterYear` | Salaries for a year not covered, or after the policy year (they are only grown forward). |
| `region.*`, `tenure.*`, `councilTaxBand.*` | `.required` when unanswered, `.invalid` for an unknown code. |
| `claimsUniversalCredit.required` | Not answered. |
| `head.age.*`, `partner.age.*` | `.required`, `.notWhole`, `.outOfRange` (16 to 100). The partner only with a partner. |
| `<amount>.required`, `.notANumber`, `.negative`, `.tooLarge` | Each amount the request sends. A private pension and electricity may be left out. |
| `head.studentLoanPlan.invalid` | An unknown plan. |
| `head.statePension.*`, `partner.statePension.*` | Only as entered and at State Pension age in the year. |
| `children.tooMany` | More than 10 children. |
| `children[i].age.*` | `.required`, `.notWhole`, `.negative`, `.tooOld` (20 or over, with `UK_CHILD_AGE_MESSAGE`). |
| `monthlyRent.*`, `monthlyChildcare.*` | Rent only when renting; childcare only with children. |

## State Pension age

`UK_STATE_PENSION` is State Pension age and the full new State Pension for
2026 to 2031, from the dashboard's `state_pension.json`, which its tests check
against policyengine-uk 2.132.6. Both change with the model, so an app that
keeps its own copy, checked against its own model, passes it as
`statePension` to `validate()` and `toHouseholdImpactRequest()`.
`statePensionFor(year)` reads a year's row, or the first later year's, or the
last.

## Links

`serializeDraft` writes a draft as URL parameters, and `deserializeDraft`
reads them back (a string or a `URLSearchParams`):

```
sy=2026&region=LONDON&tenure=RENT_PRIVATELY&rent=1500&band=D&uc=1
&you=34:e42000:lPLAN_2&hp=1&partner=33:e28000&c=7,17n
&petrol=620&diesel=340&elec=1040&cc=400
```

The keys are documented in `src/uk-household/serialize.ts`. Every draft
round-trips, and reading never throws: unknown codes come back unanswered and
amounts that are not numbers come back blank. `extras` are not written.

## The household impact request

`toHouseholdImpactRequest(draft, { year, policies, include?, statePension? })`
gives the body of the dashboard's `POST /api/household-impact`. It sends the
answers as they are, so validate first. It holds, for every draft:

- the keys come in one fixed order, so the same answers always give the same
  JSON text (the dashboard keys its caches on it);
- without a partner, no partner answer is read: the partner's salary and
  pension are sent as 0 and no partner State Pension is sent. The partner's
  age is sent anyway, as the dashboard always has, unless it is one the API
  would refuse (unanswered, or not a whole number from 16 to 100);
- rent only when renting, as entered or the region's average; childcare only
  with children;
- `in_education` for children from 16 to 19 only, true unless answered false;
- a State Pension only as entered and at State Pension age in the year;
- the draft is not changed, and the policies and parts are copied.

## How it is tested

`tests/fixtures/uk/dashboard-households.json` holds 32 households: the
dashboard's starting answers, its eight example households and edge cases of
its form, each with the request the dashboard's own code built for it at
commit cc15d50e. Every fixture must give that request byte for byte.
`tests/uk-household/reference/` keeps a verbatim copy of that code, and
property tests compare the adapter with it for every draft the dashboard's
form can hold. Two differences are intended, both on requests the API
refused: a partner age it would refuse is left out without a partner, and a
region named after an object built-in (`constructor`) takes the UK average
rent. Other property tests check the invariants above, that every draft
`validate()` accepts builds a request the API's constraints accept
(`reference/householdImpactApi.ts` mirrors them), and that drafts round-trip
through links.

When the dashboard's API changes, update `UK_HOUSEHOLD_LIMITS`, the adapter
and the API mirror together, and add fixtures captured from the dashboard's
code. Leave the reference copy as it is: it records what the dashboard sent
before it used this package.
