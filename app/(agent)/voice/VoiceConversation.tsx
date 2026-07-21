'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Mic,
  MicOff,
  Volume2,
} from 'lucide-react';
import { cleanVoiceText } from '@/lib/citationText';

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
  source: 'uploaded' | 'generated' | 'generated-cached';
  format: 'pdf' | 'png';
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

const FILLERS = [
  {
    src: '/audio/voice-fillers/pulling-that-up.mp3',
    pill: 'Let me pull that up…',
    hint: 'Checking the relevant experience',
  },
  {
    src: '/audio/voice-fillers/checking-our-work.mp3',
    pill: 'One moment, checking our work…',
    hint: 'Your answer is being validated',
  },
  {
    src: '/audio/voice-fillers/finding-best-examples.mp3',
    pill: 'Finding the best examples…',
    hint: 'Reviewing the strongest evidence',
  },
  {
    src: '/audio/voice-fillers/checking-that.mp3',
    pill: 'Let me check that for you…',
    hint: 'Looking through our relevant work',
  },
  {
    src: '/audio/voice-fillers/one-moment.mp3',
    pill: 'One moment while I look into that…',
    hint: 'Finding the clearest answer',
  },
] as const;

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
  listening: [
    { pill: 'Hearing you…', hint: 'Go ahead, I’m following' },
    { pill: 'Got it, keep going…', hint: 'Take your time' },
    { pill: "I'm following…", hint: 'Finish naturally when you’re ready' },
  ],
  processing: [
    { pill: 'Let me pull that up…', hint: 'Checking the relevant experience' },
    {
      pill: 'One moment, checking our work…',
      hint: 'Your answer is being validated',
    },
    {
      pill: 'Finding the best examples…',
      hint: 'Reviewing the strongest evidence',
    },
  ],
  speaking: [
    { pill: 'Speaking…', hint: 'You can speak clearly to interrupt' },
    { pill: 'Sharing what I found…', hint: 'I’m listening for an interruption' },
    { pill: 'Here’s what stands out…', hint: 'Jump in whenever you need to' },
  ],
  error: [
    { pill: 'Microphone paused', hint: 'Enable the microphone to continue' },
  ],
};

const VAD = {
  START_RMS: 0.055,
  STOP_RMS: 0.03,
  BARGE_IN_RMS: 0.18,
  START_HOLD_MS: 220,
  BARGE_IN_HOLD_MS: 200,
  SILENCE_MS: 1_200,
  MIN_CAPTURE_MS: 600,
  BARGE_IN_GRACE_MS: 650,
} as const;

type TranscriptTurn = { id: string; role: 'user' | 'assistant'; text: string };

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

function normalizedTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(
      (token) =>
        token &&
        !['and', 'the', 'a', 'an', 'case', 'project', 'onepager'].includes(
          token,
        ),
    )
    .join(' ');
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

function attachmentMatchesCase(
  attachment: OnepagerAttachment,
  caseItem: CitedCase,
): boolean {
  // New attachments are joined deterministically. Never fuzzy-match an
  // attachment carrying an ID onto a different case card.
  if (attachment.caseId) return attachment.caseId === caseItem.id;

  // Legacy persisted attachments predate caseId; use a conservative token
  // overlap fallback that tolerates punctuation, "&"/"and", and suffixes.
  const attachmentTitle = normalizedTitle(attachment.caseTitle);
  const caseTitle = normalizedTitle(caseItem.title);
  if (!attachmentTitle || !caseTitle) return false;
  if (attachmentTitle === caseTitle) return true;
  const attachmentTokens = new Set(attachmentTitle.split(' '));
  const caseTokens = new Set(caseTitle.split(' '));
  const common = [...attachmentTokens].filter((token) =>
    caseTokens.has(token),
  ).length;
  return (
    common >= 2 &&
    common / Math.max(attachmentTokens.size, caseTokens.size) >= 0.75
  );
}

