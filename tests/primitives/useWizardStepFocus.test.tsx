import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWizardStepFocus } from '@/primitives/useWizardStepFocus';

interface FocusProps {
  stepId: string | null;
  hasError?: boolean;
  errorRevision?: unknown;
  preventScroll?: boolean;
  onStepFocus?: () => void;
}

function FocusStep(props: FocusProps) {
  const { headingRef, errorRef } = useWizardStepFocus(props);
  return (
    <section>
      <h2 ref={headingRef} tabIndex={-1}>
        {props.stepId}
      </h2>
      {props.hasError && (
        <p role="alert" ref={errorRef} tabIndex={-1}>
          Check your answer
        </p>
      )}
      <button>Outside focus</button>
    </section>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('useWizardStepFocus', () => {
  it('focuses the heading on mount and actual step changes, with default scrolling', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const onStepFocus = vi.fn();
    const { rerender } = render(
      <FocusStep stepId="first" onStepFocus={onStepFocus} />,
    );
    expect(screen.getByRole('heading')).toHaveFocus();
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: false });
    expect(onStepFocus).toHaveBeenCalledTimes(1);

    screen.getByRole('button').focus();
    rerender(<FocusStep stepId="first" onStepFocus={onStepFocus} />);
    expect(screen.getByRole('button')).toHaveFocus();
    expect(onStepFocus).toHaveBeenCalledTimes(1);
    rerender(<FocusStep stepId="second" onStepFocus={onStepFocus} />);
    expect(screen.getByRole('heading')).toHaveFocus();
    expect(onStepFocus).toHaveBeenCalledTimes(2);
  });

  it('honors preventScroll for headings and newly rendered errors', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const onStepFocus = vi.fn();
    const { rerender } = render(
      <FocusStep stepId="first" preventScroll onStepFocus={onStepFocus} />,
    );
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    rerender(
      <FocusStep
        stepId="first"
        preventScroll
        hasError
        onStepFocus={onStepFocus}
      />,
    );
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(onStepFocus).toHaveBeenCalledTimes(1);
  });

  it('refocuses a repeated error only when its revision changes', () => {
    const { rerender } = render(
      <FocusStep stepId="first" hasError errorRevision={1} />,
    );
    expect(screen.getByRole('alert')).toHaveFocus();
    screen.getByRole('button').focus();
    rerender(<FocusStep stepId="first" hasError errorRevision={1} />);
    expect(screen.getByRole('button')).toHaveFocus();
    rerender(<FocusStep stepId="first" hasError errorRevision={2} />);
    expect(screen.getByRole('alert')).toHaveFocus();
  });

  it('focuses the new error after a step transition even if hasError stays true', () => {
    const onStepFocus = vi.fn();
    const { rerender } = render(
      <FocusStep stepId="first" hasError onStepFocus={onStepFocus} />,
    );
    screen.getByRole('button').focus();
    rerender(<FocusStep stepId="second" hasError onStepFocus={onStepFocus} />);
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(onStepFocus).toHaveBeenCalledTimes(2);
  });

  it('uses a fresh callback on the next step without refocusing for callback identity alone', () => {
    const firstCallback = vi.fn();
    const nextCallback = vi.fn();
    const { rerender } = render(
      <FocusStep stepId="first" onStepFocus={firstCallback} />,
    );
    screen.getByRole('button').focus();
    rerender(<FocusStep stepId="first" onStepFocus={nextCallback} />);
    expect(screen.getByRole('button')).toHaveFocus();
    expect(nextCallback).not.toHaveBeenCalled();
    rerender(<FocusStep stepId="second" onStepFocus={nextCallback} />);
    expect(nextCallback).toHaveBeenCalledTimes(1);
    expect(firstCallback).toHaveBeenCalledTimes(1);
  });
});
