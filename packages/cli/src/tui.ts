import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Progress, ProgressReporter } from './progress';

/**
 * Launcher for the Go TUI (tui/cmd/vibi-tui), ported from subconscious-cli.
 *
 * Node and the TUI talk through files in a private temp directory:
 *   state.json    written once by Node before launch (display data only)
 *   updates.json  rewritten by Node whenever something changes; the TUI
 *                 polls it (cumulative patch: sessions, request results)
 *   request.json  written by the TUI when the user picks an action; Node
 *                 polls it, performs the upload, and answers via updates.json
 * Credentials never enter the TUI process.
 */

const CLI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TUI_SOURCE_DIR = path.join(CLI_DIR, 'tui');
const NATIVE_DIR = path.join(CLI_DIR, 'bin', 'native');

export type TuiSession = {
  key: string;
  harness: string;
  harnessName: string;
  title: string;
  cwd: string;
  updatedAt: string;
  model: string;
  status: 'new' | 'synced' | 'changed';
  label: string;
  sizeBytes: number;
};

export type TuiRemoteVersion = { id: number; label: string; latest: boolean };

export type TuiRemote = {
  /** "#20" or "s5": what `vibi pull <id>` takes. */
  id: string;
  title: string;
  label: string;
  meta: string;
  updatedAt: string;
  installed: boolean;
  versions: TuiRemoteVersion[];
};

export type TuiState = {
  version: string;
  mode: 'push' | 'pull';
  cwd: string;
  serverUrl: string;
  machineName: string;
  keyUnlocked: boolean;
  sessionsLoading: boolean;
  sessions: TuiSession[];
  contacts: string[];
  remote: TuiRemote[];
};

export type TuiRequest = {
  id: string;
  /** invite: the follow-up the TUI sends after the user confirms an "ask" result. */
  action: 'sync' | 'send' | 'pull' | 'invite';
  /** push: the local session key; pull: the remote id ("#20" / "s5"). */
  key: string;
  name: string;
  email: string;
  versionId?: number;
};

/**
 * A yes/no question the TUI shows instead of a result. On yes it dispatches a
 * new request with `action` and the same key/name/email as the original one.
 */
export type TuiAsk = { action: 'invite'; title: string; yes: string; no: string };

export type TuiRequestResult = {
  status: 'running' | 'done' | 'error' | 'ask';
  message: string;
  progress?: Progress;
  ask?: TuiAsk;
};

type TuiPatch = {
  sessions?: TuiSession[];
  sessionsLoading?: boolean;
  contacts?: string[];
  remote?: TuiRemote[];
  requests?: Record<string, TuiRequestResult>;
};

export function nativeTargetName(platform = process.platform, arch = process.arch) {
  const goArch = { x64: 'amd64', arm64: 'arm64' }[arch as 'x64' | 'arm64'];
  if (!goArch || !['darwin', 'linux', 'win32'].includes(platform)) return null;
  const goOS = platform === 'win32' ? 'windows' : platform;
  return `vibi-tui-${goOS}-${goArch}${platform === 'win32' ? '.exe' : ''}`;
}

export async function resolveTuiExecutable(): Promise<{ command: string; args: string[]; cwd?: string } | null> {
  const override = process.env.VIBI_TUI_BIN?.trim();
  if (override) return { command: override, args: [] };
  const target = nativeTargetName();
  if (target) {
    const packaged = path.join(NATIVE_DIR, target);
    if (existsSync(packaged)) return { command: packaged, args: [] };
  }
  // Source checkouts run the TUI straight from Go.
  if (existsSync(path.join(TUI_SOURCE_DIR, 'go.mod'))) {
    return { command: 'go', args: ['run', './cmd/vibi-tui'], cwd: TUI_SOURCE_DIR };
  }
  return null;
}

export async function writeAtomicJson(file: string, value: unknown) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(tmp, file);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type RunTuiOptions = {
  state: TuiState;
  /** Performs the action, reporting progress; the returned message is shown in the TUI. */
  onRequest: (
    request: TuiRequest,
    report: ProgressReporter
  ) => Promise<{ message: string; sessions?: TuiSession[]; remote?: TuiRemote[]; ask?: TuiAsk }>;
};

