import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

/** Searchable case list for the assets admin UI. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';

    const cases = await prisma.caseStudy.findMany({
      where: q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { industry: { contains: q, mode: 'insensitive' } },
              { clientName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        industry: true,
        clientName: true,
        _count: { select: { assets: true } },
      },
      take: 100,
    });

    return NextResponse.json({
      cases: cases.map((c) => ({
        id: c.id,
        title: c.title,
        industry: c.industry,
        clientName: c.clientName,
        assetCount: c._count.assets,
      })),
    });
  } catch (err) {
    console.error('[api/admin/cases GET] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
