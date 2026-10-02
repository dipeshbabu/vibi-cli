import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes
} from 'node:crypto';
import { isValidPublicKey, publicKeyFingerprint } from './crypto';
import {
  ENVELOPE_ALGORITHM,
  envelopeHeaderSchema,
  traceMetadataSchema,
  type EnvelopeHeader,
  type EnvelopeRecipient,
  type TraceMetadata
} from './sessions';

/**
 * Hybrid encryption for a trace ("age"-style):
 *
 *   contentKey      = random 32 bytes, one per trace version
 *   ciphertext      = AES-256-GCM(contentKey, nonce, trace bytes)
 *   meta.ciphertext = AES-256-GCM(contentKey, metaNonce, JSON metadata)
 *   for each recipient public key R:
 *     (epk, esk) = ephemeral X25519 pair
 *     kek        = HKDF-SHA256(ECDH(esk, R), salt = epk || R, info = "vibi/v1/wrap")
 *     wrapped    = AES-256-GCM(kek, nonce, contentKey, aad = "vibi/v1/wrap:" + fingerprint(R))
 *
 * Sharing a trace with another machine later means wrapping the same
 * contentKey for its public key (see addRecipient); the ciphertext is reused.
 * Everything here runs on machines; the server only validates the header's
 * shape with envelopeHeaderSchema.
 */

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const AAD_CONTENT = Buffer.from('vibi/v1/content');
const AAD_META = Buffer.from('vibi/v1/meta');
const HKDF_INFO = Buffer.from('vibi/v1/wrap');

export type KeyPairLike = { publicKey: string; privateKey: string };

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const unb64 = (text: string) => Buffer.from(text, 'base64url');

export function sha256b64url(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64url');
}

function publicKeyObject(publicKey: string) {
  if (!isValidPublicKey(publicKey)) {
    throw new Error('Invalid X25519 public key');
  }
  return createPublicKey({
    key: { kty: 'OKP', crv: 'X25519', x: publicKey },
    format: 'jwk'
  });
}

function privateKeyObject(pair: KeyPairLike) {
  return createPrivateKey({
    key: { kty: 'OKP', crv: 'X25519', x: pair.publicKey, d: pair.privateKey },
    format: 'jwk'
  });
}

function aeadEncrypt(key: Buffer, nonce: Buffer, plaintext: Uint8Array, aad: Buffer) {
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([body, cipher.getAuthTag()]);
}

function aeadDecrypt(key: Buffer, nonce: Buffer, data: Uint8Array, aad: Buffer) {
  if (data.length < TAG_BYTES) {
    throw new Error('Ciphertext too short');
  }
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(buffer.subarray(buffer.length - TAG_BYTES));
  return Buffer.concat([
    decipher.update(buffer.subarray(0, buffer.length - TAG_BYTES)),
    decipher.final()
  ]);
}

function deriveWrapKey(sharedSecret: Buffer, epk: Buffer, recipient: Buffer) {
  return Buffer.from(
    hkdfSync('sha256', sharedSecret, Buffer.concat([epk, recipient]), HKDF_INFO, KEY_BYTES)
  );
}

export function wrapContentKey(contentKey: Buffer, recipientPublicKey: string): EnvelopeRecipient {
  const recipient = publicKeyObject(recipientPublicKey);
  const ephemeral = generateKeyPairSync('x25519');
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const epk = unb64((ephemeral.publicKey.export({ format: 'jwk' }) as { x: string }).x);
  const kek = deriveWrapKey(shared, epk, unb64(recipientPublicKey));
  const fingerprint = publicKeyFingerprint(recipientPublicKey);
  const nonce = randomBytes(NONCE_BYTES);
  const wrapped = aeadEncrypt(kek, nonce, contentKey, Buffer.from(`vibi/v1/wrap:${fingerprint}`));
  return { fingerprint, epk: b64(epk), nonce: b64(nonce), wrapped: b64(wrapped) };
}

