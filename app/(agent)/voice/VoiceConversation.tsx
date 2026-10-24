'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  ExternalLink,
  Eye,
  Loader2,
  Mic,
  MicOff,
  Square,
  Volume2,
} from 'lucide-react';
import { cleanVoiceText, formatVoiceDisplayText } from '@/lib/citationText';
import { isEmailShapedName } from '@/lib/auth/agentUserName';
import { usableSpeechText } from '@/lib/voice/speechFilter';
import { prepareAudioForFishAsr } from '@/lib/voice/prepareAudioForFishAsr';
import { buildIntroText, VOICE_CONFIG } from '@/lib/voice/config';
import { splitTextForTtsChunks } from '@/lib/voice/ttsChunks';
import {
  emitTiming,
  markTiming,
  startTurnTiming,
  type VoiceTurnTiming,
} from '@/lib/voice/turnTiming';
import VoiceTimingPanel from './VoiceTimingPanel';
import SignOutButton from '@/components/SignOutButton';
import DocumentViewer, {
  type ViewableDoc,
} from '@/app/(agent)/chat/DocumentViewer';
import ReactMarkdown from 'react-markdown';
import {
  openFluxBrowserSession,
  type FluxBrowserSession,
  type FluxTurnEvent,
} from '@/lib/voice/deepgramFluxBrowser';
import {
  DEEPGRAM_FLUX_CONFIG,
  eagerEotEnabled,
  fishListeningEnabled,
  fishSttFallbackEnabled,
  fluxReconnectDelayMs,
  voiceSttProvider,
} from '@/lib/voice/deepgramConfig';
import {
  markVoiceInterruptionStopped,
  markVoiceSession,
  resolveVoiceInterruption,
  setVoiceSessionMeta,
  startVoiceInterruption,
  startVoiceSessionTiming,
  type VoiceInterruptionTiming,
  type VoiceSessionTiming,
} from '@/lib/voice/baseline';
import {
  VoiceSessionController,
  type VoiceTurnCancelReason,
} from '@/lib/voice/sessionController';
import { OrderedSpeechPipeline } from '@/lib/voice/speechPipeline';

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
  /** Server phase timings (diagnostic). */
  timingMs?: Record<string, number>;
};

type VoiceLimitSignal = {
  voiceLimitReached?: boolean;
  modality?: 'tts' | 'stt';
  used?: number;
  limit?: number;
  notice?: string;
  error?: string;
};

class VoiceLimitReachedError extends Error {
  constructor(readonly notice?: string) {
    super('Daily voice limit reached.');
    this.name = 'VoiceLimitReachedError';
  }
}

type SpeechSegment = {
  text: string;
  captionPrefix: string;
};

const THINKING_FILLERS = VOICE_CONFIG.THINKING_FILLERS;
const PROGRESS = VOICE_CONFIG.PROGRESS_STATUS;

type ProgressKey = Exclude<keyof typeof PROGRESS, 'timedFallbackMs'>;

const STATE_MESSAGES: Record<
  VoiceState,
  Array<{ pill: string; hint: string }>
