/**
 * Unit tests for the local database guard (no database needed).
 *
 *   npm run dbguard:test
 */
import { assertLocalDatabase } from '../lib/dbGuard';

let passed = 0;
let failed = 0;

function expect(name: string, env: Record<string, string | undefined>, shouldThrow: boolean) {
  let threw = false;
  try {
    assertLocalDatabase(env);
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

expect('local DATABASE_URL and DIRECT_URL allowed', { DATABASE_URL: LOCAL, DIRECT_URL: LOCAL }, false);
expect('127.0.0.1 allowed', { DATABASE_URL: 'postgresql://p:pw@127.0.0.1:5432/x' }, false);
expect('quoted local URL allowed', { DATABASE_URL: `"${LOCAL}"` }, false);
expect('remote DATABASE_URL blocked', { DATABASE_URL: REMOTE, DIRECT_URL: LOCAL }, true);
expect('remote DIRECT_URL blocked (migrate uses it)', { DATABASE_URL: LOCAL, DIRECT_URL: REMOTE }, true);
expect('prisma accelerate URL blocked', { DATABASE_URL: 'prisma+postgres://accelerate.prisma-data.net/?api_key=x' }, true);
expect('invalid URL blocked', { DATABASE_URL: 'not a url' }, true);
expect('production skips guard', { NODE_ENV: 'production', DATABASE_URL: REMOTE }, false);
expect('ALLOW_REMOTE_DB=1 skips guard', { ALLOW_REMOTE_DB: '1', DATABASE_URL: REMOTE }, false);
expect('development does not skip guard', { NODE_ENV: 'development', DATABASE_URL: REMOTE }, true);
expect('unset URLs pass (Prisma reports its own error)', {}, false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
