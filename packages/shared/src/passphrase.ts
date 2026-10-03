import { randomInt } from 'node:crypto';

/**
 * Passphrases for provisional recipients. Generated on the sender's machine,
 * never chosen by a person: the server holds the wrapped key and the
 * ciphertext, so a guessable passphrase would be brute-forceable offline.
 * 12 characters from a 31-symbol alphabet (no 0/O/1/l/i) is about 59 bits;
 * with scrypt at N=2^17 (~1 s per guess) that is out of reach.
 */
export const PASSPHRASE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const PASSPHRASE_LENGTH = 12;
/** Heavier than the user-key wrap (2^16): these blobs are the only secret standing between the server and the content. */
export const PASSPHRASE_SCRYPT_PARAMS = { N: 1 << 17, r: 8, p: 1 } as const;

/** e.g. "k7pq-2m4x-9fde" */
export function generatePassphrase(): string {
  const chars: string[] = [];
  for (let i = 0; i < PASSPHRASE_LENGTH; i++) chars.push(PASSPHRASE_ALPHABET[randomInt(PASSPHRASE_ALPHABET.length)]);
  return chars.join('').replace(/(.{4})(?=.)/g, '$1-');
}

/** Accepts the passphrase however it was typed: case, dashes and spaces do not matter. */
export function normalizePassphrase(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isWellFormedPassphrase(input: string): boolean {
  const n = normalizePassphrase(input);
  return n.length === PASSPHRASE_LENGTH && [...n].every((c) => PASSPHRASE_ALPHABET.includes(c));
}
