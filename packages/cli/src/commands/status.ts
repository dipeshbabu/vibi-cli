import { machineSummarySchema } from '@vibivibi/shared/api';
import { ApiError, request } from '../api';
import { configPath, readConfig, readUserKey, userKeyPath } from '../config';

export async function status() {
  const config = readConfig();
  const key = readUserKey();

  console.log(`config : ${configPath()}${config ? '' : ' (not enrolled)'}`);
  if (key) {
    console.log(
      `key    : ${userKeyPath()} (fingerprint ${key.fingerprint}, ${key.privateKey ? `private key kept on this machine since ${key.unlockedAt}` : 'public key only; the password is asked when needed'})`
    );
  } else {
    console.log('key    : none on this machine');
  }
  if (!config) return;

  console.log(`server : ${config.serverUrl}`);
  console.log(`machine: "${config.machineName}" (#${config.machineId}), enrolled ${config.enrolledAt}`);

  try {
    const remote = await request(config.serverUrl, '/api/client/me', {
      token: config.deviceToken,
      schema: machineSummarySchema
    });
    console.log(`remote : last activity ${remote.lastSeenAt ?? 'never'}`);
  } catch (error) {
    if (error instanceof ApiError) {
      console.log(`remote : ${error.status === 401 ? 'device token rejected (revoked?)' : error.message}`);
      return;
    }
    throw error;
  }
}
