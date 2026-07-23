/**
 * Re-embed one CaseStudy's CaseChunk rows (overview / challenge / solution / results).
 * Idempotent: deleteMany for caseId, then insert fresh vectors.
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { embed } from './embed';

const SECTIONS = [
  { heading: 'overview', field: 'overview' },
  { heading: 'challenge', field: 'challenge' },
  { heading: 'solution', field: 'solution' },
  { heading: 'results', field: 'results' },
] as const;

type CaseRow = {
  id: string;
  title: string;
  overview: string | null;
  challenge: string | null;
  solution: string;
  results: string | null;
};

function sectionText(
  c: CaseRow,
  field: (typeof SECTIONS)[number]['field'],
): string {
  const raw = c[field];
  if (typeof raw !== 'string') return '';
  const content = raw.trim();
  if (!content || /^(n\/a|na|-)$/i.test(content)) return '';
  return content;
}

function chunksForCase(
  c: CaseRow,
): Array<{ heading: string; content: string }> {
  const out: Array<{ heading: string; content: string }> = [];
  for (const s of SECTIONS) {
    const content = sectionText(c, s.field);
    if (!content) continue;
    out.push({ heading: s.heading, content });
  }
  return out;
}

/**
 * Replace embeddings for a single case. Returns how many chunks were written.
 */
export async function replaceCaseChunks(caseId: string): Promise<{
  chunkCount: number;
  sections: string[];
}> {
  const c = await prisma.caseStudy.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      title: true,
      overview: true,
      challenge: true,
      solution: true,
      results: true,
    },
  });
  if (!c) throw new Error(`Case not found: ${caseId}`);

  const parts = chunksForCase(c);

  if (parts.length === 0) {
    await prisma.caseChunk.deleteMany({ where: { caseId } });
    return { chunkCount: 0, sections: [] };
  }

  const texts = parts.map((p) => `${p.heading}\n\n${p.content}`);
  const vectors = await embed(texts);
  if (vectors.length !== parts.length) {
    throw new Error(
      `embed length mismatch for ${c.title}: ${vectors.length} vs ${parts.length}`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.caseChunk.deleteMany({ where: { caseId } });
    for (let i = 0; i < parts.length; i++) {
      const id = randomUUID();
      const vectorStr = `[${vectors[i].join(',')}]`;
      await tx.$executeRaw`
        INSERT INTO "CaseChunk" (id, "caseId", heading, content, embedding)
        VALUES (${id}, ${caseId}, ${parts[i].heading}, ${parts[i].content}, CAST(${vectorStr} AS vector))
      `;
    }
  });

  return {
    chunkCount: parts.length,
    sections: parts.map((p) => p.heading),
  };
}

/** Sync CaseTech tag rows from a name list (used by Layer 3 index + search). */
export async function syncCaseTechTags(
  caseId: string,
  techNames: string[],
  tx?: Prisma.TransactionClient,
): Promise<string[]> {
  const db = tx ?? prisma;
  const unique = [
    ...new Set(
      techNames
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => n.slice(0, 120)),
    ),
  ];

  await db.caseTech.deleteMany({ where: { caseId } });
  if (unique.length > 0) {
    await db.caseTech.createMany({
      data: unique.map((name) => ({ caseId, name })),
    });
  }

  return unique;
}
