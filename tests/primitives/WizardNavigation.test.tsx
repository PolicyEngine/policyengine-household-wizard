import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WizardNavigation } from '@/primitives/WizardNavigation';

describe('WizardNavigation', () => {
  it('renders continue when not on the last step and calls onContinue', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onSubmit = vi.fn();
    render(
      <WizardNavigation
        canAdvance
        isFirstStep={false}
        isLastStep={false}
        onContinue={onContinue}
        onSubmit={onSubmit}
        onBack={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders submit on the last step and calls onSubmit', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onSubmit = vi.fn();
    render(
      <WizardNavigation
        canAdvance
        isFirstStep={false}
        isLastStep
        submitLabel="Find cliffs"
        onContinue={onContinue}
        onSubmit={onSubmit}
        onBack={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Find cliffs' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('disables back button on the first step', () => {
    render(
      <WizardNavigation
        canAdvance
        isFirstStep
        isLastStep={false}
        onBack={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  it('disables primary button when canAdvance is false', () => {
    render(
      <WizardNavigation
        canAdvance={false}
        isFirstStep={false}
        isLastStep={false}
        onBack={() => {}}
        onContinue={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('shows busy label and disables primary while busy', () => {
    render(
      <WizardNavigation
        canAdvance
        isFirstStep={false}
        isLastStep
        busy
        busyLabel="Calculating..."
        onSubmit={() => {}}
        onBack={() => {}}
      />,
    );
    const primary = screen.getByRole('button', { name: 'Calculating...' });
    expect(primary).toBeDisabled();
  });

  it('hides back button when hideBack is true', () => {
    render(
      <WizardNavigation
        canAdvance
        isFirstStep={false}
        isLastStep={false}
        hideBack
        onContinue={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});
