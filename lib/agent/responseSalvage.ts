const STOP = new Set([
  'about', 'after', 'again', 'also', 'could', 'does', 'from', 'have', 'into',
  'just', 'like', 'more', 'paramount', 'please', 'should', 'that', 'their',
  'there', 'these', 'they', 'this', 'what', 'when', 'where', 'which', 'with',
  'would', 'your',
]);

/**
 * Sentences split only at . ! ? followed by whitespace (or at line breaks), so
 * emails, phone numbers and decimals stay whole. A citation tag that opens a
 * piece ("… claim. [[case:x]] Next …") stays with the sentence it cites.
 */
export function replySentences(text: string): string[] {
  const pieces = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const piece of pieces) {
    const lead = piece.match(/^(?:\[\[(?:case|src):[^\]]+\]\]\s*)+/i)?.[0];
    if (lead && out.length) {
      out[out.length - 1] = `${out[out.length - 1]} ${lead.trim()}`;
      const rest = piece.slice(lead.length).trim();
      if (rest) out.push(rest);
    } else {
      out.push(piece);
    }
  }
  return out;
}

/** Shorter offending fragments are not a sentence and must not match broadly. */
const MIN_OFFENDING_CHARS = 12;

function normalized(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function dropOffendingSentences(
  text: string,
  offending: readonly string[],
): string {
  const bad = offending.map(normalized).filter((item) => item.length >= MIN_OFFENDING_CHARS);
  return replySentences(text)
    .filter((sentence) => {
      const value = normalized(sentence);
      return !bad.some((item) => value.includes(item) || item.includes(value));
    })
    .join(' ')
    .trim();
}

export function deterministicRemainderAnswers(
  userText: string,
  replyText: string,
): boolean {
  const reply = replyText.trim();
  if (!reply || reply.split(/\s+/).length < 6) return false;
  if (!/[.!?]$/.test(reply) && !/\b(?:is|are|was|were|can|do|does|built|deliver|work)\b/i.test(reply)) {
    return false;
  }
  if (/\b(?:price|pricing|rate|rates|cost|charge|discount)\b/i.test(userText)) {
    return /\$(?:90|150|200|250)|\b(?:ninety|one hundred fifty|two hundred|two hundred fifty)\b/i.test(reply) &&
      /\b(?:indicative|scop|formal quote)\b/i.test(reply);
  }
  if (/\b(?:email|phone|number|contact|reach)\b/i.test(userText)) {
    return /@paramountintelligence\.co|443[.\s-]494[.\s-]9144|\b(?:do not|don't|cannot|can't|not)\b[^.]{0,50}\bphone\b/i.test(reply);
  }
  if (/\b(?:bykea|jazzcash|jazz|mobilink|veon|daraz|alibaba|toptal|gratia|catalant)\b/i.test(userText)) {
    return /\b(?:not|isn't|wasn't|worked|employed|before founding)\b/i.test(reply);
  }
  if (/\b(?:contact me|follow up|connect me|call me|email me)\b/i.test(userText)) {
    return /\b(?:confirm|topic|team|follow.?up|on file)\b/i.test(reply);
  }
  const userWords = new Set(
    (userText.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []).filter(
      (word) => !STOP.has(word),
    ),
  );
  if (userWords.size === 0) return true;
  const lowerReply = reply.toLowerCase();
  return [...userWords].some((word) => lowerReply.includes(word));
}
