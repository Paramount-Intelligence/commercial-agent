/**
 * Anthropic tool: share_document — offer a shareable KnowledgeEntry file to the user.
 *
 * Guard: ONLY entries with shareable=true and a non-empty fileUrl.
 * Returns an attachment shaped like generate_case_onepager so chat/voice
 * reuse the same download-card pipeline.
 */
import { prisma } from '../../db';
import type { OnepagerAttachment } from './generateCaseOnepager';

export type ShareDocumentInput = {
  knowledgeEntryId?: string;
  /** Fuzzy lookup against shareLabel / title among shareable entries. */
  topic?: string;
};

export type ShareDocumentModelResult =
  | {
      ok: true;
      url: string;
      filename: string;
      label: string;
      knowledgeEntryId: string;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

export type ShareDocumentToolResult = {
  modelResult: ShareDocumentModelResult;
  retrievedIds: string[];
  attachment?: OnepagerAttachment;
};

export const shareDocumentToolDef = {
  name: 'share_document',
  description:
    'Offer a downloadable company document from the admin knowledge base to the user ' +
    '(e.g. corporate overview PDF). ONLY works for entries explicitly marked shareable. ' +
    'Call this when the user asks for an overview pack / brochure / company PDF, or when ' +
    'you naturally offer a shareable doc after answering a broad "what does Paramount do" ' +
    'question and they accept (or when offering in the same turn is clearly useful). ' +
    'Never invent documents — only share IDs listed in the shareable-documents catalog ' +
    'or found via topic match. Do not paste raw URLs; the UI shows a download card.',
  input_schema: {
    type: 'object' as const,
    properties: {
      knowledgeEntryId: {
        type: 'string',
        description:
          'KnowledgeEntry id from the shareable-documents catalog (preferred).',
      },
      topic: {
        type: 'string',
        description:
          'If you do not have an id, a short topic / label to match ' +
          '(e.g. "corporate overview", "company brochure").',
      },
    },
    additionalProperties: false,
  },
};

function formatFromEntry(
  fileName: string | null,
  fileMime: string | null,
): 'pdf' | 'png' | 'docx' {
  const mime = (fileMime ?? '').toLowerCase();
  const name = (fileName ?? '').toLowerCase();
  if (mime.includes('png') || name.endsWith('.png')) return 'png';
  if (
    mime.includes('wordprocessingml') ||
    mime.includes('msword') ||
    name.endsWith('.docx') ||
    name.endsWith('.doc')
  ) {
    return 'docx';
  }
  return 'pdf';
}

function scoreTopic(
  topic: string,
  title: string,
  shareLabel: string | null,
): number {
  const q = topic.toLowerCase().trim();
  if (!q) return 0;
  const label = (shareLabel ?? '').toLowerCase();
  const t = title.toLowerCase();
  if (label === q || t === q) return 100;
  if (label.includes(q) || t.includes(q)) return 80;
  const tokens = q.split(/\s+/).filter((w) => w.length > 2);
  if (tokens.length === 0) return 0;
  let hits = 0;
  for (const tok of tokens) {
    if (label.includes(tok) || t.includes(tok)) hits++;
  }
  return Math.round((hits / tokens.length) * 60);
}

export async function runShareDocument(
  input: ShareDocumentInput,
): Promise<ShareDocumentToolResult> {
  const knowledgeEntryId =
    typeof input.knowledgeEntryId === 'string'
      ? input.knowledgeEntryId.trim()
      : '';
  const topic = typeof input.topic === 'string' ? input.topic.trim() : '';

  if (!knowledgeEntryId && !topic) {
    return {
      modelResult: {
        ok: false,
        error:
          'Provide knowledgeEntryId or topic. Only shareable knowledge documents can be offered.',
      },
      retrievedIds: [],
    };
  }

  let entry:
    | {
        id: string;
        title: string;
        shareLabel: string | null;
        fileUrl: string | null;
        fileName: string | null;
        fileMime: string | null;
        shareable: boolean;
      }
    | null = null;

  if (knowledgeEntryId) {
    entry = await prisma.knowledgeEntry.findFirst({
      where: {
        id: knowledgeEntryId,
        shareable: true,
        fileUrl: { not: null },
      },
      select: {
        id: true,
        title: true,
        shareLabel: true,
        fileUrl: true,
        fileName: true,
        fileMime: true,
        shareable: true,
      },
    });
    if (!entry) {
      // Distinguish not-found vs not-shareable without leaking internal titles.
      const exists = await prisma.knowledgeEntry.findUnique({
        where: { id: knowledgeEntryId },
        select: { shareable: true, fileUrl: true },
      });
      const error = !exists
        ? 'No shareable document found for that id.'
        : !exists.shareable
          ? 'That knowledge entry is internal and cannot be shared with users.'
          : 'That knowledge entry has no file attachment to share.';
      return { modelResult: { ok: false, error }, retrievedIds: [] };
    }
  } else {
    const candidates = await prisma.knowledgeEntry.findMany({
      where: { shareable: true, fileUrl: { not: null } },
      select: {
        id: true,
        title: true,
        shareLabel: true,
        fileUrl: true,
        fileName: true,
        fileMime: true,
        shareable: true,
      },
      take: 50,
    });
    let best: (typeof candidates)[number] | null = null;
    let bestScore = 0;
    for (const c of candidates) {
      const s = scoreTopic(topic, c.title, c.shareLabel);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (!best || bestScore < 30) {
      return {
        modelResult: {
          ok: false,
          error:
            'No shareable document matched that topic. Check the shareable-documents catalog.',
        },
        retrievedIds: [],
      };
    }
    entry = best;
  }

  const url = entry.fileUrl!.trim();
  if (!url) {
    return {
      modelResult: {
        ok: false,
        error: 'Shareable entry has an empty file URL.',
      },
      retrievedIds: [],
    };
  }

  const label =
    (entry.shareLabel ?? '').trim() || entry.title.trim() || 'Document';
  const filename =
    (entry.fileName ?? '').trim() ||
    `${label.replace(/[^a-zA-Z0-9._-]+/g, '_')}.pdf`;
  const format = formatFromEntry(entry.fileName, entry.fileMime);

  const attachment: OnepagerAttachment = {
    documentId: `knowledge:${entry.id}`,
    url,
    filename,
    caseTitle: label,
    source: 'knowledge-share',
    format,
  };

  return {
    modelResult: {
      ok: true,
      url,
      filename,
      label,
      knowledgeEntryId: entry.id,
      message:
        'Document ready. Tell the user it is available to download — a download card is shown in the UI. Do not paste the raw URL as the primary CTA.',
    },
    retrievedIds: [],
    attachment,
  };
}
