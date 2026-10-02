import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { adapterFor, discoverLocalSessions } from '../src/harnesses';

// Fixtures mirror subconscious-cli's test/sessions.test.js record shapes.

let home: string;

before(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'vibi-harness-test-'));
  const claude = path.join(home, '.claude', 'projects', '-work-parser');
  const codex = path.join(home, '.codex', 'sessions', '2026', '10', '01');
  const pi = path.join(home, '.pi', 'agent', 'sessions');
  const sc = path.join(home, '.sc', 'sessions');
  await Promise.all([claude, codex, pi, sc].map((d) => mkdir(d, { recursive: true })));

  const jsonl = (records: unknown[]) => records.map((r) => JSON.stringify(r)).join('\n') + '\n';

  await writeFile(
    path.join(claude, 'claude-id.jsonl'),
    jsonl([
      { type: 'ai-title', aiTitle: 'Repair the parser', sessionId: 'claude-id' },
      { type: 'user', cwd: '/work/parser', sessionId: 'claude-id', timestamp: '2026-10-01T10:00:00.000Z', message: { role: 'user', content: 'Fix parser edge cases' } },
      { type: 'assistant', message: { role: 'assistant', model: 'test/model', content: [{ type: 'text', text: 'I added the failing test.' }, { type: 'tool_use', input: { secret: true } }] } }
    ])
  );
  // Started from the VS Code extension: on disk but never written to history.jsonl.
  await writeFile(
    path.join(claude, 'unindexed-id.jsonl'),
    jsonl([
      { type: 'user', cwd: '/work/parser', sessionId: 'unindexed-id', timestamp: '2026-10-01T11:00:00.000Z', message: { role: 'user', content: 'Explain the tokenizer' } },
      { type: 'assistant', message: { role: 'assistant', model: 'test/model', content: [{ type: 'text', text: 'It splits on whitespace.' }] } }
    ])
  );
  // An orphaned file and a subagent transcript must not become sessions of their own.
  await writeFile(path.join(claude, 'claude-id.orphaned-1.jsonl'), jsonl([{ type: 'user', sessionId: 'claude-id', message: { role: 'user', content: 'x' } }]));
  await mkdir(path.join(claude, 'subagents'), { recursive: true });
  await writeFile(path.join(claude, 'subagents', 'agent-1.jsonl'), jsonl([{ type: 'user', sessionId: 'agent-1', message: { role: 'user', content: 'x' } }]));
  await writeFile(
    path.join(home, '.claude', 'history.jsonl'),
    jsonl([
      { sessionId: 'claude-id', timestamp: 1759312800000, display: 'Repair the parser', project: '/work/parser' },
      { sessionId: 'missing-file', timestamp: 1759312900000, display: 'No transcript', project: '/tmp' }
    ])
  );

  await writeFile(
    path.join(codex, 'rollout-2026-10-01T10-00-00-0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.jsonl'),
    jsonl([
      { type: 'session_meta', payload: { id: '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b', cwd: '/work/codex', timestamp: '2026-10-01T10:00:00.000Z' } },
      { type: 'turn_context', payload: { model: 'test/codex' } },
      { type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: 'Review the patch' }] } },
      { type: 'response_item', payload: { role: 'assistant', content: [{ type: 'output_text', text: 'The patch is clean.' }] } }
    ])
  );
  await writeFile(
    path.join(home, '.codex', 'session_index.jsonl'),
    jsonl([{ id: '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b', updated_at: '2026-10-01T10:05:00.000Z', thread_name: 'Patch review' }])
  );

  await writeFile(
    path.join(pi, 'pi-id.jsonl'),
    jsonl([
      { type: 'session', id: 'pi-id', cwd: '/work/pi' },
      { type: 'message', message: { role: 'user', content: 'Build the UI' } },
      { type: 'message', message: { role: 'assistant', model: 'test/pi', content: [{ type: 'text', text: 'UI built.' }] } }
    ])
  );
  await writeFile(
    path.join(sc, 'session-sc-id.jsonl'),
    jsonl([
      { id: 'session-sc-id', cwd: '/work/sc', model: 'test/sc' },
      { type: 'user', content: 'Run the tests' },
      { type: 'assistant', text: 'Tests pass.', reasoning: 'hidden' }
    ])
  );
});

after(async () => {
  await rm(home, { recursive: true, force: true });
});

