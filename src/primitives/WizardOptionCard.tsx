import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface WizardOptionCardProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'onSelect'> {
  selected?: boolean;
  title: ReactNode;
  description?: ReactNode;
  onSelect?: () => void;
}

export function WizardOptionCard({
  selected = false,
  title,
  description,
  onSelect,
  onClick,
  className,
  type,
  disabled,
  ...rest
}: WizardOptionCardProps) {
  const classes = ['pe-wizard-option-card'];
  if (selected) {
    classes.push('pe-wizard-option-card--selected');
  }
  if (className) {
    classes.push(className);
  }

  return (
    <button
      type={type ?? 'button'}
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled ? true : undefined}
      disabled={disabled}
      className={classes.join(' ')}
      onClick={(event) => {
        if (disabled) {
          return;
        }
        onClick?.(event);
        if (!event.defaultPrevented) {
          onSelect?.();
        }
      }}
      {...rest}
    >
      <span className="pe-wizard-option-card-title">{title}</span>
      {description ? (
        <span className="pe-wizard-option-card-description">{description}</span>
      ) : null}
    </button>
  );
}
