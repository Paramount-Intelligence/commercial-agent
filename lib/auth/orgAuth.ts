/**
 * Org-auth cookie: proves "an org passed login" so the user-identify step can
 * proceed. NOT a user session (that's created after email verification).
 *
 * Token: v1.<base64url payload>.<base64url HMAC-SHA256> — signed, expiring.
 * Secret: env AUTH_COOKIE_SECRET (any long random string, e.g. the output of
 * `npx tsx scripts/generate-org-key.ts`). Dedicated secret by design — do NOT
 * reuse ORG_SECRET_KEY, so cookie-signing and password-encryption can rotate
 * independently. Keep it in .env.local / deployment secrets, never git.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

export const ORG_AUTH_COOKIE = 'org_auth';
export const ORG_AUTH_TTL_SECONDS = 30 * 60; // 30 min — enough to complete identify

function loadSecret(): string {
  const raw = process.env.AUTH_COOKIE_SECRET?.trim();
  if (!raw || raw.length < 32) {
    throw new Error(
      'AUTH_COOKIE_SECRET is not set (or too short — use 32+ chars). ' +
        'Generate one with `npx tsx scripts/generate-org-key.ts` and add it to .env.local.',
    );
  }
  return raw;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function hmac(data: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(data).digest());
}

/** Create a signed org-auth token for the cookie value. */
export function signOrgAuth(orgId: string): string {
  const secret = loadSecret();
  const payload = b64url(
    Buffer.from(
      JSON.stringify({ orgId, exp: Math.floor(Date.now() / 1000) + ORG_AUTH_TTL_SECONDS }),
    ),
  );
  const body = `v1.${payload}`;
  return `${body}.${hmac(body, secret)}`;
}

/** Verify a token; returns the orgId or null (bad signature / expired / malformed). */
export function verifyOrgAuth(cookieValue: string | undefined | null): string | null {
  if (!cookieValue) return null;
  const secret = loadSecret();

  const parts = cookieValue.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;

  const body = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(hmac(body, secret));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      orgId?: string;
      exp?: number;
    };
    if (!payload.orgId || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload.orgId;
  } catch {
    return null;
  }
}

/**
 * Read + verify the org-auth cookie inside a server route / server component.
 * Returns the authenticated orgId or null. (Slice 4 consumes this.)
 */
export async function readOrgAuth(): Promise<string | null> {
  const store = await cookies();
  return verifyOrgAuth(store.get(ORG_AUTH_COOKIE)?.value);
}
