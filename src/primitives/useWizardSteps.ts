import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ResolvedWizardStep,
  UseWizardStepsOptions,
  UseWizardStepsResult,
  WizardStepConfig,
} from './types';

function resolveVisibleSteps<TState>(
  steps: ReadonlyArray<WizardStepConfig<TState>>,
  state: TState,
): WizardStepConfig<TState>[] {
  return steps.filter((step) => (step.isVisible ? step.isVisible(state) : true));
}

function toResolvedStep<TState>(step: WizardStepConfig<TState>): ResolvedWizardStep {
  return { id: step.id, label: step.label };
}

function pickInitialStepId<TState>(
  visibleSteps: WizardStepConfig<TState>[],
  preferredId: string | undefined,
): string | null {
  if (visibleSteps.length === 0) {
    return null;
  }

  if (preferredId && visibleSteps.some((step) => step.id === preferredId)) {
    return preferredId;
  }

  return visibleSteps[0].id;
}

export function useWizardSteps<TState>(
  options: UseWizardStepsOptions<TState>,
): UseWizardStepsResult {
  const { steps, state, initialStepId, onStepChange } = options;

  const visibleStepConfigs = useMemo(
    () => resolveVisibleSteps(steps, state),
    [steps, state],
  );

  const visibleSteps = useMemo(
    () => visibleStepConfigs.map(toResolvedStep),
    [visibleStepConfigs],
  );

  const initialResolvedId = useMemo(
    () => pickInitialStepId(visibleStepConfigs, initialStepId),
    // Only recompute when explicit initialStepId or the set of step ids changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialStepId],
  );

  const [currentStepId, setCurrentStepId] = useState<string | null>(initialResolvedId);

  // If the visible set changes (e.g. a conditional step is hidden), keep the
  // currentStepId in sync. If the currently selected step is no longer visible,
  // fall back to the first visible step.
  useEffect(() => {
    if (visibleStepConfigs.length === 0) {
      if (currentStepId !== null) {
        setCurrentStepId(null);
      }
      return;
    }

    const exists = visibleStepConfigs.some((step) => step.id === currentStepId);
    if (!exists) {
      setCurrentStepId(visibleStepConfigs[0].id);
    }
  }, [visibleStepConfigs, currentStepId]);

  const onStepChangeRef = useRef(onStepChange);
  useEffect(() => {
    onStepChangeRef.current = onStepChange;
  }, [onStepChange]);

  const setStepAndNotify = useCallback((stepId: string) => {
    setCurrentStepId((previous) => {
      if (previous === stepId) {
        return previous;
      }
      onStepChangeRef.current?.(stepId);
      return stepId;
    });
  }, []);

  const currentStepIndex = useMemo(
    () => visibleStepConfigs.findIndex((step) => step.id === currentStepId),
    [visibleStepConfigs, currentStepId],
  );

  const currentStepConfig = currentStepIndex >= 0 ? visibleStepConfigs[currentStepIndex] : null;
  const currentStep = currentStepConfig ? toResolvedStep(currentStepConfig) : null;

  const totalSteps = visibleStepConfigs.length;
  const isFirstStep = currentStepIndex <= 0;
  const isLastStep = totalSteps === 0 ? true : currentStepIndex === totalSteps - 1;

  const canAdvance = currentStepConfig?.isComplete
    ? currentStepConfig.isComplete(state)
    : true;

  const goNext = useCallback(() => {
    if (currentStepIndex < 0 || currentStepIndex >= visibleStepConfigs.length - 1) {
      return;
    }
    setStepAndNotify(visibleStepConfigs[currentStepIndex + 1].id);
  }, [currentStepIndex, visibleStepConfigs, setStepAndNotify]);

  const goBack = useCallback(() => {
    if (currentStepIndex <= 0) {
      return;
    }
    setStepAndNotify(visibleStepConfigs[currentStepIndex - 1].id);
  }, [currentStepIndex, visibleStepConfigs, setStepAndNotify]);

  const goToStep = useCallback(
    (stepId: string) => {
      if (visibleStepConfigs.some((step) => step.id === stepId)) {
        setStepAndNotify(stepId);
      }
    },
    [visibleStepConfigs, setStepAndNotify],
  );

  const reset = useCallback(() => {
    const fallback = pickInitialStepId(visibleStepConfigs, initialStepId);
    if (fallback) {
      setStepAndNotify(fallback);
    }
  }, [visibleStepConfigs, initialStepId, setStepAndNotify]);

  return {
    visibleSteps,
    currentStep,
    currentStepIndex,
    totalSteps,
    isFirstStep,
    isLastStep,
    canAdvance,
    goNext,
    goBack,
    goToStep,
    reset,
  };
}
