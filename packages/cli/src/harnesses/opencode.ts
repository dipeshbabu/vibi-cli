import { cleanText, makeSession } from './jsonl';
import type { DiscoverContext, HarnessAdapter, LocalSession } from './types';

// OpenCode keeps sessions in SQLite; `opencode db --format json "<sql>"` reads them.
// The uploaded trace is a JSON export {session, messages}, not the database.

function run(execute: DiscoverContext['execute'], query: string): string {
  const result = execute('opencode', ['db', '--format', 'json', query], {
    encoding: 'utf8',
    timeout: 5_000,
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

function parseModel(value: unknown): string {
  try {
    return JSON.parse(String(value || '{}')).id || '';
  } catch {
    return '';
  }
}

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

type OpenCodeRow = {
  id: string;
  title?: string;
  directory?: string;
  time_created?: number;
  time_updated?: number;
  model?: string;
};

function listSessions(execute: DiscoverContext['execute'], max: number): OpenCodeRow[] {
  const query = [
    'select id, title, directory, time_created, time_updated, model',
    'from session where time_archived is null',
    `order by time_updated desc limit ${Math.max(1, Math.min(500, max))}`
  ].join(' ');
  const output = run(execute, query);
  if (!output) return [];
  try {
    return JSON.parse(output) as OpenCodeRow[];
  } catch {
    return [];
  }
}

function sessionMessages(execute: DiscoverContext['execute'], id: string) {
  const query = [
    "select json_extract(message.data, '$.role') as role,",
    "json_extract(part.data, '$.text') as text,",
    'message.time_created as time',
    'from message join part on part.message_id = message.id',
    `where message.session_id = ${sqlString(id)}`,
    "and json_extract(part.data, '$.type') = 'text'",
    'order by message.time_created asc, part.time_created asc'
  ].join(' ');
  const output = run(execute, query);
  if (!output) return [];
  try {
    return (JSON.parse(output) as { role: string; text: string; time?: number }[]).filter(
      (row) => ['user', 'assistant'].includes(row.role) && cleanText(row.text)
    );
  } catch {
    return [];
  }
}

export const opencodeAdapter: HarnessAdapter = {
  harness: 'opencode',
  async discover({ execute, max }) {
    return listSessions(execute, max)
      .map((row) => {
        const updatedMs = Number(row.time_updated || row.time_created || 0);
        const session = makeSession('opencode', row.id, {
          title: row.title,
          cwd: row.directory,
          model: parseModel(row.model),
          updatedMs
        });
        return session;
      })
      .filter((s): s is LocalSession => s !== null);
  },
  async readTrace(session, { execute }) {
    const [row] = listSessions(execute, 500).filter((r) => r.id === session.id);
    const messages = sessionMessages(execute, session.id);
    const bytes = Buffer.from(
      JSON.stringify({ harness: 'opencode', session: row ?? { id: session.id }, messages }, null, 0),
      'utf8'
    );
    const first = messages.find((m) => typeof m.time === 'number');
    return {
      bytes,
      messageCount: messages.length,
      startedAt: first?.time ? new Date(first.time).toISOString() : null
    };
  }
};
