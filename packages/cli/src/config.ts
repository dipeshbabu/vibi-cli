import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { MachineKeyPair } from '@cybermind/shared/crypto';

/**
 * Everything the client persists lives under one directory:
 *
 *   ~/.cybermind/
 *     config.json          server URL, machine id, device token   (0600)
 *     keys/machine.json    the active X25519 key pair             (0600)
 *     keys/archive/<fingerprint>.json   retired key pairs         (0600)
 *
 * Retired private keys are kept because traces encrypted before a rotation
 * can only be decrypted with the key that was active at the time.
 *
 * Override the location with CYBERMIND_HOME (used by tests).
 */

export const DEFAULT_SERVER_URL =
  process.env.CYBERMIND_SERVER_URL ?? 'http://localhost:3000';

export function configDir(): string {
  return process.env.CYBERMIND_HOME ?? join(homedir(), '.cybermind');
}

export const configPath = () => join(configDir(), 'config.json');
export const keyPath = () => join(configDir(), 'keys', 'machine.json');
export const keyArchiveDir = () => join(configDir(), 'keys', 'archive');

const configSchema = z.object({
  serverUrl: z.string().url(),
  machineId: z.number().int(),
  machineName: z.string(),
  deviceToken: z.string(),
  enrolledAt: z.string()
});
export type Config = z.infer<typeof configSchema>;

const storedKeySchema = z.object({
  algorithm: z.literal('x25519'),
  publicKey: z.string(),
  privateKey: z.string(),
  fingerprint: z.string(),
  createdAt: z.string()
});
export type StoredKeyPair = z.infer<typeof storedKeySchema>;

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function writePrivateJson(path: string, value: unknown) {
  ensureDir(join(path, '..'));
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function readConfig(): Config | null {
  if (!existsSync(configPath())) return null;
  return configSchema.parse(JSON.parse(readFileSync(configPath(), 'utf8')));
}

export function requireConfig(): Config {
  const config = readConfig();
  if (!config) {
    throw new Error(
      'This machine is not enrolled yet. Create a code in the CyberMind dashboard and run `cybermind enroll <code>`.'
    );
  }
  return config;
}

export function writeConfig(config: Config) {
  writePrivateJson(configPath(), configSchema.parse(config));
}

export function deleteConfig() {
  rmSync(configPath(), { force: true });
}

export function readKeyPair(): StoredKeyPair | null {
  if (!existsSync(keyPath())) return null;
  return storedKeySchema.parse(JSON.parse(readFileSync(keyPath(), 'utf8')));
}

export function writeKeyPair(pair: MachineKeyPair, fingerprint: string) {
  const stored: StoredKeyPair = {
    algorithm: pair.algorithm,
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    fingerprint,
    createdAt: new Date().toISOString()
  };
  writePrivateJson(keyPath(), stored);
  return stored;
}

/** Moves the active key pair into keys/archive/<fingerprint>.json. */
export function archiveKeyPair(current: StoredKeyPair) {
  ensureDir(keyArchiveDir());
  const target = join(keyArchiveDir(), `${current.fingerprint}.json`);
  renameSync(keyPath(), target);
  chmodSync(target, 0o600);
  return target;
}
