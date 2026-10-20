/**
 * Retrieval eval: runs EVAL_DIR/golden-questions.yaml against the CURRENT
 * search code (searchCases + search_company_info) on the configured database.
 *
 *   npm run eval:retrieval
 *   npm run eval:retrieval -- --k=5
 *
 * Scoring labels: a case hit is CaseStudy.slug (the seed uses the draft id);
 * a company hit is mapped to one or more draft ids by EVAL_DIR/retrieval-labels.yaml
 * (regex rules over ContentChunk title/heading). "either" counts a hit when
 * the expected id is in the top k of either tool (the model can call both).
 *
 * Query embeddings go through the local cache: one API request on the first
 * run, none after. Latency is therefore search time without the embedding
 * round trip; it is reported separately when measured.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { startEmbeddingCache } from '../scripts/lib/embeddingCache';
import { evalDir } from '../scripts/lib/paths';
import { arg, connect, csvCell, loadGolden, median, percentile, writeReport } from './lib/common';

type LabelRule = { title?: string; heading?: string; sourceType?: string; doc: string | string[] };

const K_MAX = Number(arg('k', '5'));

function loadLabels(): { content: Array<LabelRule & { re: { title?: RegExp; heading?: RegExp } }>; cases: Record<string, string> } {
  const file = join(evalDir(), 'retrieval-labels.yaml');
  if (!existsSync(file)) return { content: [], cases: {} };
  const doc = (parseYaml(readFileSync(file, 'utf8')) ?? {}) as { content?: LabelRule[]; cases?: Record<string, string> };
  return {
    content: (doc.content ?? []).map((r) => ({
      ...r,
      re: {
        title: r.title ? new RegExp(r.title, 'i') : undefined,
        heading: r.heading ? new RegExp(r.heading, 'i') : undefined,
      },
    })),
    cases: doc.cases ?? {},
  };
}

function rankOf(expected: string[], list: string[], k: number): number {
  const i = list.slice(0, k).findIndex((d) => expected.includes(d));
  return i < 0 ? 0 : i + 1;
}

async function main() {
  const golden = loadGolden();
  const labels = loadLabels();
  const { prisma, target } = await connect();
  const cache = await startEmbeddingCache('eval:retrieval');
  const { searchCases } = await import('../lib/retrieval/searchCases');
  const { runSearchCompanyInfo } = await import('../lib/agent/tools/searchCompanyInfo');
  const { normalizeProtectedEntitySpellings } = await import('../lib/agent/srcGrounding');

  try {
    await cache.prefetch([...new Set(golden.flatMap((g) => [g.q, normalizeProtectedEntitySpellings(g.q)]))]);

    const slugById = new Map(
      (await prisma.caseStudy.findMany({ select: { id: true, slug: true } })).map((c) => [c.id, labels.cases[c.slug] ?? c.slug]),
    );
    const contentRows = await prisma.contentChunk.findMany({ select: { id: true, title: true, heading: true, sourceType: true } });
    const docByChunk = new Map(
      contentRows.map((r) => {
        const rule = labels.content.find(
          (l) =>
            (!l.sourceType || l.sourceType === r.sourceType) &&
            (!l.re.title || l.re.title.test(r.title)) &&
            (!l.re.heading || l.re.heading.test(r.heading)),
        );
        const docs = rule ? (Array.isArray(rule.doc) ? rule.doc : [rule.doc]) : [`unlabelled:${r.heading.slice(0, 40)}`];
        return [r.id, docs];
      }),
    );
    const unlabelled = [...new Set([...docByChunk.values()].flat().filter((d) => d.startsWith('unlabelled:')))];

    // Warm-up (connection pool, first query plan) so it does not count as latency.
    await searchCases({ query: golden[0].q, limit: K_MAX });
    await runSearchCompanyInfo({ query: golden[0].q, limit: K_MAX });

    const rows: string[] = ['id,intent,question,expected,cases_top,company_top,rank_cases,rank_company,rank_either,top_case_sim,company_hits,cases_ms,company_ms'];
    const scored: Array<{ intent: string; rc: number; rco: number; re: number }> = [];
    const noMatch: Array<{ id: string; abstained: boolean }> = [];
    const casesMs: number[] = [];
    const companyMs: number[] = [];

    for (const g of golden) {
      let t = performance.now();
      const cases = await searchCases({ query: g.q, limit: K_MAX });
      casesMs.push(performance.now() - t);
      t = performance.now();
      const company = await runSearchCompanyInfo({ query: g.q, limit: K_MAX });
      companyMs.push(performance.now() - t);

      const caseDocs = cases.map((c) => slugById.get(c.id) ?? c.id);
      const companyDocs = [...new Set(company.modelResult.flatMap((r) => docByChunk.get(r.id) ?? [r.id]))];
      const topSim = cases[0]?.simScore ?? 0;

      if (g.expected.length === 0) {
        // Right behaviour: nothing strong. Cases never dead-end, so judge by the case floor (0.45) and empty company hits.
        noMatch.push({ id: g.id, abstained: topSim < 0.45 && company.modelResult.length === 0 });
      }
      const rc = rankOf(g.expected, caseDocs, K_MAX);
      const chunkDocs = company.modelResult.map((r) => docByChunk.get(r.id) ?? [r.id]);
      const ci = chunkDocs.slice(0, K_MAX).findIndex((docs) => docs.some((d) => g.expected.includes(d)));
      const rco = ci < 0 ? 0 : ci + 1;
      const re = rc && rco ? Math.min(rc, rco) : rc || rco;
      if (g.expected.length > 0) scored.push({ intent: g.intent, rc, rco, re });

      rows.push(
        [g.id, g.intent, csvCell(g.q), csvCell(g.expected.join(' ')), csvCell(caseDocs.slice(0, 3).join(' ')), csvCell(companyDocs.slice(0, 3).join(' ')), rc, rco, re, topSim.toFixed(3), company.modelResult.length, Math.round(casesMs.at(-1)!), Math.round(companyMs.at(-1)!)].join(','),
      );
    }

    const hit = (key: 'rc' | 'rco' | 're', k: number, set = scored) => set.filter((s) => s[key] > 0 && s[key] <= k).length / (set.length || 1);
    const mrr = (key: 'rc' | 'rco' | 're', set = scored) => set.reduce((a, s) => a + (s[key] ? 1 / s[key] : 0), 0) / (set.length || 1);
    const f = (n: number) => n.toFixed(3);
    const table = (set: typeof scored) =>
      (['re', 'rc', 'rco'] as const)
        .map((key) => `| ${{ re: 'either tool', rc: 'search_cases', rco: 'search_company_info' }[key]} | ${f(hit(key, 1, set))} | ${f(hit(key, 3, set))} | ${f(hit(key, 5, set))} | ${f(mrr(key, set))} |`)
        .join('\n');
    const intents = [...new Set(scored.map((s) => s.intent))];
    const s = cache.stats();

    const md = [
      `# Retrieval eval (${new Date().toISOString().slice(0, 16)}Z)`,
      '',
      `Database: ${target}. Questions: ${golden.length} (${scored.length} scored, ${noMatch.length} no-match). k up to ${K_MAX}.`,
      `Corpus: ${slugById.size} CaseStudy rows, ${contentRows.length} ContentChunk rows. Unlabelled company sections: ${unlabelled.length}.`,
      `Embeddings: ${s.upstreamCalls} API request(s), ${s.misses} new, ${s.hits} cached.`,
      '',
      '| ranking | hit@1 | hit@3 | hit@5 | MRR |',
      '|---|---|---|---|---|',
      table(scored),
      '',
      '## By intent (either tool)',
      '',
      '| intent | n | hit@1 | hit@3 | MRR |',
      '|---|---|---|---|---|',
      ...intents.map((i) => {
        const set = scored.filter((x) => x.intent === i);
        return `| ${i} | ${set.length} | ${f(hit('re', 1, set))} | ${f(hit('re', 3, set))} | ${f(mrr('re', set))} |`;
      }),
      '',
      `No-match questions answered with nothing strong: ${noMatch.filter((n) => n.abstained).length} of ${noMatch.length} (${noMatch.map((n) => `${n.id} ${n.abstained ? 'ok' : 'returned results'}`).join(', ')}).`,
      '',
      '## Latency per search call (embedding served from cache)',
      '',
      '| tool | median ms | p95 ms |',
      '|---|---|---|',
      `| search_cases | ${Math.round(median(casesMs))} | ${Math.round(percentile(casesMs, 95))} |`,
      `| search_company_info | ${Math.round(median(companyMs))} | ${Math.round(percentile(companyMs, 95))} |`,
      '',
      unlabelled.length ? `Unlabelled sections (add rules to retrieval-labels.yaml): ${unlabelled.map((u) => u.slice(11)).join('; ')}` : '',
    ].join('\n');

    const path = writeReport('retrieval', md, rows.join('\n'));
    console.log(md.split('\n## By intent')[0]);
    console.log(`\nReport: ${path}`);
  } finally {
    await cache.stop();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
