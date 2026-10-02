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

// Codex CLI: ~/.codex/sessions/**/rollout-...-<uuid>.jsonl, indexed by ~/.codex/session_index.jsonl

const UUID_SUFFIX = /([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;

export function codexMessages(records: JsonRecord[]) {
  const responseItems = records.flatMap((record) => {
    if (record.type !== 'response_item') return [];
    const role = record.payload?.role;
    if (!['user', 'assistant'].includes(role)) return [];
    const text = textFromContent(record.payload?.content);
    return text ? [{ role, text }] : [];
  });
  if (responseItems.length) return responseItems;
  return records.flatMap((record) => {
    if (record.type !== 'event_msg') return [];
    const eventType = record.payload?.type;
    const role = eventType === 'user_message' ? 'user' : eventType === 'agent_message' ? 'assistant' : '';
    const text = cleanText(record.payload?.message || record.payload?.last_agent_message);
    return role && text ? [{ role, text }] : [];
  });
}

function sessionIdFromFile(file: string) {
  return path.basename(file, '.jsonl').match(UUID_SUFFIX)?.[1] || '';
}

async function parseFile(entry: FileEntry): Promise<LocalSession | null> {
  const records = parseLines(await readBounded(entry.file, MAX_METADATA_BYTES));
  if (!records.length) return null;
  const meta = records.find((r) => r.type === 'session_meta')?.payload || {};
  const messages = codexMessages(records);
  const id = meta.id || sessionIdFromFile(entry.file);
  const context = records.find((r) => r.type === 'turn_context')?.payload || {};
  return makeSession('codex', id, {
    title: messages.find((m) => m.role === 'user')?.text,
    cwd: meta.cwd,
    model: context.model,
    entry
  });
}

type IndexRecord = { title: unknown; updated: number };

/** ~/.codex/session_index.jsonl: newest record per thread id, or null if unreadable. */
async function readIndex(indexFile: string): Promise<Map<string, IndexRecord> | null> {
  let records: JsonRecord[];
  try {
    records = parseLines(await readTail(indexFile));
  } catch {
    return null;
  }
  const byId = new Map<string, IndexRecord>();
  for (const record of records) {
    if (!record.id) continue;
    const updated = Date.parse(record.updated_at || '') || 0;
    const current = byId.get(record.id);
    if (!current || updated >= current.updated) {
      byId.set(record.id, { title: record.thread_name, updated });
    }
  }
  return byId;
}

export const codexAdapter: HarnessAdapter = {
  harness: 'codex',
  async discover({ home, max }) {
    const root = path.join(home, '.codex', 'sessions');
    const files = await newestFiles(root, max, (file) => sessionIdFromFile(file) !== '');
    const parsed = await Promise.all(files.map((entry) => parseFile(entry).catch(() => null)));
    const sessions = parsed.filter((s): s is LocalSession => s !== null);

    const index = await readIndex(path.join(home, '.codex', 'session_index.jsonl'));
    if (index) {
      for (const session of sessions) {
        const record = index.get(session.id);
        if (!record) continue;
        // Codex thread names are the better title when present.
        if (record.title) session.title = firstLine(record.title);
        session.updatedMs = Math.max(session.updatedMs, record.updated);
      }
    }
    return sessions;
  },
  async readTrace(session) {
    const bytes = await readFile(session.sourcePath);
    const records = parseLines(bytes.toString('utf8'));
    return { bytes, messageCount: codexMessages(records).length, startedAt: firstTimestamp(records) };
  }
};
