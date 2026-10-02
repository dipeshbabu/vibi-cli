import { z } from 'zod';

/**
 * Coding-agent harnesses the client knows how to read. The discovery rules
 * (paths, record shapes) follow subconscious-cli's bin/sessions.js.
 */
export const HARNESSES = {
  claude: { name: 'Claude Code' },
  codex: { name: 'Codex CLI' },
  opencode: { name: 'OpenCode' },
  pi: { name: 'Pi' },
  sc: { name: 'Marathon' }
} as const;
export type Harness = keyof typeof HARNESSES;
export const harnessSchema = z.enum(['claude', 'codex', 'opencode', 'pi', 'sc']);
export function harnessName(harness: string): string {
  return (HARNESSES as Record<string, { name: string }>)[harness]?.name ?? harness;
}

/** Hard cap on one encrypted trace. */
export const MAX_TRACE_BYTES = 200 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Envelope: what the server stores next to the ciphertext. Nothing in it is
// readable without a recipient's private key except sizes and fingerprints.
// ---------------------------------------------------------------------------

export const ENVELOPE_ALGORITHM = 'x25519-hkdf-sha256/aes-256-gcm' as const;

const b64url = z.string().regex(/^[A-Za-z0-9_-]+$/, 'expected base64url');

export const envelopeRecipientSchema = z.object({
  /** Fingerprint of the recipient's X25519 public key. */
  fingerprint: z.string().min(1).max(64),
  /** Ephemeral X25519 public key used for this recipient (32 bytes). */
  epk: b64url.length(43),
  /** AES-GCM nonce for the wrapped key (12 bytes). */
  nonce: b64url.length(16),
  /** Content key encrypted under HKDF(ECDH(epk, recipient)) + GCM tag (48 bytes). */
  wrapped: b64url.length(64)
});
export type EnvelopeRecipient = z.infer<typeof envelopeRecipientSchema>;

export const envelopeHeaderSchema = z.object({
  v: z.literal(1),
  alg: z.literal(ENVELOPE_ALGORITHM),
  content: z.object({
    nonce: b64url.length(16),
    /** Ciphertext length including the 16-byte GCM tag. */
    length: z.number().int().nonnegative(),
    /** SHA-256 of the ciphertext, used to verify the stored object. */
    hash: b64url.length(43)
  }),
  /** Encrypted JSON (TraceMetadata) under the same content key. */
  meta: z.object({
    nonce: b64url.length(16),
    ciphertext: b64url.max(64 * 1024)
  }),
  recipients: z.array(envelopeRecipientSchema).min(1).max(64)
});
export type EnvelopeHeader = z.infer<typeof envelopeHeaderSchema>;

/** Only ever seen in plaintext on a machine holding a recipient private key. */
export const traceMetadataSchema = z.object({
  title: z.string().max(500).default(''),
  cwd: z.string().max(1000).default(''),
  model: z.string().max(200).default(''),
  messageCount: z.number().int().nonnegative().default(0),
  sourcePath: z.string().max(1000).default(''),
  startedAt: z.string().nullable().default(null)
});
export type TraceMetadata = z.infer<typeof traceMetadataSchema>;

// ---------------------------------------------------------------------------
// Client <-> server protocol for traces
// ---------------------------------------------------------------------------

export const labelSchema = z.string().trim().max(200);
export const emailSchema = z.string().trim().toLowerCase().email();

export const registerSessionRequestSchema = z.object({
  harness: harnessSchema,
  /** The harness's own session id (Claude Code session UUID, Codex thread id, ...). */
  harnessSessionId: z.string().min(1).max(200),
  harnessUpdatedAt: z.string().datetime({ offset: true }),
  /** Ciphertext length. */
  sizeBytes: z.number().int().positive().max(MAX_TRACE_BYTES),
  /** SHA-256 of the ciphertext (must equal envelope.content.hash). */
  contentHash: b64url.length(43),
  envelope: envelopeHeaderSchema,
  /** Optional plaintext name shown in the dashboard and to recipients. */
  label: labelSchema.nullable().optional(),
  /** Emails of users this version is sent to; their keys must be among envelope.recipients. */
  shareWith: z.array(emailSchema).max(20).optional()
});
export type RegisterSessionRequest = z.infer<typeof registerSessionRequestSchema>;

export const uploadInstructionSchema = z.discriminatedUnion('transport', [
  z.object({
    transport: z.literal('vercel-blob'),
    /** Route (relative to the server) that issues the client upload token. */
    handleUploadUrl: z.string(),
    pathname: z.string(),
    access: z.enum(['private', 'public']),
    multipart: z.boolean()
  }),
  z.object({
    /** Development only: PUT the ciphertext to this route with the device token. */
    transport: z.literal('direct'),
    url: z.string()
  })
]);
export type UploadInstruction = z.infer<typeof uploadInstructionSchema>;

