import path from 'node:path';
import {
  type InviteResponse,
  inviteResponseSchema,
  pendingRecipientResponseSchema,
  sessionDetailResponseSchema,
  userLookupResponseSchema
} from '@vibivibi/shared/sessions';
import { addRecipient, contentKeyFor } from '@vibivibi/shared/envelope';
import { generateKeyPair } from '@vibivibi/shared/crypto';
import { wrapPrivateKey } from '@vibivibi/shared/userkey';
import { PASSPHRASE_SCRYPT_PARAMS, generatePassphrase, normalizePassphrase } from '@vibivibi/shared/passphrase';
import { ApiError, request } from './api';
import { readUserKey, type Config, type LocalUserKey } from './config';
import { adapterFor, discoverContext, discoverLocalSessions, type LocalSession, type TraceContent } from './harnesses';
import { encodeClaudeProjectDir } from './harnesses/install';
import { readState, writeState, type SessionState, type State } from './state';
import { fetchUserKey, rememberPublicKey } from './userkey';
import { sha256, uploadVersion } from './upload';
import type { ProgressReporter } from './progress';

/**
 * Sessions that belong to `dir`, newest first: their recorded working
 * directory is `dir` or inside it, or (Claude Code) the transcript lives in
 * the project folder Claude Code keeps for `dir`. The second rule matters for
 * sessions pulled from another machine, whose transcript still records the
 * original path.
 */
export async function sessionsForDirectory(dir: string, max = 500): Promise<LocalSession[]> {
  const root = path.resolve(dir);
  const claudeFolder = encodeClaudeProjectDir(root);
  const all = await discoverLocalSessions(discoverContext(max));
  return all.filter((s) => {
    if (s.harness === 'claude' && s.sourcePath && path.basename(path.dirname(s.sourcePath)) === claudeFolder) return true;
    if (!s.cwd) return false;
    const cwd = path.resolve(s.cwd);
    return cwd === root || cwd.startsWith(root + path.sep);
  });
}

export type SessionStatus = 'new' | 'synced' | 'changed';

export function sessionStatus(session: LocalSession, state: State): SessionStatus {
  const prev = state.sessions[session.key];
  if (!prev) return 'new';
  if (session.sourcePath) {
    return prev.mtimeMs === session.mtimeMs && prev.sizeBytes === session.sizeBytes ? 'synced' : 'changed';
  }
  return prev.updatedMs === session.updatedMs ? 'synced' : 'changed';
}

/** The user's key with at least the public half, fetching it if this machine has none. */
export async function ensurePublicKey(config: Config): Promise<LocalUserKey> {
  const local = readUserKey();
  if (local) return local;
  const remote = await fetchUserKey(config);
  if (!remote) throw new Error('Your account has no encryption key yet; run `vibi enroll <code>` first.');
  return rememberPublicKey(remote);
}

async function readTrace(session: LocalSession, onProgress?: ProgressReporter): Promise<{ trace: TraceContent; hash: string }> {
  onProgress?.({ phase: 'reading' });
  const trace = await adapterFor(session.harness).readTrace(session, discoverContext(1));
  if (trace.bytes.length === 0) throw new Error('The session file is empty.');
  return { trace, hash: sha256(trace.bytes) };
}

function unchanged(prev: SessionState | undefined, hash: string, key: LocalUserKey) {
  return !!prev && prev.plaintextHash === hash && prev.keyFingerprint === key.fingerprint;
}

async function setLabel(config: Config, sessionId: number, label: string | null) {
  await request(config.serverUrl, `/api/client/sessions/${sessionId}`, {
    method: 'PATCH',
    token: config.deviceToken,
    body: { label },
    schema: sessionDetailResponseSchema.pick({ id: true, label: true })
  });
}

export type SyncOutcome = { sessionId: number; pullId: string; versionId: number; seq: number | null; uploaded: boolean };

