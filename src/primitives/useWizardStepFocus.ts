import { useEffect, useRef } from 'react';

export interface UseWizardStepFocusOptions {
  stepId: string | null;
  hasError?: boolean;
  errorRevision?: unknown;
  preventScroll?: boolean;
  onStepFocus?: () => void;
}

/** Consumers render the targets with tabIndex={-1} and own any scrolling layout. */
export function useWizardStepFocus({
  stepId,
  hasError = false,
  errorRevision,
  preventScroll = false,
  onStepFocus,
}: UseWizardStepFocusOptions) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef({ preventScroll, onStepFocus });
  useEffect(() => {
    optionsRef.current = { preventScroll, onStepFocus };
  }, [preventScroll, onStepFocus]);

  useEffect(() => {
    if (stepId === null || !headingRef.current) return;
    headingRef.current.focus({
      preventScroll: optionsRef.current.preventScroll,
    });
    optionsRef.current.onStepFocus?.();
  }, [stepId]);

  useEffect(() => {
    if (hasError)
      errorRef.current?.focus({
        preventScroll: optionsRef.current.preventScroll,
      });
  }, [stepId, hasError, errorRevision]);

  return { headingRef, errorRef };
}
