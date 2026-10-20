/**
 * Unit tests for the database guard (no database needed).
 *
 *   npm run dbguard:test
 */
import { assertLocalDatabase, databaseFingerprint } from '../lib/dbGuard';

let passed = 0;
let failed = 0;

function expect(
  name: string,
  env: Record<string, string | undefined>,
  shouldThrow: boolean,
  opts: { strict?: boolean } = {},
) {
  let threw = false;
  try {
    assertLocalDatabase(env, opts);
  } catch {
    threw = true;
  }
  if (threw === shouldThrow) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name} (expected ${shouldThrow ? 'throw' : 'no throw'})`);
    failed++;
  }
}

const LOCAL = 'postgresql://postgres:pw@localhost:5432/jackie?schema=public';
const REMOTE = 'postgres://user:pw@db.prisma.io:5432/postgres?sslmode=require';
const STAGING = 'postgres://stage:pw2@db.prisma.io:5432/postgres?sslmode=require';
const STAGING_DIRECT = 'postgres://stage:pw2@db-direct.prisma.io:5432/postgres?sslmode=require';
const FP = databaseFingerprint(STAGING);
const FP_DIRECT = databaseFingerprint(STAGING_DIRECT);

expect('localhost allowed', { DATABASE_URL: LOCAL, DIRECT_URL: LOCAL }, false);
expect('127.0.0.1 allowed', { DATABASE_URL: 'postgresql://p:pw@127.0.0.1:5432/x' }, false);
expect('quoted local URL allowed', { DATABASE_URL: `"${LOCAL}"` }, false);
expect('remote without DB_TARGET refused', { DATABASE_URL: REMOTE, DIRECT_URL: LOCAL }, true);
expect('remote DIRECT_URL refused (migrate uses it)', { DATABASE_URL: LOCAL, DIRECT_URL: REMOTE }, true);
expect('prisma accelerate URL refused', { DATABASE_URL: 'prisma+postgres://accelerate.prisma-data.net/?api_key=x' }, true);
expect('invalid URL refused', { DATABASE_URL: 'not a url' }, true);
expect('DB_TARGET=staging without fingerprint refused', { DB_TARGET: 'staging', DATABASE_URL: STAGING }, true);
expect(
  'remote with wrong fingerprint refused (production URL)',
  { DB_TARGET: 'staging', STAGING_DB_FINGERPRINT: FP, DATABASE_URL: REMOTE },
  true,
);
expect(
  'fingerprint without DB_TARGET refused',
  { STAGING_DB_FINGERPRINT: FP, DATABASE_URL: STAGING },
  true,
);
expect(
  'matching fingerprint allowed',
  { DB_TARGET: 'staging', STAGING_DB_FINGERPRINT: FP, DATABASE_URL: STAGING },
  false,
);
expect(
  'quoted staging URL matches its fingerprint',
  { DB_TARGET: 'staging', STAGING_DB_FINGERPRINT: FP, DATABASE_URL: `"${STAGING}"` },
  false,
);
expect(
  'pooled and direct both fingerprinted allowed',
  {
    DB_TARGET: 'staging',
    STAGING_DB_FINGERPRINT: `${FP}, ${FP_DIRECT}`,
    DATABASE_URL: STAGING,
    DIRECT_URL: STAGING_DIRECT,
  },
  false,
);
expect(
  'staging DATABASE_URL with production DIRECT_URL refused',
  { DB_TARGET: 'staging', STAGING_DB_FINGERPRINT: FP, DATABASE_URL: STAGING, DIRECT_URL: REMOTE },
  true,
);
expect('ALLOW_REMOTE_DB no longer skips the guard', { ALLOW_REMOTE_DB: '1', DATABASE_URL: REMOTE }, true);
expect('production runtime skips guard', { NODE_ENV: 'production', DATABASE_URL: REMOTE }, false);
expect(
  'strict mode ignores NODE_ENV=production',
  { NODE_ENV: 'production', DATABASE_URL: REMOTE },
  true,
  { strict: true },
);
expect(
  'strict mode allows fingerprinted staging',
  { NODE_ENV: 'production', DB_TARGET: 'staging', STAGING_DB_FINGERPRINT: FP, DATABASE_URL: STAGING },
  false,
  { strict: true },
);
expect('development does not skip guard', { NODE_ENV: 'development', DATABASE_URL: REMOTE }, true);
expect('unset URLs pass (Prisma reports its own error)', {}, false);

const target = assertLocalDatabase(
  { DB_TARGET: 'staging', STAGING_DB_FINGERPRINT: FP, DATABASE_URL: STAGING },
  { strict: true },
);
if (target === 'staging' && assertLocalDatabase({ DATABASE_URL: LOCAL }) === 'local') {
  console.log('PASS  reports local / staging target');
  passed++;
} else {
  console.error('FAIL  reports local / staging target');
  failed++;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
