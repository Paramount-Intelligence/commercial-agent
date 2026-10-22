/**
 * Voice replies are spoken: normally 1-3 short sentences and no more than 50
 * words. The prompt asks for that; this is the deterministic backstop for a
 * reply that still runs long. It keeps whole sentences from the start (the
 * answer comes first) and never cuts inside one. The caller re-runs the
 * pricing/contact gates on the result and keeps the original if a required
 * caveat would be lost. Pure.
 */
import { replySentences } from './responseSalvage';

export const VOICE_MAX_WORDS = 50;
export const VOICE_MAX_SENTENCES = 3;

/** One line on the current voice turn, after any evidence: recency beats a long system prompt. */
export const VOICE_TURN_REMINDER =
  '[Voice reply: answer first in 1-3 short spoken sentences, at most 50 words. No lists, markdown or URLs. At most one question back.]';

/** The same for chat: the long system prompt otherwise pulls replies into surveys. */
export const CHAT_TURN_REMINDER =
  '[Chat reply: answer first, about 120 words at most. Bullets only for three or more comparable items; no tables or rate card unless asked.]';

const TAG_RE = /\[\[(?:case|src):[^\]]+\]\]/gi;

export function spokenWords(text: string): number {
  return text.replace(TAG_RE, ' ').match(/\S+/g)?.length ?? 0;
}

export function trimVoiceReply(
  text: string,
  maxWords = VOICE_MAX_WORDS,
  maxSentences = VOICE_MAX_SENTENCES,
): string {
  const sentences = replySentences(text);
  if (sentences.length === 0) return text;
  const visible = sentences.filter((s) => spokenWords(s) > 0);
  if (spokenWords(text) <= maxWords && visible.length <= maxSentences) return text;

  const kept: string[] = [];
  let words = 0;
  let count = 0;
  for (const sentence of sentences) {
    const w = spokenWords(sentence);
    if (kept.length > 0 && w > 0 && (words + w > maxWords || count + 1 > maxSentences)) break;
    kept.push(sentence);
    words += w;
    if (w > 0) count++;
  }
  // Only whole sentences: never ship a reply that ends mid-thought.
  const out = kept.join(' ').trim();
  return /[.!?](?:\s*\[\[[^\]]+\]\])*$/.test(out) ? out : text;
}
