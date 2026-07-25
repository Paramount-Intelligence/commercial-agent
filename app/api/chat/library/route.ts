/**
 * GET /api/chat/library — documents available to the signed-in user:
 *  - company docs:  shareable KnowledgeEntry files (e.g. the Paramount Overview)
 *  - one-pagers:    generated/uploaded case documents from THEIR conversations
 *  - transcripts:   conversation-transcript downloads Jackie offered them
 *
 * Session-gated; conversation-derived items are structurally scoped to the
 * caller's own non-deleted conversations (no id accepted from the client).
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/auth/session';
import { extractAttachments } from '@/lib/agent/attachments';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

export type LibraryItem = {
  key: string;
  kind: 'company' | 'one-pager' | 'transcript';
  title: string;
  filename: string;
  url: string;
  format: 'pdf' | 'png' | 'docx';
  /** For conversation-derived items. */
  conversationId?: string;
  conversationTitle?: string | null;
  createdAt: string;
};

function formatFromFile(
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

export async function GET() {
  try {
    const auth = await readSession();
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const [knowledgeEntries, attachmentMessages] = await Promise.all([
      // Company docs — the same shareable=true + fileUrl guard share_document uses.
      prisma.knowledgeEntry.findMany({
        where: { shareable: true, fileUrl: { not: null } },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          shareLabel: true,
          fileUrl: true,
          fileName: true,
          fileMime: true,
          updatedAt: true,
        },
        take: 100,
      }),
      // Assistant messages in the caller's own conversations that carry an
      // embedded attachments marker (one-pagers, shared docs, transcripts).
      prisma.message.findMany({
        where: {
          role: 'assistant',
          content: { contains: '<!--pi-attachments:' },
          conversation: { userId: auth.agentUser.id, deletedAt: null },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          content: true,
          createdAt: true,
          conversation: { select: { id: true, title: true } },
        },
        take: 500,
      }),
    ]);

    const items: LibraryItem[] = [];
    const seenUrls = new Set<string>();

    for (const entry of knowledgeEntries) {
      const url = (entry.fileUrl ?? '').trim();
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      const title =
        (entry.shareLabel ?? '').trim() || entry.title.trim() || 'Document';
      items.push({
        key: `knowledge:${entry.id}`,
        kind: 'company',
        title,
        filename:
          (entry.fileName ?? '').trim() ||
          `${title.replace(/[^a-zA-Z0-9._-]+/g, '_')}.pdf`,
        url,
        format: formatFromFile(entry.fileName, entry.fileMime),
        createdAt: entry.updatedAt.toISOString(),
      });
    }

    // Newest-first message order + seenUrls dedupe keeps the latest copy of
    // each document (e.g. regenerated one-pagers, per-conversation transcripts).
    for (const m of attachmentMessages) {
      const { attachments } = extractAttachments(m.content);
      for (const att of attachments) {
        const url = (att.url ?? '').trim();
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        const isTranscript = att.source === 'transcript';
        items.push({
          key: `msg:${m.conversation.id}:${url}`,
          kind: isTranscript ? 'transcript' : 'one-pager',
          title: att.caseTitle || att.filename || 'Document',
          filename: att.filename || 'document.pdf',
          url,
          format: att.format ?? 'pdf',
          conversationId: m.conversation.id,
          conversationTitle: m.conversation.title,
          createdAt: m.createdAt.toISOString(),
        });
      }
    }

    return NextResponse.json({ items });
  } catch (err) {
    console.error('[api/chat/library] unhandled', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