function fakeOpenCode(command: string, args: readonly string[]) {
  assert.equal(command, 'opencode');
  const query = String(args.at(-1));
  if (query.includes('from session where')) {
    return { status: 0, stdout: JSON.stringify([{ id: 'open-id', title: 'OpenCode migration', directory: '/work/open', time_created: 100, time_updated: 200, model: JSON.stringify({ id: 'test/open' }) }]) };
  }
  return { status: 0, stdout: JSON.stringify([{ role: 'user', text: 'Migrate the endpoint', time: 100 }, { role: 'assistant', text: 'Endpoint migrated.', time: 150 }]) };
}

const ctx = () => ({ home, max: 50, execute: fakeOpenCode as never });

test('discovers one session per harness with stable keys', async () => {
  const found = await discoverLocalSessions(ctx());
  assert.deepEqual(
    new Set(found.map((s) => s.key)),
    new Set(['claude:claude-id', 'claude:unindexed-id', 'codex:0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b', 'opencode:open-id', 'pi:pi-id', 'sc:sc-id'])
  );
  const claude = found.find((s) => s.id === 'claude-id')!;
  assert.equal(claude.title, 'Repair the parser');
  assert.equal(claude.cwd, '/work/parser');
  assert.ok(claude.sourcePath.endsWith('claude-id.jsonl'));
  assert.ok(claude.sizeBytes > 0 && claude.mtimeMs > 0);
  assert.equal(claude.model, 'test/model');
  const unindexed = found.find((s) => s.id === 'unindexed-id')!;
  assert.equal(unindexed.title, 'Explain the tokenizer');
  assert.equal(unindexed.cwd, '/work/parser');
  const codex = found.find((s) => s.harness === 'codex')!;
  assert.equal(codex.title, 'Patch review');
  assert.equal(codex.cwd, '/work/codex');
  assert.equal(codex.model, 'test/codex');
});

test('reads full traces with message counts and start times', async () => {
  const found = await discoverLocalSessions(ctx());
  for (const session of found) {
    const trace = await adapterFor(session.harness).readTrace(session, ctx());
    assert.ok(trace.bytes.length > 0, `${session.key} has bytes`);
    assert.equal(trace.messageCount, 2, `${session.key} message count`);
  }
  const claude = found.find((s) => s.id === 'claude-id')!;
  const trace = await adapterFor('claude').readTrace(claude, ctx());
  assert.equal(trace.startedAt, '2026-10-01T10:00:00.000Z');
  assert.match(trace.bytes.toString('utf8'), /tool_use/); // the upload is the raw transcript, not a text-only export
  const open = found.find((s) => s.harness === 'opencode')!;
  const openTrace = await adapterFor('opencode').readTrace(open, ctx());
  assert.deepEqual(JSON.parse(openTrace.bytes.toString('utf8')).messages.length, 2);
});

test('sessionsForDirectory keeps sessions whose cwd is the directory or inside it', async () => {
  const { sessionsForDirectory } = await import('../src/push');
  process.env.VIBI_SCAN_HOME = home;
  process.env.VIBI_HARNESSES = 'claude,codex,pi,sc';
  try {
    const parser = await sessionsForDirectory('/work/parser');
    assert.deepEqual(new Set(parser.map((s) => s.id)), new Set(['claude-id', 'unindexed-id']));
    const work = await sessionsForDirectory('/work');
    assert.equal(work.length, 5);
    assert.equal((await sessionsForDirectory('/elsewhere')).length, 0);
  } finally {
    delete process.env.VIBI_SCAN_HOME;
    delete process.env.VIBI_HARNESSES;
  }
});

test('a pulled Claude transcript counts for the directory it was installed under', async () => {
  const { sessionsForDirectory } = await import('../src/push');
  const { encodeClaudeProjectDir } = await import('../src/harnesses/install');
  const target = path.join(home, 'projects', 'resumed-here');
  const folder = path.join(home, '.claude', 'projects', encodeClaudeProjectDir(target));
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, 'pulled-id.jsonl'),
    JSON.stringify({ type: 'user', cwd: '/original/machine/path', sessionId: 'pulled-id', message: { role: 'user', content: 'from elsewhere' } }) + '\n'
  );
  process.env.VIBI_SCAN_HOME = home;
  process.env.VIBI_HARNESSES = 'claude';
  try {
    const found = await sessionsForDirectory(target);
    assert.deepEqual(found.map((s) => s.id), ['pulled-id']);
    assert.equal((await sessionsForDirectory('/original/machine/path')).map((s) => s.id).join(), 'pulled-id');
  } finally {
    delete process.env.VIBI_SCAN_HOME;
    delete process.env.VIBI_HARNESSES;
  }
});
