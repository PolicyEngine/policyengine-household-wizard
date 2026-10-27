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
 *
 * It then gives every relative import in the declarations its file
 * (`'./draft'` becomes `'./draft.js'`, `'./adapters'` becomes
 * `'./adapters/index.js'`). tsc keeps the sources' extensionless specifiers,
 * which a consumer resolving with `moduleResolution: "NodeNext"` refuses
 * (TS2834) because the package is ESM; bundler and node10 resolution read
 * both spellings. `scripts/check-consumer-types.ts` checks the result.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DIST_ROOT = resolve(here, '..', 'dist');

const SHIMS = [
  { name: 'primitives', folder: 'primitives' },
  { name: 'us-household', folder: 'us-household' },
  { name: 'us-household-adapters', folder: 'us-household/adapters' },
  { name: 'uk-household', folder: 'uk-household' },
  { name: 'uk-household-adapters', folder: 'uk-household/adapters' },
];

// A relative specifier in `from '…'`, `import '…'` or `import('…')`
const RELATIVE_SPECIFIER = /(\bfrom\s+|\bimport\s+|\bimport\(\s*)(['"])(\.{1,2}\/[^'"]*)\2/g;

/** The specifier with its file: `.js` for a module, `/index.js` for a folder. */
function withFile(file: string, specifier: string): string {
  if (/\.(js|json|css)$/.test(specifier)) return specifier;
  const target = resolve(dirname(file), specifier);
  if (existsSync(`${target}.d.ts`)) return `${specifier}.js`;
  if (existsSync(join(target, 'index.d.ts'))) return `${specifier}/index.js`;
  throw new Error(`${relative(DIST_ROOT, file)}: no declaration for '${specifier}'`);
}

async function declarationFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) return declarationFiles(path);
      return Promise.resolve(entry.name.endsWith('.d.ts') ? [path] : []);
    }),
  );
  return nested.flat();
}

async function main() {
  for (const { name, folder } of SHIMS) {
    const targetIndex = resolve(DIST_ROOT, folder, 'index.d.ts');
    if (!existsSync(targetIndex)) {
      throw new Error(`Missing declaration folder for ${name}: ${targetIndex}`);
    }
    const shimPath = resolve(DIST_ROOT, `${name}.d.ts`);
    await writeFile(shimPath, `export * from './${folder}/index.js';\n`, 'utf8');
    console.log(`Wrote ${shimPath}`);
  }

  let rewritten = 0;
  for (const file of await declarationFiles(DIST_ROOT)) {
    const text = await readFile(file, 'utf8');
    const next = text.replace(
      RELATIVE_SPECIFIER,
      (_, before: string, quote: string, specifier: string) => `${before}${quote}${withFile(file, specifier)}${quote}`,
    );
    if (next !== text) {
      await writeFile(file, next, 'utf8');
      rewritten += 1;
    }
  }
  console.log(`Gave relative imports their files in ${rewritten} declaration files`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
