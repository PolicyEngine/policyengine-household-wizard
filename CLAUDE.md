# policyengine-household-wizard

Shared wizard primitives and US and UK household draft contracts for PolicyEngine apps.

## Commands

- Install: `bun install`
- Build: `bun run build`
- Test: `bun run test`
- Type check: `bun run typecheck`
- Type-check an app that uses the build (after `bun run build`): `bun run check:consumer-types`
- Refresh county data: `bun run regenerate-counties`
- Refresh the PolicyEngine US variable graph: `bun run regenerate-variable-graph`
- Check the V1 payload against the live API: `bun run test:live`

## Architecture

- **Vite library mode** — builds ESM + CJS + types for `index`, `primitives`,
  `us-household`, `us-household-adapters`, `uk-household`, and
  `uk-household-adapters` entry points. The root `index` exports the
  primitives and the US model only; the UK model shares its names, so it is
  imported from its subpath.
- **No UI shell** — the package exposes primitives (option card, progress,
  navigation, review list, `useWizardSteps`) and a data contract; apps build
  their own form layouts.
- **No app-v2 dependency** — the wizard package knows nothing about app-v2's
  `Household` model. app-v2 owns the conversion via a `Household.fromUSDraft`
  adapter that consumes this package's `USHouseholdDraft`.

## Coding conventions

- **Sentence case** for all user-facing copy (issue copy, error messages,
  example labels). Matches PolicyEngine global guidance.
- **No defaults for state/age/marital status** — `createBlankDraft()` must
  always return `null`/empty for those fields.
- **Marital status, not filing status** in the public API. Filing status is an
  output of the model adapter, never a wizard input.
- **PolicyEngine API field names** in adapters — `employment_income`,
  `state_name`, `is_disabled`, etc. — but **camelCase** in `USPersonDraft`
  (`employmentIncome`, `isDisabled`). The adapter is the only place these
  cross.
- **Vitest** for all tests. `@testing-library/react` for components.
- **No emoji icons** in source.

## Release flow

Releases happen on `main` via `.github/workflows/push.yml` (modeled on
`@policyengine/ui-kit`):

1. Open a PR with a changelog fragment in `changelog.d/<branch>.<type>.md`.
2. CI on the PR (`.github/workflows/pr.yaml`) runs build + tests.
3. On merge, the push workflow bumps the version (towncrier), builds the
   changelog, publishes to npm, and commits the version bump.

Fragment types and their bump levels live in `.github/bump_version.py`.

## When extending

- New wizard primitive → `src/primitives/`, re-export from
  `src/primitives/index.ts`.
- New US household field → add to `USPersonDraft`/`USHouseholdDraft` in
  `src/us-household/types.ts`, update `createBlankDraft`, `normalizeLegacyDraft`,
  `validate`, and `toV1HouseholdPayload` together. Always add a fixture in
  `tests/fixtures/`. Prefer component variables to totals
  (`social_security_retirement`, not `social_security`); a total needs a
  reviewed entry in `tests/us-household/v1PayloadInvariants.test.ts`. Map
  fields to input variables. A variable PolicyEngine US computes must be sent
  for every person or no one (policyengine-core stores one array per variable
  for a whole entity, so a partial input overrides everyone else's formula);
  the invariant tests enforce this, with reviewed exceptions in
  `REVIEWED_PARTIAL_COMPUTED`. Amounts paid go in `USPersonExpenses` and
  `EXPENSE_TO_VARIABLE`; an income the model also counts inside another
  variable (tips inside wages) goes in `INCOME_ALSO_ADDED_TO`, with a
  `REVIEWED_SHARED_VARIABLES` entry. A computed total that apps have set by
  mistake (`mortgage_interest`) goes in `GUARDED_TOTALS` in
  `scripts/generate-variable-graph.ts`, so the tests check that it is still a
  total and that no field sets it. Then run
  `bun run regenerate-variable-graph` so the invariant tests see the new
  variable.
- New UK household field → add to `src/uk-household/types.ts` and update
  `createBlankDraft`, `createTypicalDraft`, `validate` (with its bound in
  `UK_HOUSEHOLD_LIMITS`), `serializeDraft`/`deserializeDraft` and
  `toHouseholdImpactRequest` together. The request must stay byte-identical
  to what the UK Autumn Budget 2026 dashboard sent: the fixtures in
  `tests/fixtures/uk/dashboard-households.json` were captured from its code,
  and `tests/uk-household/reference/dashboardRequest.ts` is a verbatim copy
  of that code. Never edit the reference to match the package; a new field
  needs fixtures captured from the dashboard, and an intended difference
  needs its own test and an entry in `docs/uk-household.md`. When the
  dashboard's request models change, rerun
  `tests/fixtures/uk/capture_household_impact_api.py` (its docstring has the
  command): the API mirror, `reference/householdImpactApi.ts`, reads their
  schema from the fixture it writes, and `apiMirror.test.ts` checks the
  mirror against the verdicts of the dashboard's own app, run at that commit
  in the environment its `uv.lock` pins. It also fails on a pydantic feature
  the models use that the mirror does not implement (`MIRRORED_FEATURES`),
  on a changed validator until the mirror copies it, and on a change to any
  other dashboard code that runs while the API answers, or any dashboard
  file the API loads or reads, until it is read and its hash recorded
  (`REVIEWED_DASHBOARD_CODE`, `REVIEWED_DASHBOARD_FILES`).
- New country → mirror the structure of `src/us-household/` and
  `src/uk-household/` rather than mixing into either.
