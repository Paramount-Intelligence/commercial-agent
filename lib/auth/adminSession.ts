/**
 * Adviser-admin session (backstage portal). 8h, DB-backed opaque token in an
 * httpOnly "adviser_admin_session" cookie.
 *
 * INDEPENDENT of the user "session" cookie (Session model) and of the website
 * Admin model — three separate auth systems, no cross-contamination.
 */
import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import type { AdviserAdmin, AdviserAdminSession } from '@prisma/client';
import { prisma } from '../db';

export const ADMIN_SESSION_COOKIE = 'adviser_admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60; // 8h — a workday

export type AdminSessionContext = {
  session: AdviserAdminSession;
  admin: AdviserAdmin;
};

/** Create a session row + set the cookie. Route handlers only (cookie write). */
export async function createAdminSession(
  adminId: string,
): Promise<AdviserAdminSession> {
  const token = randomBytes(32).toString('base64url');
  const session = await prisma.adviserAdminSession.create({
    data: {
      token,
      adminId,
      expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000),
    },
  });

  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });

  return session;
}

/**
 * Read + validate the admin session cookie. Null when: no cookie, unknown
 * token, expired (row deleted opportunistically), or admin.active = false
 * (deactivation is an instant kill switch).
 */
export async function readAdminSession(): Promise<AdminSessionContext | null> {
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.adviserAdminSession.findUnique({
    where: { token },
    include: { admin: true },
  });
  if (!session) return null;

  if (session.expiresAt <= new Date()) {
    await prisma.adviserAdminSession
      .delete({ where: { id: session.id } })
      .catch(() => {});
    return null;
  }

  if (!session.admin.active) return null;

  return { session, admin: session.admin };
}

/** Logout: delete the row + clear the cookie. Route handlers only. */
export async function destroyAdminSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (token) {
    await prisma.adviserAdminSession.deleteMany({ where: { token } });
  }
  store.delete(ADMIN_SESSION_COOKIE);
}
