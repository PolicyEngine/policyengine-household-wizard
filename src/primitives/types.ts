export interface WizardStepConfig<TState> {
  id: string;
  label: string;
  isComplete?: (state: TState) => boolean;
  isVisible?: (state: TState) => boolean;
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
}

export interface UseWizardStepsResult {
  visibleSteps: ResolvedWizardStep[];
  currentStep: ResolvedWizardStep | null;
  currentStepIndex: number;
  totalSteps: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  canAdvance: boolean;
  goNext: () => void;
  goBack: () => void;
  goToStep: (stepId: string) => void;
  reset: () => void;
}
