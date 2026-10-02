import { rotateKeyResponseSchema } from '@cybermind/shared/api';
import {
  generateMachineKeyPair,
  publicKeyFingerprint
} from '@cybermind/shared/crypto';
import { ApiError, request } from '../api';
import {
  archiveKeyPair,
  readKeyPair,
  requireConfig,
  writeKeyPair
} from '../config';
import { fail } from '../log';

/**
 * Generates a fresh key pair, registers its public half, and archives the old
 * pair locally so previously encrypted traces stay readable.
 */
export async function rotateKey() {
  const config = requireConfig();
  const current = readKeyPair();

  const pair = generateMachineKeyPair();
  const fingerprint = publicKeyFingerprint(pair.publicKey);

  try {
    const result = await request(config.serverUrl, '/api/client/keys', {
      method: 'POST',
      token: config.deviceToken,
      body: { publicKey: pair.publicKey },
      schema: rotateKeyResponseSchema
    });
    // Only touch local files once the server has accepted the new key.
    const archived = current ? archiveKeyPair(current) : null;
    writeKeyPair(pair, fingerprint);
    console.log(`Rotated. New fingerprint ${result.fingerprint}.`);
    if (archived) {
      console.log(`Previous key (${result.retiredFingerprint ?? current?.fingerprint}) archived at ${archived}.`);
    }
  } catch (error) {
    if (error instanceof ApiError) fail(error.message);
    throw error;
  }
}
