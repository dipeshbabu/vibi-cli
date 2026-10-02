import { createHash, generateKeyPairSync } from 'node:crypto';

/**
 * Key material for one machine.
 *
 * Every machine owns an X25519 key pair. The private key is generated on the
 * machine by the client and never leaves it; only the public key is sent to
 * the server. Session traces are encrypted with a hybrid scheme (per-trace
 * symmetric key wrapped for the recipient machine's X25519 public key), so the
 * server only ever stores ciphertext.
 *
 * Encoding: raw 32-byte keys, base64url without padding (43 characters), which
 * is exactly what JWK uses for the `x` / `d` fields of an OKP key.
 */

export const KEY_ALGORITHM = 'x25519' as const;
export type KeyAlgorithm = typeof KEY_ALGORITHM;

/** 32 raw bytes as unpadded base64url. */
export const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type MachineKeyPair = {
  algorithm: KeyAlgorithm;
  /** base64url, 32 bytes */
  publicKey: string;
  /** base64url, 32 bytes. Never transmitted. */
  privateKey: string;
};

export function generateMachineKeyPair(): MachineKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const pub = publicKey.export({ format: 'jwk' }) as { x?: string };
  const priv = privateKey.export({ format: 'jwk' }) as { d?: string };
  if (!pub.x || !priv.d) {
    throw new Error('Failed to export X25519 key pair');
  }
  return { algorithm: KEY_ALGORITHM, publicKey: pub.x, privateKey: priv.d };
}

export function isValidPublicKey(publicKey: string): boolean {
  return (
    PUBLIC_KEY_PATTERN.test(publicKey) &&
    Buffer.from(publicKey, 'base64url').length === 32
  );
}

/**
 * Short, human-comparable identifier for a public key: the first 16
 * base64url characters of its SHA-256. Shown in the dashboard and the CLI so
 * a user can confirm which key encrypted something. Not a secret.
 */
export function publicKeyFingerprint(publicKey: string): string {
  if (!isValidPublicKey(publicKey)) {
    throw new Error('Invalid X25519 public key');
  }
  return createHash('sha256')
    .update(Buffer.from(publicKey, 'base64url'))
    .digest('base64url')
    .slice(0, 16);
}
