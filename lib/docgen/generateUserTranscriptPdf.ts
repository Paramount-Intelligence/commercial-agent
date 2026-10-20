/**
 * User-facing conversation transcript PDF — generate + soft-cache on Conversation.
 * Session ownership is enforced by the caller (API / tool).
 */
import { prisma } from '../db';
import { renderHtmlToPdf } from './render';
import { buildConversationTranscriptHtml } from './conversationTranscript';
import { loadConversationTranscriptData } from './loadTranscriptData';
import { assetExists, deleteAsset, readStoredFile, TRANSCRIPT_PREFIX, uploadAsset } from '../storage/blob';
import { unapprovedClientNames } from '../safety/clientNames';

export type UserTranscriptPdfResult = {
  buffer: Buffer;
  filename: string;
  url: string;
  cached: boolean;
};

export class TranscriptEmptyError extends Error {
  constructor(message = 'Conversation has no messages to include in a transcript.') {
    super(message);
    this.name = 'TranscriptEmptyError';
  }
}

function transcriptFilename(conversationId: string): string {
  return `paramount-conversation-${conversationId.slice(0, 8)}.pdf`;
}

async function bufferFromStoredUrl(url: string): Promise<Buffer | null> {
  try {
    return (await readStoredFile(url))?.buffer ?? null;
  } catch {
    return null;
  }
}

/**
 * Return a branded user transcript PDF, reusing the cached blob when the
 * conversation message watermark has not advanced.
 */
export async function getOrCreateUserTranscriptPdf(opts: {
  conversationId: string;
  userName: string;
  userEmail: string;
  userCompany?: string | null;
  force?: boolean;
}): Promise<UserTranscriptPdfResult> {
  const data = await loadConversationTranscriptData(opts.conversationId);
  if (data.turns.length === 0 || !data.throughAt) {
    throw new TranscriptEmptyError();
  }

  const filename = transcriptFilename(opts.conversationId);
  const existing = await prisma.conversation.findUnique({
    where: { id: opts.conversationId },
    select: {
      transcriptPdfUrl: true,
      transcriptPdfThroughAt: true,
    },
  });

  if (
    !opts.force &&
    existing?.transcriptPdfUrl &&
    // Only PDFs from the current template are reused.
    existing.transcriptPdfUrl.includes(TRANSCRIPT_PREFIX) &&
    existing.transcriptPdfThroughAt &&
    existing.transcriptPdfThroughAt.getTime() >= data.throughAt.getTime() &&
    (await assetExists(existing.transcriptPdfUrl))
  ) {
    const cached = await bufferFromStoredUrl(existing.transcriptPdfUrl);
    if (cached?.byteLength) {
      console.info('[transcript-pdf] cache hit', {
        conversationId: opts.conversationId,
        bytes: cached.byteLength,
      });
      return {
        buffer: cached,
        filename,
        url: existing.transcriptPdfUrl,
        cached: true,
      };
    }
  }

  const generatedAt = new Date();
  const html = buildConversationTranscriptHtml({
    audience: 'user',
    leadName: opts.userName,
    leadEmail: opts.userEmail,
    leadCompany: opts.userCompany,
    topic: 'Conversation with the Paramount Assistant',
    conversationId: opts.conversationId,
    generatedAt,
    turns: data.turns,
    cases: data.cases,
    onepagers: data.onepagers,
    clientNames: await unapprovedClientNames(),
  });

  const buffer = await renderHtmlToPdf(html);
  console.info('[transcript-pdf] chromium render ok', {
    conversationId: opts.conversationId,
    bytes: buffer.byteLength,
  });

  const { url } = await uploadAsset(buffer, filename, 'application/pdf', TRANSCRIPT_PREFIX);
  const previousUrl = existing?.transcriptPdfUrl ?? null;

  await prisma.conversation.update({
    where: { id: opts.conversationId },
    data: {
      transcriptPdfUrl: url,
      transcriptPdfThroughAt: data.throughAt,
    },
  });

  if (previousUrl && previousUrl !== url) {
    await deleteAsset(previousUrl).catch(() => {});
  }

  console.info('[transcript-pdf] uploaded', { conversationId: opts.conversationId, bytes: buffer.byteLength });
  return { buffer, filename, url, cached: false };
}
