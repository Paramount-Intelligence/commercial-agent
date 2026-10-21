/**
 * Retrieval eval over approved knowledge (KNOWLEDGE_SOURCE=approved), called
 * from evals/retrieval.ts. Labels are KnowledgeDoc ids (= draft ids), so no
 * label map is needed. Questions whose expected docs are all on hold are left
 * out. Embeddings go through the local cache: a question embedded before costs
 * nothing, and the embedding time measured on a cache miss is the real API
 * round trip.
 *
 * Two scores: "retrieval" ranks only what the vector query returns;
 * "in context" also counts the core documents, which are in the cached system
 * prompt on every turn whatever retrieval returns.
 */
import { csvCell, median, percentile, writeReport, type GoldenQuestion } from './lib/common';

export const PHASE0_BASELINE_HIT3 = 0.595;

export async function approvedRetrievalEval(golden: GoldenQuestion[], held: Set<string>, target: string, k: number): Promise<void> {
  const { retrieveApproved } = await import('../lib/knowledge/approved/retrieve');
  const { normaliseQuery } = await import('../lib/retrieval/queryEmbedding');
  const { normalizeProtectedEntitySpellings } = await import('../lib/agent/srcGrounding');
  const { prisma } = await import('../lib/db');
  const { CORE_DOC_TYPES } = await import('../lib/knowledge/approved/catalog');

  const questions = golden.filter((g) => g.expected.length === 0 || g.expected.some((d) => !held.has(d)));
  const excluded = golden.length - questions.length;
  const docs = await prisma.knowledgeDoc.count({ where: { status: { notIn: ['retired', 'hold'] } } });
  const chunks = await prisma.knowledgeChunk.count();
  const coreIds = new Set(
    (await prisma.knowledgeDoc.findMany({ where: { status: { notIn: ['retired', 'hold'] }, type: { in: [...CORE_DOC_TYPES] } }, select: { id: true } })).map((d) => d.id),
  );

  await retrieveApproved(questions[0].q); // warm-up (pool, plan); not counted

  const rows = ['id,intent,question,expected,top3,rank,top_sim,chunks,embed_ms,sql_ms,total_ms,embed_cached'];
  const scored: Array<{ intent: string; rank: number; inCore: boolean }> = [];
  const noMatch: Array<{ id: string; returned: number; topSim: number }> = [];
  const totalMs: number[] = [];
  const sqlMs: number[] = [];
  const missEmbedMs: number[] = [];
  for (const g of questions) {
    const t0 = performance.now();
    const r = await retrieveApproved(g.q);
    const ms = performance.now() - t0;
    totalMs.push(ms);
    sqlMs.push(r.sqlMs);
    if (!r.cached) missEmbedMs.push(r.embedMs);
    const expected = g.expected.filter((d) => !held.has(d));
    const i = r.rankedDocIds.slice(0, k).findIndex((d) => expected.includes(d));
    const rank = i < 0 ? 0 : i + 1;
    const topSim = r.chunks[0]?.sim ?? 0;
    if (expected.length) scored.push({ intent: g.intent, rank, inCore: expected.some((d) => coreIds.has(d)) });
    else noMatch.push({ id: g.id, returned: r.chunks.length, topSim });
    rows.push(
      [g.id, g.intent, csvCell(g.q), csvCell(expected.join(' ')), csvCell(r.rankedDocIds.slice(0, 3).join(' ')), rank, topSim.toFixed(3), r.chunks.length, r.embedMs, r.sqlMs, Math.round(ms), r.cached].join(','),
    );
  }

  const hit = (n: number, set = scored) => set.filter((s) => s.rank > 0 && s.rank <= n).length / (set.length || 1);
  const hitCtx = (n: number, set = scored) => set.filter((s) => s.inCore || (s.rank > 0 && s.rank <= n)).length / (set.length || 1);
  const mrr = (set = scored) => set.reduce((a, s) => a + (s.rank ? 1 / s.rank : 0), 0) / (set.length || 1);
  const f = (n: number) => n.toFixed(3);
  const intents = [...new Set(scored.map((s) => s.intent))];
  const misses = scored.filter((s) => s.rank === 0 || s.rank > 3).length;
  const md = [
    `# Retrieval eval, approved knowledge (${new Date().toISOString().slice(0, 16)}Z)`,
    '',
    `Database: ${target}. KnowledgeDoc: ${docs} active docs, ${chunks} chunks. Questions: ${questions.length} (${scored.length} scored, ${noMatch.length} no-match; ${excluded} excluded because their only expected docs are on hold). k up to ${k}. Distinct query texts: ${new Set(questions.map((g) => normaliseQuery(normalizeProtectedEntitySpellings(g.q)))).size}.`,
    '',
    '| ranking | hit@1 | hit@3 | hit@5 | MRR |',
    '|---|---|---|---|---|',
    `| approved: retrieval | ${f(hit(1))} | ${f(hit(3))} | ${f(hit(5))} | ${f(mrr())} |`,
    `| approved: in context (core docs always present) | ${f(hitCtx(1))} | ${f(hitCtx(3))} | ${f(hitCtx(5))} | |`,
    `| Phase 0 baseline (legacy) | | ${f(PHASE0_BASELINE_HIT3)} | | |`,
    '',
    `hit@3 ≥ 0.95: retrieval ${hit(3) >= 0.95 ? 'yes' : 'no'}, in context ${hitCtx(3) >= 0.95 ? 'yes' : 'no'}. Questions outside the retrieval top 3: ${misses} (${scored.filter((s) => s.rank === 0 || s.rank > 3).filter((s) => s.inCore).length} of them expect a core document).`,
    '',
    '## By intent',
    '',
    '| intent | n | hit@1 | hit@3 | MRR |',
    '|---|---|---|---|---|',
    ...intents.map((i) => {
      const set = scored.filter((x) => x.intent === i);
      return `| ${i} | ${set.length} | ${f(hit(1, set))} | ${f(hit(3, set))} | ${f(mrr(set))} |`;
    }),
    '',
    `No-match questions: ${noMatch.map((n) => `${n.id} returned ${n.returned} chunk(s), top similarity ${n.topSim.toFixed(3)}`).join('; ')}.`,
    '',
    '## Latency (embedding + vector SQL, from this machine)',
    '',
    '| measure | n | median ms | p95 ms |',
    '|---|---|---|---|',
    `| retrieval total | ${totalMs.length} | ${Math.round(median(totalMs))} | ${Math.round(percentile(totalMs, 95))} |`,
    `| vector SQL | ${sqlMs.length} | ${Math.round(median(sqlMs))} | ${Math.round(percentile(sqlMs, 95))} |`,
    missEmbedMs.length
      ? `| query embedding (not in memory: local file cache, or the API for a new text) | ${missEmbedMs.length} | ${Math.round(median(missEmbedMs))} | ${Math.round(percentile(missEmbedMs, 95))} |`
      : '| query embedding (not in memory) | 0 | | |',
    '',
    'Retrieval total includes the query embedding. It is a real API round trip only for texts the local embedding cache has not seen (the ledger shows those calls); otherwise it is a local cache read.',
  ].join('\n');
  const path = writeReport('retrieval-approved', md, rows.join('\n'));
  console.log(md.split('\n## By intent')[0]);
  console.log(`\nReport: ${path}`);
}