> = {
  idle: [
    { pill: 'Listening, go ahead', hint: 'Ready when you are' },
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

const VAD = VOICE_CONFIG.VAD;

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

function attachmentViewUrl(attachment: OnepagerAttachment): string {
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
  assistantName,
  debugAllowed = false,
}: {
  user: { name: string | null };
  assistantName: string;
  /** Admin session or TIMING_DEBUG: allows the ?debug=1 latency panel. */
  debugAllowed?: boolean;
}) {
  const firstName = (() => {
    const raw = user.name?.trim();
    if (!raw || isEmailShapedName(raw)) return null;
    return raw.split(/\s+/)[0] || null;
  })();
  const introText = buildIntroText(firstName, assistantName);

  const [state, setState] = useState<VoiceState>('idle');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [historyReady, setHistoryReady] = useState(false);
  /** True while history + TTS assets load — status shows “Setting it up”. */
  const [settingUp, setSettingUp] = useState(true);
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
  const [stateMessage, setStateMessage] = useState({
    pill: 'Setting it up',
    hint: `Getting ${assistantName} ready`,
  });
  const [viewingDoc, setViewingDoc] = useState<ViewableDoc | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micOpenPromiseRef = useRef<Promise<void> | null>(null);
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
  const introPreparePromiseRef = useRef<Promise<void> | null>(null);
  const fillerWarmPromiseRef = useRef<Promise<void> | null>(null);
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
  /** Latency instrumentation for the turn being committed (diagnostic only). */
  const turnTimingRef = useRef<VoiceTurnTiming | null>(null);
  /** Loudest RMS after commit — used for peak-relative end-of-speech. */
  const utterancePeakRef = useRef(0);
  const speakingStartedAtRef = useRef(0);
  const captureCommittedRef = useRef(false);
  const discardCaptureRef = useRef(false);
  const captureBargeInRef = useRef(false);
  const captureOriginStateRef = useRef<VoiceState>('idle');
  /** Start of the current uninterrupted above-threshold run. */
  const vadAboveThresholdSinceRef = useRef<number | null>(null);
  const vadBelowThresholdSinceRef = useRef<number | null>(null);
  /** Measured ambient RMS — thresholds sit above this so room noise is ignored. */
  const noiseFloorRef = useRef(0.02);
  const noiseCalibrateUntilRef = useRef(0);
  const noiseCalibrateSamplesRef = useRef<number[]>([]);
  /** Bumps on interrupt so in-flight MSE/TTS loops stop appending/playing. */
  const speechGenerationRef = useRef(0);
  /** Aborts in-flight STT/chat when the user explicitly stops Jackie. */
  const turnAbortRef = useRef<AbortController | null>(null);
  const fluxSessionRef = useRef<FluxBrowserSession | null>(null);
  const fluxActiveRef = useRef(false);
  const fluxReconnectAttemptRef = useRef(0);
  const fluxReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fluxRolloverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fluxTurnBusyRef = useRef(false);
  const fluxPendingTurnRef = useRef<{
    transcript: string;
    durationSeconds: number;
  } | null>(null);
  const fluxPrewarmAbortRef = useRef<AbortController | null>(null);
  const fluxLocalBargeSinceRef = useRef<number | null>(null);
  const responseDuckedRef = useRef(false);
  const voiceTurnControllerRef = useRef(new VoiceSessionController());
  const historyReadyRef = useRef(false);
  const voiceMountedRef = useRef(true);
  const voiceSessionTimingRef = useRef<VoiceSessionTiming | null>(null);
  const activeInterruptionRef = useRef<VoiceInterruptionTiming | null>(null);
  const interruptionResolutionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    // Hold fixed copy during boot; processing syncs to the filler clip.
    if (settingUp) return;
    if (state === 'processing') return;
    const variants = STATE_MESSAGES[state];
    const nextIndex = (messageIndexRef.current[state] + 1) % variants.length;
    messageIndexRef.current[state] = nextIndex;
    setStateMessage(variants[nextIndex]);
  }, [state, settingUp]);

  useEffect(() => {
    const last = transcriptTurns[transcriptTurns.length - 1];
    if (last?.role === 'user') stickToBottomRef.current = true;
  }, [transcriptTurns]);

  useEffect(() => {
    const el = streamRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [transcriptTurns, state, stateMessage]);

  function sessionMark(mark: Parameters<typeof markVoiceSession>[1]) {
    markVoiceSession(voiceSessionTimingRef.current, mark);
  }

  function isLatestVoiceTurn(turnId: number): boolean {
    return voiceTurnControllerRef.current.snapshot()?.id === turnId;
  }

  function beginMeasuredInterruption(
    source: VoiceInterruptionTiming['source'],
  ): VoiceInterruptionTiming {
    const current = activeInterruptionRef.current;
    if (current && current.confirmed === null) return current;
    const interruption = startVoiceInterruption(source);
    activeInterruptionRef.current = interruption;
    if (interruptionResolutionTimerRef.current) {
      clearTimeout(interruptionResolutionTimerRef.current);
    }
    if (source !== 'stop-button') {
      interruptionResolutionTimerRef.current = setTimeout(() => {
        if (activeInterruptionRef.current !== interruption) return;
        resolveVoiceInterruption(interruption, false);
        activeInterruptionRef.current = null;
      }, 12_000);
    }
    return interruption;
  }

  function finishMeasuredInterruption(confirmed: boolean) {
    const interruption = activeInterruptionRef.current;
    if (!interruption) return;
    resolveVoiceInterruption(interruption, confirmed);
    if (interruptionResolutionTimerRef.current) {
      clearTimeout(interruptionResolutionTimerRef.current);
      interruptionResolutionTimerRef.current = null;
    }
    activeInterruptionRef.current = null;
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const storageKey = 'paramount-voice-session-seen';
    const warm = window.sessionStorage.getItem(storageKey) === '1';
    window.sessionStorage.setItem(storageKey, '1');
    const connection = (
      navigator as Navigator & {
        connection?: { effectiveType?: string; downlink?: number; rtt?: number };
      }
    ).connection;
    voiceSessionTimingRef.current = startVoiceSessionTiming({
      warm,
      deviceLabel: params.get('device') ?? undefined,
      runLabel: params.get('run') ?? undefined,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
      network: connection
        ? `${connection.effectiveType ?? 'unknown'};${connection.downlink ?? '?'}Mbps;${connection.rtt ?? '?'}ms`
        : 'unavailable',
    });
    // Begin the permission prompt and live STT connection as soon as voice mode
    // mounts. History can load beside it, but committed turns wait for history.
    void enableHandsFreeMic();
    void prepareIntroAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!historyReady) return;
    let cancelled = false;
    void (async () => {
      setSettingUp(true);
      setStateMessage({
        pill: 'Setting it up',
        hint: `Getting ${assistantName} ready`,
      });
      // Listening is the critical path. Open the microphone and Flux while the
      // optional spoken introduction is synthesized in parallel.
      const introReady = prepareIntroAudio();
      await enableHandsFreeMic();
      if (cancelled) return;
      setSettingUp(false);
      sessionMark('setupReady');
      await introReady;
      if (cancelled) return;
      // If the buyer has already started, never talk over their first turn.
      if (stateRef.current !== 'idle') {
        introPlayedRef.current = true;
        void warmFillerAudio();
        return;
      }
      const intro = await playJackieIntro();
      if (cancelled) return;
      if (intro !== 'blocked') void warmFillerAudio();
    })();
    return () => {
      cancelled = true;
    };
    // Finish the optional introduction once conversation history is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyReady]);

  useEffect(() => {
    let cancelled = false;
    voiceMountedRef.current = true;
    sessionMark('historyRequested');
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
        if (!cancelled) {
          historyReadyRef.current = true;
          sessionMark('historyReady');
          setHistoryReady(true);
          void drainPendingFluxTurn();
        }
      }
    })();
    return () => {
      cancelled = true;
      voiceMountedRef.current = false;
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

  function vadThresholds() {
    const floor = noiseFloorRef.current;
    return {
      start: Math.max(VAD.START_RMS, floor + VAD.NOISE_MARGIN_START),
      barge: Math.max(VAD.BARGE_IN_RMS, floor + VAD.NOISE_MARGIN_BARGE),
      stop: Math.max(VAD.STOP_RMS, floor + VAD.NOISE_MARGIN_STOP),
    };
  }

  /**
   * Speech-band energy (~300–3400 Hz). Ignores rumble/HVAC better than raw RMS;
   * Chromium voiceIsolation further attenuates non-primary talkers when available.
   */
  function speechBandLevel(
    analyser: AnalyserNode,
    freqData: Uint8Array<ArrayBuffer>,
  ): number {
    analyser.getByteFrequencyData(freqData);
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    const lo = Math.max(1, Math.floor(300 / binHz));
    const hi = Math.min(freqData.length - 1, Math.ceil(3400 / binHz));
    let sum = 0;
    let count = 0;
    for (let i = lo; i <= hi; i++) {
      const n = freqData[i]! / 255;
      sum += n * n;
      count += 1;
    }
    return count > 0 ? Math.sqrt(sum / count) : 0;
  }

  function startVadLoop(stream: MediaStream) {
    stopAnalyser();
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.35;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    analyserContextRef.current = context;
    // Chrome often leaves new contexts suspended without an explicit resume —
    // suspended analysers report silence, so Jackie never "hears" the user.
    void context.resume().catch(() => {});
    const timeDomain = new Uint8Array(
      new ArrayBuffer(analyser.fftSize),
    );
    const freqDomain = new Uint8Array(
      new ArrayBuffer(analyser.frequencyBinCount),
    );
    // Defer ambient sampling until Jackie is idle — calibrating during the
    // intro would bake speaker playback into the noise floor.
    noiseCalibrateSamplesRef.current = [];
    noiseCalibrateUntilRef.current = 0;
    let floorReady = false;
    const tick = () => {
      if (context.state === 'suspended') {
        void context.resume().catch(() => {});
      }
      analyser.getByteTimeDomainData(timeDomain);
      let energy = 0;
      for (const sample of timeDomain) {
        const normalized = (sample - 128) / 128;
        energy += normalized * normalized;
      }
      const rms = Math.sqrt(energy / timeDomain.length);
      const speech = speechBandLevel(analyser, freqDomain);
      // Orb follows blended energy; activation decisions require speech-band.
      const level = Math.max(rms, speech * 0.85);
      setOrbLevel(Math.min(1, level * 9));

      const now = performance.now();
      const idleForNoise =
        stateRef.current === 'idle' &&
        !audioRef.current;

      if (!floorReady) {
        if (noiseCalibrateUntilRef.current === 0) {
          if (idleForNoise) {
            noiseCalibrateUntilRef.current = now + VAD.NOISE_CALIBRATE_MS;
            noiseCalibrateSamplesRef.current = [];
          }
        } else if (!idleForNoise) {
          // Jackie started talking — restart ambient sample after she finishes.
          noiseCalibrateUntilRef.current = 0;
          noiseCalibrateSamplesRef.current = [];
        } else if (now < noiseCalibrateUntilRef.current) {
          // Calibrate on broadband ambient, not speech-band spikes.
          noiseCalibrateSamplesRef.current.push(rms);
        } else {
          const samples = noiseCalibrateSamplesRef.current;
          if (samples.length) {
            samples.sort((a, b) => a - b);
            const idx = Math.min(
              samples.length - 1,
              Math.floor(samples.length * 0.75),
            );
            noiseFloorRef.current = Math.max(0.01, samples[idx] ?? 0.02);
          }
          noiseCalibrateSamplesRef.current = [];
          noiseCalibrateUntilRef.current = 0;
          floorReady = true;
        }
      }

      // Absolute thresholds until ambient floor is known; then adaptive.
      const thresholds = floorReady
        ? vadThresholds()
        : {
            start: VAD.START_RMS,
            barge: VAD.BARGE_IN_RMS,
            stop: VAD.STOP_RMS,
          };

      /** Human-voice gate: RMS alone is not enough — speech band must agree. */
      const isVoiceLike = (rmsTh: number, speechRatio: number) =>
        rms >= rmsTh && speech >= rmsTh * speechRatio;

      const recorder = recorderRef.current;
      const fishCaptureAvailable =
        fishListeningEnabled() &&
        (voiceSttProvider() === 'fish' || !fluxSessionRef.current);
      if (fluxActiveRef.current && micEnabledRef.current) {
        const canBarge =
          stateRef.current === 'speaking' &&
          now - speakingStartedAtRef.current >= VAD.BARGE_IN_GRACE_MS;
        if (canBarge && isVoiceLike(thresholds.barge, VAD.BARGE_SPEECH_BAND_RATIO)) {
          if (fluxLocalBargeSinceRef.current == null) {
            fluxLocalBargeSinceRef.current = now;
            duckResponseAudio();
            beginMeasuredInterruption('local-vad');
          }
          if (
            now - fluxLocalBargeSinceRef.current >=
            VAD.LOCAL_HARD_CANCEL_MS
          ) {
            hardCancelActiveTurn('local-vad');
            fluxLocalBargeSinceRef.current = null;
          }
        } else {
          if (fluxLocalBargeSinceRef.current != null) {
            restoreResponseAudio();
            finishMeasuredInterruption(false);
          }
          fluxLocalBargeSinceRef.current = null;
        }
      } else if (
        fishCaptureAvailable &&
        micEnabledRef.current &&
        recorder?.state === 'recording'
      ) {
        if (!captureCommittedRef.current) {
          const isBarge = captureBargeInRef.current;
          const sustainMs = isBarge
            ? VAD.BARGE_IN_SUSTAIN_MS
            : VAD.START_SUSTAIN_MS;
          const startThreshold = isBarge ? thresholds.barge : thresholds.start;
          const speechRatio = isBarge
            ? VAD.BARGE_SPEECH_BAND_RATIO
            : VAD.SPEECH_BAND_RATIO;

          if (isVoiceLike(startThreshold, speechRatio)) {
            vadBelowThresholdSinceRef.current = null;
            if (vadAboveThresholdSinceRef.current == null) {
              vadAboveThresholdSinceRef.current = now;
            }
            if (
              now - vadAboveThresholdSinceRef.current >= sustainMs
            ) {
              captureCommittedRef.current = true;
              if (isBarge) {
                // Only sustained speech—not the initial spike—may cut Jackie.
                hardCancelActiveTurn('local-vad');
              }
              setState('listening');
            }
          } else {
            // Allow tiny waveform dips within speech, but a transient spike
            // followed by normal room level is discarded after the gap window.
            if (vadBelowThresholdSinceRef.current == null) {
              vadBelowThresholdSinceRef.current = now;
            } else if (
              now - vadBelowThresholdSinceRef.current >=
              VAD.ACTIVATION_GAP_TOLERANCE_MS
            ) {
              vadAboveThresholdSinceRef.current = null;
              vadBelowThresholdSinceRef.current = null;
              discardVadCapture();
            }
          }
        } else {
          // Committed listening — wait for a real pause, not a mid-clause dip.
          // Peak decays so one loud word doesn't make the rest of the sentence
          // look "quiet" relative to that spike.
          utterancePeakRef.current = Math.max(
            rms,
            utterancePeakRef.current * VAD.PEAK_DECAY,
          );
          const nearAbsoluteQuiet = rms < thresholds.stop * 1.6;
          const peakQuiet =
            utterancePeakRef.current > thresholds.start &&
            rms < utterancePeakRef.current * VAD.PEAK_SILENCE_RATIO &&
            nearAbsoluteQuiet;
          const belowStop = rms < thresholds.stop;
          const hitMax =
            now - captureStartedAtRef.current >= VAD.MAX_CAPTURE_MS;

          if (hitMax) {
            stopVadCapture();
          } else if (belowStop || peakQuiet) {
            if (silenceStartedAtRef.current == null) {
              silenceStartedAtRef.current = now;
            } else if (
              now - silenceStartedAtRef.current >= VAD.SILENCE_MS &&
              now - captureStartedAtRef.current >= VAD.MIN_CAPTURE_MS
            ) {
              stopVadCapture();
            }
          } else {
            silenceStartedAtRef.current = null;
          }
        }
      } else if (fishCaptureAvailable && micEnabledRef.current) {
        const currentState = stateRef.current;
        const canStart = currentState === 'idle' || currentState === 'error';
        const canBarge =
          currentState === 'speaking' &&
          now - speakingStartedAtRef.current >= VAD.BARGE_IN_GRACE_MS;
        const threshold = canBarge ? thresholds.barge : thresholds.start;
        const speechRatio = canBarge
          ? VAD.BARGE_SPEECH_BAND_RATIO
          : VAD.SPEECH_BAND_RATIO;

        // Track ambient only while waiting — keeps TV/HVAC from becoming "speech".
        if (
          floorReady &&
          canStart &&
          rms < threshold * 0.7 &&
          rms < noiseFloorRef.current + 0.01
        ) {
          noiseFloorRef.current =
            noiseFloorRef.current * (1 - VAD.NOISE_FLOOR_EMA) +
            rms * VAD.NOISE_FLOOR_EMA;
        }

        if ((canStart || canBarge) && isVoiceLike(threshold, speechRatio)) {
          if (canBarge) {
            duckResponseAudio();
            beginMeasuredInterruption('local-vad');
          }
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
      stopFiller();
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
    stopFiller();
    stopResponseAudio();
  }

  /** Quiet playback immediately while local VAD awaits turn confirmation. */
  function duckResponseAudio() {
    if (responseDuckedRef.current) return;
    responseDuckedRef.current = true;
    if (audioRef.current) audioRef.current.volume = 0.12;
    if (fillerRef.current) fillerRef.current.volume = 0.08;
  }

  function restoreResponseAudio() {
    if (!responseDuckedRef.current) return;
    responseDuckedRef.current = false;
    if (audioRef.current) audioRef.current.volume = 1;
    if (fillerRef.current) fillerRef.current.volume = 0.9;
  }

  function stopResponseAudio() {
    responseDuckedRef.current = false;
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
    fluxPrewarmAbortRef.current?.abort();
    fluxPrewarmAbortRef.current = null;
    fluxSessionRef.current?.close();
    fluxSessionRef.current = null;
    if (fluxReconnectTimerRef.current) clearTimeout(fluxReconnectTimerRef.current);
    if (fluxRolloverTimerRef.current) clearTimeout(fluxRolloverTimerRef.current);
    if (interruptionResolutionTimerRef.current) {
      clearTimeout(interruptionResolutionTimerRef.current);
    }
    fluxReconnectTimerRef.current = null;
    fluxRolloverTimerRef.current = null;
    interruptionResolutionTimerRef.current = null;
    fluxReconnectAttemptRef.current = 0;
    fluxActiveRef.current = false;
    fluxTurnBusyRef.current = false;
    fluxPendingTurnRef.current = null;
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
    voiceTurnControllerRef.current.cancelActive('cleanup');
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
    if (stage === 'searching') {
      progressSeenRef.current.searching = true;
      // Fallback for a turn started outside normal VAD commit. Normal turns
      // already start exactly one waiting line in stopVadCapture.
      if (!fillerActiveRef.current) playSafeFiller();
    }
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

  async function readChatStream(
    transcript: string,
    signal?: AbortSignal,
    timing?: VoiceTurnTiming | null,
    onSentence?: (sentence: string) => void,
  ): Promise<ChatResponse> {
    const chatResponse = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        message: transcript,
        voiceMode: true,
        streamStages: true,
      }),
      signal,
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
        throw new Error(chat.error || `${assistantName} could not respond.`);
      }
      return chat;
    }

    if (!chatResponse.ok || !chatResponse.body) {
      throw new Error(`${assistantName} could not respond.`);
    }

    const reader = chatResponse.body.getReader();
    const onAbort = () => {
      void reader.cancel().catch(() => {});
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const decoder = new TextDecoder();
    let buffer = '';
    let result: ChatResponse | null = null;
    let streamError: string | null = null;

    try {
      for (;;) {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
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
            sentence?: string;
            error?: string;
          } & ChatResponse;
          try {
            evt = JSON.parse(line) as typeof evt;
          } catch {
            continue;
          }
          if (evt.type === 'stage' && evt.stage) {
            markTiming(timing, 'firstStage');
            applyAgentStage(evt.stage);
          } else if (evt.type === 'sentence' && evt.sentence) {
            onSentence?.(evt.sentence);
          } else if (evt.type === 'result') {
            result = evt;
          } else if (evt.type === 'error') {
            streamError = evt.error || `${assistantName} could not respond.`;
          }
        }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (streamError) throw new Error(streamError);
    if (!result) throw new Error(`${assistantName} returned an empty reply.`);
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
  function hardCancelActiveTurn(
    source: Extract<
      VoiceTurnCancelReason,
      'flux-start' | 'local-vad' | 'stop-button'
    >,
  ) {
    const interruption =
      stateRef.current === 'speaking' || audioRef.current
        ? beginMeasuredInterruption(source)
        : activeInterruptionRef.current;
    voiceTurnControllerRef.current.cancelActive(source);
    fluxPrewarmAbortRef.current?.abort();
    fluxPrewarmAbortRef.current = null;
    turnAbortRef.current?.abort();
    interruptSpeaking();
    markVoiceInterruptionStopped(interruption);
    clearProgressTimers();
    stopFiller();
    fluxLocalBargeSinceRef.current = null;
    if (micEnabledRef.current) setState('listening');
  }

  function prewarmFluxTurn(transcript: string) {
    fluxPrewarmAbortRef.current?.abort();
    const controller = new AbortController();
    fluxPrewarmAbortRef.current = controller;
    void fetch('/api/chat/prewarm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: transcript }),
      signal: controller.signal,
    }).catch(() => {});
  }

  function handleFluxTurn(event: FluxTurnEvent) {
    if (event.event === 'StartOfTurn') {
      if (stateRef.current === 'speaking' || stateRef.current === 'processing') {
        hardCancelActiveTurn('flux-start');
      } else {
        setState('listening');
      }
      return;
    }
    if (event.event === 'EagerEndOfTurn') {
      if (event.transcript) prewarmFluxTurn(event.transcript);
      return;
    }
    if (event.event === 'TurnResumed') {
      fluxPrewarmAbortRef.current?.abort();
      fluxPrewarmAbortRef.current = null;
      return;
    }
    if (event.event !== 'EndOfTurn' || !event.transcript) return;
    finishMeasuredInterruption(true);
    fluxPrewarmAbortRef.current = null;
    // If this is an interruption, the cancelled prior turn may still be
    // unwinding. Keep the newest committed transcript and run it immediately
    // after that cleanup instead of dropping the user's barge-in.
    fluxPendingTurnRef.current = {
      transcript: event.transcript,
      durationSeconds: Math.max(0, event.audioEnd - event.audioStart),
    };
    void drainPendingFluxTurn();
  }

  async function drainPendingFluxTurn() {
    if (!historyReadyRef.current || fluxTurnBusyRef.current) return;
    const pending = fluxPendingTurnRef.current;
    if (!pending) return;
    fluxPendingTurnRef.current = null;
    await processFluxTranscript(pending.transcript, pending.durationSeconds);
  }

  function scheduleFluxReconnect(stream: MediaStream, reason: string) {
    if (
      fluxReconnectTimerRef.current ||
      !micEnabledRef.current ||
      voiceSttProvider() !== 'deepgram'
    ) {
      return;
    }
    const attempt = fluxReconnectAttemptRef.current;
    if (attempt >= DEEPGRAM_FLUX_CONFIG.reconnect.maxAttempts) {
      console.warn('[voice/flux] reconnect exhausted; Fish fallback remains active', {
        attempts: attempt,
        reason,
      });
      return;
    }
    const delayMs = fluxReconnectDelayMs(attempt);
    fluxReconnectAttemptRef.current += 1;
    console.info('[voice/flux] reconnect scheduled', {
      attempt: attempt + 1,
      delayMs,
      reason,
    });
    fluxReconnectTimerRef.current = setTimeout(() => {
      fluxReconnectTimerRef.current = null;
      startFluxListening(stream);
    }, delayMs);
  }

  function startFluxListening(stream: MediaStream) {
    if (voiceSttProvider() !== 'deepgram' || fluxSessionRef.current) return;
    sessionMark('fluxRequested');
    // Until the socket is actually open, the existing Fish recorder remains
    // available rather than dropping the buyer's first words.
    fluxActiveRef.current = false;
    const session = openFluxBrowserSession(
      stream,
      {
        onTurn: handleFluxTurn,
        onError: (fluxError) => {
          if (fluxSessionRef.current !== session) return;
          console.warn('[voice/flux] live listening unavailable; using Fish fallback', {
            name: fluxError.name,
          });
          setVoiceSessionMeta(
            voiceSessionTimingRef.current,
            'fluxLastError',
            fluxError.name || 'error',
          );
          setVoiceSessionMeta(
            voiceSessionTimingRef.current,
            'sttFallbackUsed',
            true,
          );
          fluxSessionRef.current = null;
          fluxActiveRef.current = false;
          if (fluxRolloverTimerRef.current) clearTimeout(fluxRolloverTimerRef.current);
          fluxRolloverTimerRef.current = null;
          session.close();
          scheduleFluxReconnect(stream, fluxError.name || 'error');
          if (!fishSttFallbackEnabled()) {
            setError('Live listening is temporarily unavailable.');
            setState('error');
          }
        },
        onOpen: () => {
          if (fluxSessionRef.current !== session) return;
          fluxActiveRef.current = true;
          sessionMark('fluxConnected');
          setVoiceSessionMeta(
            voiceSessionTimingRef.current,
            'sttProvider',
            'deepgram-flux',
          );
          fluxReconnectAttemptRef.current = 0;
          if (!fishSttFallbackEnabled()) {
            setError(null);
            if (stateRef.current === 'error') setState('idle');
          }
          if (fluxRolloverTimerRef.current) clearTimeout(fluxRolloverTimerRef.current);
          fluxRolloverTimerRef.current = setTimeout(() => {
            if (fluxSessionRef.current !== session) return;
            console.info('[voice/flux] refreshing live session');
            fluxSessionRef.current = null;
            fluxActiveRef.current = false;
            session.close();
            if (micEnabledRef.current) startFluxListening(stream);
          }, DEEPGRAM_FLUX_CONFIG.maxSessionMs);
          console.info('[voice/flux] live listening connected');
        },
        onClose: () => {
          if (fluxSessionRef.current !== session) return;
          fluxSessionRef.current = null;
          fluxActiveRef.current = false;
          if (fluxRolloverTimerRef.current) clearTimeout(fluxRolloverTimerRef.current);
          fluxRolloverTimerRef.current = null;
          // Release this session's capture graph before reconnecting. The Fish
          // VAD path remains available while Flux is offline.
          session.close();
          scheduleFluxReconnect(stream, 'closed');
        },
      },
      { eager: eagerEotEnabled() },
    );
    fluxSessionRef.current = session;
    void session.ready.catch(() => {});
  }

  /** Flux transcript -> checked sentence stream -> Fish audio queue. */
  async function processFluxTranscript(
    rawTranscript: string,
    durationSeconds: number,
  ) {
    const transcript = usableSpeechText(rawTranscript);
    if (!transcript || fluxTurnBusyRef.current) return;
    fluxTurnBusyRef.current = true;
    bargeInRef.current = false;
    setState('processing');
    setError(null);
    setProgressStatus('thinking');
    const sessionTurnId = voiceTurnControllerRef.current.begin();
    const turnAbort = new AbortController();
    turnAbortRef.current?.abort();
    turnAbortRef.current = turnAbort;
    voiceTurnControllerRef.current.register(sessionTurnId, turnAbort);
    const now = performance.now();
    const timing = startTurnTiming(now, now);
    timing.meta.sttProvider = 'deepgram-flux';
    timing.meta.recordedSeconds = Math.round(durationSeconds * 10) / 10;
    timing.meta.transcriptChars = transcript.length;
    markTiming(timing, 'sttDone', now);
    setTranscriptTurns((turns) => [
      ...turns,
      { id: crypto.randomUUID(), role: 'user', text: transcript },
    ]);
    setLatestTurnAttachments([]);
    startTimedProgressFallback();

    const ttsController = new AbortController();
    ttsAbortRef.current = ttsController;
    voiceTurnControllerRef.current.register(sessionTurnId, ttsController);
    const spokenSentences: string[] = [];
    const assistantTurnId = crypto.randomUUID();
    let startedSpeaking = false;

    const speechPipeline = new OrderedSpeechPipeline<SpeechSegment, Response>(
      async (segment) => {
        if (
          turnAbort.signal.aborted ||
          !voiceTurnControllerRef.current.isCurrent(sessionTurnId)
        ) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const response = await fetch('/api/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: segment.text }),
          signal: ttsController.signal,
        });
        const contentType = response.headers.get('content-type') ?? '';
        if (!response.ok || contentType.includes('application/json')) {
          const body = (await response.json().catch(() => ({}))) as VoiceLimitSignal;
          if (body.voiceLimitReached) {
            throw new VoiceLimitReachedError(body.notice);
          }
          throw new Error(body.error || 'Voice playback failed.');
        }
        if (timing.marks.ttsFirstResponse === undefined) {
          markTiming(timing, 'ttsFirstResponse');
          const serverTiming = response.headers.get('x-timing-ms');
          if (serverTiming) {
            try {
              timing.server.ttsFirst = JSON.parse(serverTiming);
            } catch {
              /* diagnostic only */
            }
          }
        }
        return response;
      },
      async (response, segment) => {
        if (!voiceTurnControllerRef.current.isCurrent(sessionTurnId)) {
          throw new DOMException('Aborted', 'AbortError');
        }
        await playStreamingSpeech(
          response,
          segment.text,
          (audio) => {
            if (!startedSpeaking) {
              if (!voiceTurnControllerRef.current.isCurrent(sessionTurnId)) return;
              startedSpeaking = true;
              voiceTurnControllerRef.current.transition(sessionTurnId, 'responding');
              markTiming(timing, 'audioStarted');
              audio.addEventListener(
                'playing',
                () => {
                  markTiming(timing, 'audioPlaying');
                  emitTiming(timing, 'spoke');
                },
                { once: true },
              );
              fadeOutFiller();
              clearProgressTimers();
              speakingStartedAtRef.current = performance.now();
              activeAssistantTurnIdRef.current = assistantTurnId;
              setTranscriptTurns((turns) => [
                ...turns,
                { id: assistantTurnId, role: 'assistant', text: '' },
              ]);
              setState('speaking');
            }
            revealCaption(audio, segment.text, {
              prefix: segment.captionPrefix,
            });
          },
          { settleTurn: false, captionPrefix: segment.captionPrefix },
        );
      },
      { maxAhead: 2, signal: ttsController.signal },
    );

    const queueSentence = (rawSentence: string) => {
      const sentence = cleanVoiceText(rawSentence).trim();
      if (!sentence) return;
      markTiming(timing, 'firstSentence');
      const prefix = spokenSentences.join(' ').trim();
      spokenSentences.push(sentence);
      speechPipeline.enqueue({ text: sentence, captionPrefix: prefix });
    };

    try {
      const chat = await readChatStream(
        transcript,
        turnAbort.signal,
        timing,
        queueSentence,
      );
      markTiming(timing, 'chatDone');
      if (chat.timingMs) timing.server.chat = chat.timingMs;
      if (
        turnAbort.signal.aborted ||
        !voiceTurnControllerRef.current.isCurrent(sessionTurnId)
      ) return;
      if (chat.limitReached) {
        pauseVoiceForDailyLimit(chat.reply);
        return;
      }
      if (!chat.reply) throw new Error(`${assistantName} returned an empty reply.`);

      const displayReply = formatVoiceDisplayText(chat.reply);
      const fullSpoken = cleanVoiceText(chat.reply).trim();
      const alreadyQueued = spokenSentences.join(' ').trim();
      if (!alreadyQueued) {
        for (const chunk of splitTextForTtsChunks(fullSpoken, 180)) {
          queueSentence(chunk);
        }
      } else if (fullSpoken.startsWith(alreadyQueued)) {
        const remainder = fullSpoken.slice(alreadyQueued.length).trim();
        if (remainder) {
          for (const chunk of splitTextForTtsChunks(remainder, 180)) {
            queueSentence(chunk);
          }
        }
      }
      await speechPipeline.close();
      timing.meta.ttsChunks = speechPipeline.stats().enqueued;
      timing.meta.ttsMaxAhead = speechPipeline.stats().maxAheadObserved;
      if (
        turnAbort.signal.aborted ||
        !voiceTurnControllerRef.current.isCurrent(sessionTurnId)
      ) return;

      if (chat.conversationId) setConversationId(chat.conversationId);
      const turnAttachments = dedupeAttachments(chat.attachments ?? []);
      setLatestTurnAttachments(turnAttachments);
      setTranscriptTurns((turns) => {
        const finalTurn = {
          id: assistantTurnId,
          role: 'assistant' as const,
          text: displayReply,
          citedCases: chat.citedCases ?? [],
          attachments: turnAttachments,
        };
        return turns.some((turn) => turn.id === assistantTurnId)
          ? turns.map((turn) =>
              turn.id === assistantTurnId ? { ...turn, ...finalTurn } : turn,
            )
          : [...turns, finalTurn];
      });
      activeAssistantTurnIdRef.current = null;
      visibleAgentTextRef.current = displayReply;
      voiceTurnControllerRef.current.complete(sessionTurnId);
      setState('idle');
    } catch (turnError) {
      ttsController.abort();
      void speechPipeline.close().catch(() => {});
      if (turnError instanceof VoiceLimitReachedError) {
        pauseVoiceForDailyLimit(turnError.notice);
        return;
      }
      if (
        turnAbort.signal.aborted ||
        (turnError instanceof DOMException && turnError.name === 'AbortError')
      ) {
        if (isLatestVoiceTurn(sessionTurnId)) setState('idle');
        return;
      }
      if (!isLatestVoiceTurn(sessionTurnId)) return;
      setError(
        turnError instanceof Error ? turnError.message : 'Voice turn failed.',
      );
      setState('error');
    } finally {
      ttsController.abort();
      void speechPipeline.close().catch(() => {});
      emitTiming(timing);
      if (turnAbortRef.current === turnAbort) turnAbortRef.current = null;
      if (ttsAbortRef.current === ttsController) ttsAbortRef.current = null;
      voiceTurnControllerRef.current.complete(sessionTurnId);
      fluxTurnBusyRef.current = false;
      void drainPendingFluxTurn();
    }
  }

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

  /** Prepare only the intro; it runs beside mic/Flux setup, never before it. */
  function prepareIntroAudio(): Promise<void> {
    if (introBlobUrlRef.current) return Promise.resolve();
    if (introPreparePromiseRef.current) return introPreparePromiseRef.current;
    sessionMark('introRequested');
    const promise = (async () => {
      const blob = await fetchSpeechBlob(introText);
      if (!blob || !voiceMountedRef.current) return;
      if (introBlobUrlRef.current) URL.revokeObjectURL(introBlobUrlRef.current);
      introBlobUrlRef.current = URL.createObjectURL(blob);
      sessionMark('introReady');
    })().finally(() => {
      if (introPreparePromiseRef.current === promise) {
        introPreparePromiseRef.current = null;
      }
    });
    introPreparePromiseRef.current = promise;
    return promise;
  }

  /** Warm optional fillers lazily after startup. */
  function warmFillerAudio(): Promise<void> {
    if (fillerWarmPromiseRef.current) return fillerWarmPromiseRef.current;
    const promise = (async () => {
      for (let index = 0; index < THINKING_FILLERS.length; index += 1) {
        if (fillerBlobUrlsRef.current[index]) continue;
        const blob = await fetchSpeechBlob(THINKING_FILLERS[index]!.text);
        if (!voiceMountedRef.current) return;
        if (blob) fillerBlobUrlsRef.current[index] = URL.createObjectURL(blob);
      }
    })().finally(() => {
      if (fillerWarmPromiseRef.current === promise) {
        fillerWarmPromiseRef.current = null;
      }
    });
    fillerWarmPromiseRef.current = promise;
    return promise;
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
        pill: `${assistantName} is introducing itself…`,
        hint: 'You can start speaking at any time',
      });
      speakingStartedAtRef.current = performance.now();
      revealCaption(audio, introText);

      let settled = false;
      const finishClean = (outcome: 'played' | 'blocked') => {
        if (settled) return;
        settled = true;
        if (captionTimerRef.current) clearInterval(captionTimerRef.current);
        captionTimerRef.current = null;
        visibleAgentTextRef.current = introText;
        updateActiveAssistantCaption(introText);
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

  /** User gesture: open listening first and prepare the intro in parallel. */
  async function startVoiceAfterGesture() {
    setIntroAwaitingTap(false);
    setMicDenied(false);
    setError(null);
    const introReady = prepareIntroAudio();
    await enableHandsFreeMic();
    await introReady;
    const intro = await playJackieIntro();
    if (intro === 'blocked') {
      // Still blocked somehow — keep the tap affordance.
      setIntroAwaitingTap(true);
      return;
    }
    void warmFillerAudio();
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

  function revealCaption(
    audio: HTMLAudioElement,
    chunkText: string,
    opts?: { prefix?: string },
  ) {
    if (captionTimerRef.current) clearInterval(captionTimerRef.current);
    const prefix = opts?.prefix?.trim() ?? '';
    const words = captionWords(chunkText);
    const estimatedDuration = Math.max(1, words.length / 2.55);
    let revealedCount = 0;

    const paint = (chunkVisible: string) => {
      const combined = prefix
        ? chunkVisible
          ? `${prefix} ${chunkVisible}`
          : prefix
        : chunkVisible;
      visibleAgentTextRef.current = combined;
      updateActiveAssistantCaption(combined);
    };

    paint('');

    captionTimerRef.current = setInterval(() => {
      const measuredDuration =
        audio.dataset.streamComplete === 'true' &&
        Number.isFinite(audio.duration) &&
        audio.duration > 0
          ? audio.duration
          : estimatedDuration;
      const progress = Math.min(1, audio.currentTime / measuredDuration);
      let targetCount = Math.floor(progress * words.length);
      if (audio.currentTime > 0.12) targetCount = Math.max(1, targetCount);
      revealedCount = Math.max(revealedCount, targetCount);
      paint(words.slice(0, revealedCount).join(' '));

      if (audio.ended && captionTimerRef.current) {
        paint(chunkText);
        clearInterval(captionTimerRef.current);
        captionTimerRef.current = null;
      }
    }, 80);
  }

  async function playStreamingSpeech(
    response: Response,
    chunkText: string,
    onStarted: (audio: HTMLAudioElement) => void,
    opts?: {
      settleTurn?: boolean;
      captionPrefix?: string;
      /** Full reply caption when the last chunk finishes. */
      settleCaptionTo?: string;
    },
  ): Promise<void> {
    if (!response.body) throw new Error('Voice response contained no audio');

    const settleTurn = opts?.settleTurn !== false;
    const captionPrefix = opts?.captionPrefix ?? '';
    const settleCaptionTo = opts?.settleCaptionTo ?? chunkText;
    const generation = ++speechGenerationRef.current;
    const audio = new Audio();
    audioRef.current = audio;

    const playbackDone = new Promise<void>((resolve) => {
      audio.onended = () => {
        if (speechGenerationRef.current !== generation) {
          resolve();
          return;
        }
        if (captionTimerRef.current) clearInterval(captionTimerRef.current);
        captionTimerRef.current = null;
        const doneText = settleTurn
          ? settleCaptionTo
          : captionPrefix
            ? `${captionPrefix} ${chunkText}`.trim()
            : chunkText;
        visibleAgentTextRef.current = doneText;
        updateActiveAssistantCaption(doneText);
        if (settleTurn) {
          activeAssistantTurnIdRef.current = null;
          setState('idle');
          stopResponseAudio();
        }
        resolve();
      };
      audio.onerror = () => resolve();
    });

    const supportsMse =
      typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('audio/mpeg');

    if (!supportsMse) {
      const blob = await response.blob();
      if (speechGenerationRef.current !== generation) return;
      const objectUrl = URL.createObjectURL(blob);
      try {
        audio.src = objectUrl;
        audio.dataset.streamComplete = 'true';
        onStarted(audio);
        await audio.play();
        await playbackDone;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      return;
    }

    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    audio.src = objectUrl;

    try {
      await new Promise<void>((resolve, reject) => {
        mediaSource.addEventListener(
        'sourceopen',
        () => {
          void (async () => {
            try {
              const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
              const reader = response.body!.getReader();
              // Arm playback before the first append. The route has already
              // received Fish's first bytes before returning its headers, so
              // this lets the media element move from waiting -> playing as
              // soon as that first MP3 frame is decoded instead of scheduling
              // play only after SourceBuffer's updateend event.
              onStarted(audio);
              const playPromise = audio.play();
              let appended = false;
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
                if (!appended) {
                  if (speechGenerationRef.current !== generation) {
                    resolve();
                    return;
                  }
                  appended = true;
                  await playPromise;
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
      await playbackDone;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
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
    const sessionTurnId = voiceTurnControllerRef.current.begin();
    const turnAbort = new AbortController();
    turnAbortRef.current = turnAbort;
    voiceTurnControllerRef.current.register(sessionTurnId, turnAbort);
    // Diagnostic: bind this turn's timing record locally so a later turn
    // cannot overwrite it.
    const timing = turnTimingRef.current;
    turnTimingRef.current = null;
    if (timing) timing.meta.sttProvider = 'fish-fallback';
    let turnTtsController: AbortController | null = null;
    let turnSpeechPipeline: OrderedSpeechPipeline<SpeechSegment, Response> | null =
      null;
    // Conversational turns stay silent and respond directly. A spoken waiting
    // line starts only if the agent reports a real retrieval stage.
    try {
      const prepared = await prepareAudioForFishAsr(blob);
      markTiming(timing, 'wavReady');
      if (timing) {
        timing.meta.uploadBytes = prepared.blob.size;
        timing.meta.recordedSeconds = Math.round(durationSeconds * 10) / 10;
      }
      console.info('[voice] stt upload prepared', {
        sourceType: blob.type,
        sourceBytes: blob.size,
        uploadType: prepared.mimeType,
        uploadBytes: prepared.blob.size,
        filename: prepared.filename,
      });
      const form = new FormData();
      form.append('audio', prepared.blob, prepared.filename);
      form.append('durationSeconds', String(durationSeconds));
      const sttResponse = await fetch('/api/voice/stt', {
        method: 'POST',
        body: form,
        signal: turnAbort.signal,
      });
      if (sttResponse.status === 401) {
        window.location.href = '/login';
        return;
      }
      const stt = (await sttResponse.json()) as {
        text?: string;
        error?: string;
        ignored?: boolean;
        voiceLimitReached?: boolean;
        notice?: string;
        timingMs?: Record<string, number>;
      };
      markTiming(timing, 'sttDone');
      if (timing && stt.timingMs) timing.server.stt = stt.timingMs;
      if (
        turnAbort.signal.aborted ||
        bargeInRef.current ||
        !voiceTurnControllerRef.current.isCurrent(sessionTurnId)
      ) {
        if (isLatestVoiceTurn(sessionTurnId)) setState('idle');
        return;
      }
      if (stt.voiceLimitReached) {
        pauseVoiceForDailyLimit(stt.notice);
        return;
      }
      // Ambient / "[background noise]" — don't show an error or call the agent.
      const transcript = usableSpeechText(stt.text ?? '');
      if (stt.ignored || !transcript) {
        finishMeasuredInterruption(false);
        if (timing) timing.meta.sttIgnored = true;
        setError(null);
        setState('idle');
        return;
      }
      if (!sttResponse.ok) {
        finishMeasuredInterruption(false);
        throw new Error(stt.error || 'I could not hear that clearly.');
      }

      finishMeasuredInterruption(true);

      setTranscriptTurns((turns) => [
        ...turns,
        { id: crypto.randomUUID(), role: 'user', text: transcript },
      ]);
      setLatestTurnAttachments([]);

      if (timing) timing.meta.transcriptChars = transcript.length;
      startTimedProgressFallback();
      const controller = new AbortController();
      turnTtsController = controller;
      ttsAbortRef.current = controller;
      voiceTurnControllerRef.current.register(sessionTurnId, controller);
      const spokenSentences: string[] = [];
      const assistantTurnId = crypto.randomUUID();
      let startedSpeaking = false;

      const speechPipeline = new OrderedSpeechPipeline<SpeechSegment, Response>(
        async (segment) => {
          if (
            turnAbort.signal.aborted ||
            bargeInRef.current ||
            !voiceTurnControllerRef.current.isCurrent(sessionTurnId)
          ) {
            throw new DOMException('Aborted', 'AbortError');
          }
          const ttsResponse = await fetch('/api/voice/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: segment.text }),
            signal: controller.signal,
          });
          if (timing && timing.marks.ttsFirstResponse === undefined) {
            markTiming(timing, 'ttsFirstResponse');
            const serverTiming = ttsResponse.headers.get('x-timing-ms');
            if (serverTiming) {
              try {
                timing.server.ttsFirst = JSON.parse(serverTiming);
              } catch {
                /* diagnostic only */
              }
            }
          }
          const contentType = ttsResponse.headers.get('content-type') ?? '';
          if (!ttsResponse.ok || contentType.includes('application/json')) {
            const body = (await ttsResponse.json().catch(() => ({}))) as VoiceLimitSignal;
            if (body.voiceLimitReached) {
              throw new VoiceLimitReachedError(body.notice);
            }
            throw new Error(
              body.error || 'Voice playback failed for a speech segment.',
            );
          }
          return ttsResponse;
        },
        async (response, segment) => {
          if (!voiceTurnControllerRef.current.isCurrent(sessionTurnId)) {
            throw new DOMException('Aborted', 'AbortError');
          }
          await playStreamingSpeech(
            response,
            segment.text,
            (audio) => {
              if (!startedSpeaking) {
                if (!voiceTurnControllerRef.current.isCurrent(sessionTurnId)) return;
                startedSpeaking = true;
                voiceTurnControllerRef.current.transition(sessionTurnId, 'responding');
                markTiming(timing, 'audioStarted');
                audio.addEventListener(
                  'playing',
                  () => {
                    markTiming(timing, 'audioPlaying');
                    emitTiming(timing, 'spoke');
                  },
                  { once: true },
                );
                fadeOutFiller();
                clearProgressTimers();
                speakingStartedAtRef.current = performance.now();
                activeAssistantTurnIdRef.current = assistantTurnId;
                setTranscriptTurns((turns) => [
                  ...turns,
                  { id: assistantTurnId, role: 'assistant', text: '' },
                ]);
                setProgressStatus('speaking');
                setState('speaking');
              }
              revealCaption(audio, segment.text, {
                prefix: segment.captionPrefix,
              });
            },
            { settleTurn: false, captionPrefix: segment.captionPrefix },
          );
        },
        { maxAhead: 2, signal: controller.signal },
      );
      turnSpeechPipeline = speechPipeline;

      const queueSentence = (rawSentence: string) => {
        const sentence = cleanVoiceText(rawSentence).trim();
        if (!sentence) return;
        markTiming(timing, 'firstSentence');
        const captionPrefix = spokenSentences.join(' ').trim();
        spokenSentences.push(sentence);
        speechPipeline.enqueue({ text: sentence, captionPrefix });
      };

      let pipelineClosed = false;
      let chat: ChatResponse;
      try {
        chat = await readChatStream(
          transcript,
          turnAbort.signal,
          timing,
          queueSentence,
        );
      } catch (error) {
        controller.abort();
        void speechPipeline.close().catch(() => {});
        throw error;
      }
      markTiming(timing, 'chatDone');
      if (timing && chat.timingMs) timing.server.chat = chat.timingMs;
      clearProgressTimers();

      if (
        turnAbort.signal.aborted ||
        bargeInRef.current ||
        !voiceTurnControllerRef.current.isCurrent(sessionTurnId)
      ) {
        if (isLatestVoiceTurn(sessionTurnId)) setState('idle');
        return;
      }

      if (chat.limitReached) {
        stopFiller();
        cleanupMic();
        setError(chat.reply || 'Daily limit reached.');
        setState('error');
        return;
      }
      if (!chat.reply) throw new Error(`${assistantName} returned an empty reply.`);

      // Display keeps markdown tables; TTS path expands "$90–$200 / hour"
      // into spoken "90 to 200 dollars per hour".
      const displayReply = formatVoiceDisplayText(chat.reply);
      const spokenReply = cleanVoiceText(chat.reply);
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

      if (
        turnAbort.signal.aborted ||
        bargeInRef.current ||
        !voiceTurnControllerRef.current.isCurrent(sessionTurnId)
      ) {
        if (isLatestVoiceTurn(sessionTurnId)) setState('idle');
        return;
      }

      setProgressStatus('composing');
      // Complete the validated final answer if the checked sentence stream did
      // not contain all of it (JSON/error paths do not emit sentence events).
      const alreadyQueued = spokenSentences.join(' ').trim();
      if (!alreadyQueued) {
        for (const chunk of splitTextForTtsChunks(spokenReply, 180)) {
          queueSentence(chunk);
        }
      } else if (spokenReply.startsWith(alreadyQueued)) {
        const remainder = spokenReply.slice(alreadyQueued.length).trim();
        if (remainder) {
          for (const chunk of splitTextForTtsChunks(remainder, 180)) {
            queueSentence(chunk);
          }
        }
      }
      if (timing) {
        timing.meta.replyChars = spokenReply.length;
        timing.meta.ttsChunks = speechPipeline.stats().enqueued;
        timing.meta.firstChunkChars = spokenSentences[0]?.length ?? 0;
      }
      try {
        await speechPipeline.close();
        pipelineClosed = true;
        if (timing) {
          timing.meta.ttsMaxAhead = speechPipeline.stats().maxAheadObserved;
        }
        if (
          turnAbort.signal.aborted ||
          bargeInRef.current ||
          !voiceTurnControllerRef.current.isCurrent(sessionTurnId)
        ) {
          throw new DOMException('Aborted', 'AbortError');
        }
        setTranscriptTurns((turns) => {
          const finalTurn = {
            id: assistantTurnId,
            role: 'assistant' as const,
            text: displayReply,
            citedCases: chat.citedCases ?? [],
            attachments: turnAttachments,
          };
          return turns.some((turn) => turn.id === assistantTurnId)
            ? turns.map((turn) =>
                turn.id === assistantTurnId ? { ...turn, ...finalTurn } : turn,
              )
            : [...turns, finalTurn];
        });
        activeAssistantTurnIdRef.current = null;
        visibleAgentTextRef.current = displayReply;
        voiceTurnControllerRef.current.complete(sessionTurnId);
        setState('idle');
      } catch (ttsError) {
        controller.abort();
        if (!pipelineClosed) void speechPipeline.close().catch(() => {});
        if (
          bargeInRef.current ||
          (ttsError as Error)?.name === 'AbortError' ||
          !voiceTurnControllerRef.current.isCurrent(sessionTurnId)
        ) {
          throw ttsError;
        }
        if (ttsError instanceof VoiceLimitReachedError) {
          setTranscriptTurns((turns) => {
            const exists = turns.some((turn) => turn.id === assistantTurnId);
            if (exists) {
              return turns.map((turn) =>
                turn.id === assistantTurnId
                  ? {
                      ...turn,
                      text: displayReply,
                      citedCases: chat.citedCases ?? [],
                      attachments: turnAttachments,
                    }
                  : turn,
              );
            }
            return [
              ...turns,
              {
                id: assistantTurnId,
                role: 'assistant',
                text: displayReply,
                citedCases: chat.citedCases ?? [],
                attachments: turnAttachments,
              },
            ];
          });
          pauseVoiceForDailyLimit(ttsError.notice);
          return;
        }
        // Keep the validated answer on screen; audio failed mid-play.
        stopFiller();
        setTranscriptTurns((turns) => {
          if (turns.some((t) => t.role === 'assistant' && t.text === displayReply)) {
            return turns;
          }
          if (
            turns.some(
              (t) =>
                t.id === activeAssistantTurnIdRef.current &&
                t.role === 'assistant',
            )
          ) {
            return turns.map((t) =>
              t.id === activeAssistantTurnIdRef.current
                ? { ...t, text: displayReply }
                : t,
            );
          }
          return [
            ...turns,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              text: displayReply,
              citedCases: chat.citedCases ?? [],
              attachments: turnAttachments,
            },
          ];
        });
        setError(
          ttsError instanceof Error
            ? `${ttsError.message} The full answer is shown in text above.`
            : 'Voice playback failed, the full answer is shown in text above.',
        );
        setState('idle');
        return;
      }
    } catch (turnError) {
      clearProgressTimers();
      stopFiller();
      stopResponseAudio();
      if (
        bargeInRef.current ||
        (turnError as Error)?.name === 'AbortError'
      ) {
        if (isLatestVoiceTurn(sessionTurnId)) setState('idle');
        return;
      }
      if (!isLatestVoiceTurn(sessionTurnId)) return;
      setError(
        turnError instanceof Error ? turnError.message : 'Voice turn failed.',
      );
      setState('error');
    } finally {
      turnTtsController?.abort();
      if (turnSpeechPipeline) {
        void turnSpeechPipeline.close().catch(() => {});
      }
      if (ttsAbortRef.current === turnTtsController) {
        ttsAbortRef.current = null;
      }
      // Diagnostic: turns that never played audio are logged here.
      emitTiming(timing);
      if (turnAbortRef.current === turnAbort) {
        turnAbortRef.current = null;
      }
      voiceTurnControllerRef.current.complete(sessionTurnId);
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
        recorderRef.current = null;
        chunksRef.current = [];
        captureCommittedRef.current = false;
        discardCaptureRef.current = false;
        captureBargeInRef.current = false;
        vadAboveThresholdSinceRef.current = null;
        vadBelowThresholdSinceRef.current = null;
        if (discarded || !committed || !chunks.length) {
          if (originState === 'speaking') {
            restoreResponseAudio();
            finishMeasuredInterruption(false);
          }
          // Tentative barge noise never cut Jackie, so preserve speaking.
          // Only a genuinely committed interruption lands back on idle.
          if (bargeInRef.current) {
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
      vadAboveThresholdSinceRef.current = performance.now();
      vadBelowThresholdSinceRef.current = null;
      utterancePeakRef.current = 0;
      recorder.start();
      captureStartedAtRef.current = performance.now();
      silenceStartedAtRef.current = null;
      // Barge-in remains tentative here. Jackie is interrupted only after the
      // analyser confirms sustained speech for BARGE_IN_SUSTAIN_MS.
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
      // Show feedback the instant silence commits the turn. Previously the
      // processing row waited for STT to return because no user transcript
      // existed yet, making the UI appear frozen during transcription.
      if (captureCommittedRef.current) {
        // Diagnostic: end of speech is when the closing silence began; a
        // max-capture close has no silence, so it counts from now.
        const now = performance.now();
        turnTimingRef.current = startTurnTiming(
          silenceStartedAtRef.current ?? now,
          now,
        );
        turnTimingRef.current.meta.closedBy =
          silenceStartedAtRef.current == null ? 'maxCapture' : 'silence';
        setState('processing');
        setProgressStatus('hearing');
      }
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
    if (micStreamRef.current) {
      // Already open — unmute tracks and nudge the analyser awake.
      for (const track of micStreamRef.current.getAudioTracks()) {
        track.enabled = true;
      }
      micEnabledRef.current = true;
      setMicEnabled(true);
      setMicDenied(false);
      void analyserContextRef.current?.resume().catch(() => {});
      if (
        stateRef.current !== 'speaking' &&
        stateRef.current !== 'processing' &&
        stateRef.current !== 'listening'
      ) {
        setState('idle');
      }
      startFluxListening(micStreamRef.current);
      return;
    }
    if (micOpenPromiseRef.current) {
      await micOpenPromiseRef.current;
      return;
    }
    sessionMark('micRequested');
    const openPromise = (async () => {
      setError(null);
      setMicDenied(false);
      try {
        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        };
        // Chromium voice focus — attenuates non-primary talkers when supported.
        Object.assign(audioConstraints, { voiceIsolation: true });
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });
        if (!voiceMountedRef.current) {
          stream.getTracks().forEach((streamTrack) => streamTrack.stop());
          return;
        }
        const track = stream.getAudioTracks()[0];
        if (!track) throw new Error('No microphone input is available.');
        track.enabled = true;
        try {
          await track.applyConstraints({
            ...audioConstraints,
          });
        } catch {
          // Constraint unsupported — browser already applied what it could.
        }
        micStreamRef.current = stream;
        sessionMark('micReady');
        if (voiceSttProvider() === 'fish') {
          setVoiceSessionMeta(
            voiceSessionTimingRef.current,
            'sttProvider',
            'fish',
          );
        }
        micEnabledRef.current = true;
        setMicEnabled(true);
        setMicDenied(false);
        // Don't yank the UI out of speaking/processing if intro already started.
        if (
          stateRef.current !== 'speaking' &&
          stateRef.current !== 'processing' &&
          stateRef.current !== 'listening'
        ) {
          setState('idle');
        }
        startVadLoop(stream);
        startFluxListening(stream);
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
    })();
    micOpenPromiseRef.current = openPromise;
    try {
      await openPromise;
    } finally {
      if (micOpenPromiseRef.current === openPromise) {
        micOpenPromiseRef.current = null;
      }
    }
  }

  /**
   * Mute / unmute listening only. Never interrupts Jackie speaking or thinking —
   * voice barge-in (or the small Stop control) is how you cut her off.
   */
  function toggleMic() {
    if (voiceLimitNotice) return;
    if (micEnabledRef.current) {
      if (recorderRef.current?.state === 'recording') {
        discardVadCapture();
      }
      micEnabledRef.current = false;
      setMicEnabled(false);
      for (const track of micStreamRef.current?.getAudioTracks() ?? []) {
        track.enabled = false;
      }
      if (
        stateRef.current === 'listening' ||
        stateRef.current === 'error'
      ) {
        setState('idle');
      }
      setError(null);
      return;
    }
    void enableHandsFreeMic();
  }

  /** Explicit stop — secondary to interrupting Jackie by speaking over her. */
  function stopJackie() {
    const current = stateRef.current;
    if (current !== 'speaking' && current !== 'processing') return;
    bargeInRef.current = true;
    if (recorderRef.current?.state === 'recording') {
      discardVadCapture();
    }
    hardCancelActiveTurn('stop-button');
    if (current === 'speaking') finishMeasuredInterruption(true);
    setError(null);
    setState('idle');
  }

  const orbScale = 1 + orbLevel * 0.08;
  const hasUserInput = transcriptTurns.some((turn) => turn.role === 'user');
  const canDownloadTranscript =
    Boolean(conversationId) &&
    transcriptTurns.some((t) => t.text.trim().length > 0);

  function openTranscriptViewer() {
    if (!conversationId) return;
    setViewingDoc({
      title: 'Conversation transcript',
      url: `/api/chat/transcript?conversationId=${encodeURIComponent(conversationId)}`,
      filename: `paramount-conversation-${conversationId.slice(0, 8)}.pdf`,
      format: 'pdf',
    });
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
            <SignOutButton className="voice-mode-btn" style={{}} />
            {canDownloadTranscript ? (
              <button
                type="button"
                className="voice-mode-btn"
                onClick={openTranscriptViewer}
                aria-label="View conversation transcript"
                title="View transcript"
              >
                <Eye className="h-3.5 w-3.5" />
                View transcript
              </button>
            ) : null}
          </div>
          <span className="voice-topbar-brand">Paramount Intelligence</span>
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
            <p className="voice-brand">Paramount Intelligence</p>
            <h1 className="voice-heading">{assistantName}</h1>
            <div
              className={`voice-jackie voice-jackie-${state}${state === 'speaking' ? ' voice-jackie-stoppable' : ''}`}
              style={{
                '--voice-level': orbLevel,
                transform: `scale(${orbScale})`,
              } as CSSProperties}
              role={state === 'speaking' ? 'button' : 'img'}
              tabIndex={state === 'speaking' ? 0 : undefined}
              aria-label={
                state === 'speaking'
                  ? `Stop ${assistantName} speaking`
                  : `${assistantName}: ${stateMessage.pill}`
              }
              onClick={() => {
                if (state !== 'speaking') return;
                stopJackie();
              }}
              onKeyDown={(event) => {
                if (state !== 'speaking') return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                stopJackie();
              }}
            >
              <span className="voice-jackie-aura" aria-hidden="true" />
              <span className="voice-orb-shell" aria-hidden="true">
                <span className="voice-orb-flow voice-orb-flow-a" />
                <span className="voice-orb-flow voice-orb-flow-b" />
                <span className="voice-orb-depth" />
                <span className="voice-orb-highlight" />
              </span>
            </div>

            <div className="voice-controls">
              <div className="voice-controls-row">
                <button
                  type="button"
                  className={`voice-mic-toggle${micEnabled ? '' : ' voice-mic-toggle-muted'}`}
                  onClick={toggleMic}
                  disabled={Boolean(voiceLimitNotice) || settingUp}
                  aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
                  title={
                    settingUp
                      ? 'Available in a moment'
                      : micEnabled
                        ? `Mute mic (${assistantName} keeps speaking)`
                        : 'Unmute microphone'
                  }
                >
                  {micEnabled ? (
                    <Mic className="h-5 w-5" />
                  ) : (
                    <MicOff className="h-5 w-5" />
                  )}
                </button>
                <button
                  type="button"
                  className="voice-stop-btn"
                  onClick={stopJackie}
                  disabled={
                    Boolean(voiceLimitNotice) ||
                    settingUp ||
                    (state !== 'speaking' && state !== 'processing')
                  }
                  aria-label={`Stop ${assistantName}`}
                  title={`Stop ${assistantName} (or just speak over it)`}
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              </div>
              <span className="sr-only" role="status" aria-live="polite">
                {stateMessage.pill}
              </span>
            </div>

            <p className="sr-only">
              {settingUp
                ? stateMessage.hint
                : micEnabled
                  ? stateMessage.hint
                  : introAwaitingTap
                    ? `Tap below to hear ${assistantName}, then talk`
                    : micDenied
                      ? 'Microphone access is required for voice'
                      : state === 'speaking' || state === 'processing'
                        ? `Mic muted — ${assistantName} will keep going. Speak to interrupt, or press Stop.`
                        : 'Microphone muted — unmute when you want to talk'}
            </p>

            {introAwaitingTap ? (
              <div className="voice-gate-notice" role="status">
                <p className="voice-intro-fallback">{introText}</p>
                <button
                  type="button"
                  className="voice-start-btn"
                  onClick={() => void startVoiceAfterGesture()}
                >
                  Tap to start with {assistantName}
                </button>
                <a href="/chat" className="voice-mode-btn">
                  Switch to text chat
                </a>
              </div>
            ) : null}

            {micDenied && !introAwaitingTap ? (
              <div className="voice-gate-notice" role="status">
                <p>
                  I need microphone access to talk, or you can switch to text
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
                        ? assistantName
                        : 'You'}
                    </span>
                    {turn.text ? (
                      turn.role === 'assistant' ? (
                        <div className="assistant-md voice-stream-md text-sm leading-relaxed">
                          <ReactMarkdown
                            components={{
                              p: ({ children }) => (
                                <p className="m-0 mb-2 last:mb-0">{children}</p>
                              ),
                              strong: ({ children }) => (
                                <strong className="font-semibold">{children}</strong>
                              ),
                              ul: ({ children }) => (
                                <ul className="m-0 mb-2 pl-5 list-disc space-y-1 last:mb-0">
                                  {children}
                                </ul>
                              ),
                              ol: ({ children }) => (
                                <ol className="m-0 mb-2 pl-5 list-decimal space-y-1 last:mb-0">
                                  {children}
                                </ol>
                              ),
                              li: ({ children }) => (
                                <li className="pl-0.5">{children}</li>
                              ),
                              table: ({ children }) => (
                                <div className="assistant-md-table-wrap my-2.5 overflow-x-auto">
                                  <table className="assistant-md-table">
                                    {children}
                                  </table>
                                </div>
                              ),
                              thead: ({ children }) => <thead>{children}</thead>,
                              tbody: ({ children }) => <tbody>{children}</tbody>,
                              tr: ({ children }) => <tr>{children}</tr>,
                              th: ({ children }) => <th>{children}</th>,
                              td: ({ children }) => <td>{children}</td>,
                            }}
                          >
                            {turn.text}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p>{turn.text}</p>
                      )
                    ) : null}
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
                    {turn.attachments?.map((attachment) => {
                      const title =
                        attachment.source === 'knowledge-share' ||
                        attachment.source === 'transcript'
                          ? attachment.caseTitle
                          : `One-pager: ${attachment.caseTitle}`;
                      return (
                        <button
                          key={attachmentKey(attachment)}
                          type="button"
                          className="voice-stream-download"
                          onClick={() =>
                            setViewingDoc({
                              title,
                              url: attachmentViewUrl(attachment),
                              filename: attachment.filename,
                              format: attachment.format,
                            })
                          }
                        >
                          <Eye className="h-3.5 w-3.5" />
                          {attachment.source === 'knowledge-share' ||
                          attachment.source === 'transcript'
                            ? `View: ${attachment.caseTitle} (${attachment.format.toUpperCase()})`
                            : `View one-pager: ${attachment.caseTitle} (${attachment.format.toUpperCase()})`}
                        </button>
                      );
                    })}
                  </div>
                ))
              : null}
          </div>
        </div>
      </main>
      <DocumentViewer
        doc={viewingDoc}
        onClose={() => setViewingDoc(null)}
      />
      {debugAllowed ? <VoiceTimingPanel /> : null}
    </div>
  );
}
