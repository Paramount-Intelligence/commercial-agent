/**
 * Anthropic tool: search_company_info — semantic search over ContentChunk
 * (ingested website prose: about, services, industries, candidates, faq, home).
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
    '(e.g. Ali Azzam, CEO), services, industries served, and general positioning. ' +
    'Use for questions about WHO Paramount is, what services it offers, or company background — ' +
    'NOT for specific project evidence (use search_cases for that).',
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

const SNIPPET_MAX = 300;
const DEFAULT_LIMIT = 5;

function truncateAtWord(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd() + '…';
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

  const modelResult: ProjectedCompanyInfo[] = rows.map((r) => ({
    title: r.heading && r.heading !== r.title ? `${r.title} — ${r.heading}` : r.title,
    sourceType: r.sourceType,
    sourceUrl: r.sourceUrl,
    snippet: truncateAtWord(r.content, SNIPPET_MAX),
  }));

  return {
    modelResult,
    sources: [...new Set(modelResult.map((r) => r.sourceUrl))],
    retrievedIds: [],
  };
}
