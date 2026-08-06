/**
 * Voice / TTS+STT config — swap IDs and copy here when Marty picks new defaults.
 *
 * TTS provider (see lib/voice/tts.ts + TTS_PROVIDER env):
 * - Default: ElevenLabs (Amy / eleven_flash_v2_5) while subscription is active.
 * - Flip: TTS_PROVIDER=fish when ElevenLabs ends (needs FISH_API_KEY + FISH_VOICE_ID).
 *
 * // TODO(slice-2): when on Fish, pcm/opus + latency:"balanced" + barge-in retune.
 *
 * STT model: scribe_v2 — ElevenLabs batch speech-to-text (unchanged).
 *
 * Jackie branding / intro / fillers stay editable below without a code hunt.
 */
export const VOICE_CONFIG = {
  /** Default ElevenLabs voice id — Amy (warm female). Used when TTS_PROVIDER=elevenlabs. */
  DEFAULT_VOICE_ID: process.env.ELEVENLABS_VOICE_ID?.trim() || undefined,
  /** Human label for the default ElevenLabs voice (docs / admin notes). */
  DEFAULT_VOICE_LABEL: 'Amy',
  /** Low-latency ElevenLabs Flash model for streaming playback. */
  DEFAULT_MODEL_ID: 'eleven_flash_v2_5',
  /**
   * Fish mp3 bitrate when TTS_PROVIDER=fish (Slice 1 format match).
   * // TODO(slice-2): unused once we move off mp3.
   */
  MP3_BITRATE: 128 as 64 | 128 | 192,
  /** Soft ceiling per TTS request (~60–90s spoken). Longer replies are truncated. */
  MAX_CHARS_PER_REQUEST: 1_200,
  /** Abort hung TTS fetches before the platform 60s limit. */
  TTS_FETCH_TIMEOUT_MS: 28_000,
  /** ElevenLabs Scribe model for speech-to-text. */
  STT_MODEL_ID: 'scribe_v2',
  /** Soft ceiling — refuse absurdly long recordings (seconds). */
  MAX_STT_SECONDS: 120,

  /**
   * Hands-free VAD tuning. Activation requires CONTINUOUS energy above an
   * adaptive threshold (ambient floor + margin) for the full sustain window;
   * short taps/clicks and room noise are discarded. True speaker-ID isn't
   * available in-browser — Chromium voiceIsolation + noise floor do the job.
   */
  VAD: {
    /** Absolute idle floor (RMS). Real threshold is max(this, floor + margin). */
    START_RMS: 0.058,
    /** Absolute barge floor while Jackie speaks (must beat speaker bleed). */
    BARGE_IN_RMS: 0.1,
    /** Absolute end-of-speech floor after a committed utterance. */
    STOP_RMS: 0.03,
    /** How far above the measured ambient floor idle speech must sit. */
    NOISE_MARGIN_START: 0.042,
    /** Extra headroom above ambient to barge in over Jackie / room chatter. */
    NOISE_MARGIN_BARGE: 0.065,
    /** How far above ambient counts as still-in-speech when ending a turn. */
    NOISE_MARGIN_STOP: 0.01,
    /**
     * Speech-band energy must clear this fraction of the RMS threshold.
     * Broadband noise (fans, rustle) rarely matches; human voice does.
     */
    SPEECH_BAND_RATIO: 0.62,
    /** Barge-in needs stronger speech-band presence than idle starts. */
    BARGE_SPEECH_BAND_RATIO: 0.78,
    /** Sample ambient before first activation (ms). */
    NOISE_CALIBRATE_MS: 800,
    /** Slow ambient tracking while idle (0–1 EMA toward quiet frames). */
    NOISE_FLOOR_EMA: 0.05,
    /** Required continuous above-threshold duration for a normal turn. */
    START_SUSTAIN_MS: 300,
    /** Required continuous above-threshold duration for a barge-in. */
    BARGE_IN_SUSTAIN_MS: 480,
    /** Permit natural speech dips; longer gaps reset activation. */
    ACTIVATION_GAP_TOLERANCE_MS: 160,
    /**
     * Real pause needed to close a turn. Too low cuts mid-sentence
     * ("…platform in _"); too high feels stuck listening.
     */
    SILENCE_MS: 1_350,
    /** Hard cap so ambient can't leave Jackie stuck in "listening". */
    MAX_CAPTURE_MS: 16_000,
    /**
     * Peak-relative quiet only counts when this far below the recent peak,
     * AND near the absolute stop floor (see VAD tick). Prevents soft syllables
     * from ending the turn early.
     */
    PEAK_SILENCE_RATIO: 0.16,
    /** How fast the utterance peak decays (per frame ~60Hz). Keeps peak local. */
    PEAK_DECAY: 0.994,
    /** Ignore captures shorter than this. */
    MIN_CAPTURE_MS: 550,
    /** Avoid reacting to Jackie's playback startup transient. */
    BARGE_IN_GRACE_MS: 300,
  },

  // ── Jackie branding (voice UI) ──────────────────────────────────────────
  /** Short display name in captions / heading. */
  AGENT_DISPLAY_NAME: 'Jackie',
  /** Longer label for transcript rows (CSS may uppercase). */
  AGENT_LABEL: 'Jackie · Paramount Adviser',

  /**
   * Fixed spoken intro when voice mode opens (NOT model output).
   * Prefer buildIntroText(firstName) so the opener greets the user by name.
   * Keep it 2–3 short sentences. No em/en dashes.
   */
  INTRO_TEXT:
    "Hi, I'm Jackie, Paramount Intelligence's adviser. I can walk you through our work, share case examples, put together one-pagers, and answer questions about what we do. Let me know how I can help you?",

  /**
   * Thinking-gap fillers - Jackie speaks EXACTLY ONE of these per processing
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
      text: 'One moment, pulling that up.',
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
   * Spoken barge-in acknowledgments - exactly ONE when the user interrupts
   * Jackie mid-answer. Fixed safe phrases (not model output), kept short so
   * listening resumes immediately after.
   */
  INTERRUPT_ACKS: [
    'Okay, what else can I help with?',
    'Sure, go ahead.',
    'Yeah?',
    'Okay, what do you need?',
  ],

  /**
   * Progressive VISUAL status (Claude-style) - shown on the pill / under the orb.
   * Not spoken. Driven by real pipeline events when streamStages is on;
   * timedApproximations are a fallback if stages aren't received yet.
   */
  PROGRESS_STATUS: {
    listening: {
      pill: 'Listening…',
      hint: "Go ahead, I'm following",
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

/**
 * Spoken intro for voice-mode open. Includes first name when known and not
 * email-shaped; otherwise falls back to INTRO_TEXT.
 */
export function buildIntroText(firstName?: string | null): string {
  const name = firstName?.trim();
  if (!name) return VOICE_CONFIG.INTRO_TEXT;
  return (
    `Hi ${name}, I'm Jackie, Paramount Intelligence's adviser. ` +
    'I can walk you through our work, share case examples, put together one-pagers, and answer questions about what we do. ' +
    'Let me know how I can help you?'
  );
}