/** The stored version this machine last uploaded, as the server still has it; null if gone. */
async function serverStillHas(config: Config, prev: SessionState) {
  try {
    const detail = await request(config.serverUrl, `/api/client/sessions/${prev.sessionId}`, {
      token: config.deviceToken,
      schema: sessionDetailResponseSchema
    });
    const version = detail.versions.find((v) => v.id === prev.versionId && v.status === 'stored');
    return version ? { pullId: detail.pullId, seq: version.seq } : null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Sync: encrypt for yourself and upload, unless this exact content is already
 * stored. "Already stored" is confirmed with the server, so a copy that went
 * missing there is re-uploaded; --force uploads regardless.
 */
export async function syncSession(
  config: Config,
  key: LocalUserKey,
  session: LocalSession,
  label: string | null | undefined,
  opts: { force?: boolean; onProgress?: ProgressReporter } = {}
): Promise<SyncOutcome> {
  const { trace, hash } = await readTrace(session, opts.onProgress);
  const state = readState();
  const prev = state.sessions[session.key];
  const existing = !opts.force && unchanged(prev, hash, key) ? await serverStillHas(config, prev!) : null;
  if (existing) {
    if (label !== undefined && (label || null) !== (prev!.label ?? null)) {
      await setLabel(config, prev!.sessionId, label || null);
      state.sessions[session.key] = { ...prev!, label: label || null, mtimeMs: session.mtimeMs, sizeBytes: session.sizeBytes, updatedMs: session.updatedMs, pullId: existing.pullId };
    } else {
      state.sessions[session.key] = { ...prev!, mtimeMs: session.mtimeMs, sizeBytes: session.sizeBytes, updatedMs: session.updatedMs, pullId: existing.pullId };
    }
    writeState(state);
    opts.onProgress?.({ phase: 'done' });
    return { sessionId: prev!.sessionId, pullId: existing.pullId, versionId: prev!.versionId, seq: existing.seq, uploaded: false };
  }
  return uploadVersion(config, key, { session, trace, plaintextHash: hash, label, recipients: [key.publicKey] }, opts.onProgress);
}

export type SendOutcome = SyncOutcome & {
  recipient: string;
  reusedVersion: boolean;
  /** The copy was encrypted for a provisional key made by this account; the recipient claims it with a passphrase. */
  provisional: boolean;
  /** The passphrase to pass on, when the provisional key was made on this machine. */
  passphrase: string | null;
  /** Whether the address already had an account (otherwise an invitation was emailed). */
  registered: boolean;
};

export type Recipient = { email: string; publicKey: string; provisional: boolean; passphrase: string | null; registered: boolean };

/**
 * Who to encrypt for. An address with a key is used as is. Otherwise a key
 * pair is generated here on their behalf, its private key wrapped with a
 * random passphrase, and both registered with the server; the sender passes
 * the passphrase on through another channel. The same pair is reused for
 * later sends to that address until they claim it.
 */
export async function resolveRecipient(config: Config, rawEmail: string): Promise<Recipient> {
  const email = rawEmail.trim().toLowerCase();
  try {
    const found = await request(config.serverUrl, `/api/client/users/lookup?email=${encodeURIComponent(email)}`, {
      token: config.deviceToken,
      schema: userLookupResponseSchema
    });
    return { email: found.email, publicKey: found.publicKey, provisional: false, passphrase: null, registered: true };
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  const state = readState();
  const local = state.pending[email];
  const pair = local ? { publicKey: local.publicKey, privateKey: local.privateKey } : generateKeyPair();
  const passphrase = local?.passphrase ?? generatePassphrase();
  const encryptedPrivateKey = wrapPrivateKey(pair, normalizePassphrase(passphrase), PASSPHRASE_SCRYPT_PARAMS);
  const remote = await request(config.serverUrl, '/api/client/pending-recipients', {
    method: 'POST',
    token: config.deviceToken,
    body: { email, publicKey: pair.publicKey, encryptedPrivateKey },
    schema: pendingRecipientResponseSchema
  });
  if (remote.publicKey === pair.publicKey) {
    state.pending[email] = { id: remote.id, email, publicKey: pair.publicKey, privateKey: pair.privateKey, fingerprint: remote.fingerprint, passphrase, createdAt: local?.createdAt ?? new Date().toISOString() };
    writeState(state);
    return { email, publicKey: remote.publicKey, provisional: true, passphrase, registered: remote.registered };
  }
  // A provisional key for this address already exists, made on another of our machines: use it; its passphrase lives there.
  return { email, publicKey: remote.publicKey, provisional: true, passphrase: null, registered: remote.registered };
}

/**
 * Invites an address to join. The server mails a sign-up link through Clerk;
 * the session has to be sent again once they have signed up and enrolled,
 * because nothing can be encrypted for a key that does not exist yet.
 */
export async function inviteRecipient(config: Config, email: string, session?: LocalSession): Promise<InviteResponse> {
  const known = session ? readState().sessions[session.key] : undefined;
  return request(config.serverUrl, '/api/client/invitations', {
    method: 'POST',
    token: config.deviceToken,
    body: { email, ...(known?.sessionId ? { sessionId: known.sessionId } : {}) },
    schema: inviteResponseSchema
  });
}

/** One line for the user after inviteRecipient. */
export function describeInvite(r: InviteResponse): string {
  return r.status === 'sent'
    ? `Invitation emailed to ${r.email}. Once they sign up and run \`vibi enroll\`, send the session again.`
    : `${r.email} was already invited on ${new Date(r.invitedAt).toLocaleDateString()}; no second email was sent. Send the session again once they have enrolled.`;
}

/**
 * Send: make the current content readable by another user. If the stored
 * version is already up to date and the key is unlocked here, the content key
 * is re-wrapped for the recipient and only the envelope changes; otherwise a
 * new version is uploaded encrypted for both of you.
 */
export async function sendSession(
  config: Config,
  key: LocalUserKey,
  session: LocalSession,
  label: string | null | undefined,
  email: string,
  opts: { onProgress?: ProgressReporter } = {}
): Promise<SendOutcome> {
  const recipient = await resolveRecipient(config, email);
  const extra = { provisional: recipient.provisional, passphrase: recipient.passphrase, registered: recipient.registered };
  const { trace, hash } = await readTrace(session, opts.onProgress);
  const state = readState();
  const prev = state.sessions[session.key];

  if (unchanged(prev, hash, key) && key.privateKey) {
    opts.onProgress?.({ phase: 'registering' });
    const detail = await request(config.serverUrl, `/api/client/sessions/${prev!.sessionId}`, {
      token: config.deviceToken,
      schema: sessionDetailResponseSchema
    }).catch((error) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    });
    const version = detail?.versions.find((v) => v.id === prev!.versionId && v.status === 'stored');
    if (version) {
      const contentKey = contentKeyFor(version.envelope, { publicKey: key.publicKey, privateKey: key.privateKey });
      const envelope = addRecipient(version.envelope, contentKey, recipient.publicKey);
      await request(config.serverUrl, `/api/client/session-versions/${version.id}/envelope`, {
        method: 'PUT',
        token: config.deviceToken,
        body: { envelope, shareWith: [recipient.email] },
        schema: sessionDetailResponseSchema.pick({ id: true }).extend({ sessionId: sessionDetailResponseSchema.shape.id, versionId: sessionDetailResponseSchema.shape.id }).partial()
      });
      if (label !== undefined && (label || null) !== (prev!.label ?? null)) {
        await setLabel(config, prev!.sessionId, label || null);
        state.sessions[session.key] = { ...prev!, label: label || null };
        writeState(state);
      }
      opts.onProgress?.({ phase: 'done' });
      return { sessionId: prev!.sessionId, pullId: detail!.pullId, versionId: version.id, seq: version.seq, uploaded: false, recipient: recipient.email, reusedVersion: true, ...extra };
    }
  }

  const result = await uploadVersion(config, key, {
    session,
    trace,
    plaintextHash: hash,
    label,
    recipients: [key.publicKey, recipient.publicKey],
    shareWith: [recipient.email]
  }, opts.onProgress);
  return { ...result, recipient: recipient.email, reusedVersion: false, ...extra };
}

/** One line for the user after a send: where it went and, for a provisional key, the passphrase to pass on. */
export function describeSend(r: SendOutcome, compact = false): string {
  const head = r.reusedVersion
    ? `Sent #${r.pullId} v${r.seq ?? '?'} to ${r.recipient}${compact ? ' (re-keyed, nothing re-uploaded)' : '; the stored copy was re-keyed, nothing re-uploaded.'}`
    : `Sent #${r.pullId} to ${r.recipient} as new version v${r.seq ?? '?'}${compact ? '' : '.'}`;
  if (!r.provisional) return head;
  const who = r.registered ? 'They have an account but no key yet' : 'They have no account yet (an invitation was emailed)';
  if (r.passphrase) {
    return `${head}\n${who}. Give them this passphrase through another channel; vibi asks for it when they enroll:\n  ${r.passphrase}`;
  }
  return `${head}\n${who}. The copy is encrypted for the provisional key made on another of your machines; \`vibi pending\` there shows the passphrase, or \`vibi pending --reset ${r.recipient}\` makes a new one here.`;
}
