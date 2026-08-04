/**
 * Reject STT output that is ambient noise / audio-event tags, not real speech.
 * Scribe can emit "[background noise]" etc. — never forward those into the agent.
 */

const AUDIO_EVENT_RE = /\[[^\]]*\]|\([^)]*\)/g;

/** Strip Scribe-style event markers and normalize whitespace. */
export function stripAudioEventTags(text: string): string {
  return text
    .replace(AUDIO_EVENT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the transcript has no usable spoken content (noise tags only,
 * empty, or tiny non-lexical sounds).
 */
export function isNonSpeechTranscript(text: string): boolean {
  const raw = text.trim();
  if (!raw) return true;

  const stripped = stripAudioEventTags(raw);
  if (!stripped) return true;

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

/** Speech text safe to send to the agent (tags stripped). */
export function usableSpeechText(text: string): string | null {
  if (isNonSpeechTranscript(text)) return null;
  return stripAudioEventTags(text);
}
