import { wrapPrivateKey } from '@vibivibi/shared/userkey';
import { PASSPHRASE_SCRYPT_PARAMS, generatePassphrase, normalizePassphrase } from '@vibivibi/shared/passphrase';
import { listPendingRecipientsResponseSchema } from '@vibivibi/shared/sessions';
import { z } from 'zod';
import { ApiError, request } from '../api';
import { requireConfig } from '../config';
import { fail } from '../log';
import { readState, writeState } from '../state';

/**
 * `vibi pending`              people you sent sessions to before they had a key, with the passphrases made here
 * `vibi pending --reset <email>`  new passphrase for one of them (re-wraps the same provisional private key)
 */
export async function pending(opts: { reset?: string; json?: boolean }) {
  const config = requireConfig();
  const state = readState();
  try {
    const { pending } = await request(config.serverUrl, '/api/client/pending-recipients', { token: config.deviceToken, schema: listPendingRecipientsResponseSchema });
    if (opts.reset) {
      const email = opts.reset.trim().toLowerCase();
      const row = pending.find((p) => p.email === email && !p.claimedAt);
      if (!row) fail(`no open provisional recipient for ${email}.`);
      const local = state.pending[email];
      if (!local || local.publicKey === undefined) fail(`the provisional key for ${email} was made on another machine; run \`vibi pending --reset\` there.`);
      const passphrase = generatePassphrase();
      const encryptedPrivateKey = wrapPrivateKey({ publicKey: local.publicKey, privateKey: local.privateKey }, normalizePassphrase(passphrase), PASSPHRASE_SCRYPT_PARAMS);
      await request(config.serverUrl, `/api/client/pending-recipients/${row.id}`, {
        method: 'PUT',
        token: config.deviceToken,
        body: { encryptedPrivateKey },
        schema: z.object({ id: z.number(), email: z.string(), expiresAt: z.string() })
      });
      state.pending[email] = { ...local, id: row.id, passphrase };
      writeState(state);
      console.log(`New passphrase for ${email} (the old one no longer works):\n  ${passphrase}`);
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify(pending.map((p) => ({ ...p, passphrase: state.pending[p.email]?.passphrase ?? null })), null, 2));
      return;
    }
    if (pending.length === 0) {
      console.log('Nobody is waiting on a passphrase from you.');
      return;
    }
    for (const p of pending) {
      const local = state.pending[p.email];
      const status = p.claimedAt
        ? `claimed ${new Date(p.claimedAt).toLocaleDateString()}`
        : Date.parse(p.expiresAt) < Date.now()
          ? 'expired'
          : `waiting · expires ${new Date(p.expiresAt).toLocaleDateString()}`;
      console.log(`${p.email}  ${p.shareCount} ${p.shareCount === 1 ? 'session' : 'sessions'}  ${status}`);
      if (!p.claimedAt) {
        console.log(local?.passphrase ? `  passphrase: ${local.passphrase}` : '  passphrase: made on another machine (run `vibi pending` there, or --reset here)');
      }
    }
  } catch (error) {
    if (error instanceof ApiError) fail(error.message, error.status === 401 ? 2 : 1);
    throw error;
  }
}
