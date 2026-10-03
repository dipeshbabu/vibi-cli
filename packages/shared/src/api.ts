import { z } from 'zod';
import { PUBLIC_KEY_PATTERN } from './crypto';

/**
 * Wire format between the machine client and the web app's /api/client/*
 * routes. Both sides validate with these schemas.
 *
 * Authentication: after enrollment the client sends
 *   Authorization: Bearer <deviceToken>
 * on every request. The server stores only a hash of the token. There is no
 * persistent connection or heartbeat: a machine's "last activity" is simply
 * the last authenticated request it made.
 */

export const publicKeySchema = z
  .string()
  .regex(PUBLIC_KEY_PATTERN, 'public key must be 32 bytes, base64url');

/** Enrollment codes are generated in the dashboard and expire after a few minutes. */
export const enrollmentCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((s) => s.replace(/[^A-Z0-9]/g, ''))
  .pipe(z.string().length(10));

export const machineDescriptorSchema = z.object({
  name: z.string().trim().min(1).max(100),
  platform: z.string().min(1).max(32), // os.platform(): darwin | linux | win32 | ...
  hostname: z.string().max(255),
  arch: z.string().max(32),
  clientVersion: z.string().max(32)
});

export const enrollRequestSchema = machineDescriptorSchema.extend({
  code: enrollmentCodeSchema
});
export type EnrollRequest = z.infer<typeof enrollRequestSchema>;

export const enrollResponseSchema = z.object({
  machineId: z.number().int(),
  name: z.string(),
  deviceToken: z.string(),
  serverTime: z.string()
});
export type EnrollResponse = z.infer<typeof enrollResponseSchema>;

export const machineSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  platform: z.string(),
  hostname: z.string(),
  lastSeenAt: z.string().nullable()
});
export type MachineSummary = z.infer<typeof machineSummarySchema>;

// ---------------------------------------------------------------------------
// The user's encryption key (one per account)
// ---------------------------------------------------------------------------

const b64url = z.string().regex(/^[A-Za-z0-9_-]+$/, 'expected base64url');

/**
 * The private key as stored on the server: AES-256-GCM under a key derived
 * from the user's encryption password with scrypt. The server never sees the
 * password and cannot unwrap this.
 */
export const encryptedPrivateKeySchema = z.object({
  v: z.literal(1),
  kdf: z.literal('scrypt'),
  params: z.object({
    N: z.number().int().min(1 << 14).max(1 << 22),
    r: z.number().int().min(1).max(32),
    p: z.number().int().min(1).max(16)
  }),
  /** 16 bytes */
  salt: b64url.length(22),
  /** 12 bytes */
  nonce: b64url.length(16),
  /** 32-byte private key + 16-byte GCM tag */
  ciphertext: b64url.length(64)
});
export type EncryptedPrivateKey = z.infer<typeof encryptedPrivateKeySchema>;

export const userKeySchema = z.object({
  publicKey: publicKeySchema,
  fingerprint: z.string(),
  encryptedPrivateKey: encryptedPrivateKeySchema,
  createdAt: z.string(),
  updatedAt: z.string()
});
export type UserKey = z.infer<typeof userKeySchema>;

export const createUserKeyRequestSchema = z.object({
  publicKey: publicKeySchema,
  encryptedPrivateKey: encryptedPrivateKeySchema
});
export type CreateUserKeyRequest = z.infer<typeof createUserKeyRequestSchema>;

/** Password change: same key pair, re-wrapped. */
export const rewrapUserKeyRequestSchema = z.object({
  publicKey: publicKeySchema,
  encryptedPrivateKey: encryptedPrivateKeySchema
});

/** Error bodies carry a message and, where the client needs to branch, a short code. */
export const apiErrorSchema = z.object({ error: z.string(), code: z.string().optional() });
