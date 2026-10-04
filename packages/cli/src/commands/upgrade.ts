import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fail } from '../log';
import { isStandaloneBinary } from '../runtime';
import { VERSION } from '../version';

export const INSTALL_SH_URL = 'https://vibivibi.com/install.sh';
export const INSTALL_PS1_URL = 'https://vibivibi.com/install.ps1';

/**
 * `vibi upgrade`: re-runs the installer that put this copy here, so the
 * binary is replaced in place. Copies installed through npm are left to npm.
 */
export async function upgrade() {
  console.log(`vibi ${VERSION}`);
  if (!isStandaloneBinary()) {
    console.log('This copy runs from npm or a source checkout; update it the same way, e.g. `npm install -g vibi@latest`.');
    return;
  }
  const installDir = path.dirname(process.execPath);
  const [command, args] =
    process.platform === 'win32'
      ? ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `irm ${INSTALL_PS1_URL} | iex`]]
      : ['sh', ['-c', `curl -fsSL ${INSTALL_SH_URL} | sh`]];
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, VIBI_INSTALL_DIR: installDir } });
  if (result.status !== 0) fail('the installer did not finish; see the output above.');
}
