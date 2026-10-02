import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, publicKeyFingerprint } from '../src/crypto';
import {
  addRecipient,
  decryptMetadata,
  decryptTrace,
  encryptTrace,
  sha256b64url
} from '../src/envelope';
import { envelopeHeaderSchema } from '../src/sessions';

const metadata = {
  title: 'Repair the parser',
  cwd: '/work/parser',
  model: 'claude-fable-5-1',
  messageCount: 12,
  sourcePath: '/home/me/.claude/projects/x/abc.jsonl',
  startedAt: '2026-10-01T00:00:00.000Z'
};

test('round-trips content and metadata for the recipient', () => {
  const pair = generateKeyPair();
  const content = Buffer.from('{"type":"user"}\n'.repeat(5000));
  const { header, ciphertext } = encryptTrace({ content, metadata, recipients: [pair.publicKey] });

  assert.equal(envelopeHeaderSchema.safeParse(header).success, true);
  assert.equal(header.content.length, ciphertext.length);
  assert.equal(header.content.hash, sha256b64url(ciphertext));
  assert.equal(header.recipients[0].fingerprint, publicKeyFingerprint(pair.publicKey));
  assert.notEqual(ciphertext.toString('utf8'), content.toString('utf8'));

  const out = decryptTrace({ header, ciphertext, pair });
  assert.ok(out.content.equals(content));
  assert.deepEqual(out.metadata, metadata);
  assert.deepEqual(decryptMetadata(header, pair), metadata);
});

test('a key that is not a recipient cannot decrypt', () => {
  const pair = generateKeyPair();
  const stranger = generateKeyPair();
  const { header, ciphertext } = encryptTrace({ content: Buffer.from('secret'), metadata, recipients: [pair.publicKey] });
  assert.throws(() => decryptTrace({ header, ciphertext, pair: stranger }), /not encrypted for key/);
  assert.throws(() => decryptMetadata(header, stranger), /not encrypted for key/);
});

test('tampering with ciphertext or header is detected', () => {
  const pair = generateKeyPair();
  const { header, ciphertext } = encryptTrace({ content: Buffer.from('secret payload'), metadata, recipients: [pair.publicKey] });
  const flipped = Buffer.from(ciphertext);
  flipped[0] ^= 0xff;
  assert.throws(() => decryptTrace({ header, ciphertext: flipped, pair }), /hash/);
  const forgedHeader = { ...header, content: { ...header.content, hash: sha256b64url(flipped) } };
  assert.throws(() => decryptTrace({ header: forgedHeader, ciphertext: flipped, pair }));
  const badWrap = { ...header, recipients: [{ ...header.recipients[0], wrapped: header.recipients[0].wrapped.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) }] };
  assert.throws(() => decryptMetadata(badWrap, pair));
});

test('addRecipient shares the same ciphertext with a second machine', () => {
  const owner = generateKeyPair();
  const friend = generateKeyPair();
  const { header, ciphertext, contentKey } = encryptTrace({ content: Buffer.from('shared trace'), metadata, recipients: [owner.publicKey] });
  const shared = addRecipient(header, contentKey, friend.publicKey);
  assert.equal(shared.recipients.length, 2);
  assert.equal(decryptTrace({ header: shared, ciphertext, pair: friend }).content.toString(), 'shared trace');
  assert.equal(decryptTrace({ header: shared, ciphertext, pair: owner }).content.toString(), 'shared trace');
  assert.equal(addRecipient(shared, contentKey, friend.publicKey).recipients.length, 2);
});
