#!/usr/bin/env tsx
/**
 * Type-check a consumer of the built package (run after `bun run build`).
 *
 * A throwaway app imports every export path and uses a named export from
 * each, then tsc checks it with library checking on (`skipLibCheck: false`),
 * once for each way consumers resolve modules: ESM with
 * `moduleResolution: "NodeNext"`, as Node runs it, and `"Bundler"`, as Vite
 * and Next.js do. The package is linked into the app's node_modules, so its
 * own `exports` map and `dist` declarations are what the app sees.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc');

const CONSUMER = `\
import { createBlankDraft } from 'policyengine-household-wizard';
import { WizardProgress } from 'policyengine-household-wizard/primitives';
import { createBlankDraft as createBlankUSDraft } from 'policyengine-household-wizard/us-household';
import { toV1HouseholdPayload } from 'policyengine-household-wizard/us-household/adapters';
import {
  createTypicalDraft,
  deserializeDraft,
  serializeDraft,
  toHouseholdImpactRequest,
  validate,
  type HouseholdImpactRequest,
  type UKHouseholdDraft,
} from 'policyengine-household-wizard/uk-household';
import { toHouseholdImpactRequest as toRequest } from 'policyengine-household-wizard/uk-household/adapters';

const draft: UKHouseholdDraft = deserializeDraft(serializeDraft(createTypicalDraft()));
const result: boolean = validate(draft, { year: 2027 }).ok;
const body: HouseholdImpactRequest = toHouseholdImpactRequest(draft, { year: 2027, policies: ['road_fuel_vat_cut'] });
const same: HouseholdImpactRequest = toRequest(draft, { year: 2027, policies: ['road_fuel_vat_cut'] });
export const used = [createBlankDraft, WizardProgress, createBlankUSDraft, toV1HouseholdPayload, result, body, same];
`;

const RESOLUTIONS = [
  { name: 'NodeNext (ESM)', module: 'NodeNext', moduleResolution: 'NodeNext' },
  { name: 'Bundler', module: 'ESNext', moduleResolution: 'Bundler' },
];

const app = mkdtempSync(join(tmpdir(), 'household-wizard-consumer-'));
let failed = false;
try {
  mkdirSync(join(app, 'node_modules'));
  symlinkSync(ROOT, join(app, 'node_modules', 'policyengine-household-wizard'), 'dir');
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  writeFileSync(join(app, 'index.ts'), CONSUMER);
  for (const { name, module, moduleResolution } of RESOLUTIONS) {
    const compilerOptions = {
      module,
      moduleResolution,
      target: 'ES2022',
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      types: [],
      jsx: 'react-jsx',
    };
    writeFileSync(join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['index.ts'] }));
    const run = spawnSync(TSC, ['-p', app], { encoding: 'utf8' });
    if (run.status === 0) {
      console.log(`${name}: the consumer type-checks`);
    } else {
      failed = true;
      console.error(`${name}: the consumer does not type-check\n${run.stdout}${run.stderr}`);
    }
  }
} finally {
  rmSync(app, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
