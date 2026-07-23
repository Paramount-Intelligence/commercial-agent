import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminApi, adminUnauthorized } from '@/lib/auth/requireAdmin';
import {
  replaceCaseChunks,
  syncCaseTechTags,
} from '@/lib/retrieval/embedCaseChunks';

export const runtime = 'nodejs';

type TechItem = { title: string; description: string };

function parseTechInput(raw: unknown): { names: string[]; json: TechItem[] } {
  if (typeof raw === 'string') {
    const names = raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      names,
      json: names.map((title) => ({ title, description: '' })),
    };
  }
  if (Array.isArray(raw)) {
    const items: TechItem[] = [];
    const names: string[] = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        const title = item.trim();
        if (!title) continue;
        names.push(title);
        items.push({ title, description: '' });
      } else if (item && typeof item === 'object' && 'title' in item) {
        const title = String((item as { title: unknown }).title ?? '').trim();
        if (!title) continue;
        const description = String(
          (item as { description?: unknown }).description ?? '',
        );
        names.push(title);
        items.push({ title, description });
      }
    }
    return { names, json: items };
  }
  return { names: [], json: [] };
}

function peFromBody(raw: unknown): boolean | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '' || raw === 'unknown') return null;
  if (raw === true || raw === 'true' || raw === 'yes') return true;
  if (raw === false || raw === 'false' || raw === 'no') return false;
  return undefined;
}

async function loadCase(id: string) {
  return prisma.caseStudy.findUnique({
    where: { id },
    include: {
      techTags: { select: { name: true }, orderBy: { name: 'asc' } },
      updatedBy: { select: { name: true, email: true } },
      _count: { select: { assets: true, chunks: true } },
    },
  });
}

function serializeCase(
  c: NonNullable<Awaited<ReturnType<typeof loadCase>>>,
) {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    subtitle: c.subtitle,
    clientName: c.clientName,
    industry: c.industry,
    businessFunction: c.businessFunction,
    overview: c.overview,
    challenges: c.challenges,
    challenge: c.challenge,
    solution: c.solution,
    benefits: c.benefits,
    results: c.results,
    summary: c.summary,
    uniqueSolution: c.uniqueSolution,
    peBacked: c.peBacked,
    tech: c.tech,
    techTags: c.techTags.map((t) => t.name),
    assetCount: c._count.assets,
    chunkCount: c._count.chunks,
    updatedAt: c.updatedAt.toISOString(),
    updatedByName: c.updatedBy?.name ?? null,
    updatedByEmail: c.updatedBy?.email ?? null,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { caseId } = await params;
    const c = await loadCase(caseId);
    if (!c) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }
    return NextResponse.json({ case: serializeCase(c) });
  } catch (err) {
    console.error('[api/admin/cases/[caseId] GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * Update case fields, sync tech tags, bump updatedAt (invalidates one-pager
 * cache), re-embed CaseChunks for this case.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    const auth = await requireAdminApi();
    if (!auth) return adminUnauthorized();

    const { caseId } = await params;
    const existing = await loadCase(caseId);
    if (!existing) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }

    const body = (await req.json()) as Record<string, unknown>;

    const title =
      body.title !== undefined
        ? String(body.title).trim()
        : existing.title;
    const subtitle =
      body.subtitle !== undefined
        ? String(body.subtitle).trim()
        : existing.subtitle;
    const clientName =
      body.clientName !== undefined
        ? String(body.clientName).trim() || null
        : existing.clientName;
    const industry =
      body.industry !== undefined
        ? String(body.industry).trim()
        : existing.industry;
    const businessFunction =
      body.businessFunction !== undefined
        ? String(body.businessFunction).trim()
        : existing.businessFunction;
    const overview =
      body.overview !== undefined
        ? String(body.overview).trim() || null
        : existing.overview;
    const challenges =
      body.challenges !== undefined
        ? String(body.challenges).trim()
        : existing.challenges;
    const challenge =
      body.challenge !== undefined
        ? String(body.challenge).trim() || null
        : body.challenges !== undefined && !existing.challenge
          ? String(body.challenges).trim() || null
          : existing.challenge;
    const solution =
      body.solution !== undefined
        ? String(body.solution).trim()
        : existing.solution;
    const benefits =
      body.benefits !== undefined
        ? String(body.benefits).trim()
        : existing.benefits;
    const results =
      body.results !== undefined
        ? String(body.results).trim() || null
        : existing.results;
    const summary =
      body.summary !== undefined
        ? String(body.summary).trim() || null
        : existing.summary;
    const uniqueSolution =
      body.uniqueSolution !== undefined
        ? String(body.uniqueSolution).trim() || null
        : existing.uniqueSolution;

    const peParsed = peFromBody(body.peBacked);
    const peBacked =
      peParsed === undefined ? existing.peBacked : peParsed;

    if (!title || !subtitle || !industry || !businessFunction) {
      return NextResponse.json(
        {
          error:
            'title, subtitle, industry, and businessFunction are required.',
        },
        { status: 400 },
      );
    }
    if (!challenges || !solution || !benefits) {
      return NextResponse.json(
        { error: 'challenges, solution, and benefits are required.' },
        { status: 400 },
      );
    }

    const techInput =
      body.tech !== undefined
        ? parseTechInput(body.tech)
        : body.techTags !== undefined
          ? parseTechInput(body.techTags)
          : null;

    await prisma.caseStudy.update({
      where: { id: caseId },
      data: {
        title,
        subtitle,
        clientName,
        industry,
        businessFunction,
        overview,
        challenges,
        challenge,
        solution,
        benefits,
        results,
        summary,
        uniqueSolution,
        peBacked,
        updatedById: auth.admin.id,
        ...(techInput ? { tech: techInput.json } : {}),
      },
    });

    if (techInput) {
      await syncCaseTechTags(caseId, techInput.names);
    }

    const embedResult = await replaceCaseChunks(caseId);

    const refreshed = await loadCase(caseId);
    return NextResponse.json({
      case: refreshed ? serializeCase(refreshed) : null,
      reembedded: {
        chunkCount: embedResult.chunkCount,
        sections: embedResult.sections,
      },
      message: `Saved. Re-embedded ${embedResult.chunkCount} chunk${embedResult.chunkCount === 1 ? '' : 's'}. Case index and one-pager cache follow from updated case data.`,
    });
  } catch (err) {
    console.error('[api/admin/cases/[caseId] PATCH]', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Failed to update case study',
      },
      { status: 500 },
    );
  }
}
