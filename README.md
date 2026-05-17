# @policyengine/household-wizard

Shared wizard primitives and a US household draft contract for PolicyEngine
apps (cliff-watch, Coverage Compass, app-v2, and standalone calculators).

The package ships two surfaces:

- **Wizard primitives** — copy-neutral React primitives for step state, progress,
  navigation, option cards, and review screens. No household-specific code.
- **US household model** — a draft type that starts blank for state, age, and
  marital status (issue #1044), validation rules, URL serialization,
  state-filtered counties, and adapters to the PolicyEngine API V1 household
  payload.

## Install

```bash
bun add @policyengine/household-wizard
# or
npm install @policyengine/household-wizard
```

React 19 is a peer dependency.

If you want the default look, import the stylesheet once:

```ts
import '@policyengine/household-wizard/styles.css';
```

The CSS uses ui-kit CSS variables (`--primary`, `--border`, `--accent`, …) when
they're present, with safe fallbacks otherwise. Apps already on
`@policyengine/ui-kit` will inherit the teal theme automatically.

## Quick start

```tsx
import {
  useWizardSteps,
  WizardProgress,
  WizardNavigation,
  WizardOptionCard,
  WizardReviewList,
  createBlankDraft,
  applyMaritalStatusChange,
  validate,
  toV1HouseholdPayload,
  US_STATES,
  getCountiesByState,
  type USHouseholdDraft,
} from '@policyengine/household-wizard';

const steps = [
  { id: 'location', label: 'Location', isComplete: (d: USHouseholdDraft) => !!d.state },
  { id: 'marital', label: 'Marital status', isComplete: (d: USHouseholdDraft) => !!d.maritalStatus },
  { id: 'review', label: 'Review' },
];

function MyWizard() {
  const [draft, setDraft] = useState(createBlankDraft());
  const wizard = useWizardSteps({ steps, state: draft });

  // ...render WizardProgress, step bodies, WizardNavigation
}
```

See [`docs/api.md`](docs/api.md) for the full API and [`docs/migration.md`](docs/migration.md)
for migrating from each app's local wizard.

## Design decisions

- **Marital status, not filing status.** The wizard asks users marital status
  in plain English; apps derive filing status (single, head of household,
  married filing jointly, …) in their own model adapters.
- **No defaults for state, age, or marital status.** `createBlankDraft()`
  returns a draft with all three set to `null`/empty. The wizard explicitly
  surfaces those fields rather than picking a quiet default like California or
  age 30.
- **State-filtered counties.** Counties come from a bundled JSON generated
  from PolicyEngine US metadata. Use `getCountiesByState('CA')` to get the
  options for the chosen state. Refresh with `bun run regenerate-counties`.
- **Adapters, not a UI shell.** Apps render their own form layouts and pass
  the draft through `validate()` and `toV1HouseholdPayload()` (or their own
  app-specific adapter) at submit time.

## Repository structure

```
src/
  primitives/        useWizardSteps, WizardProgress, WizardNavigation, …
  us-household/      types, draft, validate, normalize, serialize, counties
    adapters/        toV1HouseholdPayload — PolicyEngine API V1 envelope
    data/            counties-by-state.json
tests/               vitest unit and round-trip tests
scripts/             generate-counties.ts
```

## Development

```bash
bun install
bun run test
bun run typecheck
bun run build
```

Changes follow the towncrier convention used by `@policyengine/ui-kit`. Add a
fragment in `changelog.d/` before opening a PR:

```bash
echo "Describe your change." > changelog.d/your-branch.added.md
```

Fragment types: `added` (minor), `changed` (patch), `fixed` (patch),
`removed` (minor), `breaking` (major). The release workflow on `main` bumps
the version, builds the changelog, publishes to npm, and commits the bump.
