import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { generateAdminPassword } from '@/lib/admin/password';

export const runtime = 'nodejs';

const BCRYPT_ROUNDS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** List adviser admins (no password hashes). */
export async function GET() {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const admins = await prisma.adviserAdmin.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      admins: admins.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
        isSelf: a.id === auth.admin.id,
      })),
    });
  } catch (err) {
    console.error('[api/admin/admins GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** Create a new adviser admin — password returned once. */
export async function POST(req: Request) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const body = (await req.json()) as { name?: string; email?: string };
    const name = body.name?.trim() ?? '';
    const email = body.email?.trim().toLowerCase() ?? '';

    if (!name || !email) {
      return NextResponse.json(
        { error: 'name and email are required' },
        { status: 400 },
      );
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    const existing = await prisma.adviserAdmin.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'An admin with that email already exists' },
        { status: 409 },
      );
    }

    const password = generateAdminPassword();
    const admin = await prisma.adviserAdmin.create({
      data: {
        name,
        email,
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      },
      select: { id: true, name: true, email: true, role: true, active: true },
    });

    console.info('[api/admin/admins] created', {
      by: auth.admin.email,
      email: admin.email,
    });

    return NextResponse.json({
      admin,
      password,
      warning:
        'Password shown once. Store it securely — it cannot be retrieved later (only reset).',
    });
  } catch (err) {
    console.error('[api/admin/admins POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
