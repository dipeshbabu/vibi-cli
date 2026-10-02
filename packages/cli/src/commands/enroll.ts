import { enrollResponseSchema, machineSummarySchema, type EnrollRequest } from '@vibivibi/shared/api';
import { ApiError, request } from '../api';
import { DEFAULT_SERVER_URL, readConfig, writeConfig } from '../config';
import { fail } from '../log';
import { describeThisMachine } from '../machine';
import { ensureUserKey } from '../userkey';

export async function enroll(
  code: string,
  opts: { server?: string; name?: string; force?: boolean; unlock?: boolean; remember?: boolean }
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
          'Run `vibi status`, or pass --force to enroll again as a new machine.'
      );
    }
    console.log(
      `Previous enrollment "${existing.machineName}" (#${existing.machineId}) is no longer valid (revoked?); enrolling again.`
    );
  }

  const body: EnrollRequest = { ...describeThisMachine(opts.name), code };

  try {
    const result = await request(serverUrl, '/api/client/enroll', {
      method: 'POST',
      body,
      schema: enrollResponseSchema
    });
    const config = {
      serverUrl,
      machineId: result.machineId,
      machineName: result.name,
      deviceToken: result.deviceToken,
      enrolledAt: result.serverTime
    };
    writeConfig(config);
    console.log(`Enrolled as "${result.name}" (machine #${result.machineId}) at ${serverUrl}.`);

    await ensureUserKey(config, { unlock: opts.unlock !== false, remember: opts.remember });
    console.log('Run `vibi sync` to upload this machine\'s sessions (or `vibi daemon` to keep syncing), and `vibi pull` to fetch sessions from your other machines.');
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
