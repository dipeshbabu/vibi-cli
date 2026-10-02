// Ad-hoc verification used by the e2e script: decrypt what the server stores
// for MACHINE_NAME with the user key unlocked under VIBI_HOME and compare.
import { readFileSync } from 'node:fs';
import { decryptTrace } from '@vibivibi/shared/envelope';
import postgres from 'postgres';

const url = readFileSync('.env', 'utf8').match(/^POSTGRES_URL=(.+)$/m)![1].trim().replace(/^["']|["']$/g, '');
const sql = postgres(url, { max: 1 });
const key = JSON.parse(readFileSync(process.env.VIBI_HOME + '/keys/user.json', 'utf8'));
if (!key.privateKey) throw new Error('key is locked under ' + process.env.VIBI_HOME);
const [m] = await sql`select id from machines where name = ${process.env.MACHINE_NAME!} and revoked_at is null order by id desc limit 1`;
const rows = await sql`select s.harness, v.envelope, v.blob_url from sessions s join session_versions v on v.id = s.current_version_id where s.machine_id = ${m.id} order by s.id`;
for (const r of rows) {
  const file = '.data/blobs/' + String(r.blob_url).replace('local://', '');
  const { content, metadata } = decryptTrace({ header: r.envelope, ciphertext: readFileSync(file), pair: key });
  console.log(`${r.harness}: title="${metadata.title}" cwd=${metadata.cwd} messages=${metadata.messageCount} bytes=${content.length}`);
}
const claude = rows.find((r) => r.harness === 'claude')!;
const { content } = decryptTrace({ header: claude.envelope, ciphertext: readFileSync('.data/blobs/' + String(claude.blob_url).replace('local://', '')), pair: key });
const original = readFileSync(process.env.VIBI_SCAN_HOME + '/.claude/projects/-work-parser/claude-id.jsonl');
console.log('claude plaintext identical to the local file:', content.equals(original));
console.log('envelope JSON contains the title in clear:', JSON.stringify(claude.envelope).includes('Repair the parser'));
await sql.end();
