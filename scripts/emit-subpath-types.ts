#!/usr/bin/env tsx
/**
 * Emit shim `.d.ts` files at the dist root so consumers' module resolvers find
 * the types next to Vite's flat JS output.
 *
 * Vite's library mode emits `dist/primitives.js` / `dist/primitives.cjs`, while
 * `tsc --emitDeclarationOnly` emits `dist/primitives/index.d.ts` (folder
 * shape). When `dist/index.d.ts` says `export * from './primitives'`, the
 * TypeScript resolver finds `dist/primitives.js` first and stops without
 * trying the folder; the result is "no exported member" errors in consumers.
 *
 * The shim is two lines per subpath:
 *
 *   // dist/primitives.d.ts
 *   export * from './primitives/index';
 *
 * After this runs, both the flat-JS and folder-declarations layouts are
 * accessible under the same logical name.
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DIST_ROOT = resolve(here, '..', 'dist');

const SHIMS = [
  { name: 'primitives', folder: 'primitives' },
  { name: 'us-household', folder: 'us-household' },
  { name: 'us-household-adapters', folder: 'us-household/adapters' },
];

async function main() {
  for (const { name, folder } of SHIMS) {
    const targetIndex = resolve(DIST_ROOT, folder, 'index.d.ts');
    if (!existsSync(targetIndex)) {
      throw new Error(`Missing declaration folder for ${name}: ${targetIndex}`);
    }
    const shimPath = resolve(DIST_ROOT, `${name}.d.ts`);
    await writeFile(shimPath, `export * from './${folder}/index';\n`, 'utf8');
    console.log(`Wrote ${shimPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
