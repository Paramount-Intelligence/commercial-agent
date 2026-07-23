'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Loader2,
  Mic,
  MicOff,
  Volume2,
} from 'lucide-react';
import { cleanVoiceText } from '@/lib/citationText';
import { downloadConversationTranscript } from '@/lib/chat/downloadTranscript';
import { VOICE_CONFIG } from '@/lib/voice/config';

type VoiceState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error';

type CitedCase = {
  id: string;
  title: string;
  blurb?: string;
  url?: string;
};

type OnepagerAttachment = {
  /** Present on all newly produced attachments; absent on legacy history. */
  caseId?: string;
  /** Stable case+format identity; absent on legacy history. */
  documentId?: string;
  url: string;
  filename: string;
  caseTitle: string;
  source: 'uploaded' | 'generated' | 'generated-cached' | 'knowledge-share' | 'transcript';
  format: 'pdf' | 'png' | 'docx';
};

type ChatResponse = {
  conversationId?: string;
  reply?: string;
  citedCases?: CitedCase[];
  attachments?: OnepagerAttachment[];
  assistantMessageId?: string | null;
  limitReached?: boolean;
  error?: string;
};

type VoiceLimitSignal = {
  voiceLimitReached?: boolean;
  modality?: 'tts' | 'stt';
  used?: number;
  limit?: number;
  notice?: string;
  error?: string;
};

const THINKING_FILLERS = VOICE_CONFIG.THINKING_FILLERS;
const PROGRESS = VOICE_CONFIG.PROGRESS_STATUS;

type ProgressKey = Exclude<keyof typeof PROGRESS, 'timedFallbackMs'>;

const STATE_MESSAGES: Record<
  VoiceState,
  Array<{ pill: string; hint: string }>
> = {
  idle: [
    { pill: 'Listening — go ahead', hint: 'Ready when you are' },
    { pill: "I'm all ears", hint: 'What can I help you explore?' },
    { pill: 'Ready when you are', hint: 'Just start speaking' },
    { pill: 'Listening', hint: 'Go ahead whenever you’re ready' },
  ],
  listening: [PROGRESS.listening],
  processing: [
    PROGRESS.hearing,
    PROGRESS.thinking,
    PROGRESS.searching,
    PROGRESS.composing,
  ],
  speaking: [PROGRESS.speaking],
  error: [
    { pill: 'Microphone paused', hint: 'Enable the microphone to continue' },
  ],
};

const VAD = {
  START_RMS: 0.055,
  STOP_RMS: 0.03,
  /** Speech energy to begin interrupting Jackie (must beat speaker bleed). */
  BARGE_IN_RMS: 0.075,
  /** Soft floor — only abandon a barge attempt if energy stays below this. */
  BARGE_IN_KEEP_RMS: 0.04,
  START_HOLD_MS: 220,
  BARGE_IN_HOLD_MS: 110,
  BARGE_SOFT_ABORT_MS: 220,
  SILENCE_MS: 1_200,
  MIN_CAPTURE_MS: 600,
  BARGE_IN_GRACE_MS: 280,
} as const;

type TranscriptTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Case refs / one-pagers produced with this assistant turn (unified stream). */
  citedCases?: CitedCase[];
  attachments?: OnepagerAttachment[];
};

function recorderMime(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const candidate of candidates) {
    if (
      typeof MediaRecorder !== 'undefined' &&
      MediaRecorder.isTypeSupported(candidate)
    ) {
      return candidate;
    }
  }
  return '';
}

