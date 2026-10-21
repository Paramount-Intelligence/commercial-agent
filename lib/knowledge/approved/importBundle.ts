/**
 * Core of POST /api/admin/knowledge/import: check the bundle, re-run the
 * draft scan on every doc, then load it (dry run unless apply is true).
 * Embeddings come from the bundle, so the import makes no API calls.
 */
import { checkBundle, decodeVector } from './bundle';
import { hashDoc } from './manifest';
import { scanDoc } from './scan';
import { loadKnowledge, prismaKnowledgeStore, type KnowledgeStore, type LoadResult } from './store';

export function knowledgeImportEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.KNOWLEDGE_IMPORT_ENABLED?.trim() === 'true';
}

export type ImportResult =
  | ({ ok: true } & LoadResult & { refused: Array<{ id: string; kinds: string[] }> })
  | { ok: false; error: string; refused?: Array<{ id: string; kinds: string[] }> };

export async function importKnowledgeBundle(
  raw: unknown,
  opts: { apply: boolean },
  store: KnowledgeStore = prismaKnowledgeStore,
): Promise<ImportResult> {
  const checked = checkBundle(raw);
  if (!checked.ok) return { ok: false, error: checked.error };
  const b = checked.bundle;
  const lists = { confidentialNames: b.confidentialNames, formerEmployers: b.formerEmployers };
  const refused: Array<{ id: string; kinds: string[] }> = [];
  for (const d of b.docs) {
    if (hashDoc(d) !== d.contentHash) refused.push({ id: d.id, kinds: ['hash-mismatch'] });
    const problems = scanDoc(d, lists);
    if (problems.length) refused.push({ id: d.id, kinds: [...new Set(problems.map((p) => p.kind))] });
  }
  // All or nothing: a bundle with a refused doc is not loaded at all.
  if (refused.length) return { ok: false, error: 'bundle refused', refused };
  const byId = new Map(b.docs.map((d) => [d.id, d]));
  const result = await loadKnowledge(
    { docs: b.docs.map(({ chunks: _c, ...doc }) => doc), confidentialNames: b.confidentialNames, formerEmployers: b.formerEmployers },
    {
      apply: opts.apply,
      embedder: async (doc, chunks) => {
        const stored = byId.get(doc.id)!.chunks;
        return chunks.map((c) => {
          const s = stored.find((x) => x.ordinal === c.ordinal);
          if (!s) throw new Error(`missing embedding for ${doc.id}:${c.ordinal}`);
          return decodeVector(s.embedding);
        });
      },
    },
    store,
  );
  return { ok: true, ...result, refused };
}
