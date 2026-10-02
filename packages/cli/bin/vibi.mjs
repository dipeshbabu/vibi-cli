#!/usr/bin/env node
// Runs the TypeScript sources directly through tsx, so the workspace needs no
// build step. A bundled build replaces this file before publishing to npm.
import { register } from 'tsx/esm/api';

register();
await import('../src/index.ts');