function extensionForMime(mime: string): string {
  const type = mime.toLowerCase();
  if (type.includes('mp4')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  return 'webm';
}

function captionWords(text: string): string[] {
  return text.match(/\S+/g) ?? [];
}

function attachmentKey(attachment: OnepagerAttachment): string {
  return (
    attachment.documentId ||
    (attachment.caseId
      ? `${attachment.caseId}:${attachment.format}`
      : attachment.url)
  );
}

function attachmentDownloadUrl(attachment: OnepagerAttachment): string {
  if (!attachment.caseId) return attachment.url;
  const params = new URLSearchParams({
    caseId: attachment.caseId,
    format: attachment.format,
  });
  return `/api/voice/onepager?${params.toString()}`;
}

function dedupeAttachments(
  items: OnepagerAttachment[],
): OnepagerAttachment[] {
  const deduped = new Map<string, OnepagerAttachment>();
  for (const item of items) deduped.set(attachmentKey(item), item);
  return [...deduped.values()];
}

export default function VoiceConversation({
  user,
}: {
  user: { name: string | null };
}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [historyReady, setHistoryReady] = useState(false);
  const [, setCitedCases] = useState<CitedCase[]>([]);
  const [, setAttachments] = useState<OnepagerAttachment[]>([]);
  const [, setLatestTurnAttachments] = useState<
    OnepagerAttachment[]
  >([]);
  const [transcriptTurns, setTranscriptTurns] = useState<TranscriptTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voiceLimitNotice, setVoiceLimitNotice] = useState<string | null>(null);
  const [orbLevel, setOrbLevel] = useState(0);
  const [micEnabled, setMicEnabled] = useState(false);
  /** Browser denied or blocked getUserMedia — show escape hatch to text chat. */
  const [micDenied, setMicDenied] = useState(false);
  /** Autoplay blocked Jackie's intro — show text + tap-to-start. */
  const [introAwaitingTap, setIntroAwaitingTap] = useState(false);
  const [stateMessage, setStateMessage] = useState(STATE_MESSAGES.idle[0]);
  const [transcriptDownloading, setTranscriptDownloading] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fillerRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const analyserContextRef = useRef<AudioContext | null>(null);
  const analyserFrameRef = useRef<number | null>(null);
  const captionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visibleAgentTextRef = useRef('');
  const activeAssistantTurnIdRef = useRef<string | null>(null);
  const fillerIndexRef = useRef(0);
  const fillerActiveRef = useRef(false);
  const fillerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Pre-synthesized Jackie filler clips (one blob URL per THINKING_FILLERS line). */
  const fillerBlobUrlsRef = useRef<(string | null)[]>([]);
  const introBlobUrlRef = useRef<string | null>(null);
  const introPlayedRef = useRef(false);
  const introTurnIdRef = useRef<string | null>(null);
  /** Visual progressive-status timers (approximation until real stage events). */
  const progressTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const progressSeenRef = useRef<{ searching: boolean; composing: boolean }>({
    searching: false,
    composing: false,
  });
  const bargeInRef = useRef(false);
  const stateRef = useRef<VoiceState>('idle');
  const micEnabledRef = useRef(false);
  const captureStartedAtRef = useRef(0);
  const silenceStartedAtRef = useRef<number | null>(null);
  const speakingStartedAtRef = useRef(0);
  const captureCommittedRef = useRef(false);
  const discardCaptureRef = useRef(false);
  const captureBargeInRef = useRef(false);
  const captureOriginStateRef = useRef<VoiceState>('idle');
  const bargeSoftSinceRef = useRef<number | null>(null);
  /** Bumps on interrupt so in-flight MSE/TTS loops stop appending/playing. */
  const speechGenerationRef = useRef(0);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const messageIndexRef = useRef<Record<VoiceState, number>>({
    idle: -1,
    listening: -1,
    processing: -1,
    speaking: -1,
    error: -1,
  });

  useEffect(() => {
    stateRef.current = state;
    // Processing copy is synchronized to the exact safe filler clip playing.
    if (state === 'processing') return;
    const variants = STATE_MESSAGES[state];
    const nextIndex = (messageIndexRef.current[state] + 1) % variants.length;
    messageIndexRef.current[state] = nextIndex;
    setStateMessage(variants[nextIndex]);
  }, [state]);

  useEffect(() => {
    const last = transcriptTurns[transcriptTurns.length - 1];
    if (last?.role === 'user') stickToBottomRef.current = true;
  }, [transcriptTurns]);

  useEffect(() => {
    const el = streamRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [transcriptTurns, state, stateMessage]);

  useEffect(() => {
    if (!historyReady) return;
    let cancelled = false;
    void (async () => {
      await prepareJackieAudio();
      if (cancelled) return;
      const intro = await playJackieIntro();
      if (cancelled) return;
      // Autoplay blocked: wait for an explicit tap before mic + speech.
      if (intro === 'blocked') return;
      await enableHandsFreeMic();
    })();
    return () => {
      cancelled = true;
    };
    // Intro + mic start once when history/session setup finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyReady]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/chat/history');
        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }
        const data = (await response.json()) as {
          conversationId?: string | null;
          messages?: Array<{
            role?: string;
            citedCases?: CitedCase[];
            attachments?: OnepagerAttachment[];
          }>;
        };
        if (!cancelled && data.conversationId) {
          setConversationId(data.conversationId);
          const caseMap = new Map<string, CitedCase>();
          const attachmentMap = new Map<string, OnepagerAttachment>();
          for (const message of data.messages ?? []) {
            for (const caseItem of message.citedCases ?? []) {
              caseMap.set(caseItem.id, caseItem);
            }
            for (const attachment of message.attachments ?? []) {
              attachmentMap.set(attachmentKey(attachment), attachment);
            }
          }
          setCitedCases([...caseMap.values()]);
          setAttachments([...attachmentMap.values()]);
          const latestAssistant = [...(data.messages ?? [])]
            .reverse()
            .find((message) => message.role === 'assistant');
          setLatestTurnAttachments(
            dedupeAttachments(latestAssistant?.attachments ?? []),
          );
        }
      } finally {
        if (!cancelled) setHistoryReady(true);
      }
    })();
    return () => {
      cancelled = true;
      cleanupAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopAnalyser() {
    if (analyserFrameRef.current != null) {
      cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = null;
    }
    void analyserContextRef.current?.close().catch(() => {});
    analyserContextRef.current = null;
    setOrbLevel(0);
  }

  function startVadLoop(stream: MediaStream) {
    stopAnalyser();
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.4;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    analyserContextRef.current = context;
    const values = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(values);
      let energy = 0;
      for (const sample of values) {
        const normalized = (sample - 128) / 128;
        energy += normalized * normalized;
      }
      const rms = Math.sqrt(energy / values.length);
      setOrbLevel(Math.min(1, rms * 9));

      const now = performance.now();
      const recorder = recorderRef.current;
      if (micEnabledRef.current && recorder?.state === 'recording') {
        if (!captureCommittedRef.current) {
          const isBarge = captureBargeInRef.current;
          const holdMs = isBarge ? VAD.BARGE_IN_HOLD_MS : VAD.START_HOLD_MS;
          const startThreshold = isBarge ? VAD.BARGE_IN_RMS : VAD.START_RMS;
          const keepThreshold = isBarge
            ? VAD.BARGE_IN_KEEP_RMS
            : VAD.START_RMS;

          if (rms < keepThreshold) {
            if (isBarge) {
              if (bargeSoftSinceRef.current == null) {
                bargeSoftSinceRef.current = now;
              } else if (
                now - bargeSoftSinceRef.current >= VAD.BARGE_SOFT_ABORT_MS
              ) {
                discardVadCapture();
              }
            } else {
              discardVadCapture();
            }
          } else {
            bargeSoftSinceRef.current = null;
            // Barge may have interrupted at capture start with a softer floor;
            // still require startThreshold energy to commit the utterance.
            if (
              rms >= startThreshold &&
              now - captureStartedAtRef.current >= holdMs
            ) {
              captureCommittedRef.current = true;
              if (isBarge) {
                // Audio may already be stopped at barge start; ensure cut-off.
                interruptSpeaking();
              }
              setState('listening');
            }
          }
        } else if (rms >= VAD.STOP_RMS) {
          silenceStartedAtRef.current = null;
        } else if (silenceStartedAtRef.current == null) {
          silenceStartedAtRef.current = now;
        } else if (
          now - silenceStartedAtRef.current >= VAD.SILENCE_MS &&
          now - captureStartedAtRef.current >= VAD.MIN_CAPTURE_MS
        ) {
          stopVadCapture();
        }
      } else if (micEnabledRef.current) {
        const currentState = stateRef.current;
        const canStart = currentState === 'idle' || currentState === 'error';
        const canBarge =
          currentState === 'speaking' &&
          now - speakingStartedAtRef.current >= VAD.BARGE_IN_GRACE_MS;
        const threshold = canBarge ? VAD.BARGE_IN_RMS : VAD.START_RMS;

        if ((canStart || canBarge) && rms >= threshold) {
          // Start a tentative recorder immediately to retain the first word,
          // but only commit if volume stays high for the hold duration.
          startVadCapture(canBarge);
        }
      }
      analyserFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  }

  /** Cut Jackie mid-utterance and freeze the caption at what was heard. */
  function interruptSpeaking() {
    if (stateRef.current !== 'speaking' && !audioRef.current) {
      // Still abort any lingering TTS/MSE work.
      bargeInRef.current = true;
      stopResponseAudio();
      return;
    }
    bargeInRef.current = true;
    const spokenPart = visibleAgentTextRef.current;
    setTranscriptTurns((turns) =>
      turns.map((turn, index) =>
        index === turns.length - 1 && turn.role === 'assistant'
          ? { ...turn, text: spokenPart || turn.text }
          : turn,
      ),
    );
    activeAssistantTurnIdRef.current = null;
    stopResponseAudio();
  }

  function stopResponseAudio() {
    speechGenerationRef.current += 1;
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    if (captionTimerRef.current) {
      clearInterval(captionTimerRef.current);
      captionTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      audioRef.current = null;
    }
  }

  function stopFiller() {
    fillerActiveRef.current = false;
    if (fillerTimerRef.current) clearTimeout(fillerTimerRef.current);
    if (fillerRef.current) {
      fillerRef.current.pause();
      fillerRef.current.currentTime = 0;
      fillerRef.current = null;
    }
  }

  function fadeOutFiller() {
    fillerActiveRef.current = false;
    if (fillerTimerRef.current) clearTimeout(fillerTimerRef.current);
    const audio = fillerRef.current;
    if (!audio) return;
    const fade = setInterval(() => {
      audio.volume = Math.max(0, audio.volume - 0.16);
      if (audio.volume <= 0.01) {
        clearInterval(fade);
        audio.pause();
        fillerRef.current = null;
      }
    }, 25);
  }

  function cleanupMic() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    micEnabledRef.current = false;
    setMicEnabled(false);
    stopAnalyser();
  }

  function cleanupAll() {
    clearProgressTimers();
    stopResponseAudio();
    stopFiller();
    cleanupMic();
    if (captionTimerRef.current) clearInterval(captionTimerRef.current);
    if (introBlobUrlRef.current) {
      URL.revokeObjectURL(introBlobUrlRef.current);
      introBlobUrlRef.current = null;
    }
    for (const url of fillerBlobUrlsRef.current) {
      if (url) URL.revokeObjectURL(url);
    }
    fillerBlobUrlsRef.current = [];
  }

  function clearProgressTimers() {
    for (const t of progressTimersRef.current) clearTimeout(t);
    progressTimersRef.current = [];
  }

  function setProgressStatus(key: ProgressKey) {
    const copy = PROGRESS[key];
    setStateMessage({ pill: copy.pill, hint: copy.hint });
  }

  /**
   * Soft timed stages while waiting on /api/chat — only fills gaps until real
   * `stage` events arrive. Never invents "searching" (that label is reserved for
   * real search_cases / search_company_info signals from the agent loop).
   *
   * TODO(stages): if NDJSON stage events are delayed by proxy buffering in prod,
   * prefer fixing flush/headers over expanding this approximation.
   */
  function startTimedProgressFallback() {
    clearProgressTimers();
    progressSeenRef.current = { searching: false, composing: false };
    setProgressStatus('thinking');
    const { composing } = PROGRESS.timedFallbackMs;
    // Only soft-advance to composing after a long think with no stage events.
    // Searching is driven exclusively by real onStage('searching') events.
    progressTimersRef.current.push(
      setTimeout(() => {
        if (
          !progressSeenRef.current.searching &&
          !progressSeenRef.current.composing
        ) {
          setProgressStatus('composing');
        }
      }, composing),
    );
  }

  function applyAgentStage(stage: string) {
    if (stage === 'searching') progressSeenRef.current.searching = true;
    if (stage === 'composing' || stage === 'validating') {
      progressSeenRef.current.composing = true;
    }
    if (
      stage === 'thinking' ||
      stage === 'searching' ||
      stage === 'composing' ||
      stage === 'validating'
    ) {
      // Real pipeline signal — clear timed approximation so it can't overwrite.
      clearProgressTimers();
      setProgressStatus(stage);
    }
  }

  async function readChatStream(transcript: string): Promise<ChatResponse> {
    const chatResponse = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        message: transcript,
        voiceMode: true,
        streamStages: true,
      }),
    });
    if (chatResponse.status === 401) {
      window.location.href = '/login';
      throw new Error('Not authenticated');
    }

    const contentType = chatResponse.headers.get('content-type') ?? '';
    // Cap / error paths still return JSON (not NDJSON).
    if (contentType.includes('application/json')) {
      const chat = (await chatResponse.json()) as ChatResponse;
      if (!chatResponse.ok) {
        throw new Error(chat.error || 'The adviser could not respond.');
      }
      return chat;
    }

    if (!chatResponse.ok || !chatResponse.body) {
      throw new Error('The adviser could not respond.');
    }

    const reader = chatResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: ChatResponse | null = null;
    let streamError: string | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line) continue;
        let evt: {
          type?: string;
          stage?: string;
          error?: string;
        } & ChatResponse;
        try {
          evt = JSON.parse(line) as typeof evt;
        } catch {
          continue;
        }
        if (evt.type === 'stage' && evt.stage) {
          applyAgentStage(evt.stage);
        } else if (evt.type === 'result') {
          result = evt;
        } else if (evt.type === 'error') {
          streamError = evt.error || 'The adviser could not respond.';
        }
      }
    }

    if (streamError) throw new Error(streamError);
    if (!result) throw new Error('The adviser returned an empty reply.');
    return result;
  }

  function pauseVoiceForDailyLimit(notice?: string) {
    clearProgressTimers();
    stopFiller();
    stopResponseAudio();
    cleanupMic();
    setError(null);
    setVoiceLimitNotice(
      notice ||
        "We've reached today's voice limit for your organization. You can keep going in text chat.",
    );
    setState('error');
  }

  /** Fetch Jackie speech as a Blob (fixed safe lines only — never model output). */
  async function fetchSpeechBlob(text: string): Promise<Blob | null> {
    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return null;
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const signal = (await res.json()) as VoiceLimitSignal;
        if (signal.voiceLimitReached) {
          pauseVoiceForDailyLimit(signal.notice);
        }
        return null;
      }
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  }

  /** Pre-synthesize intro + thinking fillers so turn-end has no TTS wait. */
  async function prepareJackieAudio() {
    const [introBlob, ...fillerBlobs] = await Promise.all([
      fetchSpeechBlob(VOICE_CONFIG.INTRO_TEXT),
      ...THINKING_FILLERS.map((f) => fetchSpeechBlob(f.text)),
    ]);
    if (introBlob) {
      if (introBlobUrlRef.current) URL.revokeObjectURL(introBlobUrlRef.current);
      introBlobUrlRef.current = URL.createObjectURL(introBlob);
    }
    fillerBlobUrlsRef.current = fillerBlobs.map((blob) =>
      blob ? URL.createObjectURL(blob) : null,
    );
  }

  /** Speak the fixed Jackie intro once on voice-mode open, then listen. */
  async function playJackieIntro(): Promise<'played' | 'blocked' | 'skipped'> {
    if (introPlayedRef.current) return 'skipped';
    const url = introBlobUrlRef.current;
    if (!url) return 'skipped';

    return new Promise((resolve) => {
      const audio = new Audio(url);
      audioRef.current = audio;
      if (!introTurnIdRef.current) {
        introTurnIdRef.current = crypto.randomUUID();
        const introTurnId = introTurnIdRef.current;
        setTranscriptTurns((turns) => [
          ...turns,
          { id: introTurnId, role: 'assistant', text: '' },
        ]);
      }
      activeAssistantTurnIdRef.current = introTurnIdRef.current;
      setState('speaking');
      setProgressStatus('speaking');
      setStateMessage({
        pill: `${VOICE_CONFIG.AGENT_DISPLAY_NAME} is introducing herself…`,
        hint: 'She’ll listen right after this',
      });
      speakingStartedAtRef.current = performance.now();
      revealCaption(audio, VOICE_CONFIG.INTRO_TEXT);

      let settled = false;
      const finishClean = (outcome: 'played' | 'blocked') => {
        if (settled) return;
        settled = true;
        if (captionTimerRef.current) clearInterval(captionTimerRef.current);
        captionTimerRef.current = null;
        visibleAgentTextRef.current = VOICE_CONFIG.INTRO_TEXT;
        updateActiveAssistantCaption(VOICE_CONFIG.INTRO_TEXT);
        activeAssistantTurnIdRef.current = null;
        audioRef.current = null;
        if (outcome === 'played') {
          setIntroAwaitingTap(false);
          setState('idle');
          resolve('played');
          return;
        }
        // Autoplay blocked — show the intro as text and wait for a tap.
        setIntroAwaitingTap(true);
        setStateMessage({
          pill: 'Tap to start',
          hint: 'Browsers often need a tap before audio can play',
        });
        setState('idle');
        resolve('blocked');
      };

      audio.onended = () => finishClean('played');
      audio.onerror = () => finishClean('blocked');
      void audio
        .play()
        .then(() => {
          introPlayedRef.current = true;
          setIntroAwaitingTap(false);
        })
        .catch(() => {
          // NotAllowedError / autoplay policy — don't mark intro as played.
          try {
            audio.pause();
          } catch {
            /* ignore */
          }
          finishClean('blocked');
        });
    });
  }

  /** User gesture: play intro (if needed) then request the mic. */
  async function startVoiceAfterGesture() {
    setIntroAwaitingTap(false);
    setMicDenied(false);
    setError(null);
    const intro = await playJackieIntro();
    if (intro === 'blocked') {
      // Still blocked somehow — keep the tap affordance.
      setIntroAwaitingTap(true);
      return;
    }
    await enableHandsFreeMic();
  }

  /**
   * Exactly ONE warm filler per thinking gap (rotate across turns).
   * Visual progressive status is separate — this only plays audio.
   * No chaining — silence until the real answer TTS starts.
   */
  function playSafeFiller() {
    stopFiller();
    fillerActiveRef.current = true;
    const index = fillerIndexRef.current % THINKING_FILLERS.length;
    fillerIndexRef.current += 1;
    const filler = THINKING_FILLERS[index];
    // Intentionally do NOT setStateMessage here — progressive visual status owns the pill.

    const cachedUrl = fillerBlobUrlsRef.current[index];
    if (cachedUrl) {
      const audio = new Audio(cachedUrl);
      audio.volume = 0.9;
      fillerRef.current = audio;
      // Intentionally no onended chain — one line only.
      void audio.play().catch(() => {});
      return;
    }

    // Cache miss: synthesize once (still never repeats within this gap).
    void (async () => {
      if (!fillerActiveRef.current) return;
      const blob = await fetchSpeechBlob(filler.text);
      if (!blob || !fillerActiveRef.current) return;
      const url = URL.createObjectURL(blob);
      fillerBlobUrlsRef.current[index] = url;
      const audio = new Audio(url);
      audio.volume = 0.9;
      fillerRef.current = audio;
      void audio.play().catch(() => {});
    })();
  }

  function updateActiveAssistantCaption(text: string) {
    const turnId = activeAssistantTurnIdRef.current;
    if (!turnId) return;
    setTranscriptTurns((turns) =>
      turns.map((turn) => (turn.id === turnId ? { ...turn, text } : turn)),
    );
  }

  function revealCaption(audio: HTMLAudioElement, text: string) {
    if (captionTimerRef.current) clearInterval(captionTimerRef.current);
    visibleAgentTextRef.current = '';
    const words = captionWords(text);
    const estimatedDuration = Math.max(1, words.length / 2.55);
    let revealedCount = 0;

    captionTimerRef.current = setInterval(() => {
      // MediaSource reports the duration of the currently buffered prefix
      // while streaming. Trust it only after endOfStream marks it final.
      const measuredDuration =
        audio.dataset.streamComplete === 'true' &&
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : estimatedDuration;
      const progress = Math.min(1, audio.currentTime / measuredDuration);
      let targetCount = Math.floor(progress * words.length);
      if (audio.currentTime > 0.12) targetCount = Math.max(1, targetCount);
      revealedCount = Math.max(revealedCount, targetCount);
      const visible = words.slice(0, revealedCount).join(' ');
      visibleAgentTextRef.current = visible;
      updateActiveAssistantCaption(visible);

      if (audio.ended && captionTimerRef.current) {
        visibleAgentTextRef.current = text;
        updateActiveAssistantCaption(text);
        clearInterval(captionTimerRef.current);
        captionTimerRef.current = null;
      }
    }, 80);
  }

  async function playStreamingSpeech(
    response: Response,
    finalText: string,
    onStarted: (audio: HTMLAudioElement) => void,
  ): Promise<void> {
    if (!response.body) throw new Error('Voice response contained no audio');

    const generation = ++speechGenerationRef.current;
    const audio = new Audio();
    audioRef.current = audio;
    audio.onended = () => {
      if (speechGenerationRef.current !== generation) return;
      if (captionTimerRef.current) clearInterval(captionTimerRef.current);
      captionTimerRef.current = null;
      visibleAgentTextRef.current = finalText;
      updateActiveAssistantCaption(finalText);
      activeAssistantTurnIdRef.current = null;
      setState('idle');
      stopResponseAudio();
    };

    const supportsMse =
      typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('audio/mpeg');

    if (!supportsMse) {
      const blob = await response.blob();
      if (speechGenerationRef.current !== generation) return;
      audio.src = URL.createObjectURL(blob);
      audio.dataset.streamComplete = 'true';
      onStarted(audio);
      await audio.play();
      return;
    }

    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    audio.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      mediaSource.addEventListener(
        'sourceopen',
        () => {
          void (async () => {
            try {
              const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
              const reader = response.body!.getReader();
              let started = false;
              for (;;) {
                if (speechGenerationRef.current !== generation) {
                  try {
                    await reader.cancel();
                  } catch {
                    /* ignore */
                  }
                  if (mediaSource.readyState === 'open') {
                    try {
                      mediaSource.endOfStream();
                    } catch {
                      /* ignore */
                    }
                  }
                  resolve();
                  return;
                }
                const { done, value } = await reader.read();
                if (done) break;
                if (!value?.byteLength) continue;
                await new Promise<void>((appendResolve, appendReject) => {
                  const updateEnd = () => {
                    sourceBuffer.removeEventListener('updateend', updateEnd);
                    appendResolve();
                  };
                  sourceBuffer.addEventListener('updateend', updateEnd);
                  try {
                    const copy = new Uint8Array(value.byteLength);
                    copy.set(value);
                    sourceBuffer.appendBuffer(copy);
                  } catch (appendError) {
                    sourceBuffer.removeEventListener('updateend', updateEnd);
                    appendReject(appendError);
                  }
                });
                if (!started) {
                  if (speechGenerationRef.current !== generation) {
                    resolve();
                    return;
                  }
                  started = true;
                  onStarted(audio);
                  await audio.play();
                }
              }
              if (
                speechGenerationRef.current === generation &&
                mediaSource.readyState === 'open'
              ) {
                mediaSource.endOfStream();
              }
              audio.dataset.streamComplete = 'true';
              resolve();
            } catch (streamError) {
              if (speechGenerationRef.current !== generation) {
                resolve();
                return;
              }
              reject(streamError);
            }
          })();
        },
        { once: true },
      );
    });
  }

  /**
   * Non-negotiable buffer-and-gate:
   * STT text goes through /api/chat → runAgentTurn → citation validator.
   * Only the final validated `reply` returned by /api/chat is sent to TTS.
   * Thinking fillers and the Jackie intro are fixed config lines (not model output).
   */
  async function processRecording(blob: Blob, durationSeconds: number) {
    bargeInRef.current = false;
    setState('processing');
    setError(null);
    setProgressStatus('hearing');
    playSafeFiller();
    try {
      const form = new FormData();
      form.append(
        'audio',
        blob,
        `voice-turn.${extensionForMime(blob.type)}`,
      );
      form.append('durationSeconds', String(durationSeconds));
      const sttResponse = await fetch('/api/voice/stt', {
        method: 'POST',
        body: form,
      });
      if (sttResponse.status === 401) {
        window.location.href = '/login';
        return;
      }
      const stt = (await sttResponse.json()) as {
        text?: string;
        error?: string;
        voiceLimitReached?: boolean;
        notice?: string;
      };
      if (stt.voiceLimitReached) {
        pauseVoiceForDailyLimit(stt.notice);
        return;
      }
      if (!sttResponse.ok || !stt.text) {
        throw new Error(stt.error || 'I could not hear that clearly.');
      }

      const transcript = stt.text.trim();
      setTranscriptTurns((turns) => [
        ...turns,
        { id: crypto.randomUUID(), role: 'user', text: transcript },
      ]);
      setLatestTurnAttachments([]);

      startTimedProgressFallback();
      const chat = await readChatStream(transcript);
      clearProgressTimers();

      if (chat.limitReached) {
        stopFiller();
        cleanupMic();
        setError(chat.reply || 'Daily adviser limit reached.');
        setState('error');
        return;
      }
      if (!chat.reply) throw new Error('The adviser returned an empty reply.');

      // The API reply is already validated; remove internal citation markers
      // before either the accessible caption or Jackie receives the text.
      const cleanReply = cleanVoiceText(chat.reply);
      if (chat.conversationId) setConversationId(chat.conversationId);
      setCitedCases((current) => {
        const merged = new Map(current.map((item) => [item.id, item]));
        for (const item of chat.citedCases ?? []) merged.set(item.id, item);
        return [...merged.values()];
      });
      const turnAttachments = dedupeAttachments(chat.attachments ?? []);
      setLatestTurnAttachments(turnAttachments);
      setAttachments((current) => {
        const merged = new Map(
          current.map((item) => [attachmentKey(item), item]),
        );
        for (const item of turnAttachments) {
          merged.set(attachmentKey(item), item);
        }
        return [...merged.values()];
      });

      setProgressStatus('composing');
      const controller = new AbortController();
      ttsAbortRef.current = controller;
      const ttsResponse = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanReply,
          messageId: chat.assistantMessageId || undefined,
        }),
        signal: controller.signal,
      });
      const ttsContentType = ttsResponse.headers.get('content-type') ?? '';
      if (ttsContentType.includes('application/json')) {
        const ttsSignal = (await ttsResponse.json()) as VoiceLimitSignal;
        if (ttsSignal.voiceLimitReached) {
          stopFiller();
          const assistantTurnId = crypto.randomUUID();
          setTranscriptTurns((turns) => [
            ...turns,
            {
              id: assistantTurnId,
              role: 'assistant',
              text: cleanReply,
              citedCases: chat.citedCases ?? [],
              attachments: turnAttachments,
            },
          ]);
          pauseVoiceForDailyLimit(ttsSignal.notice);
          return;
        }
        throw new Error(ttsSignal.error || 'Voice playback failed.');
      }
      if (!ttsResponse.ok) {
        const ttsError = (await ttsResponse.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(ttsError.error || 'Voice playback failed.');
      }

      await playStreamingSpeech(ttsResponse, cleanReply, (audio) => {
        fadeOutFiller();
        clearProgressTimers();
        speakingStartedAtRef.current = performance.now();
        const assistantTurnId = crypto.randomUUID();
        activeAssistantTurnIdRef.current = assistantTurnId;
        setTranscriptTurns((turns) => [
          ...turns,
          {
            id: assistantTurnId,
            role: 'assistant',
            text: '',
            citedCases: chat.citedCases ?? [],
            attachments: turnAttachments,
          },
        ]);
        setProgressStatus('speaking');
        setState('speaking');
        revealCaption(audio, cleanReply);
      });
    } catch (turnError) {
      clearProgressTimers();
      stopFiller();
      stopResponseAudio();
      if (
        bargeInRef.current ||
        (turnError as Error)?.name === 'AbortError'
      ) {
        return;
      }
      setError(
        turnError instanceof Error ? turnError.message : 'Voice turn failed.',
      );
      setState('error');
    }
  }

  function startVadCapture(isBargeIn = false) {
    const stream = micStreamRef.current;
    if (!stream || recorderRef.current?.state === 'recording') return;

    try {
      const mime = recorderMime();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const chunks = chunksRef.current;
        const type = recorder.mimeType || 'audio/webm';
        const committed = captureCommittedRef.current;
        const discarded = discardCaptureRef.current;
        const originState = captureOriginStateRef.current;
        const wasBarge = captureBargeInRef.current;
        recorderRef.current = null;
        chunksRef.current = [];
        captureCommittedRef.current = false;
        discardCaptureRef.current = false;
        captureBargeInRef.current = false;
        if (discarded || !committed || !chunks.length) {
          // If we already cut Jackie for a barge that didn't stick, don't
          // restore "speaking" with no audio — land on idle and listen again.
          if (wasBarge || bargeInRef.current) {
            setState('idle');
          } else {
            setState(originState);
          }
          return;
        }
        const blob = new Blob(chunks, { type });
        const durationSeconds = Math.max(
          0.1,
          (performance.now() - captureStartedAtRef.current) / 1000,
        );
        void processRecording(blob, durationSeconds);
      };
      captureCommittedRef.current = false;
      discardCaptureRef.current = false;
      captureBargeInRef.current = isBargeIn;
      captureOriginStateRef.current = stateRef.current;
      bargeSoftSinceRef.current = null;
      recorder.start();
      captureStartedAtRef.current = performance.now();
      silenceStartedAtRef.current = null;
      // Interrupt Jackie as soon as barge speech is detected — don't wait for
      // the hold window, or the user hears her keep talking over them.
      if (isBargeIn) {
        interruptSpeaking();
        setState('listening');
      }
    } catch (captureError) {
      setError(
        captureError instanceof Error
          ? captureError.message
          : 'Could not start voice capture.',
      );
      setState('error');
    }
  }

  function stopVadCapture() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }

  function discardVadCapture() {
    if (recorderRef.current?.state !== 'recording') return;
    discardCaptureRef.current = true;
    recorderRef.current.stop();
  }

  async function enableHandsFreeMic() {
    if (voiceLimitNotice) return;
    if (micStreamRef.current) return;
    setError(null);
    setMicDenied(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('No microphone input is available.');
      track.enabled = true;
      micStreamRef.current = stream;
      micEnabledRef.current = true;
      setMicEnabled(true);
      setMicDenied(false);
      setState('idle');
      startVadLoop(stream);
    } catch {
      cleanupMic();
      setMicDenied(true);
      setError(null);
      setStateMessage({
        pill: 'Microphone needed',
        hint: 'Grant access or continue in text chat',
      });
      setState('error');
    }
  }

  function toggleMic() {
    if (voiceLimitNotice) return;
    if (micEnabledRef.current) {
      cleanupMic();
      setState('error');
      setMicDenied(false);
      setError('Hands-free microphone is muted.');
    } else {
      void enableHandsFreeMic();
    }
  }

  const orbScale = 1 + orbLevel * 0.08;
  const firstName = user.name?.split(' ')[0];
  const hasUserInput = transcriptTurns.some((turn) => turn.role === 'user');
  const canDownloadTranscript =
    Boolean(conversationId) &&
    transcriptTurns.some((t) => t.text.trim().length > 0);

  async function onDownloadTranscript() {
    if (!conversationId || transcriptDownloading) return;
    setTranscriptDownloading(true);
    setError(null);
    try {
      await downloadConversationTranscript(conversationId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not download transcript',
      );
      setState('error');
    } finally {
      setTranscriptDownloading(false);
    }
  }

  return (
    <div className="voice-page">
      <main className="voice-stage">
        <div className="voice-topbar">
          <div className="voice-topbar-actions">
            <a href="/chat" className="voice-mode-btn">
              <ArrowLeft className="h-3.5 w-3.5" />
              Switch to text chat
            </a>
            {canDownloadTranscript ? (
              <button
                type="button"
                className="voice-mode-btn"
                onClick={() => void onDownloadTranscript()}
                disabled={transcriptDownloading}
                aria-label="Download conversation transcript"
                title="Download transcript"
              >
                {transcriptDownloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {transcriptDownloading
                  ? 'Preparing PDF…'
                  : 'Download transcript'}
              </button>
            ) : null}
          </div>
          <a
            href="https://www.paramountintelligence.co"
            target="_blank"
            rel="noopener noreferrer"
            className="voice-website-link"
            aria-label="Visit Paramount Intelligence website"
            title="Visit Paramount Intelligence website"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Visit website</span>
          </a>
        </div>

        <div
          className={`voice-layout${hasUserInput ? ' voice-layout-active' : ' voice-layout-intro'}`}
          aria-live="polite"
        >
          <section className="voice-center">
            <p className="voice-eyebrow">
              {VOICE_CONFIG.AGENT_DISPLAY_NAME} · Paramount Adviser
            </p>
            <h1 className="voice-heading">
              {firstName
                ? `Talk with ${VOICE_CONFIG.AGENT_DISPLAY_NAME}, ${firstName}`
                : `Talk with ${VOICE_CONFIG.AGENT_DISPLAY_NAME}`}
            </h1>

            <div
              className={`voice-jackie voice-jackie-${state}${state === 'speaking' ? ' voice-jackie-stoppable' : ''}`}
              style={{ transform: `scale(${orbScale})` }}
              role={state === 'speaking' ? 'button' : 'img'}
              tabIndex={state === 'speaking' ? 0 : undefined}
              aria-label={
                state === 'speaking'
                  ? `Stop ${VOICE_CONFIG.AGENT_DISPLAY_NAME} speaking`
                  : `${VOICE_CONFIG.AGENT_DISPLAY_NAME}: ${stateMessage.pill}`
              }
              onClick={() => {
                if (state !== 'speaking') return;
                interruptSpeaking();
                setState('idle');
              }}
              onKeyDown={(event) => {
                if (state !== 'speaking') return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                interruptSpeaking();
                setState('idle');
              }}
            >
              <span className="voice-jackie-aura" aria-hidden="true" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="voice-jackie-logo"
                src="/images/logo.png"
                alt="Paramount Intelligence"
              />
            </div>

            <div className="voice-controls">
              <button
                type="button"
                className="voice-mic-toggle"
                onClick={toggleMic}
                disabled={Boolean(voiceLimitNotice)}
                aria-label={micEnabled ? 'Mute microphone' : 'Enable microphone'}
                title={micEnabled ? 'Mute microphone' : 'Enable microphone'}
              >
                {micEnabled ? (
                  <Mic className="h-5 w-5" />
                ) : (
                  <MicOff className="h-5 w-5" />
                )}
              </button>
              <span className={`voice-status voice-status-${state}`}>
                <span className="voice-status-dot" />
                {stateMessage.pill}
              </span>
            </div>

            <p className="voice-instruction">
              {micEnabled
                ? stateMessage.hint
                : introAwaitingTap
                  ? 'Tap below to hear Jackie, then talk'
                  : micDenied
                    ? 'Microphone access is required for voice'
                    : 'Enable the microphone to continue'}
            </p>

            {introAwaitingTap ? (
              <div className="voice-gate-notice" role="status">
                <p className="voice-intro-fallback">{VOICE_CONFIG.INTRO_TEXT}</p>
                <button
                  type="button"
                  className="voice-start-btn"
                  onClick={() => void startVoiceAfterGesture()}
                >
                  Tap to start with {VOICE_CONFIG.AGENT_DISPLAY_NAME}
                </button>
                <a href="/chat" className="voice-mode-btn">
                  Switch to text chat
                </a>
              </div>
            ) : null}

            {micDenied && !introAwaitingTap ? (
              <div className="voice-gate-notice" role="status">
                <p>
                  I need microphone access to talk — or you can switch to text
                  chat.
                </p>
                <button
                  type="button"
                  className="voice-start-btn"
                  onClick={() => void enableHandsFreeMic()}
                >
                  Enable microphone
                </button>
                <a href="/chat" className="voice-mode-btn">
                  Switch to text chat
                </a>
              </div>
            ) : null}

            {voiceLimitNotice ? (
              <div className="voice-limit-notice" role="status">
                <p>{voiceLimitNotice}</p>
                <a href="/chat" className="voice-mode-btn">
                  Switch to text chat
                </a>
              </div>
            ) : null}
            {error && !micDenied ? (
              <p className="voice-error">{error}</p>
            ) : null}
          </section>

          <div
            ref={streamRef}
            className="voice-stream"
            aria-label="Conversation"
            aria-hidden={!hasUserInput}
            onScroll={() => {
              const el = streamRef.current;
              if (!el) return;
              const distanceFromBottom =
                el.scrollHeight - el.scrollTop - el.clientHeight;
              stickToBottomRef.current = distanceFromBottom < 96;
            }}
          >
            {hasUserInput
              ? transcriptTurns.map((turn) => (
                  <div
                    key={turn.id}
                    className={`voice-stream-turn voice-stream-${turn.role}`}
                  >
                    <span className="voice-stream-label">
                      {turn.role === 'assistant' ? (
                        <Volume2 className="h-3.5 w-3.5" />
                      ) : null}
                      {turn.role === 'assistant'
                        ? VOICE_CONFIG.AGENT_LABEL
                        : 'You'}
                    </span>
                    {turn.text ? <p>{turn.text}</p> : null}
                    {turn.citedCases?.map((caseItem) => (
                      <div key={caseItem.id} className="voice-stream-ref">
                        {caseItem.url ? (
                          <a
                            href={caseItem.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="voice-stream-case"
                          >
                            {caseItem.title}
                          </a>
                        ) : (
                          <span className="voice-stream-case">
                            {caseItem.title}
                          </span>
                        )}
                        {caseItem.blurb ? (
                          <small>{caseItem.blurb}</small>
                        ) : null}
                      </div>
                    ))}
                    {turn.attachments?.map((attachment) => (
                      <a
                        key={attachmentKey(attachment)}
                        href={attachmentDownloadUrl(attachment)}
                        download={attachment.filename}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="voice-stream-download"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {attachment.source === 'knowledge-share' ||
                        attachment.source === 'transcript'
                          ? `Download — ${attachment.caseTitle} (${attachment.format.toUpperCase()})`
                          : `Download one-pager — ${attachment.caseTitle} (${attachment.format.toUpperCase()})`}
                      </a>
                    ))}
                  </div>
                ))
              : null}
            {hasUserInput && state === 'processing' ? (
              <div className="voice-stream-turn voice-stream-assistant voice-stream-thinking">
                <span className="voice-stream-label">
                  {VOICE_CONFIG.AGENT_LABEL}
                </span>
                <p>{stateMessage.pill}</p>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
