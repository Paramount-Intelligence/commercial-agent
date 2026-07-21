/**
 * Anthropic tool: search_cases — wraps lib/retrieval/searchCases and projects
 * RankedCase → model-facing fields (no score telemetry).
 */
import { prisma } from '../../db';
import {
  searchCases,
  type SearchCasesInput,
} from '../../retrieval/searchCases';

const SITE_BASE = 'https://www.paramountintelligence.co';

export type ProjectedCase = {
  id: string;
  title: string;
  matchedTechs: string[];
  peBacked: boolean | null;
  summary: string;
  /** Public case-study page URL when slug is present; omitted if slug empty. */
  url?: string;
};

export type SearchCasesToolResult = {
  modelResult: ProjectedCase[];
  retrievedIds: string[];
};

/** Anthropic tool definition (name + description + JSON Schema input). */
export const searchCasesToolDef = {
  name: 'search_cases',
  description:
    'Find real Paramount Intelligence case studies by tech tags and/or a natural-language semantic query. ' +
    'Returns cases you may cite in your reply. ' +
    'CRITICAL: the `id` field on each returned case is the ONLY valid source for a [[case:ID]] citation. ' +
    'Never cite a case ID you did not receive from this tool in this conversation. ' +
    'Call this before making any specific claim about Paramount\'s past work.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description:
          'Natural-language problem or need (e.g. "reduce customer support costs"). ' +
          'Drives semantic ranking. Use alone or together with techs.',
      },
      techs: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Technology names to match (e.g. ["n8n","AWS"]). Canonicalized via aliases before matching.',
      },
      techMatch: {
        type: 'string',
        enum: ['any', 'all'],
        description:
          'How to combine techs. Use "all" ONLY when the user explicitly requires every listed tech ' +
          '(e.g. "both n8n and AWS", "must have all"). Otherwise use "any" (default) so partial matches still surface.',
      },
      peMatch: {
        type: 'string',
        enum: ['required', 'preferred'],
        description:
          'PE-backed filter vs boost. Use "required" ONLY when the user explicitly demands PE-backed experience. ' +
          'Otherwise use "preferred" (default) — PE boosts ranking but does not exclude non-PE cases.',
      },
      limit: {
        type: 'number',
        description: 'Max cases to return (default 10).',
      },
    },
    additionalProperties: false,
  },
};

const SUMMARY_MAX = 300;

function truncateAtWord(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd() + '…';
}

function summaryFor(title: string, overview: string | null | undefined): string {
  const raw = overview?.trim();
  if (!raw || /^(n\/a|na|-)$/i.test(raw)) {
    return `${title} (summary unavailable — offer to connect the team for detail)`;
  }
  return truncateAtWord(raw, SUMMARY_MAX);
}

export async function runSearchCases(
  input: SearchCasesInput,
): Promise<SearchCasesToolResult> {
  const ranked = await searchCases(input);
  const ids = ranked.map((r) => r.id);

  const extras =
    ids.length === 0
      ? []
      : await prisma.caseStudy.findMany({
          where: { id: { in: ids } },
          select: { id: true, overview: true, slug: true },
        });

  const extraById = new Map(extras.map((o) => [o.id, o]));

  const modelResult: ProjectedCase[] = ranked.map((r) => {
    const extra = extraById.get(r.id);
    const slug = extra?.slug?.trim();
    const projected: ProjectedCase = {
      id: r.id,
      title: r.title,
      matchedTechs: r.matchedTechs,
      peBacked: r.peBacked,
      summary: summaryFor(r.title, extra?.overview),
    };
    if (slug) {
      projected.url = `${SITE_BASE}/case-studies/${slug}`;
    }
    return projected;
  });

  return {
    modelResult,
    retrievedIds: modelResult.map((c) => c.id),
  };
}
