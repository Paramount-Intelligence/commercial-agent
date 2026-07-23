/**
 * Smoke-test Vercel Blob write + public read.
 *
 *   npx tsx --env-file=.env.local scripts/test-blob.ts
 *
 * For production verification, temporarily set BLOB_READ_WRITE_TOKEN to the
 * Production env token (or pull via `vercel env pull`), then run. Deletes the
 * test object afterward when possible.
 */
import { put, del } from '@vercel/blob';

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) {
    console.error(
      'FAIL: BLOB_READ_WRITE_TOKEN is unset. ' +
        'Without it, uploads fall back to /uploads (dev only) and will break on Vercel.',
    );
    process.exitCode = 1;
    return;
  }

  const key = `blob-smoke/${Date.now()}-ping.txt`;
  const body = `blob-ok ${new Date().toISOString()}`;

  console.log('Writing public blob…', key);
  const uploaded = await put(key, body, {
    access: 'public',
    contentType: 'text/plain',
    token,
  });

  console.log('URL:', uploaded.url);

  if (!/^https:\/\//i.test(uploaded.url)) {
    console.error('FAIL: URL is not absolute https — not a Blob store URL.');
    process.exitCode = 1;
    return;
  }
  if (/localhost|\/uploads\//i.test(uploaded.url)) {
    console.error('FAIL: URL looks local (/uploads or localhost), not Blob.');
    process.exitCode = 1;
    return;
  }
  if (!/blob\.vercel-storage\.com|public\.blob\.vercel-storage\.com/i.test(uploaded.url)) {
    console.warn(
      'WARN: URL host is not the usual *.blob.vercel-storage.com — confirm this is your store.',
    );
  }

  const res = await fetch(uploaded.url);
  const text = await res.text();
  console.log('GET status:', res.status);
  if (!res.ok || !text.includes('blob-ok')) {
    console.error('FAIL: public GET did not return the written body.');
    process.exitCode = 1;
    return;
  }

  console.log('PASS: Blob write + public read OK.');
  try {
    await del(uploaded.url, { token });
    console.log('Cleaned up smoke object.');
  } catch (err) {
    console.warn('Could not delete smoke object (non-fatal):', err);
  }
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
