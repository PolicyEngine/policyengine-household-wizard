# Migrate a calculator wizard

Keep app-specific inputs, copy, layouts, normalization, and calculation adapters
in the consumer. Import shared behavior from
`policyengine-household-wizard/primitives`; import `styles.css` only when using
the package's default component styling.

1. Give each conditional question a stable ID and supply its visibility
   predicate to `useWizardSteps`. Replace local current-step and furthest-index
   state with `currentStep` and `hasVisitedStep`.
2. Supply completion predicates and use `advance()` for shared validation, or
   retain raw input validation and call `goNext()` after it passes. Preserve
   country-specific validation before any number normalization.
3. Use `goToStep(id)` for edit dialogs, validation errors, and newly required
   follow-up questions. If a state update reveals the target question, call
   `goToStep` after that update commits, such as from an effect; a call in the
   same event sees the previous visible-step set and ignores the hidden target.
   Only the app's progress links need a visited-step guard.
4. For selection questions, mark the step `autoAdvance` and create an
   `advanceRequest` in the same event as the answer update. Use the shared form
   handlers and remove local auto-advance effects.
5. Attach `useWizardStepFocus` refs to a focusable heading and error container.
   Keep app-owned scroll behavior, result focus, and dialog focus restoration.
6. Render editable answers with `WizardReviewList`; retain the edit event's
   `currentTarget` before opening a dialog. Apps can style the rows locally.

Existing `goNext()` callers remain valid, but `goNext()` now enforces a supplied
`isComplete` predicate. It still does nothing at the last step. Call `advance()`
when the hook should invoke `onComplete`, or keep the app's submission handler.
Review-row buttons retain `data-testid="pe-wizard-review-{id}"`; their parent
holds the `listitem` role, and the edit control now exposes the native `button`
role. Update role-based selectors accordingly.

For a threshold calculator, keep year, area, family size, and tenure validation
in the app. A marriage calculator can use the same navigation and focus hooks
while retaining US and UK household inputs, childcare follow-ups, and payload
construction. Neither migration requires adopting the US household draft model
or adding personal-answer defaults.

Verify Back, repeated errors, conditional steps, keyboard selection, and edit
Save/Cancel behavior in consumer tests. Run browser checks for desktop and
mobile on the actual standalone and embedded routes before deployment.
