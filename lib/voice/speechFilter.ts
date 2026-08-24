/**
 * Reject STT output that is ambient noise / audio-event tags, not real speech.
 * ASR can emit "[background noise]" etc. — never forward those into the agent.
 */

const AUDIO_EVENT_RE = /\[[^\]]*\]|\([^)]*\)/g;
/** CJK / non-Latin scripts Jackie should not treat as English speech. */
const NON_LATIN_SCRIPT_RE =
  /[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;

/** Strip STT event markers and normalize whitespace. */
export function stripAudioEventTags(text: string): string {
  return text
    .replace(AUDIO_EVENT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the transcript has no usable spoken content (noise tags only,
 * empty, tiny non-lexical sounds, or non-English script).
 */
export function isNonSpeechTranscript(text: string): boolean {
  const raw = text.trim();
  if (!raw) return true;

  const stripped = stripAudioEventTags(raw);
  if (!stripped) return true;

  // Fish sometimes mis-hears short English noise as Chinese/other scripts.
  if (NON_LATIN_SCRIPT_RE.test(stripped)) return true;

  const letters = stripped.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 2) return true;

  if (/^(um+|uh+|hmm+|mm+|mhm+|ah+|oh+|er+|uh-huh)[.?!,]*$/i.test(stripped)) {
    return true;
  }

  if (
    /^(background\s+noise|silence|music|applause|laughter|coughing|static)[.?!,]*$/i.test(
      stripped,
    )
  ) {
    return true;
  }

  return false;
}

/** True when Fish's detected language is not English (hint is not a hard pin). */
export function isNonEnglishAsrLanguage(
  languageCode: string | null | undefined,
): boolean {
  if (!languageCode?.trim()) return false;
  const code = languageCode.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return Boolean(code) && code !== 'en';
}

/** Speech text safe to send to the agent (tags stripped). */
export function usableSpeechText(text: string): string | null {
  if (isNonSpeechTranscript(text)) return null;
  return stripAudioEventTags(text);
}
