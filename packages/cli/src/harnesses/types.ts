import type { spawnSync } from 'node:child_process';
import type { Harness } from '@vibivibi/shared/sessions';

/** A coding-agent session found on this machine. */
export type LocalSession = {
  /** `${harness}:${id}`, stable across runs. */
  key: string;
  harness: Harness;
  id: string;
  title: string;
  cwd: string;
  model: string;
  /** Best known "last activity" time (ms). */
  updatedMs: number;
  /** Source file mtime and size, used to detect changes cheaply. 0 for non-file harnesses. */
  mtimeMs: number;
  sizeBytes: number;
  /** '' when the harness does not keep a plain file (OpenCode). */
  sourcePath: string;
};

export type TraceContent = {
  bytes: Buffer;
  messageCount: number;
  startedAt: string | null;
};

export type DiscoverContext = {
  /** Home directory to scan; VIBI_SCAN_HOME overrides os.homedir() in tests. */
  home: string;
  max: number;
  execute: typeof spawnSync;
};

export interface HarnessAdapter {
  harness: Harness;
  discover(ctx: DiscoverContext): Promise<LocalSession[]>;
  /** Reads the full trace for upload. */
  readTrace(session: LocalSession, ctx: DiscoverContext): Promise<TraceContent>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonRecord = any;
