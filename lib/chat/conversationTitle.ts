/**
 * Conversation title helpers — no model call.
 */

/** First ~maxChars of message, trimmed at a word boundary when possible. */
export function deriveConversationTitle(
  message: string,
  maxChars = 50,
): string {
  const cleaned = message.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'New chat';
  if (cleaned.length <= maxChars) return cleaned;
  const slice = cleaned.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const base =
    lastSpace > Math.floor(maxChars * 0.4)
      ? slice.slice(0, lastSpace).trimEnd()
      : slice.trimEnd();
  return `${base}…`;
}
