/**
 * Per-turn voice latency instrumentation (diagnostic only, no behaviour change).
 *
 * One record per committed voice turn, timed with performance.now() in the
 * browser. Each record is logged once as `[voice-timing]` and appended to
 * window.__voiceTimings. In the browser console:
 *
 *   copy(window.__voiceTimingsCsv())   // all turns as CSV for the baseline sheet
 *   window.__voiceTimings              // raw records, including server phases
 *
 * Marks (all relative to `speechEnd`, the moment the user went quiet):
 *   committed        turn closed by the silence window (or max capture)
 *   wavReady         WebM decoded and re-encoded as WAV for Fish ASR
 *   sttDone          /api/voice/stt JSON received
 *   firstStage       first NDJSON stage event from /api/chat
 *   firstSentence    first fully checked sentence received from /api/chat
 *   chatDone         /api/chat final result received (validated reply)
 *   ttsFirstResponse first /api/voice/tts response headers received
 *   audioStarted     first answer audio handed to the <audio> element
 *   audioPlaying     first answer audio actually playing ("playing" event)
 */

export const VOICE_TIMING_MARKS = [
  'speechEnd',
  'committed',
  'wavReady',
  'sttDone',
  'firstStage',
  'firstSentence',
  'chatDone',
  'ttsFirstResponse',
  'audioStarted',
  'audioPlaying',
] as const;

export type VoiceTimingMark = (typeof VOICE_TIMING_MARKS)[number];

export type VoiceTurnTiming = {
  id: number;
  marks: Partial<Record<VoiceTimingMark, number>>;
  /** Server-reported phase timings (ms), keyed by route. */
  server: Record<string, unknown>;
  meta: Record<string, string | number | boolean | null>;
  emitted: boolean;
};

export type VoiceTimingSummary = {
  id: number;
  outcome: string;
  /** End of speech → first answer audio playing. Null if no audio played. */
  totalMs: number | null;
  /** Duration of each stage, in pipeline order. */
  stagesMs: Record<string, number | null>;
  /** Each mark relative to speechEnd. */
  sinceSpeechEndMs: Partial<Record<VoiceTimingMark, number>>;
  server: Record<string, unknown>;
  meta: VoiceTurnTiming['meta'];
};

declare global {
  interface Window {
    __voiceTimings?: VoiceTimingSummary[];
    __voiceTimingsCsv?: () => string;
  }
}

export const VOICE_TIMING_EVENT = 'voice-timing';

let sequence = 0;

export function startTurnTiming(
  speechEndAt: number,
  committedAt: number = performance.now(),
): VoiceTurnTiming {
  sequence += 1;
  return {
    id: sequence,
    marks: { speechEnd: speechEndAt, committed: committedAt },
    server: {},
    meta: {},
    emitted: false,
  };
}

/** First write wins, so prefetches and retries never move a mark. */
export function markTiming(
  timing: VoiceTurnTiming | null | undefined,
  mark: VoiceTimingMark,
  at: number = performance.now(),
): void {
  if (!timing || timing.marks[mark] !== undefined) return;
  timing.marks[mark] = at;
}

function between(
  timing: VoiceTurnTiming,
  from: VoiceTimingMark,
  to: VoiceTimingMark,
): number | null {
  const a = timing.marks[from];
  const b = timing.marks[to];
  if (a === undefined || b === undefined) return null;
  return Math.round(b - a);
}

function inferOutcome(timing: VoiceTurnTiming): string {
  if (timing.marks.audioPlaying !== undefined) return 'spoke';
  if (timing.meta.sttIgnored) return 'stt-ignored';
  if (timing.marks.sttDone === undefined) return 'stopped-before-stt';
  if (timing.marks.chatDone === undefined) return 'stopped-before-reply';
  return 'no-audio';
}

export function summarizeTiming(
  timing: VoiceTurnTiming,
  outcome?: string,
): VoiceTimingSummary {
  const start = timing.marks.speechEnd ?? 0;
  const sinceSpeechEndMs: Partial<Record<VoiceTimingMark, number>> = {};
  for (const mark of VOICE_TIMING_MARKS) {
    const at = timing.marks[mark];
    if (at !== undefined) sinceSpeechEndMs[mark] = Math.round(at - start);
  }
  return {
    id: timing.id,
    outcome: outcome ?? inferOutcome(timing),
    totalMs: between(timing, 'speechEnd', 'audioPlaying'),
    stagesMs: {
      endOfSpeechWindow: between(timing, 'speechEnd', 'committed'),
      wavEncode: between(timing, 'committed', 'wavReady'),
      sttRoundTrip: between(timing, 'wavReady', 'sttDone'),
      chatToFirstStage: between(timing, 'sttDone', 'firstStage'),
      chatToFirstSentence: between(timing, 'sttDone', 'firstSentence'),
      chatRoundTrip: between(timing, 'sttDone', 'chatDone'),
      ttsFirstResponse: timing.marks.firstSentence !== undefined
        ? between(timing, 'firstSentence', 'ttsFirstResponse')
        : between(timing, 'chatDone', 'ttsFirstResponse'),
      playbackStart: between(timing, 'ttsFirstResponse', 'audioPlaying'),
    },
    sinceSpeechEndMs,
    server: timing.server,
    meta: timing.meta,
  };
}

const CSV_COLUMNS = [
  'id',
  'outcome',
  'totalMs',
  'endOfSpeechWindow',
  'wavEncode',
  'sttRoundTrip',
  'chatToFirstStage',
  'chatToFirstSentence',
  'chatRoundTrip',
  'ttsFirstResponse',
  'playbackStart',
  'transcriptChars',
  'replyChars',
  'ttsChunks',
  'firstChunkChars',
  'uploadBytes',
  'recordedSeconds',
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function timingsToCsv(rows: VoiceTimingSummary[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    const flat: Record<string, unknown> = {
      id: row.id,
      outcome: row.outcome,
      totalMs: row.totalMs,
      ...row.stagesMs,
      ...row.meta,
    };
    lines.push(CSV_COLUMNS.map((col) => csvCell(flat[col])).join(','));
  }
  return lines.join('\n');
}

/** Log once per turn; later calls for the same turn are ignored. */
export function emitTiming(
  timing: VoiceTurnTiming | null | undefined,
  outcome?: string,
): VoiceTimingSummary | null {
  if (!timing || timing.emitted) return null;
  timing.emitted = true;
  const summary = summarizeTiming(timing, outcome);
  console.info('[voice-timing]', summary);
  if (typeof window !== 'undefined') {
    window.__voiceTimings = [...(window.__voiceTimings ?? []), summary];
    window.__voiceTimingsCsv = () => timingsToCsv(window.__voiceTimings ?? []);
    window.dispatchEvent(
      new CustomEvent<VoiceTimingSummary>(VOICE_TIMING_EVENT, {
        detail: summary,
      }),
    );
  }
  return summary;
}
