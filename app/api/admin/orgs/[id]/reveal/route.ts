import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { decryptSecret } from '@/lib/crypto/orgSecret';

export const runtime = 'nodejs';

/** Deliberate credential reveal — decrypts passwordEnc. Audited. */
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
      select: { id: true, name: true, email: true, passwordEnc: true },
    });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    let password: string;
    try {
      password = decryptSecret(org.passwordEnc);
    } catch (e) {
      console.error('[api/admin/orgs/reveal] decrypt failed', e);
      return NextResponse.json(
        { error: 'Could not decrypt credentials (check ORG_SECRET_KEY).' },
        { status: 500 },
      );
    }

    console.log(
      `[admin/orgs] REVEAL org=${org.id} (${org.email}) by admin=${auth.admin.id} (${auth.admin.email}) at ${new Date().toISOString()}`,
    );

    return NextResponse.json({ email: org.email, password });
  } catch (err) {
    console.error('[api/admin/orgs/reveal] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
