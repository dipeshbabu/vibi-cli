import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_METADATA_BYTES,
  cleanText,
  firstLine,
  firstTimestamp,
  makeSession,
  newestFiles,
  parseLines,
  readBounded,
  readTail,
  textFromContent,
  type FileEntry
} from './jsonl';
import type { HarnessAdapter, JsonRecord, LocalSession } from './types';

// Claude Code: ~/.claude/projects/<project>/<session>.jsonl, indexed by ~/.claude/history.jsonl

export function claudeMessages(records: JsonRecord[]) {
  return records.flatMap((record) => {
    const role = record.message?.role || record.type;
    if (!['user', 'assistant'].includes(role)) return [];
    const text = textFromContent(record.message?.content ?? record.content);
    return text ? [{ role, text }] : [];
  });
}

function sessionIdFromFile(file: string): string {
  const name = path.basename(file, '.jsonl');
  if (name.includes('.orphaned-') || file.split(path.sep).includes('subagents')) return '';
  return name;
}

async function parseFile(entry: FileEntry): Promise<LocalSession | null> {
  const records = parseLines(await readBounded(entry.file, MAX_METADATA_BYTES));
  if (!records.length) return null;
  const messages = claudeMessages(records);
  const metadata = [...records].reverse().find((r) => r.cwd) || {};
  const identity = records.find((r) => r.sessionId) || {};
  const id =
    metadata.sessionId || identity.sessionId || path.basename(entry.file, '.jsonl').split('.orphaned-')[0];
  const titleRecord = records.find((r) => r.type === 'ai-title');
  const lastPrompt = [...records].reverse().find((r) => r.type === 'last-prompt');
  const assistant = records.find((r) => r.message?.role === 'assistant');
  return makeSession('claude', id, {
    title:
      titleRecord?.aiTitle ||
      messages.find((m) => m.role === 'user')?.text ||
      lastPrompt?.lastPrompt,
    cwd: metadata.cwd,
    model: assistant?.message?.model,
    entry
  });
}

type IndexRecord = { title: unknown; cwd: unknown; updated: number };

/** ~/.claude/history.jsonl: newest record per session id, or null if unreadable. */
async function readIndex(indexFile: string): Promise<Map<string, IndexRecord> | null> {
  let records: JsonRecord[];
  try {
    records = parseLines(await readTail(indexFile));
  } catch {
    return null;
  }
  const byId = new Map<string, IndexRecord>();
  for (const record of records) {
    if (!record.sessionId) continue;
    const updated = Number(record.timestamp) || 0;
    const current = byId.get(record.sessionId);
    if (!current || updated >= current.updated) {
      byId.set(record.sessionId, { title: record.display, cwd: record.project, updated });
    }
  }
  return byId;
}

export const claudeAdapter: HarnessAdapter = {
  harness: 'claude',
  async discover({ home, max }) {
    // Transcript files are the source of truth: sessions started from the
    // VS Code extension or the SDK are not always written to history.jsonl.
    const root = path.join(home, '.claude', 'projects');
    const files = await newestFiles(root, max, (file) => sessionIdFromFile(file) !== '');
    const parsed = await Promise.all(files.map((entry) => parseFile(entry).catch(() => null)));
    const sessions = parsed.filter((s): s is LocalSession => s !== null);

    const index = await readIndex(path.join(home, '.claude', 'history.jsonl'));
    if (index) {
      for (const session of sessions) {
        const record = index.get(session.id);
        if (!record) continue;
        if (session.title === 'Untitled session' && record.title) session.title = firstLine(record.title);
        if (!session.cwd && record.cwd) session.cwd = cleanText(record.cwd);
        session.updatedMs = Math.max(session.updatedMs, record.updated);
      }
    }
    return sessions;
  },
  async readTrace(session) {
    const bytes = await readFile(session.sourcePath);
    const records = parseLines(bytes.toString('utf8'));
    return { bytes, messageCount: claudeMessages(records).length, startedAt: firstTimestamp(records) };
  }
};
