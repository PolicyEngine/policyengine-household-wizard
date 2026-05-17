import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWizardSteps } from '@/primitives/useWizardSteps';

interface DemoState {
  location: string;
  marital: 'single' | 'married' | null;
  reviewed: boolean;
}

function makeSteps() {
  return [
    { id: 'location', label: 'Location', isComplete: (s: DemoState) => s.location !== '' },
    { id: 'marital', label: 'Marital', isComplete: (s: DemoState) => s.marital !== null },
    {
      id: 'spouse',
      label: 'Spouse',
      isVisible: (s: DemoState) => s.marital === 'married',
    },
    { id: 'review', label: 'Review' },
  ];
}

describe('useWizardSteps', () => {
  it('starts at the first visible step by default', () => {
    const state: DemoState = { location: '', marital: null, reviewed: false };
    const { result } = renderHook(() => useWizardSteps({ steps: makeSteps(), state }));

    expect(result.current.currentStep?.id).toBe('location');
    expect(result.current.currentStepIndex).toBe(0);
    expect(result.current.totalSteps).toBe(3); // 'spouse' is hidden
    expect(result.current.isFirstStep).toBe(true);
    expect(result.current.isLastStep).toBe(false);
  });

  it('honors initialStepId when it is visible', () => {
    const state: DemoState = { location: 'CA', marital: null, reviewed: false };
    const { result } = renderHook(() =>
      useWizardSteps({ steps: makeSteps(), state, initialStepId: 'marital' }),
    );
    expect(result.current.currentStep?.id).toBe('marital');
  });

  it('falls back to the first visible step when initialStepId is hidden', () => {
    const state: DemoState = { location: 'CA', marital: 'single', reviewed: false };
    const { result } = renderHook(() =>
      useWizardSteps({ steps: makeSteps(), state, initialStepId: 'spouse' }),
    );
    expect(result.current.currentStep?.id).toBe('location');
  });

  it('blocks goNext when the current step is incomplete via canAdvance', () => {
    const state: DemoState = { location: '', marital: null, reviewed: false };
    const { result } = renderHook(() => useWizardSteps({ steps: makeSteps(), state }));

    expect(result.current.canAdvance).toBe(false);
  });

  it('advances and steps back, notifying onStepChange', () => {
    const onStepChange = vi.fn();
    const state: DemoState = { location: 'CA', marital: 'single', reviewed: false };
    const { result } = renderHook(() =>
      useWizardSteps({ steps: makeSteps(), state, onStepChange }),
    );

    expect(result.current.currentStep?.id).toBe('location');
    act(() => result.current.goNext());
    expect(result.current.currentStep?.id).toBe('marital');
    expect(onStepChange).toHaveBeenCalledWith('marital');
    act(() => result.current.goNext());
    expect(result.current.currentStep?.id).toBe('review');
    expect(result.current.isLastStep).toBe(true);
    act(() => result.current.goNext()); // no-op past last
    expect(result.current.currentStep?.id).toBe('review');

    act(() => result.current.goBack());
    expect(result.current.currentStep?.id).toBe('marital');
  });

  it('shows the conditional step when state makes it visible', () => {
    const initial: DemoState = { location: 'CA', marital: 'single', reviewed: false };
    const { result, rerender } = renderHook(
      ({ state }: { state: DemoState }) => useWizardSteps({ steps: makeSteps(), state }),
      { initialProps: { state: initial } },
    );

    expect(result.current.totalSteps).toBe(3);
    rerender({ state: { ...initial, marital: 'married' } });
    expect(result.current.totalSteps).toBe(4);
    expect(result.current.visibleSteps.map((step) => step.id)).toEqual([
      'location',
      'marital',
      'spouse',
      'review',
    ]);
  });

  it('moves currentStepId to the first visible step when the active one disappears', () => {
    const initial: DemoState = { location: 'CA', marital: 'married', reviewed: false };
    const { result, rerender } = renderHook(
      ({ state }: { state: DemoState }) => useWizardSteps({ steps: makeSteps(), state }),
      { initialProps: { state: initial } },
    );

    act(() => result.current.goToStep('spouse'));
    expect(result.current.currentStep?.id).toBe('spouse');

    rerender({ state: { ...initial, marital: 'single' } });
    expect(result.current.currentStep?.id).toBe('location');
  });

  it('reset returns to the initial step', () => {
    const state: DemoState = { location: 'CA', marital: 'single', reviewed: false };
    const { result } = renderHook(() => useWizardSteps({ steps: makeSteps(), state }));

    act(() => result.current.goNext());
    expect(result.current.currentStep?.id).toBe('marital');
    act(() => result.current.reset());
    expect(result.current.currentStep?.id).toBe('location');
  });

  it('goToStep ignores unknown step ids', () => {
    const state: DemoState = { location: 'CA', marital: 'single', reviewed: false };
    const { result } = renderHook(() => useWizardSteps({ steps: makeSteps(), state }));

    act(() => result.current.goToStep('does-not-exist'));
    expect(result.current.currentStep?.id).toBe('location');
  });
});
