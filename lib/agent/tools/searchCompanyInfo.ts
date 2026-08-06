/**
 * Anthropic tool: search_company_info — semantic search over ContentChunk
 * (website prose plus approved knowledge-base/founder-bio sections).
 *
 * Corpus boundary: returns ContentChunk IDs for the [[src:ID]] grounding gate
 * ONLY. retrievedIds (case namespace) is always empty — never merges into
 * [[case:ID]] validation.
 */
import { prisma } from '../../db';
import { embed } from '../../retrieval/embed';
import {
  companyInfoSimilarityFloor,
  maybeSuppressMetricLinesInSnippet,
  normalizeProtectedEntitySpellings,
  type AttributionClass,
  type RetrievedSrcChunk,
} from '../srcGrounding';

export type SearchCompanyInfoInput = {
  query: string;
  limit?: number;
};

export type ProjectedCompanyInfo = {
  /** ContentChunk id — use ONLY inside [[src:ID]], never as a case citation. */
  id: string;
  /** Exact grounding token; copy verbatim onto specific founder/company claims. */
  citation: string;
  title: string;
  sourceType: string;
  sourceUrl: string;
  snippet: string;
  attributionClass: AttributionClass | null;
  employer: string | null;
};

export type SearchCompanyInfoToolResult = {
  modelResult: ProjectedCompanyInfo[];
  sources: string[];
  /** Always empty — company info never enters the case citation allowlist. */
  retrievedIds: string[];
  /** Src-namespace hits above floor for this call. */
  retrievedSrc: RetrievedSrcChunk[];
  query: string;
  topRelevanceScore: number | null;
};