/** Runs the TUI until the user quits; resolves afterwards. */
export async function runTui(options: RunTuiOptions): Promise<void> {
  const executable = await resolveTuiExecutable();
  if (!executable) {
    throw new Error('The vibi TUI binary is missing and Go is not available to run it from source.');
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vibi-tui-'));
  const statePath = path.join(dir, 'state.json');
  const updatesPath = path.join(dir, 'updates.json');
  const requestPath = path.join(dir, 'request.json');
  const patch: TuiPatch = { requests: {} };
  let lastRequestId = '';
  let busy: Promise<void> = Promise.resolve();

  const writePatch = async (partial: TuiPatch) => {
    if (partial.requests) patch.requests = { ...patch.requests, ...partial.requests };
    if (partial.sessions) patch.sessions = partial.sessions;
    if (partial.sessionsLoading !== undefined) patch.sessionsLoading = partial.sessionsLoading;
    if (partial.contacts) patch.contacts = partial.contacts;
    if (partial.remote) patch.remote = partial.remote;
    try {
      await writeAtomicJson(updatesPath, patch);
    } catch {
      // The TUI may already have exited and the directory be gone.
    }
  };

  const handle = (request: TuiRequest) => {
    busy = busy.then(async () => {
      // Progress patches are queued so they never overtake the final result.
      let queue: Promise<void> = Promise.resolve();
      const enqueue = (partial: TuiPatch) => {
        queue = queue.then(() => writePatch(partial)).catch(() => {});
        return queue;
      };
      let lastKey = '';
      let lastAt = 0;
      const report: ProgressReporter = (progress) => {
        const percent = progress.total ? Math.floor(((progress.loaded ?? 0) / progress.total) * 100) : -1;
        const key = `${progress.phase}:${percent}`;
        const now = Date.now();
        if (key === lastKey || (now - lastAt < 80 && progress.phase === 'uploading' && percent < 100)) return;
        lastKey = key;
        lastAt = now;
        void enqueue({ requests: { [request.id]: { status: 'running', message: '', progress } } });
      };
      await enqueue({ requests: { [request.id]: { status: 'running', message: '' } } });
      try {
        const result = await options.onRequest(request, report);
        await enqueue({
          requests: {
            [request.id]: result.ask
              ? { status: 'ask', message: result.message, ask: result.ask }
              : { status: 'done', message: result.message }
          },
          ...(result.sessions ? { sessions: result.sessions } : {}),
          ...(result.remote ? { remote: result.remote } : {})
        });
      } catch (error) {
        await enqueue({
          requests: { [request.id]: { status: 'error', message: error instanceof Error ? error.message : String(error) } }
        });
      }
    });
  };

  await writeFile(statePath, `${JSON.stringify(options.state)}\n`, { mode: 0o600 });

  const child = spawn(executable.command, [...executable.args, '--state', statePath, '--updates', updatesPath, '--request', requestPath], {
    cwd: executable.cwd,
    env: process.env,
    stdio: 'inherit'
  });
  const exited = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => (signal ? reject(new Error(`TUI exited with signal ${signal}`)) : resolve(code ?? 1)));
  });

  let running = true;
  exited.then(() => (running = false), () => (running = false));
  let lastMtime = 0;
  const poll = (async () => {
    while (running) {
      try {
        const info = await stat(requestPath);
        if (info.mtimeMs !== lastMtime) {
          lastMtime = info.mtimeMs;
          const request = JSON.parse(await readFile(requestPath, 'utf8')) as TuiRequest;
          if (request.id && request.id !== lastRequestId) {
            lastRequestId = request.id;
            handle(request);
          }
        }
      } catch {
        // no request yet
      }
      await sleep(100);
    }
  })();

  try {
    const code = await exited;
    await poll;
    await busy;
    if (code !== 0) throw new Error(`vibi TUI exited with status ${code}`);
  } finally {
    running = false;
    await rm(dir, { recursive: true, force: true });
  }
}
