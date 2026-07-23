/**
 * Voice / TTS+STT config — swap IDs and copy here when Marty picks new defaults.
 *
 * TTS model: eleven_flash_v2_5 — lowest-latency Flash model.
 * TTS voice: Amy (y3H6zY6KvCH2pEuQjmv8) — warm, friendly female (Jackie).
 * STT model: scribe_v2 — current ElevenLabs batch speech-to-text.
 *
 * Swap DEFAULT_VOICE_ID anytime; Jackie branding / intro / fillers stay editable
 * below without a code hunt.
 */
export const VOICE_CONFIG = {
  /** Default ElevenLabs voice id — Amy (warm female). Swap freely. */
  DEFAULT_VOICE_ID: 'y3H6zY6KvCH2pEuQjmv8',
  /** Human label for the default voice (docs / admin notes). */
  DEFAULT_VOICE_LABEL: 'Amy',
  /** Low-latency Flash model for streaming playback. */
  DEFAULT_MODEL_ID: 'eleven_flash_v2_5',
  /** Soft ceiling per TTS request. */
  MAX_CHARS_PER_REQUEST: 4_000,
  /** ElevenLabs Scribe model for speech-to-text. */
  STT_MODEL_ID: 'scribe_v2',
  /** Soft ceiling — refuse absurdly long recordings (seconds). */
  MAX_STT_SECONDS: 120,

  // ── Jackie branding (voice UI) ──────────────────────────────────────────
  /** Short display name in captions / heading. */
  AGENT_DISPLAY_NAME: 'Jackie',
  /** Longer label for transcript rows (CSS may uppercase). */
  AGENT_LABEL: 'Jackie · Paramount Adviser',

  /**
   * Fixed spoken intro when voice mode opens (NOT model output).
   * Marty can tweak wording here — keep it 2–3 short sentences.
   */
  INTRO_TEXT:
    "Hi, I'm Jackie, Paramount Intelligence's adviser. I can walk you through our work, share case examples, put together one-pagers, and answer questions about what we do. Let me know how can I help you?",

  /**
   * Thinking-gap fillers — Jackie speaks EXACTLY ONE of these per processing
   * wait (rotated across turns for variety; never chained within the same gap).
   * Fixed safe phrases, not model output. Marty can edit the lines freely.
   */
  THINKING_FILLERS: [
    {
      text: 'Let me see what I can find for you.',
      pill: 'Let me see what I can find…',
      hint: 'Looking through our relevant work',
    },
    {
      text: 'One moment — pulling that up.',
      pill: 'One moment…',
      hint: 'Checking the relevant experience',
    },
    {
      text: 'Give me a second to check our work.',
      pill: 'Checking our work…',
      hint: 'Finding the clearest answer',
    },
  ],

  /**
   * Progressive VISUAL status (Claude-style) — shown on the pill / under the orb.
   * Not spoken. Driven by real pipeline events when streamStages is on;
   * timedApproximations are a fallback if stages aren't received yet.
   */
  PROGRESS_STATUS: {
    listening: {
      pill: 'Listening…',
      hint: 'Go ahead — I’m following',
    },
    hearing: {
      pill: 'Getting that…',
      hint: 'Making sure I heard you clearly',
    },
    thinking: {
      pill: 'Thinking…',
      hint: 'Working through what you asked',
    },
    searching: {
      pill: 'Searching our work…',
      hint: 'Looking through our case studies',
    },
    composing: {
      pill: 'Putting it together…',
      hint: 'Shaping a clear answer for you',
    },
    validating: {
      pill: 'Double-checking…',
      hint: 'Making sure this stays accurate',
    },
    speaking: {
      pill: 'Speaking…',
      hint: 'You can speak clearly to interrupt',
    },
    /** Fallback cadence (ms) if stage events are delayed — visual only.
     * Do NOT schedule a fake "searching" — that label is real-event-only. */
    timedFallbackMs: {
      thinking: 0,
      composing: 5_500,
    },
  },
} as const;
