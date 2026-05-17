# policyengine-household-wizard

Shared wizard primitives and US household draft contract for PolicyEngine apps.

## Commands

- Install: `bun install`
- Build: `bun run build`
- Test: `bun run test`
- Type check: `bun run typecheck`
- Refresh county data: `bun run regenerate-counties`

## Architecture

- **Vite library mode** — builds ESM + CJS + types for `index`, `primitives`,
  `us-household`, and `us-household-adapters` entry points.
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
  `tests/us-household/fixtures/`.
- New country (e.g. UK) → mirror the structure under
  `src/uk-household/` rather than mixing into `us-household/`.
