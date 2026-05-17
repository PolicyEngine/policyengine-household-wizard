import type { USHouseholdDraft, USPersonDraft, USPersonKind } from './types';

export const DEFAULT_HOUSEHOLD_YEAR = new Date().getUTCFullYear();

const ADULT_PREFIX = 'adult';
const DEPENDENT_PREFIX = 'dependent';

function nextPersonId(people: USPersonDraft[], kind: USPersonKind): string {
  const prefix = kind === 'adult' ? ADULT_PREFIX : DEPENDENT_PREFIX;
  const ids = new Set(people.map((person) => person.id));
  let candidate = `${prefix}-1`;
  let counter = 1;
  while (ids.has(candidate)) {
    counter += 1;
    candidate = `${prefix}-${counter}`;
  }
  return candidate;
}

/**
 * Returns a draft with no defaults for state, ages, or marital status. The
 * wizard must explicitly capture each of these before the household is valid.
 *
 * `year` defaults to the current UTC year so calculations have a target period;
 * apps that want a fixed year can pass one in.
 */
export function createBlankDraft(year: number = DEFAULT_HOUSEHOLD_YEAR): USHouseholdDraft {
  return {
    state: null,
    county: null,
    zip: null,
    maritalStatus: null,
    people: [],
    year,
  };
}

/**
 * Returns a deep clone of an existing draft. Used by apps that want to keep an
 * "edit baseline" separate from the in-progress draft.
 */
export function cloneDraft(draft: USHouseholdDraft): USHouseholdDraft {
  return {
    state: draft.state,
    county: draft.county,
    zip: draft.zip,
    maritalStatus: draft.maritalStatus,
    year: draft.year,
    extras: draft.extras ? structuredClone(draft.extras) : undefined,
    people: draft.people.map((person) => ({
      ...person,
      extras: person.extras ? structuredClone(person.extras) : undefined,
    })),
  };
}

export function createPerson(
  kind: USPersonKind,
  existingPeople: USPersonDraft[] = [],
  partial: Partial<USPersonDraft> = {},
): USPersonDraft {
  return {
    id: partial.id ?? nextPersonId(existingPeople, kind),
    kind,
    age: partial.age ?? null,
    ...partial,
  };
}

export function addPerson(
  draft: USHouseholdDraft,
  kind: USPersonKind,
  partial: Partial<USPersonDraft> = {},
): USHouseholdDraft {
  const newPerson = createPerson(kind, draft.people, partial);
  return { ...draft, people: [...draft.people, newPerson] };
}

export function removePerson(draft: USHouseholdDraft, personId: string): USHouseholdDraft {
  return { ...draft, people: draft.people.filter((person) => person.id !== personId) };
}

export function updatePerson(
  draft: USHouseholdDraft,
  personId: string,
  changes: Partial<USPersonDraft>,
): USHouseholdDraft {
  return {
    ...draft,
    people: draft.people.map((person) =>
      person.id === personId ? { ...person, ...changes } : person,
    ),
  };
}

export function getAdults(draft: USHouseholdDraft): USPersonDraft[] {
  return draft.people.filter((person) => person.kind === 'adult');
}

export function getDependents(draft: USHouseholdDraft): USPersonDraft[] {
  return draft.people.filter((person) => person.kind === 'dependent');
}

/**
 * Reconcile the people array with the chosen marital status. Switching to
 * "married" with one adult adds a partner; switching to "single" with two or
 * more adults removes the trailing adults beyond the first.
 */
export function applyMaritalStatusChange(
  draft: USHouseholdDraft,
  maritalStatus: USHouseholdDraft['maritalStatus'],
): USHouseholdDraft {
  if (maritalStatus === draft.maritalStatus) {
    return draft;
  }

  const adults = getAdults(draft);
  let next: USHouseholdDraft = { ...draft, maritalStatus };

  if (maritalStatus === 'married' && adults.length < 2) {
    next = addPerson(next, 'adult');
  } else if (maritalStatus === 'single' && adults.length > 1) {
    const extras = adults.slice(1);
    for (const extra of extras) {
      next = removePerson(next, extra.id);
    }
  }

  return next;
}
