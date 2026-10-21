/**
 * Load approved knowledge into KnowledgeDoc / KnowledgeChunk (local or staging
 * only, through the db guard). Idempotent: unchanged docs are not re-embedded.
 *
 *   npm run knowledge:ingest -- --target=local              (dry run; reads .env.local)
 *   npm run knowledge:ingest -- --target=local --apply
 *   npm run knowledge:ingest -- --target=staging --apply    (reads .env.staging; DB_TARGET=staging + fingerprint)
 *
 * Embeddings go through the local embedding cache (EVAL_OUT/cache), so a text
 * already embedded once costs nothing; every upstream request is in the API
 * ledger. Refuses to run if any draft fails the scan.
 */
import { assertLocalDatabase } from '../lib/dbGuard';
import { embeddingText } from '../lib/knowledge/approved/chunk';
import { startEmbeddingCache } from './lib/embeddingCache';
import { describePlan, readKnowledgePlan } from './lib/knowledgeFiles';

const argTarget = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1];
const APPLY = process.argv.includes('--apply');

async function main() {
  if (argTarget !== 'local' && argTarget !== 'staging') throw new Error('--target=local|staging is required');
  process.loadEnvFile(argTarget === 'staging' ? '.env.staging' : '.env.local');
  const target = assertLocalDatabase(process.env, { strict: true });
  if (target !== argTarget) throw new Error(`--target=${argTarget} but the configured database is ${target}. Refusing.`);

  const plan = readKnowledgePlan();
  console.log(describePlan(plan));
  if (plan.refused.length) throw new Error('Some drafts were refused; fix them before loading. Nothing was written.');

  const { loadKnowledge } = await import('../lib/knowledge/approved/store');
  const { embed } = await import('../lib/retrieval/embed');
  const { prisma } = await import('../lib/db');
  const cache = APPLY ? await startEmbeddingCache(`knowledge:ingest ${target}`) : null;
  try {
    const result = await loadKnowledge(plan, {
      apply: APPLY,
      embedder: async (_doc, chunks) => {
        const texts = chunks.map(embeddingText);
        await cache!.prefetch(texts);
        return embed(texts);
      },
    });
    console.log(JSON.stringify(result));
    if (cache) console.log('embedding cache', JSON.stringify(cache.stats()));
    if (!APPLY) console.log('Dry run: nothing written. Re-run with --apply.');
  } finally {
    await cache?.stop();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
