import type { HTMLAttributes, ReactNode } from 'react';

export interface WizardReviewItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
  missing?: boolean;
  onEdit?: () => void;
  editLabel?: ReactNode;
}

export interface WizardReviewListProps extends HTMLAttributes<HTMLDivElement> {
  items: WizardReviewItem[];
}

export function WizardReviewList({ items, className, ...rest }: WizardReviewListProps) {
  return (
    <div
      className={['pe-wizard-review-list', className].filter(Boolean).join(' ')}
      role="list"
      {...rest}
    >
      {items.map((item) => {
        const classes = ['pe-wizard-review-item'];
        if (item.missing) {
          classes.push('pe-wizard-review-item--missing');
        }
        const editable = typeof item.onEdit === 'function';
        const content = (
          <>
            <span className="pe-wizard-review-item-label">{item.label}</span>
            <span className="pe-wizard-review-item-value">
              {item.missing && (item.value === null || item.value === undefined || item.value === '')
                ? 'Missing'
                : item.value}
            </span>
          </>
        );

        if (!editable) {
          return (
            <div
              key={item.id}
              role="listitem"
              className={classes.join(' ')}
              data-testid={`pe-wizard-review-${item.id}`}
            >
              {content}
            </div>
          );
        }

        return (
          <button
            key={item.id}
            type="button"
            role="listitem"
            className={classes.join(' ')}
            data-testid={`pe-wizard-review-${item.id}`}
            onClick={item.onEdit}
            aria-label={
              typeof item.label === 'string'
                ? `${item.editLabel ?? 'Edit'} ${item.label}`
                : undefined
            }
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
