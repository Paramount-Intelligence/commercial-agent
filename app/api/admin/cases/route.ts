import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

function techSummary(
  tags: { name: string }[],
  tech: unknown,
): string {
  if (tags.length > 0) return tags.map((t) => t.name).join(', ');
  if (Array.isArray(tech)) {
    return tech
      .map((t) => {
        if (t && typeof t === 'object' && 'title' in t) {
          return String((t as { title: unknown }).title ?? '');
        }
        return typeof t === 'string' ? t : '';
      })
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

/**
 * Case list for assets picker + cases admin table.
 * Query: q, pe (yes|no|unknown|all), industry, tech
 */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const sp = new URL(req.url).searchParams;
    const q = sp.get('q')?.trim() ?? '';
    const pe = (sp.get('pe') ?? 'all').toLowerCase();
    const industry = sp.get('industry')?.trim() ?? '';
    const tech = sp.get('tech')?.trim() ?? '';

    const peFilter =
      pe === 'yes'
        ? { peBacked: true as const }
        : pe === 'no'
          ? { peBacked: false as const }
          : pe === 'unknown'
            ? { peBacked: null }
            : {};

    const cases = await prisma.caseStudy.findMany({
      where: {
        ...peFilter,
        ...(industry
          ? { industry: { contains: industry, mode: 'insensitive' } }
          : {}),
        ...(tech
          ? {
              OR: [
                {
                  techTags: {
                    some: { name: { contains: tech, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { industry: { contains: q, mode: 'insensitive' } },
                { clientName: { contains: q, mode: 'insensitive' } },
                { businessFunction: { contains: q, mode: 'insensitive' } },
                {
                  techTags: {
                    some: { name: { contains: q, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        clientName: true,
        industry: true,
        businessFunction: true,
        peBacked: true,
        tech: true,
        updatedAt: true,
        techTags: { select: { name: true }, orderBy: { name: 'asc' } },
        updatedBy: { select: { name: true, email: true } },
        _count: { select: { assets: true, chunks: true } },
      },
      take: 200,
    });

    return NextResponse.json({
      cases: cases.map((c) => ({
        id: c.id,
        title: c.title,
        industry: c.industry,
        clientName: c.clientName,
        businessFunction: c.businessFunction,
        peBacked: c.peBacked,
        tech: techSummary(c.techTags, c.tech),
        techTags: c.techTags.map((t) => t.name),
        hasAssets: c._count.assets > 0,
        assetCount: c._count.assets,
        chunkCount: c._count.chunks,
        updatedAt: c.updatedAt.toISOString(),
        updatedByName: c.updatedBy?.name ?? null,
        updatedByEmail: c.updatedBy?.email ?? null,
      })),
    });
  } catch (err) {
    console.error('[api/admin/cases GET] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
