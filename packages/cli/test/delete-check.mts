// Ad-hoc: exercise deleteSession() and the status counts against the test user's data.
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { deleteSession, getPendingCountsForUser, getRemoteSessionsForUser, getSharedWithUser } from '../../../lib/sessions/queries';
const uidA = Number(process.env.UID_A); const uidB = Number(process.env.UID_B);
const before = await getRemoteSessionsForUser(uidA);
const target = before[0];
const blobFile = '.data/blobs/' + String((await import('postgres')).default(readFileSync('.env','utf8').match(/^POSTGRES_URL=(.+)$/m)![1].trim().replace(/^["']|["']$/g,''), { max: 1 })).toString().slice(0, 0);
console.log('sessions before:', before.map((s) => `#${s.id} v=${s.versionCount}`).join(', '), '| shares to B before:', (await getSharedWithUser(uidB)).length);
console.log('pending counts:', JSON.stringify([...(await getPendingCountsForUser(uidA)).entries()]));
const ok = await deleteSession(uidA, target.id);
const after = await getRemoteSessionsForUser(uidA);
console.log('deleted:', ok, '| sessions after:', after.map((s) => `#${s.id}`).join(', ') || '(none)', '| shares to B after:', (await getSharedWithUser(uidB)).length);
console.log('blob dir for the session still exists:', existsSync(`.data/blobs/traces/u${uidA}`) ? 'yes (other sessions)' : 'no');
console.log('deleting a session of another user:', await deleteSession(uidB, 999999));
process.exit(0);
