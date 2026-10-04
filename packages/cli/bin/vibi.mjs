#!/usr/bin/env node
// Published package: runs the bundle in dist/. Workspace checkout: runs the
// TypeScript sources through tsx, so development needs no build step.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundle = new URL('../dist/vibi.mjs', import.meta.url);
if (existsSync(fileURLToPath(bundle))) {
  await import(bundle.href);
} else {
  const { register } = await import('tsx/esm/api');
  register();
  await import('../src/index.ts');
}
