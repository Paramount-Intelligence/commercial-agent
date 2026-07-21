/**
 * Hybrid case retrieval: structured tech/PE filters + pgvector semantic ranking.
 *
 * Raw SQL only lives here for CaseChunk.embedding (Unsupported → $queryRaw).
 * Cosine: pgvector `<=>` is cosine *distance*; similarity = 1 - distance
 * (matches OpenAI unit-ish vectors written via CAST(... AS vector) in chunk-and-embed).
 *
 * Default RANKED ("adviser, not boolean box"): partial tech matches still surface.
 * Hard filters only when techMatch:'all' or peMatch:'required'.
 */
import { prisma } from '../db';
import { embed } from './embed';

/** Pure-semantic only; below this = off-topic noise (tuned on real data). */
const SEMANTIC_SIM_FLOOR = 0.45;

export type SearchCasesInput = {
  /** Natural-language; drives semantic ranking via CaseChunk embeddings. */
  query?: string;
  /** Tech strings; canonicalized via TechAlias before matching CaseTech. */
  techs?: string[];
  /** default 'any' — score only; 'all' hard-filters to cases with every tech. */
  techMatch?: 'any' | 'all';
  /** default 'preferred' — PE boosts score; 'required' keeps only peBacked === true. */
  peMatch?: 'required' | 'preferred';
  /** default 10 */
  limit?: number;
};

export type RankedCase = {
  id: string;
  title: string;
  matchedTechs: string[];
  peBacked: boolean | null;
  /** techScore + (peScore if matchedTechs) + 0.4 * simScore */
  score: number;
  /** 1.0 * count of query canonical techs present on the case */
  techScore: number;
  /** 0.5 if peBacked === true, else 0 (null treated as not PE) */
  peScore: number;
  /** Best-chunk cosine similarity in [0, 1] (raw; weight 0.4 applied in score) */
  simScore: number;
};

/**
 * Resolve input tech strings → CaseTech canonical names via TechAlias.
 * Unknown aliases contribute nothing (skipped, no error).
 * Already-canonical names (present on CaseTech / as a TechAlias.canonical) pass through.
 */
async function canonicalizeTechs(raw: string[]): Promise<string[]> {
  if (raw.length === 0) return [];

  const [aliases, distinctTags] = await Promise.all([
    prisma.techAlias.findMany({ select: { alias: true, canonical: true } }),
    prisma.caseTech.findMany({ distinct: ['name'], select: { name: true } }),
  ]);

  const byAlias = new Map(aliases.map((a) => [a.alias.toLowerCase(), a.canonical]));
  const byCanonicalLower = new Map<string, string>();
  for (const t of distinctTags) byCanonicalLower.set(t.name.toLowerCase(), t.name);
  for (const a of aliases) byCanonicalLower.set(a.canonical.toLowerCase(), a.canonical);

  const out: string[] = [];
  for (const t of raw) {
    const key = t.trim().toLowerCase();
    if (!key) continue;
    const fromAlias = byAlias.get(key);
    if (fromAlias) {
      out.push(fromAlias);
      continue;
    }
    const already = byCanonicalLower.get(key);
    if (already) {
      out.push(already);
      continue;
    }
    // unknown → contribute 0
  }
  return [...new Set(out)];
}

/**
 * Per-case MAX cosine similarity vs query embedding.
 * Uses <=> (cosine distance); similarity = 1 - distance.
 */
async function bestChunkSimilarityByCase(
  queryEmbedding: number[],
): Promise<Map<string, number>> {
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  const rows = await prisma.$queryRaw<Array<{ caseId: string; sim: number }>>`
    SELECT
      "caseId",
      MAX(1 - (embedding <=> CAST(${vectorStr} AS vector))) AS sim
    FROM "CaseChunk"
    WHERE embedding IS NOT NULL
    GROUP BY "caseId"
  `;

  const map = new Map<string, number>();
  for (const r of rows) {
    const sim = Number(r.sim);
    map.set(r.caseId, Number.isFinite(sim) ? Math.max(0, Math.min(1, sim)) : 0);
  }
  return map;
}

export async function searchCases(input: SearchCasesInput): Promise<RankedCase[]> {
  const techMatch = input.techMatch ?? 'any';
  const peMatch = input.peMatch ?? 'preferred';
  const limit = input.limit ?? 10;
  const query = input.query?.trim() || undefined;

  const canonicalTechs = await canonicalizeTechs(input.techs ?? []);

  // Semantic: one embed() call, then best-chunk sim per case via $queryRaw
  let simByCase = new Map<string, number>();
  if (query) {
    const [vec] = await embed([query]);
    if (vec) simByCase = await bestChunkSimilarityByCase(vec);
  }

  const cases = await prisma.caseStudy.findMany({
    select: {
      id: true,
      title: true,
      peBacked: true,
      createdAt: true,
      techTags: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const ranked: RankedCase[] = [];

  for (const c of cases) {
    // peMatch:'required' → only peBacked === true (null and false both drop)
    if (peMatch === 'required' && c.peBacked !== true) continue;

    const tagSet = new Set(c.techTags.map((t) => t.name));
    const matchedTechs = canonicalTechs.filter((t) => tagSet.has(t));

    // techMatch:'all' → must have every requested canonical tech
    if (techMatch === 'all' && canonicalTechs.length > 0) {
      if (matchedTechs.length < canonicalTechs.length) continue;
    }
    // techMatch:'any' / preferred PE: no hard tech filter — 0-tech + strong sim still ranks

    const techScore = matchedTechs.length; // 1.0 * count
    const peScore = c.peBacked === true ? 0.5 : 0; // null → 0; always reported
    const simScore = simByCase.get(c.id) ?? 0;
    // PE boost in score only when tech matches exist; pure-semantic uses PE as sort tiebreak only
    const score =
      matchedTechs.length > 0
        ? techScore + peScore + 0.4 * simScore
        : techScore + 0.4 * simScore;

    ranked.push({
      id: c.id,
      title: c.title,
      matchedTechs,
      peBacked: c.peBacked,
      score,
      techScore,
      peScore,
      simScore,
    });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.simScore !== a.simScore) return b.simScore - a.simScore;
    // PE tiebreak only — never overrides a higher sim
    const aPe = a.peBacked === true ? 1 : 0;
    const bPe = b.peBacked === true ? 1 : 0;
    return bPe - aPe;
  });

  // Pure-semantic floor: no resolved techs + a query present. Tech modes skip this entirely.
  const pureSemantic = Boolean(query) && canonicalTechs.length === 0;
  if (pureSemantic) {
    const aboveFloor = ranked.filter((r) => r.simScore >= SEMANTIC_SIM_FLOOR);
    if (aboveFloor.length >= 3) {
      return aboveFloor.slice(0, limit);
    }
    // Never-dead-end: ignore floor, show closest 3 by sim
    return [...ranked]
      .sort((a, b) => b.simScore - a.simScore)
      .slice(0, Math.min(3, ranked.length));
  }

  return ranked.slice(0, limit);
}
