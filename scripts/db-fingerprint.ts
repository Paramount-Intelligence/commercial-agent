/**
 * Print the SHA-256 fingerprint of DATABASE_URL and DIRECT_URL from
 * .env.staging, never the URLs themselves. Paste the result into
 * STAGING_DB_FINGERPRINT in .env.staging.
 *
 *   npm run db:fingerprint
 */
import { databaseFingerprint } from '../lib/dbGuard';

const fps: string[] = [];
for (const key of ['DATABASE_URL', 'DIRECT_URL'] as const) {
  const raw = process.env[key]?.trim();
  if (!raw) {
    console.log(`${key}: not set`);
    continue;
  }
  let host = '(invalid URL)';
  try {
    host = new URL(raw.replace(/^["']|["']$/g, '')).hostname;
  } catch {
    // reported as invalid below
  }
  const fp = databaseFingerprint(raw);
  console.log(`${key}: host ${host}, sha256 ${fp}`);
  if (!fps.includes(fp)) fps.push(fp);
}
if (fps.length > 0) console.log(`\nSTAGING_DB_FINGERPRINT=${fps.join(',')}`);
