import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WizardOptionCard } from '@/primitives/WizardOptionCard';

describe('WizardOptionCard', () => {
  it('renders title and description, fires onSelect on click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <WizardOptionCard
        title="Married"
        description="Adds a spouse to the household."
        onSelect={onSelect}
      />,
    );

    const card = screen.getByRole('radio', { name: /married/i });
    expect(card).toHaveAttribute('aria-checked', 'false');
    expect(card).toHaveTextContent('Adds a spouse to the household.');

    await user.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('reflects selected state', () => {
    render(<WizardOptionCard title="Unmarried" selected onSelect={() => {}} />);
    const card = screen.getByRole('radio', { name: /unmarried/i });
    expect(card).toHaveAttribute('aria-checked', 'true');
    expect(card.className).toContain('pe-wizard-option-card--selected');
  });

  it('blocks onSelect when disabled', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<WizardOptionCard title="Disabled" disabled onSelect={onSelect} />);
    await user.click(screen.getByRole('radio'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('lets onClick override default selection behavior via preventDefault', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <WizardOptionCard
        title="Cancel"
        onClick={(event) => event.preventDefault()}
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole('radio'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
