import type { HTMLAttributes, ReactNode } from 'react';

export interface WizardNavigationProps extends HTMLAttributes<HTMLDivElement> {
  canAdvance: boolean;
  isFirstStep: boolean;
  isLastStep: boolean;
  backLabel?: ReactNode;
  continueLabel?: ReactNode;
  submitLabel?: ReactNode;
  busyLabel?: ReactNode;
  busy?: boolean;
  onBack?: () => void;
  onContinue?: () => void;
  onSubmit?: () => void;
  leadingActions?: ReactNode;
  trailingActions?: ReactNode;
  hideBack?: boolean;
}

export function WizardNavigation({
  canAdvance,
  isFirstStep,
  isLastStep,
  backLabel = 'Back',
  continueLabel = 'Continue',
  submitLabel = 'Submit',
  busyLabel,
  busy = false,
  onBack,
  onContinue,
  onSubmit,
  leadingActions,
  trailingActions,
  hideBack = false,
  className,
  ...rest
}: WizardNavigationProps) {
  const primaryDisabled = busy || !canAdvance;
  const primaryLabel = busy && busyLabel ? busyLabel : isLastStep ? submitLabel : continueLabel;

  const handlePrimary = () => {
    if (primaryDisabled) {
      return;
    }
    if (isLastStep) {
      onSubmit?.();
    } else {
      onContinue?.();
    }
  };

  return (
    <div
      className={['pe-wizard-nav', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {leadingActions ? (
        <div className="pe-wizard-nav-leading">{leadingActions}</div>
      ) : null}
      {!hideBack ? (
        <button
          type="button"
          className="pe-wizard-nav-back"
          onClick={onBack}
          disabled={isFirstStep || busy}
          aria-label={typeof backLabel === 'string' ? backLabel : undefined}
        >
          {backLabel}
        </button>
      ) : null}
      <button
        type="button"
        className="pe-wizard-nav-primary"
        onClick={handlePrimary}
        disabled={primaryDisabled}
        aria-disabled={primaryDisabled}
      >
        {primaryLabel}
      </button>
      {trailingActions ? (
        <div className="pe-wizard-nav-trailing">{trailingActions}</div>
      ) : null}
    </div>
  );
}
