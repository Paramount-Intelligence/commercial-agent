/**
 * Persist one-pager attachments alongside assistant message text without a
 * schema migration. Marker is stripped before the reply reaches the user UI.
 *
 * Attachment URLs are always app routes that check the session
 * (buyerFileUrl). Older messages that stored a storage URL are rewritten when
 * read, so no stored URL ever reaches a browser.
 */
import type { OnepagerAttachment } from './tools/generateCaseOnepager';

const MARKER_START = '\n\n<!--pi-attachments:';
const MARKER_END = '-->';

/** The gated download route for an attachment, or null if it has none. */
export function buyerFileUrl(att: Pick<OnepagerAttachment, 'caseId' | 'documentId' | 'source' | 'url' | 'format'>): string | null {
  if (att.source === 'transcript') {
    return att.url?.startsWith('/api/chat/transcript?') ? att.url : null;
  }
  if (att.documentId?.startsWith('knowledge:')) {
    return `/api/files/knowledge/${encodeURIComponent(att.documentId.slice('knowledge:'.length))}`;
  }
  if (att.caseId) {
    const format = att.format === 'png' ? 'png' : 'pdf';
    return `/api/files/onepager?caseId=${encodeURIComponent(att.caseId)}&format=${format}`;
  }
  return null;
}

/** Copy with the gated URL; null when the attachment cannot be served. */
export function toBuyerAttachment(att: OnepagerAttachment): OnepagerAttachment | null {
  const url = buyerFileUrl(att);
  return url ? { ...att, url } : null;
}

export function embedAttachments(
  reply: string,
  attachments: OnepagerAttachment[],
): string {
  const safe = attachments.map(toBuyerAttachment).filter((a): a is OnepagerAttachment => a !== null);
  if (!safe.length) return reply;
  return `${reply}${MARKER_START}${JSON.stringify(safe)}${MARKER_END}`;
}

export function extractAttachments(content: string): {
  reply: string;
  attachments: OnepagerAttachment[];
} {
  const start = content.indexOf(MARKER_START);
  if (start < 0) return { reply: content, attachments: [] };

  const jsonStart = start + MARKER_START.length;
  const end = content.indexOf(MARKER_END, jsonStart);
  if (end < 0) return { reply: content, attachments: [] };

  const raw = content.slice(jsonStart, end);
  let attachments: OnepagerAttachment[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      attachments = parsed
        .filter(
          (a): a is OnepagerAttachment =>
            !!a &&
            typeof a === 'object' &&
            typeof (a as OnepagerAttachment).url === 'string' &&
            typeof (a as OnepagerAttachment).caseTitle === 'string',
        )
        .map(toBuyerAttachment)
        .filter((a): a is OnepagerAttachment => a !== null);
    }
  } catch {
    attachments = [];
  }

  return {
    reply: content.slice(0, start).trimEnd(),
    attachments,
  };
}
