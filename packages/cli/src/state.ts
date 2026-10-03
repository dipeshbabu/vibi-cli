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

/**
 * A key pair this machine made for someone who had no key yet, and the
 * passphrase it was wrapped with (so `vibi pending` can show it again).
 */
const pendingRecipientStateSchema = z.object({
  id: z.number().int().nullable(),
  email: z.string(),
  publicKey: z.string(),
  privateKey: z.string(),
  fingerprint: z.string(),
  passphrase: z.string(),
  createdAt: z.string()
});
export type PendingRecipientState = z.infer<typeof pendingRecipientStateSchema>;

const stateSchema = z.object({
  version: z.literal(1),
  sessions: z.record(sessionStateSchema),
  pending: z.record(pendingRecipientStateSchema).default({})
});
export type State = z.infer<typeof stateSchema>;

export const statePath = () => join(configDir(), 'state.json');

export function readState(): State {
  if (!existsSync(statePath())) return { version: 1, sessions: {}, pending: {} };
  try {
    return stateSchema.parse(JSON.parse(readFileSync(statePath(), 'utf8')));
  } catch {
    return { version: 1, sessions: {}, pending: {} };
  }
}

export function writeState(state: State) {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(statePath(), JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}
