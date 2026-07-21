import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

/** Kill switch: deactivate logs out all org users on their next request. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { id } = await params;
    let body: { active?: boolean };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (typeof body.active !== 'boolean') {
      return NextResponse.json({ error: 'active (boolean) is required' }, { status: 400 });
    }

    const org = await prisma.organization.findUnique({
      where: { id },
      select: { id: true, email: true, active: true },
    });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const updated = await prisma.organization.update({
      where: { id: org.id },
      data: { active: body.active },
      select: { id: true, active: true },
    });

    console.log(
      `[admin/orgs] SET_ACTIVE org=${org.id} (${org.email}) active=${body.active} by admin=${auth.admin.id} (${auth.admin.email}) at ${new Date().toISOString()}`,
    );

    return NextResponse.json({ ok: true, active: updated.active });
  } catch (err) {
    console.error('[api/admin/orgs/set-active] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
