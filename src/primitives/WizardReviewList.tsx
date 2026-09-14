import { useId } from 'react';
import type { HTMLAttributes, MouseEvent, ReactNode } from 'react';

export interface WizardReviewItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
  missing?: boolean;
  onEdit?: (event: MouseEvent<HTMLButtonElement>) => void;
  editLabel?: ReactNode;
  editAriaLabel?: string;
}

export interface WizardReviewListProps extends HTMLAttributes<HTMLDivElement> {
  items: WizardReviewItem[];
}

export function WizardReviewList({
  items,
  className,
  ...rest
}: WizardReviewListProps) {
  const listId = useId();
  return (
    <div
      className={['pe-wizard-review-list', className].filter(Boolean).join(' ')}
      role="list"
      {...rest}
    >
      {items.map((item, index) => {
        const valueId = `${listId}-${index}-value`;
        const classes = ['pe-wizard-review-item'];
        if (item.missing) {
          classes.push('pe-wizard-review-item--missing');
        }
        const editable = typeof item.onEdit === 'function';
        const content = (
          <>
            <span className="pe-wizard-review-item-label">{item.label}</span>
            <span id={valueId} className="pe-wizard-review-item-value">
              {item.missing &&
              (item.value === null ||
                item.value === undefined ||
                item.value === '')
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
          <div
            key={item.id}
            role="listitem"
            className="pe-wizard-review-listitem"
          >
            <button
              type="button"
              className={classes.join(' ')}
              data-testid={`pe-wizard-review-${item.id}`}
              onClick={item.onEdit}
              aria-describedby={valueId}
              aria-label={
                item.editAriaLabel ??
                (typeof item.label === 'string'
                  ? `${item.editLabel ?? 'Edit'} ${item.label}`
                  : undefined)
              }
            >
              {content}
            </button>
          </div>
        );
      })}
    </div>
  );
}
