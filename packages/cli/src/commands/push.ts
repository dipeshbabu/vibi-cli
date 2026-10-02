import { harnessName } from '@vibivibi/shared/sessions';
import { ApiError } from '../api';
import { requireConfig } from '../config';
import { discoverContext, discoverLocalSessions, type LocalSession } from '../harnesses';
import { fail } from '../log';
import { ensurePublicKey, sendSession, sessionStatus, sessionsForDirectory, syncSession } from '../push';
import { readState } from '../state';
import { runTui, type TuiSession } from '../tui';
import { VERSION } from '../version';
import { lineReporter } from '../progress';

function toTuiSessions(sessions: LocalSession[]): TuiSession[] {
  const state = readState();
  return sessions.map((s) => ({
    key: s.key,
    harness: s.harness,
    harnessName: harnessName(s.harness),
    title: s.title,
    cwd: s.cwd,
    updatedAt: new Date(s.updatedMs).toISOString(),
    model: s.model,
    status: sessionStatus(s, state),
    label: state.sessions[s.key]?.label ?? '',
    sizeBytes: s.sizeBytes
  }));
}

function findSession(sessions: LocalSession[], ref: string) {
  const index = Number(ref);
  if (Number.isInteger(index) && index >= 1 && index <= sessions.length) return sessions[index - 1];
  return sessions.find((s) => s.key === ref || s.id === ref || s.id.startsWith(ref)) ?? null;
}

/**
 * `vibi push`                                  interactive: pick a session, Sync or Send
 * `vibi push --list`                            print the sessions under this directory
 * `vibi push --session <key|n> --sync [--name]` non-interactive sync
 * `vibi push --session <key|n> --send <email>`  non-interactive send
 */
export async function push(opts: { session?: string; sync?: boolean; send?: string; name?: string; list?: boolean; json?: boolean; all?: boolean; force?: boolean; max: string }) {
  const config = requireConfig();
  const dir = process.cwd();
  const max = Math.max(1, Number(opts.max) || 500);
  try {
    const key = await ensurePublicKey(config);
    const sessions = opts.all ? await discoverLocalSessions(discoverContext(max)) : await sessionsForDirectory(dir, max);

    if (opts.list || opts.json) {
      const rows = toTuiSessions(sessions);
      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      console.log(`${opts.all ? 'All sessions' : `Sessions under ${dir}`}: ${rows.length}\n`);
      rows.forEach((r, i) => {
        console.log(`${String(i + 1).padStart(3)}. ${r.label ? `[${r.label}] ` : ''}${r.title}`);
        console.log(`     ${r.key} · ${r.harnessName} · ${new Date(r.updatedAt).toLocaleString()} · ${r.status}${r.cwd !== dir ? ` · ${r.cwd}` : ''}`);
      });
      return;
    }

    if (opts.session) {
      const session = findSession(sessions, opts.session);
      if (!session) fail(`no session "${opts.session}" under ${dir}; see \`vibi push --list\`.`);
      const label = opts.name !== undefined ? opts.name : undefined;
      const progress = lineReporter();
      if (opts.send) {
        const r = await sendSession(config, key, session, label, opts.send, { onProgress: progress }).finally(() => progress.finish());
        console.log(
          r.reusedVersion
            ? `Sent #${r.pullId} v${r.seq ?? '?'} to ${r.recipient}; the stored copy was re-keyed, nothing re-uploaded.`
            : `Sent #${r.pullId} to ${r.recipient} as new version v${r.seq ?? '?'}.`
        );
      } else {
        const r = await syncSession(config, key, session, label, { force: opts.force, onProgress: progress }).finally(() => progress.finish());
        console.log(r.uploaded ? `Synced #${r.pullId} as version v${r.seq ?? '?'}.` : `#${r.pullId} is already up to date (version v${r.seq ?? '?'}).`);
      }
      return;
    }

    // VIBI_TUI_BIN substitutes the picker binary (tests), so no terminal is needed then.
    if (!process.env.VIBI_TUI_BIN && (!process.stdout.isTTY || !process.stdin.isTTY)) {
      fail('interactive mode needs a terminal; use --list, or --session <key> with --sync or --send <email>.');
    }
    let current = sessions;
    await runTui({
      state: {
        version: VERSION,
        mode: 'push',
        cwd: dir,
        serverUrl: config.serverUrl,
        machineName: config.machineName,
        keyUnlocked: Boolean(key.privateKey),
        sessionsLoading: false,
        sessions: toTuiSessions(current),
        contacts: [],
        remote: []
      },
      onRequest: async (request, report) => {
        const session = current.find((s) => s.key === request.key);
        if (!session) throw new Error('That session is no longer in the list.');
        const label = request.name ? request.name : undefined;
        let message: string;
        if (request.action === 'send') {
          const r = await sendSession(config, key, session, label, request.email, { onProgress: report });
          message = r.reusedVersion
            ? `Sent #${r.pullId} v${r.seq ?? '?'} to ${r.recipient} (re-keyed, nothing re-uploaded)`
            : `Sent #${r.pullId} to ${r.recipient} as new version v${r.seq ?? '?'}`;
        } else {
          const r = await syncSession(config, key, session, label, { force: opts.force, onProgress: report });
          message = r.uploaded ? `Synced #${r.pullId} as version v${r.seq ?? '?'}` : `#${r.pullId} already up to date (version v${r.seq ?? '?'})`;
        }
        current = opts.all ? await discoverLocalSessions(discoverContext(max)) : await sessionsForDirectory(dir, max);
        return { message, sessions: toTuiSessions(current) };
      }
    });
  } catch (error) {
    if (error instanceof ApiError) fail(error.message, error.status === 401 ? 2 : 1);
    throw error;
  }
}
