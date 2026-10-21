/**
 * Write the private knowledge bundle (docs, chunks, embeddings) for loading a
 * deployment through POST /api/admin/knowledge/import. Reads only the
 * Knowledge folder and the embedding cache; touches no database.
 *
 *   npm run knowledge:bundle                      → KNOWLEDGE_DIR/bundles/knowledge-bundle-<date>.json
 *   npm run knowledge:bundle -- --out=<path>      (must be outside the repo)
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import { buildChunks, embeddingText } from '../lib/knowledge/approved/chunk';
import { encodeVector, makeBundle } from '../lib/knowledge/approved/bundle';
import { embed } from '../lib/retrieval/embed';
import { startEmbeddingCache } from './lib/embeddingCache';
import { describePlan, readKnowledgePlan } from './lib/knowledgeFiles';
import { knowledgeDir, REPO_ROOT } from './lib/paths';

async function main() {
  const outArg = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1];
  const out = resolve(outArg ?? join(knowledgeDir(), 'bundles', `knowledge-bundle-${new Date().toISOString().slice(0, 10)}.json`));
  const rel = relative(REPO_ROOT, out);
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('The bundle must be written outside the repo.');

  const plan = readKnowledgePlan();
  console.log(describePlan(plan));
  if (plan.refused.length) throw new Error('Some drafts were refused; no bundle written.');

  const cache = await startEmbeddingCache('knowledge:bundle');
  try {
    const docs = [];
    for (const doc of plan.docs) {
      const chunks = buildChunks(doc);
      const texts = chunks.map(embeddingText);
      await cache.prefetch(texts);
      const vectors = await embed(texts);
      docs.push({ ...doc, chunks: chunks.map((c, i) => ({ ordinal: c.ordinal, embedding: encodeVector(vectors[i]) })) });
    }
    const bundle = makeBundle({ confidentialNames: plan.confidentialNames, formerEmployers: plan.formerEmployers, docs });
    mkdirSync(dirname(out), { recursive: true });
    const json = JSON.stringify(bundle);
    writeFileSync(out, json);
    console.log(`bundle: ${docs.length} docs, ${docs.reduce((n, d) => n + d.chunks.length, 0)} chunks, ${(json.length / 1e6).toFixed(2)} MB → ${out}`);
    console.log('embedding cache', JSON.stringify(cache.stats()));
  } finally {
    await cache.stop();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
