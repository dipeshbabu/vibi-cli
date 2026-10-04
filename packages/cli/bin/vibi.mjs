#!/usr/bin/env node
// Workspace checkout: runs the TypeScript sources through tsx, so development
// needs no build step and a stale bundle can never shadow the code. Published
// package (no src/): runs the bundle in dist/.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sources = new URL('../src/index.ts', import.meta.url);
if (existsSync(fileURLToPath(sources))) {
  const { register } = await import('tsx/esm/api');
  register();
  await import(sources.href);
} else {
  await import(new URL('../dist/vibi.mjs', import.meta.url).href);
}
