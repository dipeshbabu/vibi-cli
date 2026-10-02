import {
  enrollResponseSchema,
  machineSummarySchema,
  type EnrollRequest
} from '@cybermind/shared/api';
import {
  generateMachineKeyPair,
  publicKeyFingerprint
} from '@cybermind/shared/crypto';
import { request, ApiError } from '../api';
import {
  DEFAULT_SERVER_URL,
  keyPath,
  readConfig,
  readKeyPair,
  writeConfig,
  writeKeyPair
} from '../config';
import { fail } from '../log';
import { describeThisMachine } from '../machine';

export async function enroll(
  code: string,
  opts: { server?: string; name?: string; force?: boolean }
) {
  const existing = readConfig();
  const serverUrl = opts.server ?? existing?.serverUrl ?? DEFAULT_SERVER_URL;

  if (existing && !opts.force) {
    // Ask the server whether the previous enrollment is still alive. If the
    // machine was revoked in the dashboard, enrolling again is the obvious
    // intent, so continue without demanding --force.
    const alive = await previousEnrollmentIsAlive(existing.serverUrl, existing.deviceToken);
    if (alive) {
      fail(
        `already enrolled as "${existing.machineName}" (#${existing.machineId}) at ${existing.serverUrl}. ` +
          'Run `cybermind status`, or pass --force to enroll again as a new machine.'
      );
    }
    console.log(
      `Previous enrollment "${existing.machineName}" (#${existing.machineId}) is no longer valid (revoked?); enrolling again.`
    );
  }

  // The key pair is created here and the private half never leaves this file.
  let key = readKeyPair();
  if (!key) {
    const pair = generateMachineKeyPair();
    key = writeKeyPair(pair, publicKeyFingerprint(pair.publicKey));
    console.log(`Generated a new X25519 key pair (fingerprint ${key.fingerprint}).`);
  } else {
    console.log(`Using the existing key pair (fingerprint ${key.fingerprint}).`);
  }

  const body: EnrollRequest = {
    ...describeThisMachine(opts.name),
    code,
    publicKey: key.publicKey
  };

  try {
    const result = await request(serverUrl, '/api/client/enroll', {
      method: 'POST',
      body,
      schema: enrollResponseSchema
    });
    writeConfig({
      serverUrl,
      machineId: result.machineId,
      machineName: result.name,
      deviceToken: result.deviceToken,
      enrolledAt: result.serverTime
    });
    console.log(
      `Enrolled as "${result.name}" (machine #${result.machineId}) at ${serverUrl}.`
    );
    console.log(`Key fingerprint ${result.fingerprint}; private key stays in ${keyPath()}.`);
    console.log('Run `cybermind daemon` to keep this machine online.');
  } catch (error) {
    if (error instanceof ApiError) fail(error.message);
    throw error;
  }
}

async function previousEnrollmentIsAlive(serverUrl: string, token: string) {
  try {
    await request(serverUrl, '/api/client/me', { token, schema: machineSummarySchema });
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return false;
    // Server unreachable or other error: be conservative and keep the old config.
    throw error;
  }
}
