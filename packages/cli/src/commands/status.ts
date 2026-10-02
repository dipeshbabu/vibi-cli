import { machineSummarySchema } from '@cybermind/shared/api';
import { ApiError, request } from '../api';
import { configPath, keyPath, readConfig, readKeyPair } from '../config';

export async function status() {
  const config = readConfig();
  const key = readKeyPair();

  console.log(`config : ${configPath()}${config ? '' : ' (not enrolled)'}`);
  console.log(`key    : ${key ? `${keyPath()} (fingerprint ${key.fingerprint}, created ${key.createdAt})` : 'none'}`);
  if (!config) return;

  console.log(`server : ${config.serverUrl}`);
  console.log(`machine: "${config.machineName}" (#${config.machineId}), enrolled ${config.enrolledAt}`);

  try {
    const remote = await request(config.serverUrl, '/api/client/me', {
      token: config.deviceToken,
      schema: machineSummarySchema
    });
    console.log(`remote : last seen ${remote.lastSeenAt ?? 'never'}, active key ${remote.activeKey?.fingerprint ?? 'none'}`);
    if (remote.activeKey && key && remote.activeKey.fingerprint !== key.fingerprint) {
      console.log('warning: the server holds a different public key than this machine. Run `cybermind rotate-key`.');
    }
  } catch (error) {
    if (error instanceof ApiError) {
      console.log(`remote : ${error.status === 401 ? 'device token rejected (revoked?)' : error.message}`);
      return;
    }
    throw error;
  }
}
