import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import type { Harness } from '@vibivibi/shared/sessions';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { opencodeAdapter } from './opencode';
import { piAdapter } from './pi';
import { scAdapter } from './sc';
import type { DiscoverContext, HarnessAdapter, LocalSession } from './types';

export const adapters: HarnessAdapter[] = [
  claudeAdapter,
  codexAdapter,
  opencodeAdapter,
  piAdapter,
  scAdapter
];

/** VIBI_HARNESSES=claude,codex limits scanning to those harnesses. */
export function enabledAdapters(): HarnessAdapter[] {
  const only = process.env.VIBI_HARNESSES?.split(',').map((h) => h.trim()).filter(Boolean);
  return only?.length ? adapters.filter((a) => only.includes(a.harness)) : adapters;
}

export function adapterFor(harness: Harness): HarnessAdapter {
  const adapter = adapters.find((a) => a.harness === harness);
  if (!adapter) throw new Error(`Unsupported harness: ${harness}`);
  return adapter;
}

export function scanHome(): string {
  return process.env.VIBI_SCAN_HOME ?? homedir();
}

export function discoverContext(max: number): DiscoverContext {
  return { home: scanHome(), max, execute: spawnSync };
}

/** Every local session across harnesses, newest first, de-duplicated by key. */
export async function discoverLocalSessions(ctx: DiscoverContext): Promise<LocalSession[]> {
  const groups = await Promise.all(
    enabledAdapters().map((adapter) =>
      adapter.discover(ctx).catch((error: unknown) => {
        if (process.env.VIBI_DEBUG) console.error(`[${adapter.harness}]`, error);
        return [] as LocalSession[];
      })
    )
  );
  const seen = new Set<string>();
  return groups
    .flat()
    .filter((session) => {
      if (seen.has(session.key)) return false;
      seen.add(session.key);
      return true;
    })
    .sort((a, b) => b.updatedMs - a.updatedMs)
    .slice(0, ctx.max);
}

export type { DiscoverContext, HarnessAdapter, LocalSession, TraceContent } from './types';
