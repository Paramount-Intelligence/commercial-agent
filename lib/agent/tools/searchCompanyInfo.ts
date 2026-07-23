/**
 * Anthropic tool: search_company_info — semantic search over ContentChunk
 * (website prose plus approved knowledge-base/founder-bio sections).
 *
 * NOT case evidence: returns no case IDs, contributes nothing to the
 * [[case:ID]] citation validator (retrievedIds is always empty).
 */
import { prisma } from '../../db';
import { embed } from '../../retrieval/embed';

export type SearchCompanyInfoInput = {
  query: string;
  limit?: number;
};

export type ProjectedCompanyInfo = {
  title: string;
  sourceType: string;
  sourceUrl: string;
  snippet: string;
};

export type SearchCompanyInfoToolResult = {
  modelResult: ProjectedCompanyInfo[];
  sources: string[];
  /** Always empty — company info is not case evidence and is never citable. */
  retrievedIds: string[];
};

export const searchCompanyInfoToolDef = {
  name: 'search_company_info',
  description:
    "Search Paramount's own company information — about the firm, its leadership/founders " +
    '(e.g. Ali Azzam and Marty Kaufman), approved LinkedIn/public profiles, services, industries, ' +
    'positioning, approved professional biographies, and admin-authored company knowledge. ' +
    'Founder employment history is personal background, NOT evidence that Paramount delivered ' +
    'work for that employer, and must never de-anonymize a case. Admin knowledge is company/' +
    'product/process context only — never treat it as a cited case study. Use for questions ' +
    'about WHO Paramount is, how to find Ali or Marty (LinkedIn / company pages), what services ' +
    'it offers, or company background — NOT for specific project evidence (use search_cases for that).',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description:
          'Natural-language question about Paramount as a company (people, services, positioning).',
      },
      limit: {
        type: 'number',
        description: 'Max sections to return (default 5).',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

const SNIPPET_MAX = 900;
const DEFAULT_LIMIT = 5;
const URL_RE = /https?:\/\/[^\s)]+/gi;

function truncateAtWord(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd() + '…';
}

/**
 * Keep approved profile/site URLs visible even when the body is long —
 * append any URLs that truncation would have dropped.
 */
function projectSnippet(content: string, max: number): string {
  const base = truncateAtWord(content, max);
  const allUrls = [...content.matchAll(URL_RE)].map((m) => m[0]);
  if (allUrls.length === 0) return base;
  const missing = allUrls.filter((url) => !base.includes(url));
  if (missing.length === 0) return base;
  return `${base}\nApproved links: ${[...new Set(missing)].join(' | ')}`;
}

export async function runSearchCompanyInfo(
  input: SearchCompanyInfoInput,
): Promise<SearchCompanyInfoToolResult> {
  const query = input.query?.trim();
  if (!query) {
    return { modelResult: [], sources: [], retrievedIds: [] };
  }
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 10));

  const [vec] = await embed([query]);
  const vectorStr = `[${vec.join(',')}]`;

  // pgvector <=> is cosine distance; similarity = 1 - distance (same as searchCases)
  const rows = await prisma.$queryRaw<
    Array<{
      title: string;
      sourceType: string;
      sourceUrl: string;
      heading: string;
      content: string;
      sim: number;
    }>
  >`
    SELECT
      title,
      "sourceType",
      "sourceUrl",
      heading,
      content,
      1 - (embedding <=> CAST(${vectorStr} AS vector)) AS sim
    FROM "ContentChunk"
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> CAST(${vectorStr} AS vector)
    LIMIT ${limit}
  `;

  // LinkedIn / profile asks: force-include chunks that actually contain the URLs
  // so semantic neighbors (bios) don't crowd out the link list.
  const wantsProfiles =
    /linkedin|profile\s*link|toptal\.com|how to (find|reach|contact)|contact (ali|marty)/i.test(
      query,
    );
  let merged = rows;
  if (wantsProfiles) {
    const linkRows = await prisma.contentChunk.findMany({
      where: {
        OR: [
          { content: { contains: 'linkedin.com/in/', mode: 'insensitive' } },
          { heading: { contains: 'LinkedIn', mode: 'insensitive' } },
        ],
      },
      select: {
        title: true,
        sourceType: true,
        sourceUrl: true,
        heading: true,
        content: true,
      },
      take: 3,
    });
    const seen = new Set(rows.map((r) => `${r.sourceUrl}::${r.heading}`));
    const extras = linkRows
      .filter((r) => !seen.has(`${r.sourceUrl}::${r.heading}`))
      .map((r) => ({ ...r, sim: 1 }));
    merged = [...extras, ...rows].slice(0, Math.max(limit, extras.length + 2));
  }

  const modelResult: ProjectedCompanyInfo[] = merged.map((r) => ({
    title: r.heading && r.heading !== r.title ? `${r.title} — ${r.heading}` : r.title,
    sourceType: r.sourceType,
    sourceUrl: r.sourceUrl,
    snippet: projectSnippet(r.content, SNIPPET_MAX),
  }));

  return {
    modelResult,
    sources: [...new Set(modelResult.map((r) => r.sourceUrl))],
    retrievedIds: [],
  };
}
