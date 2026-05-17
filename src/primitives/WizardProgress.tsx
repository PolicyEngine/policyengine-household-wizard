import type { CSSProperties, HTMLAttributes } from 'react';

export interface WizardProgressProps extends HTMLAttributes<HTMLDivElement> {
  totalSteps: number;
  currentStepIndex: number;
  currentStepLabel?: string;
}

export function WizardProgress({
  totalSteps,
  currentStepIndex,
  currentStepLabel,
  className,
  ...rest
}: WizardProgressProps) {
  const safeTotal = Math.max(totalSteps, 0);
  const clampedIndex = Math.max(0, Math.min(currentStepIndex, safeTotal - 1));
  const progress = safeTotal > 0 ? ((clampedIndex + 1) / safeTotal) * 100 : 0;
  const stepNumber = safeTotal > 0 ? clampedIndex + 1 : 0;

  const trackStyle: CSSProperties = { width: `${progress}%` };

  return (
    <div
      role="group"
      aria-label={rest['aria-label'] ?? 'Wizard progress'}
      className={['pe-wizard-progress', className].filter(Boolean).join(' ')}
      {...rest}
    >
      <div className="pe-wizard-progress-topline">
        <span data-testid="pe-wizard-progress-step">
          Step {stepNumber} of {safeTotal}
        </span>
        {currentStepLabel ? (
          <span data-testid="pe-wizard-progress-label">{currentStepLabel}</span>
        ) : null}
      </div>
      <div
        className="pe-wizard-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeTotal}
        aria-valuenow={stepNumber}
        aria-valuetext={currentStepLabel}
      >
        <div className="pe-wizard-progress-bar" style={trackStyle} />
      </div>
    </div>
  );
}
