/**
 * User-facing conversation transcript PDF — generate + soft-cache on Conversation.
 * Session ownership is enforced by the caller (API / tool).
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { prisma } from '../db';
import { renderHtmlToPdf } from './render';
import { buildConversationTranscriptHtml } from './conversationTranscript';
import { loadConversationTranscriptData } from './loadTranscriptData';
import { assetExists, deleteAsset, uploadAsset } from '../storage/blob';

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
    if (url.startsWith('/uploads/')) {
      const filePath = path.join(
        process.cwd(),
        'public',
        url.replace(/^\//, ''),
      );
      return await readFile(filePath);
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
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
    topic: 'Conversation with Jackie',
    conversationId: opts.conversationId,
    generatedAt,
    turns: data.turns,
    cases: data.cases,
    onepagers: data.onepagers,
  });

  const buffer = await renderHtmlToPdf(html);
  console.info('[transcript-pdf] chromium render ok', {
    conversationId: opts.conversationId,
    bytes: buffer.byteLength,
  });

  const { url } = await uploadAsset(buffer, filename, 'application/pdf');
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

  console.info('[transcript-pdf] uploaded', { filename, url });
  return { buffer, filename, url, cached: false };
}
