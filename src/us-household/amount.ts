/**
 * An entered amount as a finite number, or `undefined` when nothing usable was
 * entered. Drafts parsed from JSON or forms can carry numeric strings, null,
 * NaN, or Infinity. `validate()` and the V1 adapter both use this, so they
 * agree on which amounts count as entered.
 */
export function toAmount(value: unknown): number | undefined {
  const amount = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : undefined;
}
