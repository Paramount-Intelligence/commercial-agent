/**
 * Persist one-pager attachments alongside assistant message text without a
 * schema migration. Marker is stripped before the reply reaches the user UI.
 */
import type { OnepagerAttachment } from './tools/generateCaseOnepager';

const MARKER_START = '\n\n<!--pi-attachments:';
const MARKER_END = '-->';

export function embedAttachments(
  reply: string,
  attachments: OnepagerAttachment[],
): string {
  if (!attachments.length) return reply;
  return `${reply}${MARKER_START}${JSON.stringify(attachments)}${MARKER_END}`;
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
      attachments = parsed.filter(
        (a): a is OnepagerAttachment =>
          !!a &&
          typeof a === 'object' &&
          typeof (a as OnepagerAttachment).url === 'string' &&
          typeof (a as OnepagerAttachment).caseTitle === 'string',
      );
    }
  } catch {
    attachments = [];
  }

  return {
    reply: content.slice(0, start).trimEnd(),
    attachments,
  };
}
