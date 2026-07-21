/**
 * Reversible encryption for Organization.passwordEnc — AES-256-GCM, Node built-in
 * crypto only (no dependency).
 *
 * Key: env ORG_SECRET_KEY, 32 bytes as hex (64 chars) or base64 (44 chars).
 * Generate one:  npx tsx scripts/generate-org-key.ts
 *
 * SECURITY: ORG_SECRET_KEY is a sensitive secret — anyone holding it can decrypt
 * every org password. Keep it in .env.local / deployment secrets only; never in
 * git or the database. Rotating it invalidates existing passwordEnc payloads
 * (they'd need re-encryption from the plaintext).
 *
 * Payload format (v1): base64( iv[12] || authTag[16] || ciphertext ).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const IV_LEN = 12; // GCM standard nonce size
const TAG_LEN = 16;
const KEY_LEN = 32;

function loadKey(): Buffer {
  const raw = process.env.ORG_SECRET_KEY?.trim();
  if (!raw) {
    throw new Error(
      'ORG_SECRET_KEY is not set. Generate one with `npx tsx scripts/generate-org-key.ts` ' +
        'and add it to .env.local (32 bytes, hex or base64).',
    );
  }

  let key: Buffer | undefined;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === KEY_LEN) key = b64;
  }

  if (!key || key.length !== KEY_LEN) {
    throw new Error(
      'ORG_SECRET_KEY must decode to exactly 32 bytes (64 hex chars or 44 base64 chars). ' +
        'Generate a valid one with `npx tsx scripts/generate-org-key.ts`.',
    );
  }
  return key;
}

/** Encrypt a secret for storage. Output is a single base64 string. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** Decrypt a payload produced by encryptSecret. Throws on tamper/wrong key. */
export function decryptSecret(payload: string): string {
  const key = loadKey();
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('decryptSecret: payload too short / malformed');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
