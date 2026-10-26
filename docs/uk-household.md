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
`message`. It checks only what the calculation reads, against the bounds and
policy years the household impact API applies (`UK_HOUSEHOLD_LIMITS` and
`UK_POLICY_YEARS`, 2026 to 2031), so a draft that passes builds a request the
API accepts when it is sent with at least one measure the API knows (it
refuses an empty `policies` list) and parts it knows. Pass `years` to check
against an app's own policy years instead.

| Code | When |
| --- | --- |
| `year.unsupported` | The year is not a whole number, or not in `years` (`UK_POLICY_YEARS` unless given). |
| `salaryYear.unsupported`, `salaryYear.afterYear` | Salaries for a year not in `years`, or after the policy year (they are only grown forward). |
| `region.*`, `tenure.*`, `councilTaxBand.*` | `.required` when unanswered, `.invalid` for an unknown code. |
| `claimsUniversalCredit.required` | Not answered. |
| `head.age.*`, `partner.age.*` | `.required`, `.notWhole`, `.outOfRange` (16 to 100). The partner only with a partner. |
| `<amount>.required`, `.notANumber`, `.negative`, `.tooLarge` | Each amount the request sends. A private pension and electricity may be left out. |
| `head.studentLoanPlan.invalid` | An unknown plan. |
| `head.statePension.*`, `partner.statePension.*` | Only as entered and at State Pension age in the year. |
| `children.tooMany` | More than 10 children. |
| `children[i].required` | No child at that place in the list (a hole, or `null`). |
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

The keys are documented in `src/uk-household/serialize.ts`. A draft read
back from its link is the same draft, except that a private pension left out
(`null` or `undefined`) comes back as 0 and electricity left out as `null`:
each means the same and gives the same request. Also, -0 comes back as 0;
an age, salary year or amount that is not a finite number is not written, so
it comes back blank and the salary year as the default year; a child missing
from the list (a hole or `null`) comes back unanswered; and an education
answer other than `true` or `false` comes back unanswered. Reading never
throws: unknown codes come back unanswered and amounts that are not numbers
come back blank. `extras` are not written.

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
`validate()` accepts builds a request the API accepts, and that drafts
round-trip through links.

"The API accepts" is checked against `reference/householdImpactApi.ts`, a
mirror of the validation the API's endpoint does before its own code runs.
It reads the request models' JSON schema and choices (regions, measures,
policy years and the rest) from `tests/fixtures/uk/household-impact-api.json`,
which `tests/fixtures/uk/capture_household_impact_api.py` writes.

The capture runs the dashboard's own API. It exports a commit with
`git archive` and installs exactly what that commit's `uv.lock` pins
(`uv run --frozen --exact`). Python runs with `-B` and an empty
`pycache_prefix`, so every module runs from its source rather than from
cached bytecode, with `-X utf8`, and without the `PYTHON*` environment
variables apart from `PYTHONPATH`, so it runs in the same mode whatever the
shell sets. The capture stops if Python runs optimized (`-O`), which drops
its checks. Before it imports the dashboard, it checks five things:
- the files are the commit's;
- the environment sees no site-packages but its own: not those of the
  Python install it was made from, nor the user's;
- every package installed is the version the lock pins, which the lock
  takes from PyPI, each copy if one shadows another;
- each package has a `RECORD`, apart from the project's egg-info, which
  must be beside the sources the project's install adds to the path, or
  in the export's `src`, where the first check lets one be (its own list
  of them is not used). Each file a `RECORD` lists has a hash,
  apart from the `RECORD` itself, and is as the `RECORD` says, the
  project's own install included. Every `.pth` file is a file a `RECORD`
  hashes, or uv's shim, and the project's has no line that runs code. The
  project's install adds nothing to site-packages but its metadata and
  that `.pth` file: its code is the commit's. These checks run once the
  interpreter has started, so a `.pth` file they stop on has already run.
  They do not check the files against the wheels the lock pins: a package
  changed along with its `RECORD` passes them, but changes the digest
  `environment` records (below);
- pydantic, pydantic-core, FastAPI, Starlette and policyengine-uk are
  imported from those installs.

Once it is done, it checks that every module loaded from a file, and every
file opened through Python, was the interpreter's own, a package's file in
site-packages that the environment's digest covers (not one a `RECORD`
lists elsewhere), one of the commit's or the capture itself. The
interpreter's own library is the standard library and its extension
modules in the Python install the venv was made from, none of its
site-packages; it is trusted, and `environment` records its version and
flags, not its files. A module whose spec or
`__file__` names anything but a regular file, such as a path in an archive,
stops it.

It then imports `uk_budget_data.api` and replaces only the calculation
(`household_impact.calculate_household_impact`) with one that counts its
calls. It starts the app's lifespan as the server does, and posts `app`
7,878 bodies through Starlette's test client:
- each field set to each kind of value pydantic converts or refuses
  (number text included, down to underscores and integer text longer than
  4,300 characters, the minus sign counted);
- each household field again with a partner;
- unknown and prototype keys;
- text holding an unpaired surrogate;
- the year rules;
- random combinations of these;
- the 32 dashboard requests.

