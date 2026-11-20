import { createPerson } from '../draft';
import type { USHouseholdDraft, USMaritalStatus, USPersonDraft } from '../types';
import catalog from './catalog.json';

export interface DrawUsSampleHouseholdOptions {
  /** Omit to draw across states. State codes use two uppercase letters. */
  stateCode?: string;
  /** Skip copies of the previous profile in its state when another profile is available. */
  excludeId?: string;
  /** Returns a number from zero inclusive to one exclusive. */
  random?: () => number;
}

export interface UsSampleHousehold {
  /** A catalog slot local to this release, suitable for excludeId. */
  id: string;
  stateCode: string;
  draft: USHouseholdDraft;
  provenance: {
    dataset: string;
    buildId: string;
    year: number;
    url: string;
    sha256: string;
    policyengineVersion: string;
    policyengineUsVersion: string;
    sourceHouseholds: number;
    eligibleHouseholds: number;
    totalWeight: number;
    eligibleWeight: number;
    drawsPerState: number;
    seed: number;
  };
}

interface SampleProfile {
  maritalStatus: USMaritalStatus;
  people: Pick<
    USPersonDraft,
    'kind' | 'age' | 'isFullTimeStudent' | 'isDisabled' | 'employmentIncome' |
    'selfEmploymentIncome' | 'socialSecurityIncome' | 'privatePensionIncome'
  >[];
}

interface StateSamples {
  populationWeight: number;
  households: SampleProfile[];
}

function profileKey(stateCode: string, profile: SampleProfile): string {
  // The same person fields can arrive in a different key order. The order of
  // the people themselves matters: the head and spouse occupy distinct rows.
  const members = profile.people.map((person) =>
    Object.entries(person).sort(([left], [right]) => left.localeCompare(right)),
  );
  return JSON.stringify([stateCode, profile.maritalStatus, members]);
}

// The generator has already drawn household slots in proportion to source
// weights within each state. Divide the state's eligible-household weight
// evenly among its slots so national draws also respect state population.
const states = catalog.states as Record<string, StateSamples>;
const slots = Object.entries(states).flatMap(([stateCode, state]) =>
  state.households.map((household, index) => ({
    id: `${stateCode}-${index}`,
    stateCode,
    weight: state.populationWeight / state.households.length,
    profile: household,
    profileKey: profileKey(stateCode, household),
  })),
);

/**
 * Draw an editable household from the calibrated populace_us_2024 dataset in its source year.
 * ZIP, county and other facts outside the projection stay unset.
 */
export function drawUsSampleHousehold({
  stateCode,
  excludeId,
  random = Math.random,
}: DrawUsSampleHouseholdOptions = {}): UsSampleHousehold {
  const matching = stateCode === undefined ? slots : slots.filter((slot) => slot.stateCode === stateCode);
  if (!matching.length) {
    throw new RangeError(`No sample households for state "${stateCode}".`);
  }
  const previous = excludeId === undefined ? undefined : matching.find((slot) => slot.id === excludeId);
  const alternatives = previous
    ? matching.filter((slot) => slot.profileKey !== previous.profileKey)
    : matching;
  const pool = alternatives.length > 0 ? alternatives : matching;

  const unit = random();
  if (!Number.isFinite(unit) || unit < 0 || unit >= 1) {
    throw new RangeError('The random draw must be at least zero and less than one.');
  }
  let remaining = unit * pool.reduce((sum, slot) => sum + slot.weight, 0);
  const selected = pool.find((slot) => {
    remaining -= slot.weight;
    return remaining < 0;
  }) ?? pool[pool.length - 1]; // rounding at the upper end of the last slot
  return sampleFromSlot(selected);
}

/** Reopen a sample from this catalog release, or return undefined for an unknown ID. */
export function getUsSampleHousehold(id: string): UsSampleHousehold | undefined {
  const selected = slots.find((slot) => slot.id === id);
  return selected && sampleFromSlot(selected);
}

function sampleFromSlot(selected: (typeof slots)[number]): UsSampleHousehold {
  const people: USPersonDraft[] = [];
  for (const person of selected.profile.people) {
    people.push(createPerson(person.kind, people, person));
  }
  return {
    id: selected.id,
    stateCode: selected.stateCode,
    provenance: { ...catalog.provenance },
    draft: {
      year: catalog.provenance.year, state: selected.stateCode, county: null, zip: null,
      maritalStatus: selected.profile.maritalStatus, people,
    },
  };
}
