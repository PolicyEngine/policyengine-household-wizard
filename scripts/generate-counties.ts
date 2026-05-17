#!/usr/bin/env tsx
/**
 * Generate `src/us-household/data/counties-by-state.json` from PolicyEngine US
 * metadata. Run when PolicyEngine US releases new geography:
 *
 *   bun run regenerate-counties
 *
 * The resulting file is the only source of truth for county codes in this
 * package. Apps that need fresher data can fetch the metadata themselves and
 * pass it to {@link buildCountiesByState} at runtime.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const METADATA_URL = 'https://api.policyengine.org/us/metadata';

interface PossibleValue {
  value: string;
  label: string;
}

interface MetadataVariable {
  possibleValues?: PossibleValue[];
}

interface MetadataPayload {
  result: {
    variables: Record<string, MetadataVariable>;
  };
}

export interface CountyEntry {
  code: string;
  name: string;
}

export type CountiesByState = Record<string, CountyEntry[]>;

const SKIP_VALUES = new Set(['UNKNOWN']);

export function buildCountiesByState(possibleValues: PossibleValue[]): CountiesByState {
  const byState: CountiesByState = {};

  for (const { value, label } of possibleValues) {
    if (SKIP_VALUES.has(value)) {
      continue;
    }
    // Codes look like "ALAMEDA_COUNTY_CA". The final segment after the last
    // underscore is the state two-letter code.
    const parts = value.split('_');
    if (parts.length < 2) {
      continue;
    }
    const stateCode = parts[parts.length - 1];
    if (!/^[A-Z]{2}$/.test(stateCode)) {
      continue;
    }
    // Labels look like "Alameda County, CA". Strip the trailing state segment
    // so the dropdown reads cleanly when grouped by state.
    const name = label.replace(/,\s*[A-Z]{2}$/, '').trim() || label;

    if (!byState[stateCode]) {
      byState[stateCode] = [];
    }
    byState[stateCode].push({ code: value, name });
  }

  for (const stateCode of Object.keys(byState)) {
    byState[stateCode].sort((left, right) => left.name.localeCompare(right.name));
  }

  return byState;
}

async function main() {
  console.log(`Fetching ${METADATA_URL}...`);
  const response = await fetch(METADATA_URL);
  if (!response.ok) {
    throw new Error(`Metadata fetch failed: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as MetadataPayload;
  const countyVariable = payload.result.variables.county;
  const possibleValues = countyVariable?.possibleValues ?? [];

  if (possibleValues.length === 0) {
    throw new Error('No possibleValues for "county" in metadata.');
  }

  const byState = buildCountiesByState(possibleValues);
  const counts = Object.entries(byState).map(([state, list]) => `${state}=${list.length}`);
  console.log(`Built counties for ${Object.keys(byState).length} states; counts: ${counts.join(', ')}`);

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, '..', 'src', 'us-household', 'data', 'counties-by-state.json');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(byState, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outPath}`);
}

const isDirectInvocation =
  typeof process !== 'undefined' && process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
