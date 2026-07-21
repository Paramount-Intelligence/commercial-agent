import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { signOrgAuth, ORG_AUTH_COOKIE, ORG_AUTH_TTL_SECONDS } from '@/lib/auth/orgAuth';

export const runtime = 'nodejs';

const GENERIC_401 = { error: 'Invalid credentials or inactive organization' };

export async function POST(req: Request) {
  try {
    let body: { email?: string; password?: string };
    try {
      body = (await req.json()) as { email?: string; password?: string };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? '';
    if (!email || !password) {
      return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
    }

    const org = await prisma.organization.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, active: true },
    });

    // Generic 401 for all failure shapes — never reveal which check failed
    if (!org || !org.active) {
      return NextResponse.json(GENERIC_401, { status: 401 });
    }

    const passwordOk = await bcrypt.compare(password, org.passwordHash);
    if (!passwordOk) {
      return NextResponse.json(GENERIC_401, { status: 401 });
    }

    // Org passed login → short-lived org-auth cookie unlocks the identify step.
    // NOT a user session — that is created after email verification (Slice 4).
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ORG_AUTH_COOKIE, signOrgAuth(org.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: ORG_AUTH_TTL_SECONDS,
    });
    return res;
  } catch (err) {
    console.error('[api/org-login] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
