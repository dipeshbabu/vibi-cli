import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair } from '../src/crypto';
import { decryptTrace, encryptTrace } from '../src/envelope';
import { WrongPasswordError, unwrapPrivateKey, wrapPrivateKey } from '../src/userkey';

const fast = { N: 1 << 14, r: 8, p: 1 }; // keep the test quick; production uses larger N

test('wraps and unwraps the private key with the password', () => {
  const pair = generateKeyPair();
  const wrapped = wrapPrivateKey(pair, 'correct horse battery staple', fast);
  assert.notEqual(wrapped.ciphertext, pair.privateKey);
  const back = unwrapPrivateKey(wrapped, pair.publicKey, 'correct horse battery staple');
  assert.equal(back.privateKey, pair.privateKey);
  assert.equal(back.publicKey, pair.publicKey);
});

test('a wrong password, a wrong public key or tampering is rejected', () => {
  const pair = generateKeyPair();
  const other = generateKeyPair();
  const wrapped = wrapPrivateKey(pair, 'correct horse battery staple', fast);
  assert.throws(() => unwrapPrivateKey(wrapped, pair.publicKey, 'wrong password'), WrongPasswordError);
  assert.throws(() => unwrapPrivateKey(wrapped, other.publicKey, 'correct horse battery staple'), WrongPasswordError);
  const tampered = { ...wrapped, ciphertext: wrapped.ciphertext.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) };
  assert.throws(() => unwrapPrivateKey(tampered, pair.publicKey, 'correct horse battery staple'), WrongPasswordError);
});

test('unicode passwords are NFKC-normalised and a fresh wrap differs each time', () => {
  const pair = generateKeyPair();
  const composed = 'caf\u00e9 pass phrase 12';
  const decomposed = 'cafe\u0301 pass phrase 12';
  const wrapped = wrapPrivateKey(pair, composed, fast);
  assert.equal(unwrapPrivateKey(wrapped, pair.publicKey, decomposed).privateKey, pair.privateKey);
  assert.notEqual(wrapPrivateKey(pair, composed, fast).ciphertext, wrapped.ciphertext);
});

test('an unlocked key decrypts traces encrypted for the user', () => {
  const pair = generateKeyPair();
  const wrapped = wrapPrivateKey(pair, 'correct horse battery staple', fast);
  const { header, ciphertext } = encryptTrace({
    content: Buffer.from('trace'),
    metadata: { title: 't', cwd: '', model: '', messageCount: 1, sourcePath: '', startedAt: null },
    recipients: [pair.publicKey]
  });
  const unlocked = unwrapPrivateKey(wrapped, pair.publicKey, 'correct horse battery staple');
  assert.equal(decryptTrace({ header, ciphertext, pair: unlocked }).content.toString(), 'trace');
});
