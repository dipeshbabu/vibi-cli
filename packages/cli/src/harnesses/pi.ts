import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_METADATA_BYTES,
  firstTimestamp,
  makeSession,
  newestFiles,
  parseLines,
  readBounded,
  textFromContent,
  type FileEntry
} from './jsonl';
import type { HarnessAdapter, JsonRecord, LocalSession } from './types';

// Pi: ~/.pi/agent/sessions/*.jsonl

export function piMessages(records: JsonRecord[]) {
  return records.flatMap((record) => {
    if (record.type !== 'message') return [];
    const role = record.message?.role;
    if (!['user', 'assistant'].includes(role)) return [];
    const text = textFromContent(record.message?.content);
    return text ? [{ role, text }] : [];
  });
}

async function parseFile(entry: FileEntry): Promise<LocalSession | null> {
  const records = parseLines(await readBounded(entry.file, MAX_METADATA_BYTES));
  if (!records.length) return null;
  const meta = records.find((r) => r.type === 'session') || {};
  const messages = piMessages(records);
  const assistant = records.find((r) => r.message?.role === 'assistant');
  const id = meta.id || path.basename(entry.file, '.jsonl').split('_').at(-1) || '';
  return makeSession('pi', id, {
    title: messages.find((m) => m.role === 'user')?.text,
    cwd: meta.cwd,
    model: assistant?.message?.model,
    entry
  });
}

export const piAdapter: HarnessAdapter = {
  harness: 'pi',
  async discover({ home, max }) {
    const files = await newestFiles(path.join(home, '.pi', 'agent', 'sessions'), max);
    const sessions = await Promise.all(files.map((entry) => parseFile(entry).catch(() => null)));
    return sessions.filter((s): s is LocalSession => s !== null);
  },
  async readTrace(session) {
    const bytes = await readFile(session.sourcePath);
    const records = parseLines(bytes.toString('utf8'));
    return { bytes, messageCount: piMessages(records).length, startedAt: firstTimestamp(records) };
  }
};
