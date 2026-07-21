import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import { mapCaseToOnepager } from '@/lib/docgen/mapCaseToOnepager';
import { buildOnepagerHtml } from '@/lib/docgen/onepagerTemplate';
import { renderHtmlToPdf, renderHtmlToPng } from '@/lib/docgen/render';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Generate a branded one-pager for a case (PDF or PNG).
 * Chat path: generate_case_onepager tool prefers CaseAsset ONE_PAGER when present.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { caseId } = await params;
    const formatRaw = new URL(req.url).searchParams.get('format')?.toLowerCase();
    const format = formatRaw === 'png' ? 'png' : 'pdf';

    const c = await prisma.caseStudy.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        title: true,
        slug: true,
        clientName: true,
        clientIndustry: true,
        clientMarket: true,
        industry: true,
        summary: true,
        challenge: true,
        challenges: true,
        solution: true,
        benefits: true,
        results: true,
        uniqueSolution: true,
        solutionAgents: true,
        tech: true,
      },
    });
    if (!c) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    // Prefer CaseAsset ONE_PAGER in chat (generate_case_onepager); admin always regenerates.
    const content = mapCaseToOnepager(c);
    const html = buildOnepagerHtml(content);

    const filenameBase = `${c.slug || 'case'}-onepager`;

    if (format === 'png') {
      const buf = await renderHtmlToPng(html);
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': `attachment; filename="${filenameBase}.png"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const buf = await renderHtmlToPdf(html);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filenameBase}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[api/admin/cases/onepager] unhandled', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
