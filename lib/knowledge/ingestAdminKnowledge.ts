/**
 * Persist admin knowledge as ContentChunk rows (company / trusted-uncited corpus).
 *
 * Corpus boundary: admin-knowledge is searchable via search_company_info only.
 * It never yields case IDs and cannot bypass citation validation.
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { embed } from '../retrieval/embed';
import { chunkKnowledgeText, type TextChunk } from './chunkText';

export const ADMIN_KNOWLEDGE_SOURCE_TYPE = 'admin-knowledge';

/** Agent-facing boundary injected into every stored chunk. */
export const ADMIN_KNOWLEDGE_BOUNDARY =
  'Agent-facing boundary: This is admin-authored company knowledge (positioning, product, process, internal reference). It is NOT a Paramount case study. Do not use it for client-project metrics, named engagements, delivery outcomes, or engagement details — those require search_cases evidence and [[case:ID]] citations.';

export function adminKnowledgeSourceUrl(entryId: string): string {
  return `admin-knowledge://${entryId}`;
}

export async function replaceAdminKnowledgeChunks(opts: {
  entryId: string;
  title: string;
  body?: string | null;
  fileText?: string | null;
  fileLabel?: string | null;
}): Promise<{ chunkCount: number; chunks: TextChunk[] }> {
  const sourceUrl = adminKnowledgeSourceUrl(opts.entryId);
  const title = opts.title.trim();
  if (!title) throw new Error('Title is required');

  const rawChunks = chunkKnowledgeText({
    title,
    body: opts.body,
    fileText: opts.fileText,
    fileLabel: opts.fileLabel,
  });

  if (rawChunks.length === 0) {
    throw new Error(
      'Nothing to embed — provide body text and/or a file with extractable text.',
    );
  }

  const chunks = rawChunks.map((chunk) => ({
    ...chunk,
    content: `${ADMIN_KNOWLEDGE_BOUNDARY}\n\n${chunk.content}`,
  }));

  const vectors = await embed(
    chunks.map((chunk) => `${title}\n${chunk.heading}\n${chunk.content}`),
  );
  if (vectors.length !== chunks.length) {
    throw new Error(
      `Embedding count mismatch: ${vectors.length} for ${chunks.length} chunks`,
    );
  }

  const rows = chunks.map((chunk, index) => {
    const vector = `[${vectors[index].join(',')}]`;
    return Prisma.sql`(${randomUUID()}, ${ADMIN_KNOWLEDGE_SOURCE_TYPE}, ${sourceUrl}, ${title}, ${chunk.heading}, ${chunk.content}, CAST(${vector} AS vector))`;
  });

  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM "ContentChunk" WHERE "sourceUrl" = ${sourceUrl}`,
    prisma.$executeRaw`
      INSERT INTO "ContentChunk"
        (id, "sourceType", "sourceUrl", title, heading, content, embedding)
      VALUES ${Prisma.join(rows)}
    `,
    prisma.knowledgeEntry.update({
      where: { id: opts.entryId },
      data: { chunkCount: chunks.length },
    }),
  ]);

  return { chunkCount: chunks.length, chunks: rawChunks };
}

export async function deleteAdminKnowledgeChunks(
  entryId: string,
): Promise<number> {
  const sourceUrl = adminKnowledgeSourceUrl(entryId);
  const result = await prisma.$executeRaw`
    DELETE FROM "ContentChunk" WHERE "sourceUrl" = ${sourceUrl}
  `;
  return Number(result);
}
