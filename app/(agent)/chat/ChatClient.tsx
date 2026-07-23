'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { AlertCircle, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Loader2, Mic, RotateCcw, Send, Volume2, Square, X } from 'lucide-react';
import { stripCaseTags } from '@/lib/citationText';
import { downloadConversationTranscript } from '@/lib/chat/downloadTranscript';
import { cn } from '@/lib/utils';

type CitedCase = { id: string; title: string; blurb?: string; url?: string };

type OnepagerAttachment = {
  caseId?: string;
  documentId?: string;
  url: string;
  filename: string;
  caseTitle: string;
  source: 'uploaded' | 'generated' | 'generated-cached' | 'knowledge-share' | 'transcript';
  format: 'pdf' | 'png' | 'docx';
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citedIds?: string[];
  citedCases?: CitedCase[];
  attachments?: OnepagerAttachment[];
  pending?: boolean;
  preparingOnepager?: boolean;
  error?: boolean;
};

const ONEPAGER_ASK_RE =
  /\b(one[\s-]?pager|onepager|\.pdf\b|\.png\b|pdf|png|branded\s+document|case\s+document)\b/i;

/**
 * Deterministic backstop for connector em/en dashes the model keeps emitting.
 * Targets ONLY U+2014 (—) and U+2013 (–) — ASCII hyphen-minus is untouched, so
 * hyphenated words ("PE-backed", "zero-touch") and list markers are safe.
 */
function normalizeConnectorDashes(text: string): string {
  return (
    text
      // Leading dash right after a list marker ("- — Case" → "- Case") so the
      // connector replacement below can't eat the marker's required space
      .replace(/(^|\n)([ \t]*(?:[-*+]|\d+[.)])[ \t]+)[—–][ \t]*/g, '$1$2')
      .replace(/ — /g, ': ')
      .replace(/ – /g, ', ')
  );
}

const SUGGESTIONS = [
  'Do you have experience with n8n and AWS?',
  'Tell me about PE-backed support copilots',
  'How have you reduced customer support costs?',
];

/**
 * Agent avatar — Paramount logo from /public/images/logo.png.
 * Falls back to the "P" monogram if the file is missing or fails to load.
 */
