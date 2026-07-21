import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { id } = await params;
    let body: {
      dailyMsgLimit?: number;
      dailyLlmTokenLimit?: number;
      dailyTtsCharLimit?: number;
      dailySttSecondLimit?: number;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const updates: {
      dailyMsgLimit?: number;
      dailyLlmTokenLimit?: number;
      dailyTtsCharLimit?: number;
      dailySttSecondLimit?: number;
    } = {};
    for (const key of [
      'dailyMsgLimit',
      'dailyLlmTokenLimit',
      'dailyTtsCharLimit',
      'dailySttSecondLimit',
    ] as const) {
      if (body[key] === undefined) continue;
      const value = Number(body[key]);
      if (!Number.isInteger(value) || value < 1) {
        return NextResponse.json(
          { error: `${key} must be a positive integer` },
          { status: 400 },
        );
      }
      updates[key] = value;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'At least one limit is required' },
        { status: 400 },
      );
    }

    const org = await prisma.organization.findUnique({
      where: { id },
      select: { id: true, email: true },
    });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const updated = await prisma.organization.update({
      where: { id: org.id },
      data: updates,
      select: {
        id: true,
        dailyMsgLimit: true,
        dailyLlmTokenLimit: true,
        dailyTtsCharLimit: true,
        dailySttSecondLimit: true,
      },
    });

    console.log(
      `[admin/orgs] SET_LIMITS org=${org.id} (${org.email}) updates=${JSON.stringify(updates)} by admin=${auth.admin.id} (${auth.admin.email}) at ${new Date().toISOString()}`,
    );

    return NextResponse.json({ ok: true, ...updated });
  } catch (err) {
    console.error('[api/admin/orgs/set-limit] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
