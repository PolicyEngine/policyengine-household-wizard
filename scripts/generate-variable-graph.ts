#!/usr/bin/env tsx
/**
 * Generate `tests/us-household/data/policyengine-us-variable-graph.json` from
 * PolicyEngine US metadata. The V1 payload invariant tests read it to check
 * that the adapter never sends a variable together with one of its
 * components, and never sends a computed variable for only some people. Run
 * after changing the adapter's variable mapping, or when
 * PolicyEngine US restructures the variables it sets:
 *
 *   bun run regenerate-variable-graph
 *
 * The snapshot holds every variable the adapter can emit plus the transitive
 * `adds`/`subtracts` components beneath each one, whether the model computes
 * each variable, and its default. Components given as a parameter path are resolved
 * to the union of that list parameter's values across all dates.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FLAG_TO_VARIABLE,
  INCOME_TO_VARIABLE,
  SSI_TAKE_UP_VARIABLE,
} from '../src/us-household/adapters/v1Payload';

const METADATA_URL = 'https://api.policyengine.org/us/metadata';

/** Person variables the adapter sets outside the flag and income maps. */
const OTHER_PERSON_VARIABLES = ['age', 'is_tax_unit_dependent', SSI_TAKE_UP_VARIABLE];
/** Household variables the adapter sets. */
const HOUSEHOLD_VARIABLES = ['state_name', 'county'];

type Components = string[] | string | null | undefined;

interface MetadataVariable {
  entity: string;
  /** False when the model computes the variable (a formula, adds, or subtracts). */
  isInputVariable?: boolean;
  defaultValue?: unknown;
  adds?: Components;
  subtracts?: Components;
}

interface MetadataParameter {
  values?: Record<string, unknown>;
}

interface MetadataPayload {
  result: {
    version: string;
    variables: Record<string, MetadataVariable>;
    parameters: Record<string, MetadataParameter>;
  };
}

export interface VariableGraphNode {
  entity: string;
  /**
   * False when the model computes the variable. policyengine-core stores one
   * array per variable and period for a whole entity, so an input for one
   * person gives everyone else the stored default instead of the computed
   * value.
   */
  isInputVariable: boolean;
  /** What a person who sends nothing holds, for input variables. */
  defaultValue: unknown;
  adds: string[];
  subtracts: string[];
}

export interface VariableGraph {
  source: string;
  policyengineUsVersion: string;
  variables: Record<string, VariableGraphNode>;
}

function resolveComponents(
  components: Components,
  parameters: Record<string, MetadataParameter>,
): string[] {
  if (components === null || components === undefined) {
    return [];
  }
  if (Array.isArray(components)) {
    return [...components].sort();
  }
  const parameter = parameters[components];
  if (!parameter?.values) {
    throw new Error(`Component list parameter "${components}" is missing from metadata.`);
  }
  const names = new Set<string>();
  for (const value of Object.values(parameter.values)) {
    if (!Array.isArray(value)) {
      throw new Error(`Component list parameter "${components}" has a non-list value.`);
    }
    for (const name of value) {
      names.add(String(name));
    }
  }
  return [...names].sort();
}

export function buildVariableGraph(
  metadata: MetadataPayload['result'],
  roots: string[],
): VariableGraph {
  const variables: Record<string, VariableGraphNode> = {};
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (variables[name]) {
      continue;
    }
    const variable = metadata.variables[name];
    if (!variable) {
      throw new Error(`Variable "${name}" is missing from PolicyEngine US metadata.`);
    }
    if (typeof variable.isInputVariable !== 'boolean') {
      throw new Error(`Variable "${name}" has no isInputVariable flag in metadata.`);
    }
    const node: VariableGraphNode = {
      entity: variable.entity,
      isInputVariable: variable.isInputVariable,
      defaultValue: variable.defaultValue ?? null,
      adds: resolveComponents(variable.adds, metadata.parameters),
      subtracts: resolveComponents(variable.subtracts, metadata.parameters),
    };
    variables[name] = node;
    queue.push(...node.adds, ...node.subtracts);
  }

  const sorted: Record<string, VariableGraphNode> = {};
  for (const name of Object.keys(variables).sort()) {
    sorted[name] = variables[name];
  }
  return {
    source: METADATA_URL,
    policyengineUsVersion: metadata.version,
    variables: sorted,
  };
}

async function main() {
  console.log(`Fetching ${METADATA_URL}...`);
  const response = await fetch(METADATA_URL);
  if (!response.ok) {
    throw new Error(`Metadata fetch failed: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as MetadataPayload;
  const roots = [
    ...OTHER_PERSON_VARIABLES,
    ...Object.values(FLAG_TO_VARIABLE),
    ...Object.values(INCOME_TO_VARIABLE),
    ...HOUSEHOLD_VARIABLES,
  ];
  const graph = buildVariableGraph(payload.result, roots);

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(
    here,
    '..',
    'tests',
    'us-household',
    'data',
    'policyengine-us-variable-graph.json',
  );
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');

  console.log(
    `Wrote ${Object.keys(graph.variables).length} variables from PolicyEngine US ` +
      `${graph.policyengineUsVersion} to ${outPath}`,
  );
}

const isDirectInvocation =
  typeof process !== 'undefined' && process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
