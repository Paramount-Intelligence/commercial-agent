/**
 * Split long agent replies into TTS-sized pieces at sentence boundaries.
 *
 * Why: Vercel kills serverless work at 60s. One Fish call for a long answer
 * cannot finish in time. Speaking sequential short chunks delivers the FULL
 * answer in audio without truncating meaning or falling back to text-only.
 */
import { VOICE_CONFIG } from './config';

const BREAK_PRIORITY = [
  /\n\n/g,
  /(?<=[.!?])\s+/g,
  /(?<=;)\s+/g,
  /,\s+/g,
  /\s+/g,
] as const;

/**
 * Split `text` into chunks each ≤ maxChars (default: VOICE_CONFIG.MAX_CHARS_PER_REQUEST).
 * Prefers paragraph → sentence → clause → word boundaries.
 */
export function splitTextForTtsChunks(
  text: string,
  maxChars: number = VOICE_CONFIG.MAX_CHARS_PER_REQUEST,
): string[] {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const chunks: string[] = [];
  let remaining = trimmed;

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars);
    let cut = -1;

    for (const re of BREAK_PRIORITY) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      let lastGood = -1;
      while ((match = re.exec(window)) !== null) {
        const at = match.index + match[0].length;
        if (at > maxChars * 0.35) lastGood = at;
      }
      if (lastGood > 0) {
        cut = lastGood;
        break;
      }
    }

    if (cut <= 0) cut = maxChars;
    const piece = remaining.slice(0, cut).trim();
    if (piece) chunks.push(piece);
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}
