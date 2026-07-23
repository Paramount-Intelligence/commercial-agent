/**
 * Anthropic tool: generate_case_onepager — serve an uploaded ONE_PAGER, a fresh
 * generated cache, or generate + cache a branded PDF/PNG.
 *
 * Anti-fabrication: caseId MUST be in the conversation's retrievedIds set
 * (cases actually returned by search_cases in this conversation).
 *
 * Three-tier lookup (caseId + format):
 *  1. Admin-uploaded ONE_PAGER (generated=false) → source:'uploaded'
 *  2. Cached generated row still fresh vs case.updatedAt → source:'generated-cached'
 *  3. Else generate, upsert cache row, delete stale blob → source:'generated'
 */
import { prisma } from '../../db';
import { mapCaseToOnepager } from '../../docgen/mapCaseToOnepager';
import { buildOnepagerHtml } from '../../docgen/onepagerTemplate';
import { renderHtmlToPdf, renderHtmlToPng } from '../../docgen/render';
import { assetExists, uploadGeneratedOnepager } from '../../storage/blob';

export type GenerateOnepagerInput = {
  caseId: string;
  format?: 'pdf' | 'png';
};

export type OnepagerSource =
  | 'uploaded'
  | 'generated'
  | 'generated-cached'
  | 'knowledge-share';

export type OnepagerAttachment = {
  /** Case study id for one-pagers; omit for knowledge-share docs. */
  caseId?: string;
  /** Stable identity for one document slot; URL may change after regeneration. */
  documentId: string;
  url: string;
  filename: string;
  /** Display title (case title or knowledge shareLabel). */
  caseTitle: string;
  source: OnepagerSource;
  format: 'pdf' | 'png' | 'docx';
};

