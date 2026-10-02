import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_METADATA_BYTES,
  cleanText,
  firstTimestamp,
  makeSession,
  newestFiles,
  parseLines,
  readBounded,
  type FileEntry
} from './jsonl';
import type { HarnessAdapter, JsonRecord, LocalSession } from './types';

// Marathon / Subconscious Code: ~/.sc/sessions/session-<id>.jsonl, first record is metadata

export function scMessages(records: JsonRecord[]) {
  return records.flatMap((record) => {
    if (!['user', 'assistant'].includes(record.type)) return [];
    const text = cleanText(record.text ?? record.content);
    return text ? [{ role: record.type, text }] : [];
  });
}

async function parseFile(entry: FileEntry): Promise<LocalSession | null> {
  const records = parseLines(await readBounded(entry.file, MAX_METADATA_BYTES));
  if (!records.length) return null;
  const meta = records[0] || {};
  const messages = scMessages(records);
  const id = String(meta.id || path.basename(entry.file, '.jsonl')).replace(/^session-/, '');
  return makeSession('sc', id, {
    title: messages.find((m) => m.role === 'user')?.text,
    cwd: meta.cwd,
    model: meta.model,
    entry
  });
}

export const scAdapter: HarnessAdapter = {
  harness: 'sc',
  async discover({ home, max }) {
    const files = await newestFiles(path.join(home, '.sc', 'sessions'), max);
    const sessions = await Promise.all(files.map((entry) => parseFile(entry).catch(() => null)));
    return sessions.filter((s): s is LocalSession => s !== null);
  },
  async readTrace(session) {
    const bytes = await readFile(session.sourcePath);
    const records = parseLines(bytes.toString('utf8'));
    return { bytes, messageCount: scMessages(records).length, startedAt: firstTimestamp(records) };
  }
};
