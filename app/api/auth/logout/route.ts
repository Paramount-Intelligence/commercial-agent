import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { destroySession } from '@/lib/auth/session';
import { ORG_AUTH_COOKIE } from '@/lib/auth/orgAuth';

export const runtime = 'nodejs';

/** Buyer sign-out: deletes the session row and clears both sign-in cookies. */
export async function POST() {
  try {
    await destroySession();
    (await cookies()).delete(ORG_AUTH_COOKIE);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/auth/logout] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
