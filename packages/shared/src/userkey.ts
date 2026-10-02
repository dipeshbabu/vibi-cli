import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync
} from 'node:crypto';
import { encryptedPrivateKeySchema, type EncryptedPrivateKey } from './api';
import { isValidPublicKey, publicKeyFingerprint, type KeyPair } from './crypto';

/**
 * Wrapping the user's private key with their encryption password so the
 * server can hold it without being able to read it.
 *
 *   kek        = scrypt(NFKC(password), salt, N, r, p) -> 32 bytes
 *   ciphertext = AES-256-GCM(kek, nonce, privateKey, aad = "vibi/v1/userkey:" + fingerprint)
 *
 * The scrypt parameters travel with the ciphertext so they can be raised
 * later without a format change. Default 2^16 / 8 / 1 is about 64 MB and a
 * fraction of a second on a laptop.
 */

export const SCRYPT_PARAMS = { N: 1 << 16, r: 8, p: 1 } as const;
export const MIN_PASSWORD_LENGTH = 12;
const SCRYPT_MAXMEM = 1024 * 1024 * 1024;

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong encryption password');
    this.name = 'WrongPasswordError';
  }
}

function deriveKey(password: string, salt: Buffer, params: EncryptedPrivateKey['params']) {
  return scryptSync(Buffer.from(password.normalize('NFKC'), 'utf8'), salt, 32, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAXMEM
  });
}

const aadFor = (publicKey: string) => Buffer.from(`vibi/v1/userkey:${publicKeyFingerprint(publicKey)}`);

export function wrapPrivateKey(
  pair: KeyPair,
  password: string,
  params: EncryptedPrivateKey['params'] = SCRYPT_PARAMS
): EncryptedPrivateKey {
  if (!isValidPublicKey(pair.publicKey)) throw new Error('Invalid public key');
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const kek = deriveKey(password, salt, params);
  const cipher = createCipheriv('aes-256-gcm', kek, nonce);
  cipher.setAAD(aadFor(pair.publicKey));
  const body = Buffer.concat([
    cipher.update(Buffer.from(pair.privateKey, 'base64url')),
    cipher.final(),
    cipher.getAuthTag()
  ]);
  return encryptedPrivateKeySchema.parse({
    v: 1,
    kdf: 'scrypt',
    params: { ...params },
    salt: salt.toString('base64url'),
    nonce: nonce.toString('base64url'),
    ciphertext: body.toString('base64url')
  });
}

/** Returns the key pair, or throws WrongPasswordError. */
export function unwrapPrivateKey(
  encrypted: EncryptedPrivateKey,
  publicKey: string,
  password: string
): KeyPair {
  const kek = deriveKey(password, Buffer.from(encrypted.salt, 'base64url'), encrypted.params);
  const body = Buffer.from(encrypted.ciphertext, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(encrypted.nonce, 'base64url'));
  decipher.setAAD(aadFor(publicKey));
  decipher.setAuthTag(body.subarray(body.length - 16));
  let privateKey: Buffer;
  try {
    privateKey = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  } catch {
    throw new WrongPasswordError();
  }
  return { algorithm: 'x25519', publicKey, privateKey: privateKey.toString('base64url') };
}