export const registerSessionResponseSchema = z.object({
  sessionId: z.number().int(),
  /** The session's public handle (#xxxxxxxxxx). */
  pullId: z.string(),
  versionId: z.number().int(),
  /** Version number when the server already had it; null until the upload completes. */
  seq: z.number().int().nullable(),
  /** 'stored' means the server already holds exactly this ciphertext; no upload needed. */
  status: z.enum(['stored', 'pending']),
  upload: uploadInstructionSchema.nullable()
});
export type RegisterSessionResponse = z.infer<typeof registerSessionResponseSchema>;

export const completeVersionRequestSchema = z.object({
  /** URL returned by the Vercel Blob client upload; omitted for the direct transport. */
  blobUrl: z.string().url().optional()
});
export const completeVersionResponseSchema = z.object({
  sessionId: z.number().int(),
  versionId: z.number().int(),
  seq: z.number().int(),
  status: z.literal('stored')
});

/** Who can decrypt a version, as the owner sees it. */
export const versionSummarySchema = z.object({
  id: z.number().int(),
  /** Version number within the session (1, 2, 3...); null while the upload is pending. */
  seq: z.number().int().nullable(),
  /** Machine that uploaded this version. */
  machineName: z.string().nullable(),
  contentHash: z.string(),
  sizeBytes: z.number().int(),
  keyFingerprint: z.string(),
  status: z.enum(['pending', 'stored']),
  createdAt: z.string(),
  storedAt: z.string().nullable(),
  /** Emails of users this version was sent to. */
  sharedWith: z.array(z.string())
});
export type VersionSummary = z.infer<typeof versionSummarySchema>;

export const sessionDetailResponseSchema = z.object({
  id: z.number().int(),
  pullId: z.string(),
  machineName: z.string(),
  harness: harnessSchema,
  harnessSessionId: z.string(),
  harnessUpdatedAt: z.string(),
  label: z.string().nullable(),
  currentVersionId: z.number().int().nullable(),
  versions: z.array(versionSummarySchema.extend({ envelope: envelopeHeaderSchema }))
});
export type SessionDetail = z.infer<typeof sessionDetailResponseSchema>;

export const updateSessionRequestSchema = z.object({
  label: labelSchema.nullable()
});

/** Grant more users access to an already stored version without re-uploading it. */
export const updateEnvelopeRequestSchema = z.object({
  envelope: envelopeHeaderSchema,
  shareWith: z.array(emailSchema).min(1).max(20)
});

export const userLookupResponseSchema = z.object({
  email: z.string(),
  publicKey: z.string(),
  fingerprint: z.string()
});
export type UserLookup = z.infer<typeof userLookupResponseSchema>;

export const sessionSummarySchema = z.object({
  id: z.number().int(),
  pullId: z.string(),
  machineId: z.number().int(),
  harness: harnessSchema,
  harnessSessionId: z.string(),
  harnessUpdatedAt: z.string(),
  label: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  keyFingerprint: z.string().nullable(),
  status: z.enum(['pending', 'stored'])
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const listSessionsResponseSchema = z.object({
  sessions: z.array(sessionSummarySchema)
});

/** A session as another machine sees it when listing the account's traces. */
export const remoteSessionSchema = z.object({
  id: z.number().int(),
  /** What `vibi pull` takes (10 hex chars, shown with a leading #). */
  pullId: z.string(),
  /** The machine that pushed the latest version. */
  machineId: z.number().int(),
  machineName: z.string(),
  harness: harnessSchema,
  harnessSessionId: z.string(),
  harnessUpdatedAt: z.string(),
  label: z.string().nullable(),
  /** Current stored version, or null while the first upload is pending. */
  versionId: z.number().int().nullable(),
  sizeBytes: z.number().int().nullable(),
  keyFingerprint: z.string().nullable(),
  /** Needed to decrypt the metadata (title, cwd) and later the content. */
  envelope: envelopeHeaderSchema.nullable(),
  versionCount: z.number().int()
});
export type RemoteSession = z.infer<typeof remoteSessionSchema>;

/** A version another user sent to this account. */
export const sharedSessionSchema = z.object({
  shareId: z.number().int(),
  pullId: z.string(),
  fromEmail: z.string(),
  label: z.string().nullable(),
  harness: harnessSchema,
  harnessSessionId: z.string(),
  harnessUpdatedAt: z.string(),
  versionId: z.number().int(),
  sizeBytes: z.number().int(),
  envelope: envelopeHeaderSchema,
  sentAt: z.string()
});
export type SharedSession = z.infer<typeof sharedSessionSchema>;

export const listRemoteSessionsResponseSchema = z.object({
  sessions: z.array(remoteSessionSchema),
  shared: z.array(sharedSessionSchema)
});