export const searchCompanyInfoToolDef = {
  name: 'search_company_info',
  description:
    "Search Paramount's own company information — about the firm, its leadership/founders " +
    '(e.g. Ali Azzam and Marty Kaufman), approved LinkedIn/public profiles, services, industries, ' +
    'positioning, approved professional biographies, and admin-authored company knowledge. ' +
    'ONLY call this when the person asks about who Paramount is, how to find Ali or Marty, services, ' +
    'or other company facts you need to look up. Do NOT call for greetings, small talk, thanks, or ' +
    'general conversation. ' +
    'CRITICAL: every SPECIFIC factual claim about a founder or the company (named role, title, ' +
    'employer, tenure/dates, founding status, or metric) MUST be tagged with the exact `citation` ' +
    'value (`[[src:CHUNK_ID]]`) from a result in THIS turn. General non-specific characterization ' +
    'needs no token. Never put a case ID inside [[src:…]] and never put a src ID inside [[case:…]]. ' +
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

const ATTRIBUTION_VALUES = new Set<string>([
  'paramount-positioning',
  'paramount-delivery-outcome',
  'ali-personal-contract',
  'ali-prior-employment',
]);

function asAttributionClass(raw: string | null | undefined): AttributionClass | null {
  if (!raw) return null;
  return ATTRIBUTION_VALUES.has(raw) ? (raw as AttributionClass) : null;
}

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

type RawRow = {
  id: string;
  title: string;
  sourceType: string;
  sourceUrl: string;
  heading: string;
  content: string;
  attributionClass: string | null;
  employer: string | null;
  startDate: string | null;
  endDate: string | null;
  sim: number;
};

function toRetrieved(row: RawRow): RetrievedSrcChunk {
  return {
    id: row.id,
    sim: row.sim,
    attributionClass: asAttributionClass(row.attributionClass),
    employer: row.employer,
    startDate: row.startDate,
    endDate: row.endDate,
    sourceType: row.sourceType,
    heading: row.heading,
    content: row.content,
  };
}

function projectRow(row: RawRow): ProjectedCompanyInfo {
  const suppressed = maybeSuppressMetricLinesInSnippet(row.content, row.employer);
  return {
    id: row.id,
    citation: `[[src:${row.id}]]`,
    title:
      row.heading && row.heading !== row.title
        ? `${row.title} — ${row.heading}`
        : row.title,
    sourceType: row.sourceType,
    sourceUrl: row.sourceUrl,
    snippet: projectSnippet(suppressed, SNIPPET_MAX),
    attributionClass: asAttributionClass(row.attributionClass),
    employer: row.employer,
  };
}

export async function runSearchCompanyInfo(
  input: SearchCompanyInfoInput,
): Promise<SearchCompanyInfoToolResult> {
  const rawQuery = input.query?.trim();
  if (!rawQuery) {
    return {
      modelResult: [],
      sources: [],
      retrievedIds: [],
      retrievedSrc: [],
      query: '',
      topRelevanceScore: null,
    };
  }
  // Canonicalize STT misspellings (Vaikea/Baikeya → Bykea) before embedding.
  const query = normalizeProtectedEntitySpellings(rawQuery);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 10));
  const floor = companyInfoSimilarityFloor();

  const [vec] = await embed([query]);
  const vectorStr = `[${vec.join(',')}]`;

  // Quarantine: founder-bio without attributionClass is excluded until re-ingest.
  // Other sourceTypes without a class still surface (legacy website rows) as
  // paramount-positioning-equivalent at the gate (null class = assertable general).
  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      id,
      title,
      "sourceType",
      "sourceUrl",
      heading,
      content,
      "attributionClass"::text AS "attributionClass",
      employer,
      "startDate",
      "endDate",
      1 - (embedding <=> CAST(${vectorStr} AS vector)) AS sim
    FROM "ContentChunk"
    WHERE embedding IS NOT NULL
      AND NOT (
        "sourceType" = 'founder-bio'
        AND "attributionClass" IS NULL
      )
    ORDER BY embedding <=> CAST(${vectorStr} AS vector)
    LIMIT ${Math.max(limit * 3, 15)}
  `;

  const aboveFloor = rows.filter((r) => Number(r.sim) >= floor);

  // LinkedIn / profile asks: force-include chunks that actually contain the URLs
  // when their real cosine similarity clears the same floor.
  const wantsProfiles =
    /linkedin|profile\s*link|toptal\.com|how to (find|reach|contact)|contact (ali|marty)/i.test(
      query,
    );
  let merged = aboveFloor.slice(0, limit);
  if (wantsProfiles) {
    const linkRows = await prisma.$queryRaw<RawRow[]>`
      SELECT
        id,
        title,
        "sourceType",
        "sourceUrl",
        heading,
        content,
        "attributionClass"::text AS "attributionClass",
        employer,
        "startDate",
        "endDate",
        1 - (embedding <=> CAST(${vectorStr} AS vector)) AS sim
      FROM "ContentChunk"
      WHERE embedding IS NOT NULL
        AND NOT (
          "sourceType" = 'founder-bio'
          AND "attributionClass" IS NULL
        )
        AND (
          content ILIKE '%linkedin.com/in/%'
          OR heading ILIKE '%LinkedIn%'
        )
      ORDER BY embedding <=> CAST(${vectorStr} AS vector)
      LIMIT 5
    `;
    const seen = new Set(merged.map((r) => r.id));
    const extras = linkRows.filter(
      (r) => Number(r.sim) >= floor && !seen.has(r.id),
    );
    merged = [...extras, ...merged].slice(0, Math.max(limit, extras.length + 2));
  }

  // Bykea (incl. STT misspellings rewritten above): force-include tagged employer rows
  // so a weak embedding match cannot empty the allowlist.
  if (/\bbykea\b/i.test(query)) {
    const bykeaRows = await prisma.$queryRaw<RawRow[]>`
      SELECT
        id,
        title,
        "sourceType",
        "sourceUrl",
        heading,
        content,
        "attributionClass"::text AS "attributionClass",
        employer,
        "startDate",
        "endDate",
        1 - (embedding <=> CAST(${vectorStr} AS vector)) AS sim
      FROM "ContentChunk"
      WHERE embedding IS NOT NULL
        AND NOT (
          "sourceType" = 'founder-bio'
          AND "attributionClass" IS NULL
        )
        AND (
          employer ILIKE '%Bykea%'
          OR content ILIKE '%Bykea%'
          OR heading ILIKE '%Bykea%'
        )
      ORDER BY embedding <=> CAST(${vectorStr} AS vector)
      LIMIT 5
    `;
    const seen = new Set(merged.map((r) => r.id));
    const extras = bykeaRows.filter(
      (r) => Number(r.sim) >= floor * 0.85 && !seen.has(r.id),
    );
    merged = [...extras, ...merged].slice(0, Math.max(limit, extras.length + 2));
  }

  // Normalize numeric sim from Prisma decimal/string
  const normalized = merged.map((r) => ({
    ...r,
    sim: Number(r.sim),
  }));

  const retrievedSrc = normalized.map(toRetrieved);
  const modelResult = normalized.map(projectRow);
  const topRelevanceScore =
    retrievedSrc.length > 0
      ? Math.max(...retrievedSrc.map((r) => r.sim))
      : null;

  return {
    modelResult,
    sources: [...new Set(modelResult.map((r) => r.sourceUrl))],
    retrievedIds: [],
    retrievedSrc,
    query,
    topRelevanceScore,
  };
}
