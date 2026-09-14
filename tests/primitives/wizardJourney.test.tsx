import { StrictMode, useState } from 'react';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useWizardSteps } from '@/primitives/useWizardSteps';

interface JourneyState {
  choice: string;
  details: string;
  showDetails: boolean;
}

const complete: JourneyState = {
  choice: 'yes',
  details: 'entered',
  showDetails: true,
};
const steps = [
  {
    id: 'choice',
    label: 'Choice',
    isComplete: (state: JourneyState) => !!state.choice,
  },
  {
    id: 'details',
    label: 'Details',
    isVisible: (state: JourneyState) => state.showDetails,
    isComplete: (state: JourneyState) => !!state.details,
  },
  { id: 'review', label: 'Review' },
];
const autoSteps = steps.map((step) => ({
  ...step,
  autoAdvance: step.id === 'choice',
}));

describe('validated wizard journeys', () => {
  it.each(['goNext', 'advance'] as const)(
    '%s blocks an incomplete current step',
    (action) => {
      const onInvalidStep = vi.fn();
      const { result } = renderHook(() =>
        useWizardSteps({
          steps,
          state: { ...complete, choice: '' },
          onInvalidStep,
        }),
      );

      act(() => result.current[action]());
      expect(result.current.currentStep?.id).toBe('choice');
      expect(result.current.validationStepId).toBe('choice');
      expect(onInvalidStep).toHaveBeenLastCalledWith('choice');
      const firstAttempt = result.current.validationAttempt;
      act(() => result.current[action]());
      expect(result.current.validationAttempt).toBeGreaterThan(firstAttempt);
      expect(onInvalidStep).toHaveBeenCalledTimes(2);
    },
  );

  it('revalidates earlier visible steps before completing the final step', () => {
    const onComplete = vi.fn();
    const onInvalidStep = vi.fn();
    const { result, rerender } = renderHook(
      ({ state }) =>
        useWizardSteps({ steps, state, onComplete, onInvalidStep }),
      { initialProps: { state: complete } },
    );
    act(() => result.current.advance());
    act(() => result.current.advance());
    expect(result.current.currentStep?.id).toBe('review');

    rerender({ state: { ...complete, choice: '', details: '' } });
    act(() => result.current.advance());
    expect(result.current.currentStep?.id).toBe('choice');
    expect(onInvalidStep).toHaveBeenLastCalledWith('choice');
    expect(onComplete).not.toHaveBeenCalled();

    rerender({ state: complete });
    act(() => result.current.goToStep('review'));
    act(() => result.current.goNext());
    expect(onComplete).not.toHaveBeenCalled(); // Existing last-step goNext stays a no-op.
    act(() => result.current.advance());
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('validateAll routes to an incomplete step without completing and excludes hidden steps', () => {
    const onComplete = vi.fn();
    const { result, rerender } = renderHook(
      ({ state }) => useWizardSteps({ steps, state, onComplete }),
      { initialProps: { state: { ...complete, details: '' } } },
    );
    let valid: boolean | undefined;
    act(() => {
      valid = result.current.validateAll();
    });
    expect(valid).toBe(false);
    expect(result.current.currentStep?.id).toBe('details');
    rerender({ state: { ...complete, details: '', showDetails: false } });
    act(() => {
      valid = result.current.validateAll();
    });
    expect(valid).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('tracks visited IDs when conditional steps appear and reset clears journey history', () => {
    const { result, rerender } = renderHook(
      ({ state }) => useWizardSteps({ steps, state }),
      { initialProps: { state: { ...complete, showDetails: false } } },
    );
    expect(result.current.visitedStepIds).toEqual(['choice']);
    act(() => result.current.advance());
    expect(result.current.hasVisitedStep('review')).toBe(true);
    rerender({ state: complete });
    expect(result.current.currentStep?.id).toBe('review');
    expect(result.current.currentStepIndex).toBe(2);
    expect(result.current.hasVisitedStep('details')).toBe(false);
    act(() => result.current.goToStep('details')); // Programmatic editing is unrestricted.
    expect(result.current.hasVisitedStep('details')).toBe(true);
    act(() => result.current.reset());
    expect(result.current.currentStep?.id).toBe('choice');
    expect(result.current.visitedStepIds).toEqual(['choice']);
  });

  it('visits the fallback when the active conditional step disappears', () => {
    const onStepChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ state }) =>
        useWizardSteps({
          steps,
          state,
          initialStepId: 'details',
          onStepChange,
        }),
      { initialProps: { state: complete } },
    );
    expect(result.current.visitedStepIds).toEqual(['details']);
    rerender({ state: { ...complete, showDetails: false } });
    expect(result.current.currentStep?.id).toBe('choice');
    expect(result.current.hasVisitedStep('choice')).toBe(true);
    expect(onStepChange).toHaveBeenCalledTimes(1);
    expect(onStepChange).toHaveBeenLastCalledWith('choice');
  });

  it.each(['goBack', 'goToStep', 'reset', 'clearValidation'] as const)(
    '%s clears a displayed validation error',
    (action) => {
      const { result } = renderHook(() =>
        useWizardSteps({
          steps,
          state: { ...complete, details: '' },
          initialStepId: 'details',
        }),
      );
      act(() => result.current.advance());
      expect(result.current.validationStepId).toBe('details');
      act(() => {
        if (action === 'goToStep') result.current.goToStep('review');
        else result.current[action]();
      });
      expect(result.current.validationStepId).toBeNull();
    },
  );

  it('notifies once per actual transition under StrictMode', () => {
    const onStepChange = vi.fn();
    const { result } = renderHook(
      () => useWizardSteps({ steps, state: complete, onStepChange }),
      {
        wrapper: StrictMode,
      },
    );
    act(() => result.current.goNext());
    act(() => result.current.goNext());
    act(() => result.current.goToStep('review'));
    act(() => result.current.goNext());
    act(() => result.current.goBack());
    expect(onStepChange.mock.calls).toEqual([
      ['details'],
      ['review'],
      ['details'],
    ]);
  });
});

describe('explicit auto-advance requests', () => {
  it('uses the updated parent state and consumes a request once across Back and rerenders', async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();
    function Parent() {
      const [state, setState] = useState({ ...complete, choice: '' });
      const [advanceRequest, setAdvanceRequest] = useState<{
        stepId: string;
      } | null>(null);
      const wizard = useWizardSteps({
        steps: autoSteps,
        state,
        advanceRequest,
        onStepChange,
      });
      return (
        <>
          <output>{wizard.currentStep?.id}</output>
          <button
            onClick={() => {
              setState({ ...state, choice: 'selected' });
              setAdvanceRequest({ stepId: 'choice' });
            }}
          >
            Select
          </button>
          <button onClick={wizard.goBack}>Back</button>
          <button onClick={() => setState({ ...state })}>Rerender</button>
        </>
      );
    }
    render(
      <StrictMode>
        <Parent />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: 'Select' }));
    expect(screen.getByRole('status')).toHaveTextContent('details');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Rerender' }));
    expect(screen.getByRole('status')).toHaveTextContent('choice');
    expect(onStepChange.mock.calls).toEqual([['details'], ['choice']]);
  });

  it('consumes invalid requests so later validity does not replay them', () => {
    const request = { stepId: 'choice' };
    const onInvalidStep = vi.fn();
    const { result, rerender } = renderHook(
      ({ state, advanceRequest }) =>
        useWizardSteps({
          steps: autoSteps,
          state,
          advanceRequest,
          onInvalidStep,
        }),
      {
        initialProps: {
          state: { ...complete, choice: '' },
          advanceRequest: request,
        },
        wrapper: StrictMode,
      },
    );
    expect(result.current.currentStep?.id).toBe('choice');
    expect(onInvalidStep).toHaveBeenCalledTimes(1);
    rerender({ state: complete, advanceRequest: request });
    expect(result.current.currentStep?.id).toBe('choice');
    rerender({ state: complete, advanceRequest: { stepId: 'choice' } });
    expect(result.current.currentStep?.id).toBe('details');
  });

  it('consumes stale requests before their step becomes current', () => {
    const advanceRequest = { stepId: 'choice' };
    const { result, rerender } = renderHook(
      ({ state }) =>
        useWizardSteps({
          steps: autoSteps,
          state,
          advanceRequest,
          initialStepId: 'details',
        }),
      { initialProps: { state: complete }, wrapper: StrictMode },
    );
    act(() => result.current.goBack());
    rerender({ state: { ...complete } });
    expect(result.current.currentStep?.id).toBe('choice');
  });

  it('does not replay the same request identity after it is removed and reintroduced', () => {
    const request = { stepId: 'choice' };
    const { result, rerender } = renderHook(
      ({ advanceRequest }: { advanceRequest: { stepId: string } | null }) =>
        useWizardSteps({
          steps: autoSteps,
          state: complete,
          advanceRequest,
        }),
      {
        initialProps: { advanceRequest: request as { stepId: string } | null },
      },
    );
    expect(result.current.currentStep?.id).toBe('details');
    rerender({ advanceRequest: null });
    act(() => result.current.goBack());
    rerender({ advanceRequest: request });
    expect(result.current.currentStep?.id).toBe('choice');
  });

  it('ignores requests addressed to a manual step', () => {
    const { result } = renderHook(() =>
      useWizardSteps({
        steps,
        state: complete,
        advanceRequest: { stepId: 'choice' },
      }),
    );
    expect(result.current.currentStep?.id).toBe('choice');
  });
});

