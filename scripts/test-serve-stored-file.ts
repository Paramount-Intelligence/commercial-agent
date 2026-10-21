/**
 * Unit tests: server-side reads of stored URLs only ever fetch Vercel Blob
 * hosts (https, no credentials, no port, no redirects). No network: fetch is
 * replaced by a counter.
 *
 *   npx tsx scripts/test-serve-stored-file.ts
 */
import { isUrlOnHost, isVercelBlobUrl, oldPublicStoreHost, readStoredFile } from '../lib/storage/blob';
import { serveStoredFile } from '../lib/storage/serveFile';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}`);
    failed++;
  }
}

const fetched: Array<{ url: string; redirect?: RequestRedirect }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  fetched.push({ url: String(input), redirect: init?.redirect });
  return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { 'content-type': 'application/pdf' } });
}) as typeof fetch;

const BLOB = 'https://abc123.public.blob.vercel-storage.com/case-assets/x.pdf';
const BAD = [
  'https://evil.example.com/x.pdf',
  'https://abc123.public.blob.vercel-storage.com.evil.com/x.pdf',
  'http://abc123.public.blob.vercel-storage.com/x.pdf',
  'https://user:pw@abc123.public.blob.vercel-storage.com/x.pdf',
  'https://abc123.public.blob.vercel-storage.com:8443/x.pdf',
  'https://169.254.169.254/latest/meta-data',
  'file:///etc/passwd',
  'https://localhost/x.pdf',
  'ftp://abc123.public.blob.vercel-storage.com/x.pdf',
];

async function main() {
  ok('Blob URL accepted', isVercelBlobUrl(BLOB));
  ok('private Blob URL accepted', isVercelBlobUrl('https://abc123.private.blob.vercel-storage.com/x.pdf'));
  for (const u of BAD) ok(`refused: ${u}`, !isVercelBlobUrl(u));

  for (const u of BAD) {
    const before = fetched.length;
    const res = await serveStoredFile(u, { filename: 'x.pdf' });
    ok(`serveStoredFile refuses without fetching: ${u}`, res.status === 404 && fetched.length === before);
  }
  ok('readStoredFile refuses a foreign host without fetching', (await readStoredFile('https://evil.example.com/x.pdf')) === null && fetched.length === 0);

  const res = await serveStoredFile(BLOB, { filename: 'x.pdf' });
  ok('a real Blob URL is fetched once and served', res.status === 200 && fetched.length === 1 && fetched[0].url === BLOB);
  ok('fetch refuses redirects', fetched[0].redirect === 'error');
  ok('served privately, as a download', res.headers.get('cache-control') === 'private, no-store' && (res.headers.get('content-disposition') ?? '').startsWith('attachment'));

  ok('old store host derived from its token', oldPublicStoreHost({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_AbC123_secretpart' }) === 'abc123.public.blob.vercel-storage.com');
  ok('no token → no old store host', oldPublicStoreHost({}) === null);
  ok('isUrlOnHost exact host only', isUrlOnHost(BLOB, 'abc123.public.blob.vercel-storage.com') && !isUrlOnHost(BLOB, 'zzz.public.blob.vercel-storage.com'));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
