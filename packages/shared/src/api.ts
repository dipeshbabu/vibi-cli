import { z } from 'zod';
import { PUBLIC_KEY_PATTERN } from './crypto';

/**
 * Wire format between the machine client and the web app's /api/client/*
 * routes. Both sides validate with these schemas.
 *
 * Authentication: after enrollment the client sends
 *   Authorization: Bearer <deviceToken>
 * on every request. The server stores only a hash of the token.
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
  code: enrollmentCodeSchema,
  publicKey: publicKeySchema
});
export type EnrollRequest = z.infer<typeof enrollRequestSchema>;

export const enrollResponseSchema = z.object({
  machineId: z.number().int(),
  name: z.string(),
  deviceToken: z.string(),
  fingerprint: z.string(),
  serverTime: z.string()
});
export type EnrollResponse = z.infer<typeof enrollResponseSchema>;

export const heartbeatRequestSchema = z.object({
  clientVersion: z.string().max(32).optional()
});
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;

export const machineKeySummarySchema = z.object({
  fingerprint: z.string(),
  createdAt: z.string()
});

export const machineSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  platform: z.string(),
  hostname: z.string(),
  lastSeenAt: z.string().nullable(),
  activeKey: machineKeySummarySchema.nullable()
});
export type MachineSummary = z.infer<typeof machineSummarySchema>;

export const heartbeatResponseSchema = z.object({
  ok: z.literal(true),
  serverTime: z.string(),
  machine: machineSummarySchema
});
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;

export const rotateKeyRequestSchema = z.object({
  publicKey: publicKeySchema
});
export type RotateKeyRequest = z.infer<typeof rotateKeyRequestSchema>;

export const rotateKeyResponseSchema = z.object({
  fingerprint: z.string(),
  retiredFingerprint: z.string().nullable(),
  serverTime: z.string()
});
export type RotateKeyResponse = z.infer<typeof rotateKeyResponseSchema>;

export const apiErrorSchema = z.object({ error: z.string() });
