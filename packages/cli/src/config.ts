import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Everything the client persists lives under one directory:
 *
 *   ~/.vibi/
 *     config.json      server URL, machine id, device token        (0600)
 *     keys/user.json   the user's public key, and the private key
 *                      once unlocked with the encryption password  (0600)
 *     state.json       per-session sync bookkeeping
 *
 * The private key is only ever stored on the server wrapped with the
 * encryption password; `vibi lock` removes the local plaintext copy.
 *
 * Override the location with VIBI_HOME (used by tests).
 */

/** The hosted service. `vibi enroll --server` or VIBI_SERVER_URL point a machine elsewhere (self-hosted, development). */
export const PRODUCTION_SERVER_URL = 'https://vibivibi.com';
export const DEFAULT_SERVER_URL = process.env.VIBI_SERVER_URL ?? PRODUCTION_SERVER_URL;

export function configDir(): string {
  return process.env.VIBI_HOME ?? join(homedir(), '.vibi');
}

export const configPath = () => join(configDir(), 'config.json');
export const userKeyPath = () => join(configDir(), 'keys', 'user.json');

const configSchema = z.object({
  serverUrl: z.string().url(),
  machineId: z.number().int(),
  machineName: z.string(),
  deviceToken: z.string(),
  enrolledAt: z.string()
});
export type Config = z.infer<typeof configSchema>;

const localUserKeySchema = z.object({
  publicKey: z.string(),
  fingerprint: z.string(),
  /** null while locked. */
  privateKey: z.string().nullable(),
  createdAt: z.string(),
  unlockedAt: z.string().nullable()
});
export type LocalUserKey = z.infer<typeof localUserKeySchema>;

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
      'This machine is not enrolled yet. Create a code in the vibivibi dashboard and run `vibi enroll <code>`.'
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

export function readUserKey(): LocalUserKey | null {
  if (!existsSync(userKeyPath())) return null;
  return localUserKeySchema.parse(JSON.parse(readFileSync(userKeyPath(), 'utf8')));
}

export function writeUserKey(key: LocalUserKey) {
  writePrivateJson(userKeyPath(), localUserKeySchema.parse(key));
}
