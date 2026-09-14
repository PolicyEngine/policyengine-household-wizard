import type { FormEvent, KeyboardEvent } from 'react';

export interface WizardStepConfig<TState> {
  id: string;
  label: string;
  isComplete?: (state: TState) => boolean;
  isVisible?: (state: TState) => boolean;
  autoAdvance?: boolean;
}

/** Create a new object for each explicit selection, alongside its state update. */
export interface WizardAdvanceRequest {
  stepId: string;
}

export interface ResolvedWizardStep {
  id: string;
  label: string;
}

export interface UseWizardStepsOptions<TState> {
  steps: ReadonlyArray<WizardStepConfig<TState>>;
  state: TState;
  initialStepId?: string;
  onStepChange?: (stepId: string) => void;
  onComplete?: () => void;
  onInvalidStep?: (stepId: string) => void;
  advanceRequest?: WizardAdvanceRequest | null;
}

export interface UseWizardStepsResult {
  visibleSteps: ResolvedWizardStep[];
  currentStep: ResolvedWizardStep | null;
  currentStepIndex: number;
  totalSteps: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  canAdvance: boolean;
  visitedStepIds: string[];
  hasVisitedStep: (stepId: string) => boolean;
  validationStepId: string | null;
  validationAttempt: number;
  clearValidation: () => void;
  validateAll: () => boolean;
  advance: () => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  handleKeyDown: (event: KeyboardEvent<HTMLFormElement>) => void;
  goNext: () => void;
  goBack: () => void;
  goToStep: (stepId: string) => void;
  reset: () => void;
}
