/**
 * 24h user Session lifecycle — the REAL gate on /chat and /api/chat.
 * Minted server-side after email verification (or the already-verified skip).
 *
 * Token: opaque 32-byte crypto-random base64url, stored in DB and in an
 * httpOnly cookie. No claims in the token — the DB row is the source of truth,
 * so revocation (row delete, org kill switch, user block) is immediate.
 */
import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import type { AgentUser, Organization, Session } from '@prisma/client';
import { prisma } from '../db';

export const SESSION_COOKIE = 'session';
export const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24h

export type SessionContext = {
  session: Session;
  agentUser: AgentUser;
  organization: Organization;
};

/**
 * Create a Session row + set the "session" cookie. Call ONLY from a route
 * handler (cookie writes are not allowed in server components).
 * organizationId must come from the verified org-auth cookie, never the client.
 */
export async function createSession(
  agentUserId: string,
  organizationId: string,
): Promise<Session> {
  const token = randomBytes(32).toString('base64url');
  const session = await prisma.session.create({
    data: {
      token,
      agentUserId,
      organizationId,
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

  return session;
}

/**
 * Read + validate the session cookie. Returns the full auth context or null.
 * Null (treat as logged out) when: no cookie, unknown token, expired row
 * (row is deleted opportunistically), org missing/inactive (kill switch —
 * deactivating an org instantly logs out all its users), or user blocked.
 */
export async function readSession(): Promise<SessionContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { agentUser: true },
  });
  if (!session) return null;

  if (session.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  if (session.agentUser.blocked) return null;

  const organization = await prisma.organization.findUnique({
    where: { id: session.organizationId },
  });
  if (!organization || !organization.active) return null;

  return { session, agentUser: session.agentUser, organization };
}

/**
 * Logout helper (wired to a route later): delete the row + clear the cookie.
 * Call ONLY from a route handler.
 */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
  }
  store.delete(SESSION_COOKIE);
}
