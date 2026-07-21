/**
 * Voice / TTS+STT config — swap IDs here when Marty picks new defaults.
 *
 * TTS model: eleven_flash_v2_5 — lowest-latency Flash model.
 * TTS voice: Daniel (onwK4e9ZLuTAKqWW03F9) — professional broadcaster.
 * STT model: scribe_v2 — current ElevenLabs batch speech-to-text.
 */
export const VOICE_CONFIG = {
  /** Default ElevenLabs voice id (Daniel). */
  DEFAULT_VOICE_ID: 'onwK4e9ZLuTAKqWW03F9',
  /** Low-latency Flash model for streaming playback. */
  DEFAULT_MODEL_ID: 'eleven_flash_v2_5',
  /** Soft ceiling per TTS request. */
  MAX_CHARS_PER_REQUEST: 4_000,
  /** ElevenLabs Scribe model for speech-to-text. */
  STT_MODEL_ID: 'scribe_v2',
  /** Soft ceiling — refuse absurdly long recordings (seconds). */
  MAX_STT_SECONDS: 120,
} as const;
