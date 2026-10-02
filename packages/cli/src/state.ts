import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { configDir } from './config';

/**
 * What the client remembers about each uploaded session so it can skip
 * unchanged ones. Stays local; the plaintext hash in particular is never sent.
 */
const sessionStateSchema = z.object({
  sessionId: z.number().int(),
  versionId: z.number().int(),
  sourcePath: z.string(),
  sizeBytes: z.number(),
  mtimeMs: z.number(),
  updatedMs: z.number(),
  plaintextHash: z.string(),
  keyFingerprint: z.string(),
  syncedAt: z.string(),
  label: z.string().nullable().optional(),
  pullId: z.string().optional()
});
export type SessionState = z.infer<typeof sessionStateSchema>;

const stateSchema = z.object({
  version: z.literal(1),
  sessions: z.record(sessionStateSchema)
});
export type State = z.infer<typeof stateSchema>;

export const statePath = () => join(configDir(), 'state.json');

export function readState(): State {
  if (!existsSync(statePath())) return { version: 1, sessions: {} };
  try {
    return stateSchema.parse(JSON.parse(readFileSync(statePath(), 'utf8')));
  } catch {
    return { version: 1, sessions: {} };
  }
}

export function writeState(state: State) {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(statePath(), JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}
