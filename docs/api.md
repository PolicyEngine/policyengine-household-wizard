# Wizard navigation and focus

Import the primitives from `policyengine-household-wizard/primitives`. Apps own
questions, answers, layouts, validation messages, and calculation requests.

## useWizardSteps

Pass `steps`, application `state`, and optional `initialStepId`, `onStepChange`,
`onComplete`, `onInvalidStep`, and `advanceRequest` options. Each step has a stable
`id` and `label`, with optional `isVisible(state)`, `isComplete(state)`, and
`autoAdvance` properties. Omitting `isComplete` leaves validation to the app.

The hook returns:

| Property or method | Behavior |
| --- | --- |
| `visibleSteps`, `currentStep` | Resolved IDs and labels; current step is `null` when no steps are visible. |
| `currentStepIndex`, `totalSteps`, `isFirstStep`, `isLastStep` | Position among currently visible steps. |
| `canAdvance` | Current step's completion predicate, or `true` when none exists. |
| `goNext()` | Validate the current step and move forward; no effect at the last step. |
| `advance()` | Validate and move forward; at the last step validate all visible steps and call `onComplete`. |
| `validateAll()` | Return a boolean; route to the first incomplete visible step without calling `onComplete`. |
| `goBack()`, `goToStep(id)` | Navigate and clear validation. `goToStep` accepts any visible ID for edit and error routing. |
| `visitedStepIds`, `hasVisitedStep(id)` | Track visited IDs, independent of conditional step positions. Apps can disable unvisited progress links. |
| `validationStepId`, `validationAttempt` | Identify an invalid step and distinguish repeated failed attempts. |
| `clearValidation()` | Clear the validation step. |
| `reset()` | Return to the configured initial step (or first visible step), clear validation, and reset visited IDs. |
| `handleSubmit`, `handleKeyDown` | Form handlers for explicit-selection and Continue steps. |

Failed validation calls `onInvalidStep(id)`. A committed step transition calls
`onStepChange(id)` once. Hiding the current step falls back to the first visible
step. Hidden steps do not participate in validation. A wizard with no visible
steps cannot advance or complete.

`goToStep` reads visibility from the committed render that created the handler.
If an answer update reveals a conditional question, wait for that state to
commit before calling `goToStep` (for example, from an effect). Calling it in
the same event as the revealing state update ignores the still-hidden target.
For automatic selection steps, `advanceRequest` already waits for updated state.

## Advance after a selection

Mark a step `autoAdvance: true` when choosing an option completes that question.
Update the answer and create a new request object in the same event:

```tsx
const [answers, setAnswers] = useState({ area: '' });
const [request, setRequest] = useState<{ stepId: string } | null>(null);
const wizard = useWizardSteps({
  steps: [
    { id: 'area', label: 'Area', autoAdvance: true,
      isComplete: (answers) => answers.area !== '' },
    { id: 'review', label: 'Review' },
  ],
  state: answers,
  advanceRequest: request,
  onComplete: calculate,
});

function selectArea(area: string) {
  setAnswers((previous) => ({ ...previous, area }));
  setRequest({ stepId: 'area' });
}
```

Attach `wizard.handleSubmit` and `wizard.handleKeyDown` to the form. Requests
observe the updated answers and only advance the matching current automatic
step. Each new request object represents a new user selection. Invalid or stale
requests are consumed too; changing an answer or navigating Back does not replay
the last request. Do not create request objects during rendering.

The submit handler prevents native submission and advances manual steps.
Automatic steps advance through selection requests. The key handler runs in the
bubble phase so comboboxes can handle Enter first; it prevents an input's Enter
from submitting the form while preserving native `<button>` activation.

## useWizardStepFocus

Pass `{ stepId, hasError, errorRevision, preventScroll, onStepFocus }`. Only
`stepId` is required. Render a heading with `ref={headingRef}` and an error
container with `ref={errorRef}`; both need `tabIndex={-1}`.

The hook focuses the heading on mount and step changes, and then calls
`onStepFocus` if supplied. It focuses the error when `hasError` becomes true,
the step changes with an error, or `errorRevision` changes with an error. Pass
`validationAttempt` as the revision to refocus repeated validation failures.
`preventScroll` defaults to `false`; apps that scroll their own containers can
set it to `true`. Result focus and dialog close-focus restoration belong to apps.

## WizardReviewList

Each item has `id`, `label`, and `value`, with optional `missing`, `onEdit`,
`editLabel`, and `editAriaLabel`. Labels and values can be React nodes. Editable
rows render a native button inside a list item, with the current value as its
accessible description. `onEdit(event)` provides the
button through `event.currentTarget`, so an app can retain it for dialog focus
restoration. Use `editAriaLabel` for a rich label; string labels otherwise use
`Edit {label}` or the supplied `editLabel` prefix.
