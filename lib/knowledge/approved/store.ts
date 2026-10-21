/**
 * Load approved knowledge into KnowledgeDoc / KnowledgeChunk, idempotently:
 * - a doc whose content hash is unchanged keeps its chunks (no embedding);
 * - changed or new docs get fresh chunks and embeddings;
 * - docs no longer in the set become status 'retired' (never deleted);
 * - the lists the buyer-output filter needs go to KnowledgeSetting.
 * Used by `npm run knowledge:ingest` and POST /api/admin/knowledge/import.
 */
import { prisma } from '../../db';
import { buildChunks } from './chunk';
import type { ChunkInput, KnowledgeDocInput } from './types';

export const SETTING_CONFIDENTIAL_NAMES = 'confidential-names';
export const SETTING_FORMER_EMPLOYERS = 'former-employers';

export type KnowledgeStore = {
  existingHashes(): Promise<Map<string, { contentHash: string; chunkCount: number }>>;
  /** Write doc fields; when chunks are given, replace the doc's chunks. */
  upsertDoc(doc: KnowledgeDocInput, chunks: Array<ChunkInput & { embedding: number[] }> | null): Promise<void>;
  retireMissing(keepIds: string[]): Promise<number>;
  setSetting(key: string, value: unknown): Promise<void>;
};

/** Embeddings for chunk texts, in order. Ingest calls the API; import reads the bundle. */
export type ChunkEmbedder = (doc: KnowledgeDocInput, chunks: ChunkInput[]) => Promise<number[][]>;

export type LoadResult = {
  apply: boolean;
  docs: number;
  unchanged: number;
  embeddedDocs: number;
  embeddedChunks: number;
  retired: number;
};

export async function loadKnowledge(
  input: { docs: KnowledgeDocInput[]; confidentialNames: string[]; formerEmployers: string[]; retireMissing?: boolean },
  opts: { apply: boolean; embedder: ChunkEmbedder },
  store: KnowledgeStore = prismaKnowledgeStore,
): Promise<LoadResult> {
  const existing = await store.existingHashes();
  const result: LoadResult = { apply: opts.apply, docs: input.docs.length, unchanged: 0, embeddedDocs: 0, embeddedChunks: 0, retired: 0 };
  for (const doc of input.docs) {
    const prev = existing.get(doc.id);
    if (prev && prev.contentHash === doc.contentHash && prev.chunkCount > 0) {
      result.unchanged++;
      if (opts.apply) await store.upsertDoc(doc, null);
      continue;
    }
    const chunks = buildChunks(doc);
    result.embeddedDocs++;
    result.embeddedChunks += chunks.length;
    if (!opts.apply) continue;
    const vectors = await opts.embedder(doc, chunks);
    if (vectors.length !== chunks.length) throw new Error(`embedding count mismatch for ${doc.id}`);
    await store.upsertDoc(doc, chunks.map((c, i) => ({ ...c, embedding: vectors[i] })));
  }
  if (input.retireMissing !== false) {
    const missing = [...existing.keys()].filter((id) => !input.docs.some((d) => d.id === id));
    result.retired = missing.length;
    if (opts.apply && missing.length) await store.retireMissing(input.docs.map((d) => d.id));
  }
  if (opts.apply) {
    await store.setSetting(SETTING_CONFIDENTIAL_NAMES, input.confidentialNames);
    await store.setSetting(SETTING_FORMER_EMPLOYERS, input.formerEmployers);
  }
  return result;
}

export const prismaKnowledgeStore: KnowledgeStore = {
  existingHashes: async () => {
    const rows = await prisma.knowledgeDoc.findMany({
      where: { status: { not: 'retired' } },
      select: { id: true, contentHash: true, _count: { select: { chunks: true } } },
    });
    return new Map(rows.map((r) => [r.id, { contentHash: r.contentHash, chunkCount: r._count.chunks }]));
  },
  upsertDoc: async (doc, chunks) => {
    const data = {
      slug: doc.slug,
      type: doc.type,
      title: doc.title,
      attribution: doc.attribution.replace(/-/g, '_') as never,
      audience: doc.audience,
      status: doc.status,
      clientName: doc.clientName,
      clientNameApproved: doc.clientNameApproved,
      sources: doc.sources as never,
      contentHash: doc.contentHash,
      metadata: doc.metadata as never,
      body: doc.body,
    };
    await prisma.$transaction(async (tx) => {
      await tx.knowledgeDoc.upsert({ where: { id: doc.id }, create: { id: doc.id, ...data }, update: data });
      if (!chunks) return;
      await tx.knowledgeChunk.deleteMany({ where: { docId: doc.id } });
      await tx.knowledgeDocFile.deleteMany({ where: { docId: doc.id } }); // cached one-pagers are stale
      for (const c of chunks) {
        await tx.$executeRaw`
          INSERT INTO "KnowledgeChunk" ("id", "docId", "ordinal", "header", "content", "tokenCount", "embedding")
          VALUES (${`${doc.id}:${c.ordinal}`}, ${doc.id}, ${c.ordinal}, ${c.header}, ${c.content}, ${c.tokenCount},
                  CAST(${`[${c.embedding.join(',')}]`} AS vector))`;
      }
    });
  },
  retireMissing: async (keepIds) =>
    (await prisma.knowledgeDoc.updateMany({ where: { id: { notIn: keepIds }, status: { not: 'retired' } }, data: { status: 'retired' } })).count,
  setSetting: async (key, value) =>
    void (await prisma.knowledgeSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } })),
};

