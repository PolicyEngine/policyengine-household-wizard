import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WizardProgress } from '@/primitives/WizardProgress';

describe('WizardProgress', () => {
  it('renders the current step number, total, and label', () => {
    render(
      <WizardProgress totalSteps={5} currentStepIndex={2} currentStepLabel="Adults" />,
    );
    expect(screen.getByTestId('pe-wizard-progress-step')).toHaveTextContent('Step 3 of 5');
    expect(screen.getByTestId('pe-wizard-progress-label')).toHaveTextContent('Adults');
  });

  it('exposes ARIA progressbar semantics', () => {
    render(
      <WizardProgress totalSteps={4} currentStepIndex={1} currentStepLabel="Marital" />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '4');
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuetext', 'Marital');
  });

  it('clamps index above the total', () => {
    render(<WizardProgress totalSteps={3} currentStepIndex={10} />);
    expect(screen.getByTestId('pe-wizard-progress-step')).toHaveTextContent('Step 3 of 3');
  });

  it('handles zero total without throwing', () => {
    render(<WizardProgress totalSteps={0} currentStepIndex={0} />);
    expect(screen.getByTestId('pe-wizard-progress-step')).toHaveTextContent('Step 0 of 0');
  });
});
