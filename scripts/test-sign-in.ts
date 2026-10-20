/**
 * Unit tests for sign-in codes, session token hashing and rate-limit helpers.
 * No database: the challenge logic runs against an in-memory store.
 *
 *   npx tsx scripts/test-sign-in.ts
 */
import {
  checkChallenge,
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  REISSUE_COOLDOWN_MS,
  reissueChallenge,
  startChallenge,
  type ChallengeRow,
  type ChallengeStore,
} from '../lib/auth/signInChallenge';
import { hashSessionToken, newSessionToken } from '../lib/auth/tokenHash';
import { clientIp, LIMITS, rateLimitKey } from '../lib/auth/rateLimit';

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

function memoryStore() {
  const rows: ChallengeRow[] = [];
  let n = 0;
  const store: ChallengeStore = {
    async latestActive(email, orgId, now) {
      return (
        rows
          .filter((r) => r.email === email && r.organizationId === orgId && !r.consumedAt && r.expiresAt > now)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
      );
    },
    async create(row, now) {
      rows.push({ ...row, id: `c${++n}`, attempts: 0, consumedAt: null, createdAt: now });
    },
    async consumeAllActive(email, orgId, now) {
      rows.filter((r) => r.email === email && r.organizationId === orgId && !r.consumedAt).forEach((r) => (r.consumedAt = now));
    },
    async update(id, data) {
      Object.assign(rows.find((r) => r.id === id)!, data);
    },
    async consume(id, now) {
      const r = rows.find((x) => x.id === id)!;
      if (r.consumedAt) return false;
      r.consumedAt = now;
      return true;
    },
  };
  return { store, rows };
}

const A = { email: 'buyer@example.com', orgId: 'org1', name: 'Pat', affiliation: 'Acme' };
const at = (t0: Date, ms: number) => new Date(t0.getTime() + ms);

async function main() {
  const t0 = new Date('2026-10-21T10:00:00Z');

  {
    const { store, rows } = memoryStore();
    const s = await startChallenge(A, store, t0);
    ok('start returns a 6-digit code', s.ok && /^\d{6}$/.test(s.code));
    ok('code is stored hashed, never in plaintext', s.ok && rows[0].codeHash !== s.code && rows[0].codeHash.startsWith('$2'));
    ok('pending details kept on the challenge', rows[0].name === 'Pat' && rows[0].affiliation === 'Acme');
    const again = await startChallenge(A, store, at(t0, 10_000));
    ok('second code within 60 s is refused', !again.ok && again.retryAfterSeconds > 0);
    if (s.ok) {
      const wrong = await checkChallenge({ ...A, code: s.code === '000000' ? '111111' : '000000' }, store, at(t0, 1000));
      ok('wrong code fails with attempts remaining', !wrong.ok && wrong.reason === 'wrong_code' && wrong.attemptsRemaining === MAX_ATTEMPTS - 1);
      const good = await checkChallenge({ ...A, code: s.code }, store, at(t0, 2000));
      ok('right code succeeds and returns pending details', good.ok && good.name === 'Pat');
      const reuse = await checkChallenge({ ...A, code: s.code }, store, at(t0, 3000));
      ok('a used code fails', !reuse.ok && reuse.reason === 'no_active_code');
    }
  }

  {
    const { store } = memoryStore();
    const s = await startChallenge(A, store, t0);
    if (s.ok) {
      const late = await checkChallenge({ ...A, code: s.code }, store, at(t0, CODE_TTL_MS + 1));
      ok('an expired code fails', !late.ok && late.reason === 'no_active_code');
    }
  }

  {
    const { store } = memoryStore();
    const s = await startChallenge(A, store, t0);
    let last: Awaited<ReturnType<typeof checkChallenge>> | null = null;
    for (let i = 0; i < MAX_ATTEMPTS; i++) last = await checkChallenge({ ...A, code: 'abcdef' }, store, at(t0, 1000 + i));
    ok('5 wrong attempts consume the code', !!last && !last.ok && last.reason === 'too_many_attempts');
    if (s.ok) {
      const after = await checkChallenge({ ...A, code: s.code }, store, at(t0, 9000));
      ok('the right code no longer works after the cap', !after.ok);
    }
  }

  {
    const { store } = memoryStore();
    const first = await startChallenge(A, store, t0);
    const re = await reissueChallenge({ email: A.email, orgId: A.orgId }, store, at(t0, REISSUE_COOLDOWN_MS + 1));
    ok('resend issues a new code after the cooldown', !!re && re.ok);
    if (first.ok && re?.ok) {
      const old = await checkChallenge({ ...A, code: first.code }, store, at(t0, REISSUE_COOLDOWN_MS + 2));
      ok('a superseded code fails', !old.ok || first.code === re.code);
      const fresh = await checkChallenge({ ...A, code: re.code }, store, at(t0, REISSUE_COOLDOWN_MS + 3));
      ok('the new code works and keeps the pending details', fresh.ok && fresh.affiliation === 'Acme');
    }
    const none = await reissueChallenge({ email: 'other@example.com', orgId: A.orgId }, store, t0);
    ok('resend without a pending sign-in does nothing', none === null);
    const otherOrg = await checkChallenge({ email: A.email, orgId: 'org2', code: '123456' }, store, t0);
    ok('a code is bound to its organization', !otherOrg.ok && otherOrg.reason === 'no_active_code');
  }

  {
    const { store } = memoryStore();
    const s = await startChallenge(A, store, t0);
    if (s.ok) {
      const [x, y] = await Promise.all([
        checkChallenge({ ...A, code: s.code }, store, at(t0, 1000)),
        checkChallenge({ ...A, code: s.code }, store, at(t0, 1000)),
      ]);
      ok('concurrent submits: only one succeeds', [x, y].filter((r) => r.ok).length === 1);
    }
  }

  const tok = newSessionToken();
  ok('session token is 43 base64url chars', /^[A-Za-z0-9_-]{43}$/.test(tok));
  ok('token hash is stable hex sha256', hashSessionToken(tok) === hashSessionToken(tok) && /^[0-9a-f]{64}$/.test(hashSessionToken(tok)));
  ok('hash differs from the token', hashSessionToken(tok) !== tok);
  ok('two tokens differ', newSessionToken() !== tok);

  ok('rate-limit key hides the subject', !rateLimitKey(LIMITS.identifyEmail, 'buyer@example.com').includes('buyer'));
  ok('rate-limit key ignores case and spaces', rateLimitKey(LIMITS.identifyEmail, ' Buyer@Example.com ') === rateLimitKey(LIMITS.identifyEmail, 'buyer@example.com'));
  ok('rate-limit key differs per rule', rateLimitKey(LIMITS.identifyEmail, 'x') !== rateLimitKey(LIMITS.verifyEmail, 'x'));
  const req = (h: Record<string, string>) => new Request('http://x/', { headers: h });
  ok('client IP from x-forwarded-for first hop', clientIp(req({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' })) === '203.0.113.5');
  ok('client IP prefers x-vercel-forwarded-for', clientIp(req({ 'x-vercel-forwarded-for': '198.51.100.7', 'x-forwarded-for': '1.1.1.1' })) === '198.51.100.7');
  ok('client IP falls back to local', clientIp(req({})) === 'local');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
