/**
 * Test sign-in through the real routes: org-login → identify → verify-code.
 *
 * Codes are emailed and stored hashed, so the harness cannot read one. On a
 * local or staging database only (strict db guard), it replaces the pending
 * sign-in's code hash with the hash of a code it generated, then submits that
 * code. The app has no shortcut; this cannot work against production because
 * the guard refuses that database.
 */
import { randomInt } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import bcrypt from 'bcryptjs';
import { REPO_ROOT } from '../../scripts/lib/paths';
import { BASE_URL } from './common';

type Prisma = Awaited<ReturnType<typeof import('./common').connect>>['prisma'];

export type SeedCredentials = {
  org: { email: string; password: string };
  buyer: { email: string };
  admin: { email: string; password: string };
};

export function seedCredentials(target: 'local' | 'staging'): SeedCredentials {
  const file = join(REPO_ROOT, '.seed', `credentials.${target}.json`);
  if (!existsSync(file)) throw new Error(`No seed credentials for ${target}; run npm run seed:${target}.`);
  return JSON.parse(readFileSync(file, 'utf8')) as SeedCredentials;
}

function cookieJar(res: Response, jar: Map<string, string>) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i);
    const value = pair.slice(i + 1);
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
}
const header = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function post(path: string, body: unknown, jar: Map<string, string>) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: header(jar) },
    body: JSON.stringify(body),
  });
  cookieJar(res, jar);
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Sign in as a buyer through the real flow. Returns the Cookie header for later requests. */
export async function signInBuyer(
  prisma: Prisma,
  target: 'local' | 'staging',
  who: { email?: string; name?: string; affiliation?: string } = {},
): Promise<{ cookie: string; signOut: () => Promise<void> }> {
  const creds = seedCredentials(target);
  const email = (who.email ?? creds.buyer.email).toLowerCase();
  const jar = new Map<string, string>();

  const login = await post('/api/auth/org-login', { email: creds.org.email, password: creds.org.password }, jar);
  if (login.status !== 200) throw new Error(`org-login failed: ${login.status}`);

  const identify = await post(
    '/api/auth/identify',
    { name: who.name ?? 'Seed Buyer', email, affiliation: who.affiliation ?? 'Seed Test Org' },
    jar,
  );
  if (identify.json.status !== 'code_sent') throw new Error(`identify did not send a code: ${JSON.stringify(identify.json)}`);

  const org = await prisma.organization.findUniqueOrThrow({ where: { email: creds.org.email }, select: { id: true } });
  const challenge = await prisma.signInChallenge.findFirst({
    where: { email, organizationId: org.id, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!challenge) throw new Error('No pending sign-in found after identify.');
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  await prisma.signInChallenge.update({ where: { id: challenge.id }, data: { codeHash: await bcrypt.hash(code, 10) } });

  const verify = await post('/api/auth/verify-code', { email, code }, jar);
  if (verify.json.verified !== true || !jar.has('session')) throw new Error(`verify-code failed: ${JSON.stringify(verify.json)}`);

  const cookie = `session=${jar.get('session')}`;
  return {
    cookie,
    signOut: async () => {
      await fetch(`${BASE_URL}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } }).catch(() => {});
    },
  };
}
