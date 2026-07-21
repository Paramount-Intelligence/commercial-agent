import { NextResponse } from 'next/server';
import { destroyAdminSession } from '@/lib/auth/adminSession';

export const runtime = 'nodejs';

export async function POST() {
  try {
    await destroyAdminSession();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/admin/logout] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
