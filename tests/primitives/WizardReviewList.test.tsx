import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WizardReviewList } from '@/primitives/WizardReviewList';

describe('WizardReviewList', () => {
  it('renders each item as a list item with label and value', () => {
    render(
      <WizardReviewList
        items={[
          { id: 'location', label: 'Location', value: 'CA' },
          { id: 'marital', label: 'Marital status', value: 'Married' },
        ]}
      />,
    );

    expect(screen.getByTestId('pe-wizard-review-location')).toHaveTextContent('CA');
    expect(screen.getByTestId('pe-wizard-review-marital')).toHaveTextContent('Married');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows "Missing" when value is empty and missing flag is true', () => {
    render(
      <WizardReviewList
        items={[{ id: 'state', label: 'State', value: '', missing: true }]}
      />,
    );
    expect(screen.getByTestId('pe-wizard-review-state')).toHaveTextContent('Missing');
  });

  it('renders editable items as buttons that fire onEdit', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <WizardReviewList
        items={[
          {
            id: 'adults',
            label: 'Adults',
            value: '2 adults',
            onEdit,
            editLabel: 'Edit',
          },
        ]}
      />,
    );

    const button = screen.getByRole('listitem', { name: /edit adults/i });
    expect(button.tagName).toBe('BUTTON');
    await user.click(button);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