export function unwrapContentKey(recipient: EnvelopeRecipient, pair: KeyPairLike): Buffer {
  const shared = diffieHellman({
    privateKey: privateKeyObject(pair),
    publicKey: publicKeyObject(recipient.epk)
  });
  const kek = deriveWrapKey(shared, unb64(recipient.epk), unb64(pair.publicKey));
  return aeadDecrypt(
    kek,
    unb64(recipient.nonce),
    unb64(recipient.wrapped),
    Buffer.from(`vibi/v1/wrap:${recipient.fingerprint}`)
  );
}

export function findRecipient(header: EnvelopeHeader, fingerprint: string) {
  return header.recipients.find((r) => r.fingerprint === fingerprint) ?? null;
}

export function encryptTrace(input: {
  content: Uint8Array;
  metadata: TraceMetadata;
  /** Public keys (base64url) of every machine that may decrypt this trace. */
  recipients: string[];
}): { header: EnvelopeHeader; ciphertext: Buffer; contentKey: Buffer } {
  if (input.recipients.length === 0) {
    throw new Error('At least one recipient public key is required');
  }
  const contentKey = randomBytes(KEY_BYTES);
  const contentNonce = randomBytes(NONCE_BYTES);
  const ciphertext = aeadEncrypt(contentKey, contentNonce, input.content, AAD_CONTENT);
  const metaNonce = randomBytes(NONCE_BYTES);
  const metaCiphertext = aeadEncrypt(
    contentKey,
    metaNonce,
    Buffer.from(JSON.stringify(traceMetadataSchema.parse(input.metadata)), 'utf8'),
    AAD_META
  );
  const header: EnvelopeHeader = {
    v: 1,
    alg: ENVELOPE_ALGORITHM,
    content: { nonce: b64(contentNonce), length: ciphertext.length, hash: sha256b64url(ciphertext) },
    meta: { nonce: b64(metaNonce), ciphertext: b64(metaCiphertext) },
    recipients: input.recipients.map((publicKey) => wrapContentKey(contentKey, publicKey))
  };
  return { header: envelopeHeaderSchema.parse(header), ciphertext, contentKey };
}

/** Recovers the content key with a recipient's key pair, or throws. */
export function contentKeyFor(header: EnvelopeHeader, pair: KeyPairLike): Buffer {
  const fingerprint = publicKeyFingerprint(pair.publicKey);
  const recipient = findRecipient(header, fingerprint);
  if (!recipient) {
    throw new Error(`This trace is not encrypted for key ${fingerprint}`);
  }
  return unwrapContentKey(recipient, pair);
}

export function decryptMetadata(header: EnvelopeHeader, pair: KeyPairLike): TraceMetadata {
  const key = contentKeyFor(header, pair);
  const json = aeadDecrypt(key, unb64(header.meta.nonce), unb64(header.meta.ciphertext), AAD_META);
  return traceMetadataSchema.parse(JSON.parse(json.toString('utf8')));
}

export function decryptTrace(input: {
  header: EnvelopeHeader;
  ciphertext: Uint8Array;
  pair: KeyPairLike;
}): { content: Buffer; metadata: TraceMetadata } {
  if (sha256b64url(input.ciphertext) !== input.header.content.hash) {
    throw new Error('Ciphertext does not match the envelope hash');
  }
  const key = contentKeyFor(input.header, input.pair);
  const content = aeadDecrypt(key, unb64(input.header.content.nonce), input.ciphertext, AAD_CONTENT);
  const json = aeadDecrypt(key, unb64(input.header.meta.nonce), unb64(input.header.meta.ciphertext), AAD_META);
  return { content, metadata: traceMetadataSchema.parse(JSON.parse(json.toString('utf8'))) };
}

/** Grants another machine access without re-encrypting the content. */
export function addRecipient(
  header: EnvelopeHeader,
  contentKey: Buffer,
  recipientPublicKey: string
): EnvelopeHeader {
  if (findRecipient(header, publicKeyFingerprint(recipientPublicKey))) {
    return header;
  }
  return {
    ...header,
    recipients: [...header.recipients, wrapContentKey(contentKey, recipientPublicKey)]
  };
}
