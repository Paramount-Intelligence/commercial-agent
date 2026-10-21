/**
 * Unit tests for the storage mode (no network): which store is used for
 * which environment, and the local-disk path when no store is available.
 *
 *   npx tsx scripts/test-storage-mode.ts
 */
import { deleteAsset, readStoredFile, storageMode, uploadAsset } from '../lib/storage/blob';

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

ok('no credentials → local disk', storageMode({}).kind === 'local');
ok('store id on a laptop (not Vercel) → still local', storageMode({ BLOB_PRIVATE_STORE_ID: 'store_abc' }).kind === 'local');
const oidc = storageMode({ VERCEL: '1', BLOB_PRIVATE_STORE_ID: 'store_abc' });
ok('on Vercel with the private store id → private via OIDC', oidc.kind === 'private-oidc' && oidc.access === 'private');
ok(
  'private store wins over an existing public token',
  storageMode({ VERCEL: '1', BLOB_PRIVATE_STORE_ID: 'store_abc', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_pub_x' }).kind === 'private-oidc',
);
ok('private-store token (laptop) → private-token', storageMode({ BLOB_PRIVATE_READ_WRITE_TOKEN: 't' }).kind === 'private-token');
ok('public token only → token, public', (() => { const m = storageMode({ BLOB_READ_WRITE_TOKEN: 't' }); return m.kind === 'token' && m.access === 'public'; })());
ok('token with BLOB_ACCESS=private → token, private', storageMode({ BLOB_READ_WRITE_TOKEN: 't', BLOB_ACCESS: 'private' }).access === 'private');
ok('Vercel without the private store id → falls back to the token', storageMode({ VERCEL: '1', BLOB_READ_WRITE_TOKEN: 't' }).kind === 'token');

async function main() {
  // Local disk round trip with no credentials (this test runs with a bare environment).
  if (storageMode().kind === 'local') {
    const { url } = await uploadAsset(Buffer.from('%PDF-1.4 local test'), 'unit test.pdf', 'application/pdf', 'unit-test/');
    ok('local upload gets a random name under /uploads/', /^\/uploads\/unit-test\/unit_test-[0-9a-f]{16}\.pdf$/.test(url));
    const back = await readStoredFile(url);
    ok('local file reads back', back?.buffer.toString() === '%PDF-1.4 local test');
    await deleteAsset(url);
    ok('local file deleted', (await readStoredFile(url)) === null);
    ok('private blob URL without credentials is not readable locally', (await readStoredFile('https://abc.private.blob.vercel-storage.com/x.pdf')) === null);
  } else {
    console.log('SKIP  local round trip (credentials present)');
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