function AgentAvatar({ size }: { size: 'sm' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  const px = size === 'lg' ? 'w-14 h-14' : 'w-10 h-10';

  return (
    <div
      className={cn(
        px,
        'shrink-0 rounded-full flex items-center justify-center text-white font-semibold select-none overflow-hidden',
        size === 'lg' ? 'text-lg' : 'text-xs',
      )}
      style={{
        // Transparent logo straight on the dark UI; gradient circle only for the fallback
        ...(failed
          ? {
              background:
                'linear-gradient(135deg, var(--pi-blue-500) 0%, var(--primary-dark) 100%)',
              ...(size === 'lg'
                ? { boxShadow: '0 8px 24px rgba(30,111,217,0.35)' }
                : {}),
            }
          : {}),
      }}
      aria-hidden="true"
    >
      {failed ? (
        'P'
      ) : (
        // Plain img (not next/image): tiny asset, and onError fallback is simpler
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/images/logo.png"
          alt=""
          className={cn(size === 'lg' ? 'w-15 h-15' : 'w-15 h-15', 'object-contain')}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

function OnepagerDownloadCard({ att }: { att: OnepagerAttachment }) {
  const formatLabel = att.format.toUpperCase();
  const isKnowledge = att.source === 'knowledge-share';
  const isTranscript = att.source === 'transcript';
  const title = isKnowledge || isTranscript
    ? att.caseTitle
    : `One-pager: ${att.caseTitle}`;
  return (
    <div
      className="mt-3 rounded-lg px-3 py-2.5 flex flex-wrap items-center gap-3"
      style={{
        background: 'rgba(30,111,217,0.1)',
        border: '1px solid rgba(59,136,245,0.28)',
      }}
    >
      <FileText
        className="w-4 h-4 shrink-0"
        style={{ color: 'var(--pi-blue-400)' }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-xs font-semibold text-white truncate">
          {title}
        </p>
        {att.source === 'uploaded' ? (
          <p
            className="m-0 mt-0.5 text-[10px] uppercase tracking-wider"
            style={{ color: 'var(--pi-silver-400)' }}
          >
            Official
          </p>
        ) : isKnowledge ? (
          <p
            className="m-0 mt-0.5 text-[10px] uppercase tracking-wider"
            style={{ color: 'var(--pi-silver-400)' }}
          >
            Company document
          </p>
        ) : isTranscript ? (
          <p
            className="m-0 mt-0.5 text-[10px] uppercase tracking-wider"
            style={{ color: 'var(--pi-silver-400)' }}
          >
            Your conversation
          </p>
        ) : null}
      </div>
      <a
        href={att.url}
        download={att.filename}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg no-underline shrink-0"
        style={{
          color: '#ffffff',
          background:
            'linear-gradient(135deg, var(--pi-blue-500) 0%, var(--primary-dark) 100%)',
        }}
      >
        <Download className="w-3.5 h-3.5" />
        Download {formatLabel}
      </a>
    </div>
  );
}

function AssistantBody({ text }: { text: string }) {
  // Assistant-only: strip tags, then normalize connector dashes, then markdown
  const cleaned = normalizeConnectorDashes(stripCaseTags(text));

  return (
    <div className="assistant-md text-sm leading-relaxed">
      <ReactMarkdown
        components={{
          p: ({ children }) => (
            <p className="m-0 mb-2 last:mb-0" style={{ color: 'var(--pi-silver-300)' }}>
              {children}
            </p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold" style={{ color: '#ffffff' }}>
              {children}
            </strong>
          ),
          ul: ({ children }) => (
            <ul
              className="m-0 mb-2 pl-5 list-disc space-y-1 last:mb-0"
              style={{ color: 'var(--pi-silver-300)' }}
            >
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol
              className="m-0 mb-2 pl-5 list-decimal space-y-1 last:mb-0"
              style={{ color: 'var(--pi-silver-300)' }}
            >
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="pl-0.5" style={{ color: 'var(--pi-silver-300)' }}>
              {children}
            </li>
          ),
          h1: ({ children }) => (
            <p className="m-0 mb-2 font-semibold text-base" style={{ color: '#ffffff' }}>
              {children}
            </p>
          ),
          h2: ({ children }) => (
            <p className="m-0 mb-2 font-semibold text-sm" style={{ color: '#ffffff' }}>
              {children}
            </p>
          ),
          h3: ({ children }) => (
            <p className="m-0 mb-2 font-semibold text-sm" style={{ color: '#ffffff' }}>
              {children}
            </p>
          ),
          a: ({ children }) => (
            <span style={{ color: 'var(--pi-silver-200)' }}>{children}</span>
          ),
          code: ({ children }) => (
            <code
              className="px-1 py-0.5 rounded text-[12px]"
              style={{
                background: 'rgba(255,255,255,0.06)',
                color: 'var(--pi-silver-200)',
              }}
            >
              {children}
            </code>
          ),
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}

function CasePanel({
  cases,
  open,
  onToggle,
  onCloseMobile,
}: {
  cases: CitedCase[];
  open: boolean;
  onToggle: () => void;
  onCloseMobile: () => void;
}) {
  if (cases.length === 0) return null;

  const header = (
    <div
      className="flex items-center justify-between px-4 py-3 shrink-0"
      style={{ borderBottom: '1px solid rgba(30,111,217,0.2)' }}
    >
      <div>
        <p
          className="m-0 text-xs font-semibold uppercase tracking-widest"
          style={{ color: 'var(--pi-blue-300)' }}
        >
          Referenced cases
        </p>
        <p className="m-0 text-sm font-medium text-white mt-0.5">{cases.length}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="hidden lg:inline-flex p-2 rounded-lg"
        style={{ color: 'var(--pi-silver-300)', background: 'rgba(255,255,255,0.04)' }}
        aria-label={open ? 'Collapse case panel' : 'Expand case panel'}
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onCloseMobile}
        className="lg:hidden inline-flex p-2 rounded-lg"
        style={{ color: 'var(--pi-silver-300)', background: 'rgba(255,255,255,0.04)' }}
        aria-label="Close case panel"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  const list = (
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
      {cases.map((c) => (
        <div
          key={c.id}
          className="glass-dark rounded-lg px-3 py-3"
          style={{ borderLeft: '2px solid var(--pi-blue-400)' }}
        >
          <p className="m-0 text-sm font-semibold text-white leading-snug">{c.title}</p>
          {c.blurb ? (
            <p
              className="m-0 mt-1.5 text-xs leading-relaxed"
              style={{ color: 'var(--pi-silver-400)' }}
            >
              {c.blurb}
            </p>
          ) : null}
          {c.url ? (
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block m-0 mt-2 text-xs font-medium no-underline"
              style={{ color: 'var(--pi-blue-400)' }}
            >
              View case →
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* Desktop side pane */}
      <aside
        className={cn(
          'hidden lg:flex flex-col shrink-0 h-full transition-[width] duration-200',
          open ? 'w-[360px]' : 'w-0 overflow-hidden',
        )}
        style={{
          borderLeft: open ? '1px solid rgba(30,111,217,0.2)' : undefined,
          background: 'rgba(6,13,26,0.45)',
        }}
      >
        {open && (
          <>
            {header}
            {list}
          </>
        )}
      </aside>

      {/* Mobile drawer overlay */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <button
            type="button"
            className="absolute inset-0 border-0 cursor-pointer"
            style={{ background: 'rgba(6,13,26,0.65)' }}
            aria-label="Dismiss case panel"
            onClick={onCloseMobile}
          />
          <aside
            className="absolute top-0 right-0 bottom-0 w-[min(360px,92vw)] flex flex-col"
            style={{
              background: 'var(--pi-navy-900)',
              borderLeft: '1px solid rgba(30,111,217,0.25)',
            }}
          >
            {header}
            {list}
          </aside>
        </div>
      )}
    </>
  );
}

export default function ChatClient({
  user,
}: {
  user: { id: string; name: string | null };
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [isSending, setIsSending] = useState(false);
  const [citedLibrary, setCitedLibrary] = useState<CitedCase[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [autoOpenedOnce, setAutoOpenedOnce] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [limitReached, setLimitReached] = useState(false);
  const [ttsPlayingId, setTtsPlayingId] = useState<string | null>(null);
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [sttBusy, setSttBusy] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const [transcriptDownloading, setTranscriptDownloading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSentRef = useRef<string>('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  // True once the user sends anything — a late-arriving history response must
  // not clobber a conversation they already started in this tab
  const hasSentRef = useRef(false);

  function stopTts() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setTtsPlayingId(null);
    setTtsLoadingId(null);
  }

  /**
   * Speak an already-validated assistant message via /api/voice/tts.
   * Mouth only — text on screen already passed the agent validator.
   * Prefers MediaSource progressive playback; falls back to full-blob Audio.
   */
  async function listenToMessage(m: ChatMessage) {
    if (m.role !== 'assistant' || !m.text.trim() || m.pending || m.error) return;

    if (ttsPlayingId === m.id || ttsLoadingId === m.id) {
      stopTts();
      return;
    }

    stopTts();
    setTtsLoadingId(m.id);

    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: m.text,
          // Real DB ids from history / assistantMessageId — skip ephemeral client ids
          messageId:
            m.id.startsWith('a-') || m.id.startsWith('u-') || m.id.startsWith('a-pending')
              ? undefined
              : m.id,
        }),
      });

      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const data = (await res.json()) as {
          voiceLimitReached?: boolean;
          notice?: string;
          error?: string;
        };
        if (data.voiceLimitReached) {
          setSttError(
            data.notice ||
              "We've reached today's voice limit. You can keep using text chat.",
          );
          stopTts();
          return;
        }
        throw new Error(data.error || `TTS failed (${res.status})`);
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `TTS failed (${res.status})`);
      }

      if (!res.body) throw new Error('Empty audio stream');

      const audio = new Audio();
      audioRef.current = audio;
      audio.onended = () => stopTts();
      audio.onerror = () => stopTts();

      const canMse =
        typeof MediaSource !== 'undefined' &&
        MediaSource.isTypeSupported('audio/mpeg') &&
        !!window.MediaSource;

      if (canMse) {
        const mediaSource = new MediaSource();
        const objectUrl = URL.createObjectURL(mediaSource);
        audioUrlRef.current = objectUrl;
        audio.src = objectUrl;

        await new Promise<void>((resolve, reject) => {
          mediaSource.addEventListener(
            'sourceopen',
            () => {
              void (async () => {
                try {
                  const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
                  const reader = res.body!.getReader();
                  let started = false;

                  const append = (chunk: Uint8Array) =>
                    new Promise<void>((resAppend, rejAppend) => {
                      const onUpdate = () => {
                        sourceBuffer.removeEventListener('updateend', onUpdate);
                        resAppend();
                      };
                      sourceBuffer.addEventListener('updateend', onUpdate);
                      try {
                        // Copy into a plain ArrayBuffer — SourceBuffer rejects SharedArrayBuffer views
                        const copy = new Uint8Array(chunk.byteLength);
                        copy.set(chunk);
                        sourceBuffer.appendBuffer(copy);
                      } catch (e) {
                        sourceBuffer.removeEventListener('updateend', onUpdate);
                        rejAppend(e);
                      }
                    });

                  for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value?.byteLength) {
                      await append(value);
                      if (!started) {
                        started = true;
                        setTtsLoadingId(null);
                        setTtsPlayingId(m.id);
                        await audio.play().catch(() => {});
                      }
                    }
                  }
                  if (mediaSource.readyState === 'open') {
                    mediaSource.endOfStream();
                  }
                  if (!started) {
                    setTtsLoadingId(null);
                    setTtsPlayingId(m.id);
                    await audio.play();
                  }
                  resolve();
                } catch (e) {
                  reject(e);
                }
              })();
            },
            { once: true },
          );
        });
      } else {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        audio.src = url;
        setTtsLoadingId(null);
        setTtsPlayingId(m.id);
        await audio.play();
      }
    } catch (err) {
      console.error('[chat] tts failed', err);
      stopTts();
    }
  }

  useEffect(() => {
    return () => {
      stopTts();
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickRecorderMime(): string {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const c of candidates) {
      if (
        typeof MediaRecorder !== 'undefined' &&
        MediaRecorder.isTypeSupported(c)
      ) {
        return c;
      }
    }
    return '';
  }

  async function transcribeBlob(blob: Blob, durationSeconds: number) {
    setSttBusy(true);
    setSttError(null);
    try {
      const form = new FormData();
      const type = blob.type.toLowerCase();
      const ext = type.includes('mp4')
        ? 'm4a'
        : type.includes('ogg')
          ? 'ogg'
          : 'webm';
      form.append('audio', blob, `recording.${ext}`);
      form.append('durationSeconds', String(durationSeconds));
      const res = await fetch('/api/voice/stt', {
        method: 'POST',
        body: form,
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = (await res.json()) as {
        text?: string;
        error?: string;
        voiceLimitReached?: boolean;
        notice?: string;
      };
      if (data.voiceLimitReached) {
        setSttError(
          data.notice ||
            "We've reached today's voice-input limit. Please continue in text.",
        );
        return;
      }
      if (!res.ok) throw new Error(data.error || `STT failed (${res.status})`);
      const text = (data.text ?? '').trim();
      if (!text) throw new Error('Empty transcript');
      setInput(text);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          autoGrow(textareaRef.current);
          textareaRef.current.focus();
        }
      });
    } catch (err) {
      console.error('[chat] stt failed', err);
      setSttError(err instanceof Error ? err.message : 'Transcription failed');
    } finally {
      setSttBusy(false);
    }
  }

  async function startRecording() {
    if (isRecording || sttBusy || isSending || limitReached) return;
    setSttError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone not available in this browser');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      mediaStreamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('No microphone audio track was provided');
      track.enabled = true;
      console.info('[chat/stt] microphone ready', track.getSettings());
      const mime = pickRecorderMime();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);
        if (!chunks.length) {
          setSttError('No audio captured — try again');
          return;
        }
        const blob = new Blob(chunks, {
          type: recorder.mimeType || 'audio/webm',
        });
        const durationSeconds = Math.max(
          0.1,
          (performance.now() - recordingStartedAtRef.current) / 1000,
        );
        void transcribeBlob(blob, durationSeconds);
      };

      // No timeslice: Chrome emits one complete, self-contained WebM/MP4 file
      // on stop. Concatenating frequent partial chunks can produce audio that
      // uploads successfully but decodes as silence in Scribe.
      recorder.start();
      recordingStartedAtRef.current = performance.now();
      setIsRecording(true);
    } catch (err) {
      console.error('[chat] mic failed', err);
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      setIsRecording(false);
      setSttError(
        err instanceof Error
          ? err.message
          : 'Could not access microphone — check browser permissions',
      );
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      setIsRecording(false);
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  }

  function toggleMic() {
    if (isRecording) stopRecording();
    else void startRecording();
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  // Ready to type immediately on arrival
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Single-thread resume: load the user's most recent conversation on entry
  // so returning users continue where they left off instead of a blank chat.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/chat/history');
        if (!res.ok) return; // 401/500 → start fresh; sends still work via cookie

        const data = (await res.json()) as {
          conversationId?: string | null;
          messages?: Array<{
            id: string;
            role: string;
            content: string;
            citedIds?: string[];
            citedCases?: CitedCase[];
            attachments?: OnepagerAttachment[];
          }>;
        };
        if (cancelled || hasSentRef.current) return;
        if (!data.conversationId || !data.messages?.length) return;

        setConversationId(data.conversationId);
        setMessages(
          data.messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              text: m.content,
              citedIds: m.citedIds,
              citedCases: m.citedCases,
              attachments: m.attachments,
            })),
        );

        // Rebuild the case panel from the history's accumulated citations
        const lib = new Map<string, CitedCase>();
        for (const m of data.messages) {
          for (const c of m.citedCases ?? []) {
            if (c.id) lib.set(c.id, c);
          }
        }
        if (lib.size > 0) {
          setCitedLibrary([...lib.values()]);
          setAutoOpenedOnce(true);
          // Desktop: reopen the panel; mobile: leave the drawer closed (tab shows)
          setPanelOpen(window.matchMedia('(min-width: 1024px)').matches);
        }
      } catch {
        // Network hiccup → fresh chat; nothing lost server-side
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function mergeCited(incoming: CitedCase[]) {
    if (!incoming.length) return;
    setCitedLibrary((prev) => {
      const map = new Map(prev.map((c) => [c.id, c]));
      for (const c of incoming) {
        if (!c.id) continue;
        const existing = map.get(c.id);
        map.set(c.id, {
          id: c.id,
          title: c.title || existing?.title || '',
          blurb: c.blurb || existing?.blurb || '',
          url: c.url || existing?.url,
        });
      }
      return [...map.values()];
    });
    if (!autoOpenedOnce) {
      setAutoOpenedOnce(true);
      setPanelOpen(true);
    }
  }

  async function sendMessage(textRaw: string) {
    const text = textRaw.trim();
    if (!text || isSending || limitReached) return;
    hasSentRef.current = true;
    lastSentRef.current = text;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
    };
    const pendingId = `a-pending-${Date.now()}`;
    const preparingOnepager = ONEPAGER_ASK_RE.test(text);
    const pending: ChatMessage = {
      id: pendingId,
      role: 'assistant',
      text: '',
      pending: true,
      preparingOnepager,
    };

    setMessages((prev) => [...prev, userMsg, pending]);
    setInput('');
    setIsSending(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message: text }),
      });

      const contentType = res.headers.get('content-type') ?? '';
      const raw = await res.text();

      let data: {
        conversationId?: string;
        reply?: string;
        citedIds?: string[];
        citedCases?: CitedCase[];
        attachments?: OnepagerAttachment[];
        assistantMessageId?: string | null;
        usedFallback?: boolean;
        limitReached?: boolean;
        error?: string;
      };

      if (contentType.includes('application/json')) {
        try {
          data = JSON.parse(raw) as typeof data;
        } catch {
          throw new Error(
            `Server returned invalid JSON (${res.status}): ${raw.slice(0, 240)}`,
          );
        }
      } else {
        throw new Error(
          `Server returned non-JSON (${res.status}): ${raw.slice(0, 240)}`,
        );
      }

      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      // Org daily cap: a normal assistant-style message, NOT an error bubble
      if (data.limitReached) {
        setLimitReached(true);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? {
                  id: `a-limit-${Date.now()}`,
                  role: 'assistant',
                  text: data.reply ?? '',
                  pending: false,
                }
              : m,
          ),
        );
        return;
      }

      if (data.conversationId) setConversationId(data.conversationId);
      if (data.citedCases?.length) mergeCited(data.citedCases);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? {
                id: data.assistantMessageId || `a-${Date.now()}`,
                role: 'assistant',
                text: data.reply ?? '',
                citedIds: data.citedIds,
                citedCases: data.citedCases,
                attachments: data.attachments,
                pending: false,
              }
            : m,
        ),
      );
    } catch (err) {
      console.error('[chat] send failed', err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? {
                id: `a-err-${Date.now()}`,
                role: 'assistant',
                text: "We couldn't get a response just now. Your message wasn't lost — try sending it again.",
                pending: false,
                error: true,
              }
            : m,
        ),
      );
    } finally {
      setIsSending(false);
      // Keep the conversation flowing — cursor back in the input
      textareaRef.current?.focus();
    }
  }

  function retryLast() {
    // Remove the error bubble + the failed user bubble; sendMessage re-adds both
    setMessages((prev) => {
      const cleaned = prev.filter((m) => !m.error);
      const last = cleaned[cleaned.length - 1];
      if (last?.role === 'user' && last.text === lastSentRef.current) {
        cleaned.pop();
      }
      return cleaned;
    });
    void sendMessage(lastSentRef.current);
  }

  function onSend(e?: FormEvent) {
    e?.preventDefault();
    void sendMessage(input);
  }

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  const showCollapsedTab = citedLibrary.length > 0 && !panelOpen;
  const canDownloadTranscript =
    Boolean(conversationId) &&
    messages.some(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        m.text.trim() &&
        !m.pending &&
        !m.error,
    );

  async function onDownloadTranscript() {
    if (!conversationId || transcriptDownloading) return;
    setTranscriptDownloading(true);
    try {
      await downloadConversationTranscript(conversationId);
    } catch (err) {
      setSttError(
        err instanceof Error ? err.message : 'Could not download transcript',
      );
    } finally {
      setTranscriptDownloading(false);
    }
  }

  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse at 20% 50%, rgba(30, 111, 217, 0.18) 0%, transparent 55%), radial-gradient(ellipse at 80% 20%, rgba(27, 58, 107, 0.28) 0%, transparent 50%), linear-gradient(160deg, #060d1a 0%, #0d1f3c 50%, #060d1a 100%)',
      }}
    >
      <div className="flex flex-1 min-h-0 w-full">
        {/* LEFT: chat */}
        <section className="flex-1 min-w-0 flex flex-col h-full relative">
          <div className="px-4 md:px-6 pt-4 pb-2 shrink-0 flex items-end justify-between gap-3">
            <div>
              <p
                className="text-xs font-semibold uppercase tracking-widest m-0 mb-1"
                style={{ color: 'var(--pi-blue-300)' }}
              >
                Commercial Adviser
              </p>
              <h1 className="text-xl font-semibold text-white m-0 tracking-tight">
                Ask about our experience
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {canDownloadTranscript ? (
                <button
                  type="button"
                  onClick={() => void onDownloadTranscript()}
                  disabled={transcriptDownloading}
                  aria-label="Download conversation transcript"
                  title="Download transcript"
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-2 text-xs font-medium disabled:opacity-60"
                  style={{
                    color: 'var(--pi-silver-300)',
                    border: '1px solid rgba(143,164,196,0.2)',
                    background: 'transparent',
                    cursor: transcriptDownloading ? 'wait' : 'pointer',
                  }}
                >
                  {transcriptDownloading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span className="hidden sm:inline">
                    {transcriptDownloading
                      ? 'Preparing PDF…'
                      : 'Download transcript'}
                  </span>
                </button>
              ) : null}
              <a
                href="https://www.paramountintelligence.co"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Visit Paramount Intelligence website"
                title="Visit Paramount Intelligence website"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-2 text-xs font-medium no-underline"
                style={{
                  color: 'var(--pi-silver-300)',
                  border: '1px solid rgba(143,164,196,0.2)',
                }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Visit website</span>
              </a>
              <a
                href="/voice"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold no-underline"
                style={{
                  color: '#fff',
                  background: 'rgba(59,136,245,0.14)',
                  border: '1px solid rgba(59,136,245,0.32)',
                }}
              >
                <Mic className="w-3.5 h-3.5" />
                Voice mode
              </a>
            </div>
          </div>

          <div className="flex-1 min-h-0 px-4 md:px-6 pb-4 flex flex-col">
            <div
              className={cn(
                'glass-dark flex-1 min-h-0 flex flex-col rounded-xl overflow-hidden',
              )}
            >
              {/* Messages — sole scroll container */}
              <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-5 py-4 space-y-4">
                {historyLoading && messages.length === 0 && (
                  <div
                    className="h-full flex items-center justify-center gap-2.5 text-sm"
                    style={{ color: 'var(--pi-silver-400)' }}
                    role="status"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading your conversation…
                  </div>
                )}
                {!historyLoading && messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center gap-5 px-4 text-center">
                    <AgentAvatar size="lg" />
                    <div>
                      <p className="m-0 text-base font-semibold text-white">
                        {user.name
                          ? `${user.name.split(' ')[0]}, what can we help you evaluate?`
                          : 'What can we help you evaluate?'}
                      </p>
                      <p
                        className="m-0 mt-1.5 text-sm max-w-md"
                        style={{ color: 'var(--pi-silver-400)' }}
                      >
                        Ask anything about our delivery experience, tech stacks,
                        PE-backed work, or a business problem.
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          disabled={isSending}
                          onClick={() => void sendMessage(s)}
                          className="chip-suggestion text-left text-xs px-3.5 py-2.5 rounded-lg"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      'msg-in flex items-end gap-2.5',
                      m.role === 'user' ? 'justify-end' : 'justify-start',
                    )}
                  >
                    {m.role === 'assistant' && <AgentAvatar size="sm" />}
                    <div
                      className={cn(
                        'max-w-[92%] md:max-w-[85%] rounded-xl px-4 py-3 text-sm',
                        m.role === 'user' ? 'whitespace-pre-wrap' : '',
                      )}
                      style={
                        m.role === 'user'
                          ? {
                              background:
                                'linear-gradient(135deg, var(--pi-blue-500) 0%, var(--primary-dark) 100%)',
                              color: '#ffffff',
                            }
                          : {
                              background: 'rgba(255,255,255,0.04)',
                              border: m.error
                                ? '1px solid rgba(143,164,196,0.4)'
                                : '1px solid rgba(255,255,255,0.08)',
                              color: 'var(--pi-silver-300)',
                            }
                      }
                    >
                      {m.pending ? (
                        m.preparingOnepager ? (
                          <span
                            className="inline-flex items-center gap-2 text-sm"
                            role="status"
                            aria-label="Preparing your one-pager"
                            style={{ color: 'var(--pi-silver-300)' }}
                          >
                            <Loader2
                              className="w-4 h-4 animate-spin shrink-0"
                              style={{ color: 'var(--pi-blue-400)' }}
                            />
                            Preparing your one-pager…
                          </span>
                        ) : (
                          <span className="typing-dots" role="status" aria-label="Assistant is thinking">
                            <span />
                            <span />
                            <span />
                          </span>
                        )
                      ) : m.error ? (
                        <div className="space-y-2.5">
                          <p
                            className="m-0 flex items-start gap-2"
                            style={{ color: 'var(--pi-silver-300)' }}
                          >
                            <AlertCircle
                              className="w-4 h-4 mt-0.5 shrink-0"
                              style={{ color: 'var(--pi-silver-400)' }}
                            />
                            {m.text}
                          </p>
                          <button
                            type="button"
                            onClick={retryLast}
                            disabled={isSending}
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg cursor-pointer"
                            style={{
                              color: 'var(--pi-blue-400)',
                              background: 'rgba(59,136,245,0.12)',
                              border: '1px solid rgba(59,136,245,0.3)',
                            }}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Try again
                          </button>
                        </div>
                      ) : m.role === 'assistant' ? (
                        <div>
                          <AssistantBody text={m.text} />
                          {m.attachments?.map((att) => (
                            <OnepagerDownloadCard
                              key={`${att.url}-${att.filename}`}
                              att={att}
                            />
                          ))}
                          {m.text.trim() ? (
                            <button
                              type="button"
                              onClick={() => void listenToMessage(m)}
                              disabled={isSending}
                              className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md border-0 cursor-pointer disabled:opacity-50"
                              style={{
                                color:
                                  ttsPlayingId === m.id || ttsLoadingId === m.id
                                    ? '#ffffff'
                                    : 'var(--pi-silver-400)',
                                background:
                                  ttsPlayingId === m.id || ttsLoadingId === m.id
                                    ? 'rgba(59,136,245,0.25)'
                                    : 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(255,255,255,0.1)',
                              }}
                              aria-label={
                                ttsPlayingId === m.id
                                  ? 'Stop listening'
                                  : 'Listen to this answer'
                              }
                              title={
                                ttsPlayingId === m.id
                                  ? 'Stop'
                                  : 'Listen to this answer'
                              }
                            >
                              {ttsLoadingId === m.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : ttsPlayingId === m.id ? (
                                <Square className="w-3 h-3" />
                              ) : (
                                <Volume2 className="w-3.5 h-3.5" />
                              )}
                              {ttsLoadingId === m.id
                                ? 'Loading…'
                                : ttsPlayingId === m.id
                                  ? 'Stop'
                                  : 'Listen'}
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        m.text
                      )}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Input pinned */}
              <form
                onSubmit={onSend}
                className="shrink-0 border-t px-4 md:px-5 pt-3 pb-2 flex flex-col gap-1.5"
                style={{ borderColor: 'rgba(30,111,217,0.2)' }}
              >
                <div className="flex gap-3 items-end">
                  <button
                    type="button"
                    onClick={toggleMic}
                    disabled={isSending || limitReached || sttBusy}
                    className="shrink-0 h-[44px] w-[44px] rounded-lg inline-flex items-center justify-center border-0 cursor-pointer disabled:opacity-50 transition-colors"
                    style={{
                      background: isRecording
                        ? 'rgba(220, 38, 38, 0.25)'
                        : sttBusy
                          ? 'rgba(59,136,245,0.2)'
                          : 'rgba(255,255,255,0.06)',
                      color: isRecording
                        ? '#fca5a5'
                        : 'var(--pi-silver-300)',
                      border: isRecording
                        ? '1px solid rgba(248,113,113,0.5)'
                        : '1px solid rgba(255,255,255,0.1)',
                      boxShadow: isRecording
                        ? '0 0 0 2px rgba(220,38,38,0.25)'
                        : undefined,
                    }}
                    aria-label={
                      isRecording
                        ? 'Stop recording'
                        : sttBusy
                          ? 'Transcribing'
                          : 'Record voice message'
                    }
                    title={
                      isRecording
                        ? 'Stop & transcribe'
                        : 'Hold a turn — tap to talk'
                    }
                  >
                    {sttBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isRecording ? (
                      <Square className="w-3.5 h-3.5 fill-current" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </button>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      autoGrow(e.target);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void sendMessage(input);
                      }
                    }}
                    rows={1}
                    placeholder={
                      isRecording
                        ? 'Listening… tap mic to stop'
                        : sttBusy
                          ? 'Transcribing…'
                          : ''
                    }
                    aria-label="Message the adviser"
                    disabled={isSending || limitReached || isRecording}
                    className="chat-input flex-1 resize-none rounded-lg px-4 py-3 text-sm outline-none max-h-[140px]"
                    style={{
                      background: 'rgba(6,13,26,0.55)',
                      color: 'var(--pi-silver-100)',
                      ...(limitReached || isRecording ? { opacity: 0.5 } : {}),
                    }}
                  />
                  <button
                    type="submit"
                    disabled={isSending || limitReached || !input.trim() || isRecording || sttBusy}
                    className="btn-primary shrink-0 h-[44px] px-5"
                    aria-label="Send message"
                  >
                    {isSending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Send
                  </button>
                </div>
                {sttError ? (
                  <p
                    className="m-0 text-[11px] select-none"
                    style={{ color: '#fca5a5' }}
                    role="alert"
                  >
                    {sttError}
                  </p>
                ) : isRecording ? (
                  <p
                    className="m-0 text-[11px] select-none inline-flex items-center gap-1.5"
                    style={{ color: '#fca5a5' }}
                  >
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                      style={{ background: '#ef4444' }}
                    />
                    Recording — tap mic again to stop &amp; transcribe
                  </p>
                ) : limitReached ? (
                  <p
                    className="m-0 text-[11px] select-none"
                    style={{ color: 'var(--pi-silver-400)' }}
                  >
                    Daily limit reached — resets tomorrow.
                  </p>
                ) : (
                  <p
                    className="m-0 text-[11px] select-none hidden md:block"
                    style={{ color: 'rgba(143,164,196,0.55)' }}
                  >
                    Enter to send · Shift+Enter for a new line · Mic fills the
                    input (does not auto-send)
                  </p>
                )}
              </form>
            </div>
          </div>

          {/* Collapsed tab — reopen panel */}
          {showCollapsedTab && (
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-20 hidden lg:flex items-center gap-1.5 pl-2 pr-3 py-2 rounded-l-lg text-xs font-medium"
              style={{
                color: 'var(--pi-blue-400)',
                background: 'rgba(13,31,60,0.95)',
                border: '1px solid rgba(59,136,245,0.3)',
                borderRight: 'none',
              }}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Cases · {citedLibrary.length}
            </button>
          )}

          {/* Mobile: collapsed reopen button */}
          {showCollapsedTab && (
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="lg:hidden fixed bottom-24 right-4 z-30 px-3 py-2 rounded-full text-xs font-medium shadow-lg"
              style={{
                color: 'var(--pi-blue-400)',
                background: 'var(--pi-navy-800)',
                border: '1px solid rgba(59,136,245,0.35)',
              }}
            >
              Cases · {citedLibrary.length}
            </button>
          )}
        </section>

        {/* RIGHT: case panel */}
        <CasePanel
          cases={citedLibrary}
          open={panelOpen && citedLibrary.length > 0}
          onToggle={() => setPanelOpen(false)}
          onCloseMobile={() => setPanelOpen(false)}
        />
      </div>
    </div>
  );
}
