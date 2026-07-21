import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { createAdminSession } from '@/lib/auth/adminSession';

export const runtime = 'nodejs';

const GENERIC_401 = 'Invalid credentials';

export async function POST(req: Request) {
  try {
    let body: { email?: string; password?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? '';
    if (!email || !password) {
      return NextResponse.json(
        { error: 'email and password are required' },
        { status: 400 },
      );
    }

    const admin = await prisma.adviserAdmin.findUnique({ where: { email } });

    // Generic 401 for not-found / inactive / wrong password — no oracle.
    // Compare against a constant hash when the admin is missing so timing
    // doesn't reveal whether the email exists.
    const hash =
      admin?.passwordHash ??
      '$2b$12$qbmDHEPprMOMuGluAX86aO2MW6YGXv2oJSkltqFLeek6fmecRZAUq';
    const passwordOk = await bcrypt.compare(password, hash);

    if (!admin || !admin.active || !passwordOk) {
      return NextResponse.json({ error: GENERIC_401 }, { status: 401 });
    }

    await createAdminSession(admin.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/admin/login] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
