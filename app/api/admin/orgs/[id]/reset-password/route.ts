import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { encryptSecret } from '@/lib/crypto/orgSecret';
import { generateOrgPassword, sealOrgPassword } from '@/lib/orgs/credentials';

export const runtime = 'nodejs';

/**
 * Rotate org login credential. Returns new plaintext ONCE.
 * Does NOT invalidate user Sessions (password is org-login only;
 * user sessions are independent — flag if you want reset to also kill them).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { id } = await params;
    const org = await prisma.organization.findUnique({
      where: { id },
      select: { id: true, email: true, name: true },
    });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    try {
      encryptSecret('key-check');
    } catch (e) {
      console.error('[api/admin/orgs/reset-password] ORG_SECRET_KEY', e);
      return NextResponse.json(
        { error: 'Server cannot encrypt org credentials (ORG_SECRET_KEY).' },
        { status: 500 },
      );
    }

    const password = generateOrgPassword();
    const sealed = await sealOrgPassword(password);

    await prisma.organization.update({
      where: { id: org.id },
      data: {
        passwordHash: sealed.passwordHash,
        passwordEnc: sealed.passwordEnc,
      },
    });

    console.log(
      `[admin/orgs] RESET_PASSWORD org=${org.id} (${org.email}) by admin=${auth.admin.id} (${auth.admin.email}) at ${new Date().toISOString()}`,
    );

    return NextResponse.json({ email: org.email, password });
  } catch (err) {
    console.error('[api/admin/orgs/reset-password] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
