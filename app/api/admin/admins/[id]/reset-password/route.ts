import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { generateAdminPassword } from '@/lib/admin/password';

export const runtime = 'nodejs';

const BCRYPT_ROUNDS = 12;

/**
 * Reset adviser-admin password + revoke sessions.
 * Password returned once.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { id } = await ctx.params;
    const target = await prisma.adviserAdmin.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, active: true },
    });
    if (!target) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 });
    }

    const password = generateAdminPassword();
    await prisma.$transaction([
      prisma.adviserAdmin.update({
        where: { id: target.id },
        data: { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) },
      }),
      prisma.adviserAdminSession.deleteMany({
        where: { adminId: target.id },
      }),
    ]);

    console.info('[api/admin/admins/reset] reset', {
      by: auth.admin.email,
      email: target.email,
    });

    return NextResponse.json({
      admin: target,
      password,
      warning:
        'Password shown once. All sessions for this admin were revoked.',
    });
  } catch (err) {
    console.error('[api/admin/admins/reset]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
