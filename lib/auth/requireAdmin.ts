/**
 * Gate helpers for the adviser-admin portal. EVERY /admin/* page and
 * /api/admin/* route goes through one of these — the portal is gated from
 * slice 1.
 */
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { readAdminSession, type AdminSessionContext } from './adminSession';

/** Server components: returns the auth context or redirects to /admin/login. */
export async function requireAdmin(): Promise<AdminSessionContext> {
  const auth = await readAdminSession();
  if (!auth) redirect('/admin/login');
  return auth;
}

/**
 * API routes: returns the auth context or null. Callers 401 on null via
 * adminUnauthorized().
 */
export async function requireAdminApi(): Promise<AdminSessionContext | null> {
  return readAdminSession();
}

/** Standard 401 for /api/admin/* routes. */
export function adminUnauthorized(): NextResponse {
  return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
}
