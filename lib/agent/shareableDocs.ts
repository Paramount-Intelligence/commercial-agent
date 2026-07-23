/**
 * Compact catalog of knowledge files Jackie may share with end users.
 * IDs only for shareable=true entries that have a fileUrl.
 */
import { prisma } from '../db';

export async function buildShareableDocsCatalog(): Promise<string> {
  const docs = await prisma.knowledgeEntry.findMany({
    where: { shareable: true, fileUrl: { not: null } },
    select: {
      id: true,
      title: true,
      shareLabel: true,
      fileName: true,
    },
    orderBy: { title: 'asc' },
  });

  if (docs.length === 0) {
    return [
      'Shareable documents: (none configured).',
      'Do not invent PDFs or brochures. Only call share_document when a catalog entry exists.',
    ].join('\n');
  }

  const lines = docs.map((d) => {
    const label = (d.shareLabel ?? '').trim() || d.title;
    const file = d.fileName ? ` (${d.fileName})` : '';
    return `- id=${d.id} — "${label}"${file}`;
  });

  return [
    'Shareable documents (call share_document with knowledgeEntryId; NEVER share non-listed / internal knowledge):',
    ...lines,
  ].join('\n');
}