export default function VoiceConversation({
  user,
}: {
  user: { name: string | null };
}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [historyReady, setHistoryReady] = useState(false);
  const [citedCases, setCitedCases] = useState<CitedCase[]>([]);
  const [attachments, setAttachments] = useState<OnepagerAttachment[]>([]);
  const [latestTurnAttachments, setLatestTurnAttachments] = useState<
    OnepagerAttachment[]
  >([]);
  const [transcriptTurns, setTranscriptTurns] = useState<TranscriptTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voiceLimitNotice, setVoiceLimitNotice] = useState<string | null>(null);
  const [orbLevel, setOrbLevel] = useState(0);
  const [micEnabled, setMicEnabled] = useState(false);
  const [stateMessage, setStateMessage] = useState(STATE_MESSAGES.idle[0]);

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
    // Warm the three immutable safe clips so VAD turn-end has no network wait.
    for (const filler of FILLERS) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = filler.src;
      audio.load();
    }
  }, []);

  useEffect(() => {
    if (historyReady) void enableHandsFreeMic();
    // The mic is intentionally started once when history/session setup finishes.
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
          const threshold = captureBargeInRef.current
            ? VAD.BARGE_IN_RMS
            : VAD.START_RMS;
          const holdMs = captureBargeInRef.current
            ? VAD.BARGE_IN_HOLD_MS
            : VAD.START_HOLD_MS;

          if (rms < threshold) {
            discardVadCapture();
          } else if (now - captureStartedAtRef.current >= holdMs) {
            captureCommittedRef.current = true;
            if (captureBargeInRef.current) {
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
              if (captionTimerRef.current) {
                clearInterval(captionTimerRef.current);
              }
            }
            setState('listening');
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

  function stopResponseAudio() {
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    if (captionTimerRef.current) {
      clearInterval(captionTimerRef.current);
      captionTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
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
    stopResponseAudio();
    stopFiller();
    cleanupMic();
    if (captionTimerRef.current) clearInterval(captionTimerRef.current);
  }

  function pauseVoiceForDailyLimit(notice?: string) {
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

  function playSafeFiller() {
    stopFiller();
    fillerActiveRef.current = true;
    playNextFiller();
  }

  function playNextFiller() {
    if (!fillerActiveRef.current) return;
    const filler = FILLERS[fillerIndexRef.current % FILLERS.length];
    fillerIndexRef.current += 1;
    setStateMessage({ pill: filler.pill, hint: filler.hint });
    const audio = new Audio(filler.src);
    audio.volume = 0.68;
    fillerRef.current = audio;
    audio.onended = () => {
      if (!fillerActiveRef.current) return;
      fillerTimerRef.current = setTimeout(playNextFiller, 180);
    };
    void audio.play().catch(() => {
      // Filler is latency masking only; never block the real turn.
    });
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

    const audio = new Audio();
    audioRef.current = audio;
    audio.onended = () => {
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
                  started = true;
                  onStarted(audio);
                  await audio.play();
                }
              }
              if (mediaSource.readyState === 'open') mediaSource.endOfStream();
              audio.dataset.streamComplete = 'true';
              resolve();
            } catch (streamError) {
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
   * Fixed filler audio is static and contains no model output.
   */
  async function processRecording(blob: Blob, durationSeconds: number) {
    bargeInRef.current = false;
    setState('processing');
    setError(null);
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

      const chatResponse = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message: transcript,
          voiceMode: true,
        }),
      });
      if (chatResponse.status === 401) {
        window.location.href = '/login';
        return;
      }
      const chat = (await chatResponse.json()) as ChatResponse;
      if (!chatResponse.ok) {
        throw new Error(chat.error || 'The adviser could not respond.');
      }
      if (chat.limitReached) {
        stopFiller();
        cleanupMic();
        setError(chat.reply || 'Daily adviser limit reached.');
        setState('error');
        return;
      }
      if (!chat.reply) throw new Error('The adviser returned an empty reply.');

      // The API reply is already validated; remove internal citation markers
      // before either the accessible caption or Daniel receives the text.
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
            { id: assistantTurnId, role: 'assistant', text: cleanReply },
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
        speakingStartedAtRef.current = performance.now();
        const assistantTurnId = crypto.randomUUID();
        activeAssistantTurnIdRef.current = assistantTurnId;
        setTranscriptTurns((turns) => [
          ...turns,
          { id: assistantTurnId, role: 'assistant', text: '' },
        ]);
        setState('speaking');
        revealCaption(audio, cleanReply);
      });
    } catch (turnError) {
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
        recorderRef.current = null;
        chunksRef.current = [];
        captureCommittedRef.current = false;
        discardCaptureRef.current = false;
        captureBargeInRef.current = false;
        if (discarded || !committed || !chunks.length) {
          setState(originState);
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
      recorder.start();
      captureStartedAtRef.current = performance.now();
      silenceStartedAtRef.current = null;
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
      setState('idle');
      startVadLoop(stream);
    } catch (micError) {
      cleanupMic();
      setError(
        micError instanceof Error
          ? micError.message
          : 'Microphone permission was denied.',
      );
      setState('error');
    }
  }

  function toggleMic() {
    if (voiceLimitNotice) return;
    if (micEnabledRef.current) {
      cleanupMic();
      setState('error');
      setError('Hands-free microphone is muted.');
    } else {
      void enableHandsFreeMic();
    }
  }

  const orbScale = 1 + orbLevel * 0.08;
  const firstName = user.name?.split(' ')[0];
  const unmatchedAttachments = attachments.filter(
    (attachment) =>
      !citedCases.some((caseItem) =>
        attachmentMatchesCase(attachment, caseItem),
      ),
  );
  // Prominent downloads belong exclusively to the most recent assistant turn.
  // The accumulated `attachments` collection remains available on case cards.
  const readyAttachments = latestTurnAttachments;

  return (
    <div className="voice-page">
      <main className="voice-stage">
        <div className="voice-topbar">
          <a href="/chat" className="voice-text-link">
            <ArrowLeft className="h-4 w-4" />
            Switch to text chat
          </a>
          <div className="voice-topbar-controls">
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
            <span className={`voice-status voice-status-${state}`}>
              <span className="voice-status-dot" />
              {stateMessage.pill}
            </span>
            <button
              type="button"
              className="voice-mic-toggle"
              onClick={toggleMic}
              disabled={Boolean(voiceLimitNotice)}
              aria-label={micEnabled ? 'Mute microphone' : 'Enable microphone'}
              title={micEnabled ? 'Mute microphone' : 'Enable microphone'}
            >
              {micEnabled ? (
                <Mic className="h-4 w-4" />
              ) : (
                <MicOff className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <div className="voice-layout" aria-live="polite">
          <aside className="voice-side-panel voice-transcript-panel">
            <div className="voice-panel-heading">
              <span>Live transcript</span>
              <small>{transcriptTurns.length} turns</small>
            </div>
            <div className="voice-transcript-scroll">
              {transcriptTurns.length ? (
                transcriptTurns.map((turn) => (
                  <div
                    key={turn.id}
                    className={`voice-caption-turn voice-caption-${turn.role}`}
                  >
                    <span>
                      {turn.role === 'assistant' ? (
                        <Volume2 className="h-3.5 w-3.5" />
                      ) : null}
                      {turn.role === 'assistant' ? 'Paramount adviser' : 'You'}
                    </span>
                    <p>{turn.text}</p>
                  </div>
                ))
              ) : (
                <div className="voice-caption-empty">
                  Start speaking naturally. Your transcript will appear here.
                </div>
              )}
              {state === 'processing' ? (
                <div className="voice-caption-turn voice-caption-agent">
                  <span>Paramount adviser</span>
                  <p>Reviewing the relevant experience and evidence…</p>
                </div>
              ) : null}
            </div>
          </aside>

          <section className="voice-center">
            <p className="voice-eyebrow">Hands-free voice adviser</p>
            <h1 className="voice-heading">
              {firstName
                ? `Talk with us, ${firstName}`
                : 'Talk with our adviser'}
            </h1>
            <div
              className={`voice-orb voice-orb-${state}`}
              style={{ transform: `scale(${orbScale})` }}
              role="img"
              aria-label={`Paramount voice adviser: ${stateMessage.pill}`}
            >
              <span className="voice-orb-ring voice-orb-ring-one" />
              <span className="voice-orb-ring voice-orb-ring-two" />
              <span className="voice-orb-core">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/logo.png" alt="Paramount Intelligence" />
              </span>
            </div>
            <p className="voice-instruction">
              {micEnabled
                ? stateMessage.hint
                : 'Enable the microphone to continue'}
            </p>
            {voiceLimitNotice ? (
              <div className="voice-limit-notice" role="status">
                <p>{voiceLimitNotice}</p>
                <a href="/chat">Switch to text chat</a>
              </div>
            ) : null}
            {error ? <p className="voice-error">{error}</p> : null}
          </section>

          <aside className="voice-side-panel voice-projects-panel">
            <div className="voice-panel-heading">
              <span>Referenced projects</span>
              <small>{citedCases.length}</small>
            </div>
            {readyAttachments.length > 0 ? (
              <div className="voice-ready-downloads" aria-live="polite">
                <p>Ready to download</p>
                {readyAttachments.map((attachment, index) => (
                  <a
                    key={attachmentKey(attachment)}
                    href={attachmentDownloadUrl(attachment)}
                    download={attachment.filename}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="voice-ready-download"
                  >
                    <span>
                      <small>{index === 0 ? 'Latest one-pager' : 'One-pager'}</small>
                      <strong>{attachment.caseTitle}</strong>
                    </span>
                    <span className="voice-ready-download-cta">
                      <Download className="h-3.5 w-3.5" />
                      Download {attachment.format.toUpperCase()}
                    </span>
                  </a>
                ))}
              </div>
            ) : null}
            <div className="voice-projects-scroll">
              {citedCases.map((caseItem) => {
                const caseAttachments = attachments.filter((attachment) =>
                  attachmentMatchesCase(attachment, caseItem),
                );
                return (
                  <div key={caseItem.id} className="voice-project-card">
                    <FileText className="h-4 w-4" />
                    <span>
                      {caseItem.url ? (
                        <a
                          href={caseItem.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="voice-project-title-link"
                        >
                          {caseItem.title}
                        </a>
                      ) : (
                        <strong>{caseItem.title}</strong>
                      )}
                      {caseItem.blurb ? <small>{caseItem.blurb}</small> : null}
                      {caseAttachments.map((attachment) => (
                        <a
                          key={attachmentKey(attachment)}
                          href={attachmentDownloadUrl(attachment)}
                          download={attachment.filename}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="voice-download-button"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download one-pager ({attachment.format.toUpperCase()})
                        </a>
                      ))}
                    </span>
                  </div>
                );
              })}

              {unmatchedAttachments.length > 0 ? (
                <div className="voice-documents">
                  <p>Documents</p>
                  {unmatchedAttachments.map((attachment) => (
                    <a
                      key={attachmentKey(attachment)}
                      href={attachmentDownloadUrl(attachment)}
                      download={attachment.filename}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="voice-document-row"
                    >
                      <FileText className="h-4 w-4" />
                      <span>
                        <strong>{attachment.caseTitle}</strong>
                        <small>{attachment.filename}</small>
                      </span>
                      <Download className="h-4 w-4" />
                    </a>
                  ))}
                </div>
              ) : null}

              {!citedCases.length && !attachments.length ? (
                <div className="voice-caption-empty">
                  Validated case references will collect here.
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
