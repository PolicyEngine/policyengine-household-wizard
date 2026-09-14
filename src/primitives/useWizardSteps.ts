import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ResolvedWizardStep,
  UseWizardStepsOptions,
  UseWizardStepsResult,
  WizardStepConfig,
} from './types';

function toResolvedStep<TState>(
  step: WizardStepConfig<TState>,
): ResolvedWizardStep {
  return { id: step.id, label: step.label };
}

function pickInitialStepId<TState>(
  steps: WizardStepConfig<TState>[],
  preferredId: string | undefined,
): string | null {
  return (
    steps.find((step) => step.id === preferredId)?.id ?? steps[0]?.id ?? null
  );
}

export function useWizardSteps<TState>({
  steps,
  state,
  initialStepId,
  onStepChange,
  onComplete,
  onInvalidStep,
  advanceRequest,
}: UseWizardStepsOptions<TState>): UseWizardStepsResult {
  const visibleStepConfigs = useMemo(
    () => steps.filter((step) => !step.isVisible || step.isVisible(state)),
    [steps, state],
  );
  const visibleSteps = useMemo(
    () => visibleStepConfigs.map(toResolvedStep),
    [visibleStepConfigs],
  );
  const [currentStepId, setCurrentStepId] = useState(() =>
    pickInitialStepId(visibleStepConfigs, initialStepId),
  );
  const [visitedStepIds, setVisitedStepIds] = useState<string[]>(() =>
    currentStepId === null ? [] : [currentStepId],
  );
  const [validationStepId, setValidationStepId] = useState<string | null>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const clearValidation = useCallback(() => setValidationStepId(null), []);

  const navigate = useCallback(
    (stepId: string | null) => {
      setCurrentStepId(stepId);
      if (stepId !== null) {
        setVisitedStepIds((previous) =>
          previous.includes(stepId) ? previous : [...previous, stepId],
        );
      }
      clearValidation();
    },
    [clearValidation],
  );

  useEffect(() => {
    if (!visibleStepConfigs.some((step) => step.id === currentStepId)) {
      navigate(visibleStepConfigs[0]?.id ?? null);
    }
  }, [visibleStepConfigs, currentStepId, navigate]);

  // Notify after a committed transition, never from a state updater that React
  // may replay. Updating the callback alone must not announce another step.
  const onStepChangeRef = useRef(onStepChange);
  useEffect(() => {
    onStepChangeRef.current = onStepChange;
  }, [onStepChange]);
  const previousStepId = useRef(currentStepId);
  useEffect(() => {
    if (previousStepId.current !== currentStepId) {
      previousStepId.current = currentStepId;
      if (currentStepId !== null) onStepChangeRef.current?.(currentStepId);
    }
  }, [currentStepId]);

  const selectedStepIndex = visibleStepConfigs.findIndex(
    (step) => step.id === currentStepId,
  );
  // Expose the fallback during this render too: consumers may render the
  // current question before the visibility effect commits its new ID.
  const currentStepIndex =
    selectedStepIndex >= 0
      ? selectedStepIndex
      : visibleStepConfigs.length > 0
        ? 0
        : -1;
  const currentStepConfig = visibleStepConfigs[currentStepIndex] ?? null;
  const currentStep = currentStepConfig
    ? toResolvedStep(currentStepConfig)
    : null;
  const totalSteps = visibleStepConfigs.length;
  const isLastStep = totalSteps === 0 || currentStepIndex === totalSteps - 1;
  const canAdvance = currentStepConfig?.isComplete
    ? currentStepConfig.isComplete(state)
    : true;

  const invalid = useCallback(
    (stepId: string) => {
      navigate(stepId);
      setValidationStepId(stepId);
      setValidationAttempt((attempt) => attempt + 1);
      onInvalidStep?.(stepId);
    },
    [navigate, onInvalidStep],
  );

  const validateAll = useCallback(() => {
    const firstInvalid = visibleStepConfigs.find(
      (step) => step.isComplete && !step.isComplete(state),
    );
    if (firstInvalid) {
      invalid(firstInvalid.id);
      return false;
    }
    clearValidation();
    return true;
  }, [visibleStepConfigs, state, invalid, clearValidation]);

  const goNext = useCallback(() => {
    if (!currentStepConfig || isLastStep) return;
    if (!canAdvance) {
      invalid(currentStepConfig.id);
      return;
    }
    navigate(visibleStepConfigs[currentStepIndex + 1].id);
  }, [
    currentStepConfig,
    isLastStep,
    canAdvance,
    invalid,
    navigate,
    visibleStepConfigs,
    currentStepIndex,
  ]);

  const advance = useCallback(() => {
    if (!currentStepConfig) return;
    if (!canAdvance) {
      invalid(currentStepConfig.id);
      return;
    }
    if (isLastStep) {
      if (validateAll()) onComplete?.();
    } else {
      goNext();
    }
  }, [
    currentStepConfig,
    canAdvance,
    invalid,
    isLastStep,
    validateAll,
    onComplete,
    goNext,
  ]);

  // Selection and its state update arrive in the same committed render. Consume
  // every request once, even when invalid or stale, so Back never replays it.
  const consumedRequest =
    useRef<UseWizardStepsOptions<TState>['advanceRequest']>(null);
  useEffect(() => {
    if (!advanceRequest || consumedRequest.current === advanceRequest) return;
    consumedRequest.current = advanceRequest;
    if (
      currentStepConfig?.autoAdvance &&
      advanceRequest.stepId === currentStepConfig.id
    )
      advance();
  }, [advanceRequest, currentStepConfig, advance]);

  const goBack = useCallback(() => {
    clearValidation();
    if (currentStepIndex > 0)
      navigate(visibleStepConfigs[currentStepIndex - 1].id);
  }, [clearValidation, currentStepIndex, navigate, visibleStepConfigs]);

  const goToStep = useCallback(
    (stepId: string) => {
      if (visibleStepConfigs.some((step) => step.id === stepId))
        navigate(stepId);
    },
    [visibleStepConfigs, navigate],
  );

  const reset = useCallback(() => {
    const initial = pickInitialStepId(visibleStepConfigs, initialStepId);
    navigate(initial);
    setVisitedStepIds(initial === null ? [] : [initial]);
  }, [visibleStepConfigs, initialStepId, navigate]);

  const handleSubmit = useCallback<UseWizardStepsResult['handleSubmit']>(
    (event) => {
      event.preventDefault();
      if (!currentStepConfig?.autoAdvance) advance();
    },
    [currentStepConfig, advance],
  );

  const handleKeyDown = useCallback<UseWizardStepsResult['handleKeyDown']>(
    (event) => {
      // Bubble after a combobox has handled selection. Native buttons retain Enter.
      if (
        currentStepConfig?.autoAdvance &&
        event.key === 'Enter' &&
        (event.target as HTMLElement).tagName === 'INPUT'
      )
        event.preventDefault();
    },
    [currentStepConfig],
  );

  const hasVisitedStep = useCallback(
    (stepId: string) => visitedStepIds.includes(stepId),
    [visitedStepIds],
  );

  return {
    visibleSteps,
    currentStep,
    currentStepIndex,
    totalSteps,
    isFirstStep: currentStepIndex <= 0,
    isLastStep,
    canAdvance,
    visitedStepIds,
    hasVisitedStep,
    validationStepId,
    validationAttempt,
    clearValidation,
    validateAll,
    advance,
    handleSubmit,
    handleKeyDown,
    goNext,
    goBack,
    goToStep,
    reset,
  };
}