describe('form keyboard integration', () => {
  it('runs input selection before suppressing Enter submission without suppressing button activation', async () => {
    const user = userEvent.setup();
    const events: string[] = [];
    const buttonClick = vi.fn();
    function Form() {
      const wizard = useWizardSteps({ steps: autoSteps, state: complete });
      return (
        <form
          onSubmit={wizard.handleSubmit}
          onKeyDown={(event) => {
            events.push('form');
            wizard.handleKeyDown(event);
            events.push(event.defaultPrevented ? 'prevented' : 'allowed');
          }}
        >
          <input aria-label="Choice" onKeyDown={() => events.push('input')} />
          <button type="button" onClick={buttonClick}>
            Option
          </button>
          <output>{wizard.currentStep?.id}</output>
        </form>
      );
    }
    render(<Form />);
    const input = screen.getByRole('textbox');
    expect(fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })).toBe(
      false,
    );
    expect(events).toEqual(['input', 'form', 'prevented']);
    expect(screen.getByRole('status')).toHaveTextContent('choice');
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(true);

    const button = screen.getByRole('button', { name: 'Option' });
    button.focus();
    await user.keyboard('{Enter}');
    expect(buttonClick).toHaveBeenCalledTimes(1);
    expect(events.slice(-2)).toEqual(['form', 'allowed']);
  });

  it('prevents native submit, ignores auto-step submit, and advances manual steps', () => {
    function Form({ automatic }: { automatic: boolean }) {
      const wizard = useWizardSteps({
        steps: automatic ? autoSteps : steps,
        state: complete,
      });
      return (
        <form
          aria-label="Journey"
          onSubmit={wizard.handleSubmit}
          onKeyDown={wizard.handleKeyDown}
        >
          <input aria-label="Answer" />
          <output>{wizard.currentStep?.id}</output>
        </form>
      );
    }
    const { rerender } = render(<Form automatic />);
    expect(fireEvent.submit(screen.getByRole('form'))).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent('choice');
    rerender(<Form automatic={false} />);
    expect(
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }),
    ).toBe(true);
    expect(fireEvent.submit(screen.getByRole('form'))).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent('details');
  });
});