export type GenerateOnepagerModelResult =
  | {
      ok: true;
      url: string;
      filename: string;
      source: OnepagerSource;
      format: 'pdf' | 'png';
      caseId: string;
      documentId: string;
      caseTitle: string;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

export type GenerateOnepagerToolResult = {
  modelResult: GenerateOnepagerModelResult;
  /** Never adds citation IDs — case must already be in retrievedIds. */
  retrievedIds: string[];
  attachment?: OnepagerAttachment;
};

export const generateCaseOnepagerToolDef = {
  name: 'generate_case_onepager',
  description:
    'Generate or retrieve a branded one-pager (PDF/PNG) for a SPECIFIC Paramount case ' +
    'study already retrieved in this conversation. Only call this once you are CERTAIN which case ' +
    'the user means. If the user\'s request is ambiguous about which case, do NOT call this tool yet ' +
    '— first ask the user to confirm the specific case by name, and call the tool only after they ' +
    'confirm.',
  input_schema: {
    type: 'object' as const,
    properties: {
      caseId: {
        type: 'string',
        description:
          'The case study id from a prior search_cases result in this conversation.',
      },
      format: {
        type: 'string',
        enum: ['pdf', 'png'],
        description: 'Output format. Default pdf.',
      },
    },
    required: ['caseId'],
    additionalProperties: false,
  },
};

function mimeForFormat(format: 'pdf' | 'png'): string {
  return format === 'png' ? 'image/png' : 'application/pdf';
}

function formatFromMime(mime: string | null | undefined): 'pdf' | 'png' {
  if (mime === 'image/png') return 'png';
  return 'pdf';
}

function okResult(
  attachment: OnepagerAttachment & {
    caseId: string;
    format: 'pdf' | 'png';
  },
  message: string,
): GenerateOnepagerToolResult {
  return {
    modelResult: {
      ok: true,
      url: attachment.url,
      filename: attachment.filename,
      source: attachment.source,
      format: attachment.format,
      caseId: attachment.caseId,
      documentId: attachment.documentId,
      caseTitle: attachment.caseTitle,
      message,
    },
    retrievedIds: [],
    attachment,
  };
}

/**
 * Serve uploaded / cached / freshly generated one-pager.
 * @param retrievedIds — conversation set of case IDs from search_cases (required guard).
 */
export async function runGenerateOnepager(
  input: GenerateOnepagerInput,
  retrievedIds: ReadonlySet<string>,
): Promise<GenerateOnepagerToolResult> {
  const caseId = typeof input.caseId === 'string' ? input.caseId.trim() : '';
  const format: 'pdf' | 'png' = input.format === 'png' ? 'png' : 'pdf';
  const mime = mimeForFormat(format);

  if (!caseId) {
    return {
      modelResult: { ok: false, error: 'caseId is required' },
      retrievedIds: [],
    };
  }

  if (!retrievedIds.has(caseId)) {
    return {
      modelResult: {
        ok: false,
        error:
          'caseId was not retrieved in this conversation. Call search_cases first to surface the case, then retry generate_case_onepager with that id. Do not invent or guess case ids.',
      },
      retrievedIds: [],
    };
  }

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
      updatedAt: true,
    },
  });

  if (!c) {
    return {
      modelResult: {
        ok: false,
        error: 'Case not found. Surface a real case with search_cases and retry.',
      },
      retrievedIds: [],
    };
  }

  // ——— Tier 1: admin-uploaded official ONE_PAGER (never generated) ———
  const uploaded = await prisma.caseAsset.findFirst({
    where: { caseId, kind: 'ONE_PAGER', generated: false },
    orderBy: [{ verified: 'desc' }, { uploadedAt: 'desc' }],
    select: {
      uri: true,
      originalFilename: true,
      mimeType: true,
    },
  });

  if (uploaded?.uri) {
    const servedFormat = formatFromMime(uploaded.mimeType);
    const filename =
      uploaded.originalFilename?.trim() ||
      `${c.slug || 'case'}-onepager.${servedFormat}`;
    return okResult(
      {
        caseId: c.id,
        documentId: `${c.id}:${servedFormat}`,
        url: uploaded.uri,
        filename,
        caseTitle: c.title,
        source: 'uploaded',
        format: servedFormat,
      },
      'Official uploaded one-pager found. Share the download with the user — do not invent alternate links. A download card is shown in the UI.',
    );
  }

  // ——— Tier 2: fresh generated cache for this case + format ———
  const cached = await prisma.caseAsset.findFirst({
    where: {
      caseId,
      kind: 'ONE_PAGER',
      generated: true,
      mimeType: mime,
    },
    orderBy: { uploadedAt: 'desc' },
    select: {
      id: true,
      uri: true,
      originalFilename: true,
      sourceUpdatedAt: true,
    },
  });

  const cacheFreshByMetadata =
    cached?.uri &&
    cached.sourceUpdatedAt != null &&
    cached.sourceUpdatedAt.getTime() >= c.updatedAt.getTime();
  const cacheFresh =
    Boolean(cacheFreshByMetadata && cached?.uri) &&
    (await assetExists(cached!.uri));

  if (cacheFresh && cached) {
    const filename =
      cached.originalFilename?.trim() ||
      `${c.slug || 'case'}-onepager.${format}`;
    return okResult(
      {
        caseId: c.id,
        documentId: `${c.id}:${format}`,
        url: cached.uri,
        filename,
        caseTitle: c.title,
        source: 'generated-cached',
        format,
      },
      'Cached one-pager served (case unchanged since generation). A download card is shown in the UI.',
    );
  }

  // ——— Tier 3: generate, upload, upsert cache (replace stale) ———
  const content = mapCaseToOnepager(c);
  const html = buildOnepagerHtml(content);
  const buffer =
    format === 'png' ? await renderHtmlToPng(html) : await renderHtmlToPdf(html);

  const filename = `${c.slug || caseId}-onepager.${format}`;
  const { url } = await uploadGeneratedOnepager(buffer, caseId, format);

  // Remove stale cache rows, but retain their files/blobs: attachment URLs are
  // persisted in historical Messages and must not be invalidated.
  const stale = await prisma.caseAsset.findMany({
    where: {
      caseId,
      kind: 'ONE_PAGER',
      generated: true,
      mimeType: mime,
    },
    select: { id: true, uri: true },
  });
  for (const row of stale) {
    await prisma.caseAsset.delete({ where: { id: row.id } }).catch(() => {});
  }

  await prisma.caseAsset.create({
    data: {
      caseId,
      kind: 'ONE_PAGER',
      uri: url,
      generated: true,
      verified: false,
      sourceUpdatedAt: c.updatedAt,
      originalFilename: filename,
      mimeType: mime,
    },
  });

  return okResult(
    {
      caseId: c.id,
      documentId: `${c.id}:${format}`,
      url,
      filename,
      caseTitle: c.title,
      source: 'generated',
      format,
    },
    'One-pager generated and cached. Tell the user it is ready — a download card is shown in the UI. Do not paste the raw URL as the primary CTA.',
  );
}