It records each verdict, its status and the errors in each refusal. An
accepted body must have reached the calculation exactly once. A refused one
must not have reached it. It must be a 422, or the 500 the API gives when
an error it would report holds an unpaired surrogate, which cannot be
written as UTF-8. The capture stops on anything else, since what the
endpoint's own code refuses once it runs (a `ValueError` is a 400, a
calculation past its time limit a 504) is not covered.

`apiMirror.test.ts` checks that the mirror gives every body the same
verdict, status and errors. The capture runs the app as the dashboard
wrote it (its middleware, exception handlers, routes, models and the values
they read), so a change that alters the API's answer to any case alters the
fixture. The fixture also records what the mirror copies, and what the API
runs and reads, so a change no case shows still fails the test:

- `features`: each pydantic feature the models' core schema uses, such as
  `int.ge` or `model.config.extra_fields_behavior='forbid'`, and each of
  its serialization schemas (after `serialization:`), since the endpoint
  dumps the request and checks it again. The test fails on any the mirror
  does not implement (`MIRRORED_FEATURES`). Strict mode, string trimming, a
  new validator type or a serializer cannot pass unnoticed.
- `validators`: the code of the models' four validators (the policy year,
  the salary year twice, and the measures), which the mirror copies by
  hand. The test fails when one is added, removed or changed until the
  mirror copies it again.
- `choices`: the policy years and measure ids are read through the
  validators' own globals, as the validators read them; the other choices
  come from the JSON schema's enums. The capture reads them again after the
  cases and stops if they changed.
- `code`: every other function of the dashboard's that started or resumed
  while the API answered the cases, found with `sys.monitoring` in every
  thread. It holds the endpoint, the code before and after the calculation
  (the definitions query, checking the request again, building the
  answers, the workers, timing), and the lifespan. A function is the
  dashboard's when its file is one of the commit's, wherever it is in the
  repository. The mirror lists the sha256 of each one's code as read
  (`REVIEWED_DASHBOARD_CODE`), and the test fails when one changes, is
  added or no longer runs.
- `files`: the sha256 of each of the commit's files the API's process
  loaded as a module or opened through Python: 31 Python modules and
  `budget_years.json`. The mirror lists them with the commit they were read
  at (`REVIEWED_DASHBOARD_FILES`). The test fails when one changes, is
  added or is no longer loaded. That covers what runs at import: a patch to
  a library, a function wrapped at import, a module the API loads from
  outside `src/`. An audit hook sees the files opened. It sees `open` and
  `os.open`, which pandas and numpy use, but not a C library that opens a
  file itself, as h5py's HDF5 does. At 5ee4e23e the API calls no
  `h5py.File`; if it ever reads data that way, add those files by hand.
- `environment`: the interpreter, its flags (`sys.flags`), its `-X` and
  `-W` options, and the platform; each package installed besides the
  dashboard's own (94 of them), with its version and a sha256 of its files
  in site-packages (each one's path and the hash its `RECORD` gives and the
  capture checks), so a file changed along with its `RECORD` still changes
  it; the entry points of the dashboard's own install, whose files name the
  export's path and are otherwise not recorded; the sha256 of uv's shim
  (`_virtualenv.py` and its `.pth`), which uv writes, so a capture whose
  venv was made by a uv that writes another shim fails the test, naming
  `_virtualenv.py` (the reviewed venv is uv 0.11.7's; 0.12.13 writes
  another shim); and
  that of the commit's `.python-version`, `pyproject.toml` and `uv.lock`,
  which decide the rest.
  The mirror lists them with the commit they were read at
  (`REVIEWED_DASHBOARD_ENVIRONMENT`), and the test fails when any changes. Starlette parses the body with the interpreter's
  `json.loads`, and pydantic validates it with pydantic-core,
  typing-inspection and annotated-types, so a new version of any of them
  can change what the API accepts on bodies no case sends.

`code` and `files` cover code that refuses a body no case sends, such as a
check added to `answers()`, and `environment` a library change no case
shows. When one fails, read what changed: the failure names the functions
whose code changed (`code`), the `git diff` to run in the dashboard
(`files`), or the packages and settings that changed and the `git diff` of
the files that decide them (`environment`). Follow in the mirror anything
that changes what the API refuses before the calculation, then record the
new hashes or versions and the commit. Code is recorded as `ast.unparse` gives it without
docstrings, so formatting and docstrings do not count. The route's
decorator and parameters do, documentation keywords such as `summary`
included.

`--source` and `--python` run the capture on an export and environment made
before, without a network. The same checks apply; the interpreter itself is
trusted, and its version and flags are recorded.

When the dashboard's API changes, rerun the capture (its docstring has the
command), then update `UK_HOUSEHOLD_LIMITS`, `UK_POLICY_YEARS` and the
adapter together; the tests say what no longer matches. Add fixtures captured
from the dashboard's code for a new field. Leave
`reference/dashboardRequest.ts` as it is: it records what the dashboard sent
before it used this package.
