import { createRequire } from 'node:module';

// Baked in at build time (`bun build --define __VIBI_VERSION__=...`, see
// scripts/build-cli.mjs); a source checkout reads package.json instead.
declare const __VIBI_VERSION__: string | undefined;

function fromPackageJson(): string {
  try {
    return (createRequire(import.meta.url)('../package.json') as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

export const VERSION: string = typeof __VIBI_VERSION__ === 'string' ? __VIBI_VERSION__ : fromPackageJson();
