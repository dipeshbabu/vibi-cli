import { encryptedPrivateKeySchema } from '@vibivibi/shared/api';
import { WrongPasswordError, unwrapPrivateKey } from '@vibivibi/shared/userkey';
import { addRecipient, contentKeyFor, findRecipient } from '@vibivibi/shared/envelope';
import { normalizePassphrase } from '@vibivibi/shared/passphrase';
import { claimResponseSchema, listPendingClaimsResponseSchema, type PendingClaim } from '@vibivibi/shared/sessions';
import { request } from './api';
import type { Config } from './config';
import { promptHidden } from './password';

export type ClaimSummary = { claimed: number; skipped: number; pulled: { pullId: string; from: string; label: string | null }[] };

/**
 * Sessions sent to this account before it had a key were encrypted for a
 * provisional key the sender made and wrapped with a passphrase. With that
 * passphrase the provisional private key is unwrapped here, the content key
 * of every share is re-wrapped for our own public key, and the server swaps
 * the recipients. Our private key is not needed for this.
 *
 * Non-interactive use: VIBI_PASSPHRASE (one value, tried for every sender).
 * A wrong passphrase can be retried three times; then the sender's sessions
 * stay in the inbox marked "needs passphrase" for `vibi pull` later.
 */
export async function claimPendingSessions(
  config: Config,
  key: { publicKey: string; fingerprint: string },
  opts: { interactive: boolean; only?: number; quiet?: boolean } = { interactive: true }
): Promise<ClaimSummary> {
  const summary: ClaimSummary = { claimed: 0, skipped: 0, pulled: [] };
  const { pending } = await request(config.serverUrl, '/api/client/pending', { token: config.deviceToken, schema: listPendingClaimsResponseSchema });
  const list = (opts.only ? pending.filter((p) => p.id === opts.only) : pending).filter((p) => p.shares.length > 0);
  for (const p of list) {
    const n = p.shares.length;
    if (!opts.quiet) {
      console.log(`${p.fromEmail} sent you ${n === 1 ? 'a session' : `${n} sessions`} before you had a key; ${n === 1 ? 'it is' : 'they are'} encrypted for a passphrase they gave you.`);
    }
    const pair = await unlockProvisional(p, opts.interactive);
    if (!pair) {
      summary.skipped += n;
      if (!opts.quiet) console.log(`Skipped. The ${n === 1 ? 'session stays' : 'sessions stay'} in your inbox; \`vibi pull\` asks for the passphrase again.`);
      continue;
    }
    const envelopes = p.shares.map((share) => {
      const contentKey = contentKeyFor(share.envelope, pair);
      const withMe = findRecipient(share.envelope, key.fingerprint) ? share.envelope : addRecipient(share.envelope, contentKey, key.publicKey);
      return { versionId: share.versionId, envelope: { ...withMe, recipients: withMe.recipients.filter((r) => r.fingerprint !== p.fingerprint) } };
    });
    const result = await request(config.serverUrl, `/api/client/pending/${p.id}/claim`, {
      method: 'POST',
      token: config.deviceToken,
      body: { envelopes },
      schema: claimResponseSchema
    });
    summary.claimed += result.claimed;
    for (const share of p.shares) summary.pulled.push({ pullId: share.pullId, from: p.fromEmail, label: share.label });
    if (!opts.quiet) {
      console.log(`Claimed ${result.claimed === 1 ? 'the session' : `${result.claimed} sessions`} from ${p.fromEmail}; ${result.claimed === 1 ? 'it is' : 'they are'} now encrypted for your own key.`);
      for (const share of p.shares) console.log(`  vibi pull ${share.pullId}${share.label ? `   # ${share.label}` : ''}`);
    }
  }
  return summary;
}

async function unlockProvisional(p: PendingClaim, interactive: boolean) {
  const encrypted = encryptedPrivateKeySchema.parse(p.encryptedPrivateKey);
  const preset = process.env.VIBI_PASSPHRASE;
  for (let attempt = 0; attempt < 3; attempt++) {
    let entered: string;
    if (attempt === 0 && preset !== undefined) entered = preset;
    else if (interactive) entered = await promptHidden(`Passphrase from ${p.fromEmail} (press enter to skip): `);
    else return null;
    if (!entered.trim()) return null;
    try {
      return unwrapPrivateKey(encrypted, p.publicKey, normalizePassphrase(entered));
    } catch (error) {
      if (!(error instanceof WrongPasswordError)) throw error;
      console.log(attempt < 2 ? 'Wrong passphrase. Check it with the sender (they can see it with `vibi pending`) and try again.' : 'Wrong passphrase three times; skipping for now.');
      if (!interactive) return null;
    }
  }
  return null;
}
