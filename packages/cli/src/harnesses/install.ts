import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Harness, TraceMetadata } from '@vibivibi/shared/sessions';
import { configDir } from '../config';

/**
 * Where a downloaded trace goes so the harness on this machine can resume it.
 *
 *   claude   ~/.claude/projects/<project dir, non-alphanumerics -> "-">/<id>.jsonl
 *            (`claude --resume <id>` inside that project directory)
 *   codex    ~/.codex/sessions/YYYY/MM/DD/<original file name>      (`codex resume <id>`)
 *   pi       ~/.pi/agent/sessions/<original file name>              (`pi --session <file>`)
 *   sc       ~/.sc/sessions/<original file name>                    (`marathon --resume <file>`)
 *   opencode ~/.vibi/downloads/opencode-<id>.json  (export only; OpenCode keeps sessions in SQLite)
 */

export type InstallTarget = {
  harness: Harness;
  harnessSessionId: string;
  harnessUpdatedAt: string;
  metadata: TraceMetadata;
  content: Buffer;
  home: string;
  /** For Claude Code: the project directory on this machine. */
  projectDir?: string;
  overwrite?: boolean;
};

export class InstallConflict extends Error {
  constructor(public readonly file: string) {
    super(`${file} already exists with different content; pass --overwrite to replace it`);
    this.name = 'InstallConflict';
  }
}

/** Claude Code's project directory encoding. */
export function encodeClaudeProjectDir(projectDir: string) {
  return path.resolve(projectDir).replace(/[^a-zA-Z0-9]/g, '-');
}

function originalBasename(metadata: TraceMetadata, fallback: string) {
  const base = metadata.sourcePath ? path.basename(metadata.sourcePath) : '';
  return base && base.endsWith('.jsonl') ? base : fallback;
}

export function installPathFor(t: Omit<InstallTarget, 'content' | 'overwrite'>): string {
  switch (t.harness) {
    case 'claude':
      return path.join(
        t.home,
        '.claude',
        'projects',
        encodeClaudeProjectDir(t.projectDir ?? process.cwd()),
        `${t.harnessSessionId}.jsonl`
      );
    case 'codex': {
      const when = new Date(t.harnessUpdatedAt);
      const yyyy = String(when.getUTCFullYear());
      const mm = String(when.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(when.getUTCDate()).padStart(2, '0');
      const stamp = when.toISOString().slice(0, 19).replace(/:/g, '-');
      return path.join(
        t.home,
        '.codex',
        'sessions',
        yyyy,
        mm,
        dd,
        originalBasename(t.metadata, `rollout-${stamp}-${t.harnessSessionId}.jsonl`)
      );
    }
    case 'pi':
      return path.join(t.home, '.pi', 'agent', 'sessions', originalBasename(t.metadata, `${t.harnessSessionId}.jsonl`));
    case 'sc':
      return path.join(t.home, '.sc', 'sessions', originalBasename(t.metadata, `session-${t.harnessSessionId}.jsonl`));
    case 'opencode':
      return path.join(configDir(), 'downloads', `opencode-${t.harnessSessionId}.json`);
  }
}

/** Writes the plaintext trace where the harness expects it; returns the path. */
export function installTrace(t: InstallTarget): { file: string; existed: boolean } {
  const file = installPathFor(t);
  const existed = existsSync(file);
  if (existed && !t.overwrite) {
    const current = readFileSync(file);
    if (current.equals(t.content)) return { file, existed };
    throw new InstallConflict(file);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, t.content, { mode: 0o600 });
  return { file, existed };
}
