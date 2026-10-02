import { heartbeatResponseSchema } from '@cybermind/shared/api';
import { ApiError, request } from '../api';
import { requireConfig, type Config } from '../config';
import { fail, log } from '../log';
import { VERSION } from '../version';

export async function sendHeartbeat(config: Config) {
  return request(config.serverUrl, '/api/client/heartbeat', {
    method: 'POST',
    token: config.deviceToken,
    body: { clientVersion: VERSION },
    schema: heartbeatResponseSchema
  });
}

export async function heartbeatOnce() {
  const config = requireConfig();
  try {
    const result = await sendHeartbeat(config);
    log(`heartbeat ok, server time ${result.serverTime}`);
  } catch (error) {
    if (error instanceof ApiError) fail(error.message, error.status === 401 ? 2 : 1);
    throw error;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Keeps the machine "online" by sending a heartbeat every interval. */
export async function daemon(opts: { interval: string }) {
  const config = requireConfig();
  const seconds = Math.max(15, Number(opts.interval) || 60);
  log(
    `heartbeat every ${seconds}s to ${config.serverUrl} as "${config.machineName}" (#${config.machineId}); Ctrl-C to stop`
  );

  let running = true;
  const stop = () => {
    running = false;
    log('stopping');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (running) {
    try {
      const result = await sendHeartbeat(config);
      log(`ok (server ${result.serverTime})`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        fail('device token rejected; the machine was probably revoked. Generate a new code in the dashboard and run `cybermind enroll <code>`.', 2);
      }
      log(`heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(seconds * 1000);
  }
}
