'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { AlertCircle, AudioLines, Check, CheckCircle2, Copy, ExternalLink, Eye, FileText, LibraryBig, Loader2, Mic, RotateCcw, Send, Volume2, Square, X } from 'lucide-react';
import { stripCaseTags } from '@/lib/citationText';
import { stripEmDashes } from '@/lib/agent/normalizeOutput';
import { cn } from '@/lib/utils';
import ConversationSidebar, {
  type ConversationListItem,
} from './ConversationSidebar';
import ChatEmptyState from './ChatEmptyState';
import ChatVideoBackground from './ChatVideoBackground';
import LibraryDialog from './LibraryDialog';
import DocumentViewer, { type ViewableDoc } from './DocumentViewer';

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
  /** User pressed Stop while this turn was generating. */
  stopped?: boolean;
};

const ONEPAGER_ASK_RE =
  /\b(one[\s-]?pager|onepager|\.pdf\b|\.png\b|pdf|png|branded\s+document|case\s+document)\b/i;

/**
 * Agent avatar - Paramount logo from /public/images/logo.png.
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

function OnepagerDownloadCard({
  att,
  onView,
}: {
  att: OnepagerAttachment;
  onView: (doc: ViewableDoc) => void;
}) {
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
      <button
        type="button"
        onClick={() =>
          onView({
            title,
            url: att.url,
            filename: att.filename,
            format: att.format,
          })
        }
        className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border-0 cursor-pointer shrink-0"
        style={{
          color: '#ffffff',
          background:
            'linear-gradient(135deg, var(--pi-blue-500) 0%, var(--primary-dark) 100%)',
        }}
      >
        <Eye className="w-3.5 h-3.5" />
        View {formatLabel}
      </button>
    </div>
  );
}

function AssistantBody({ text }: { text: string }) {
  // Assistant-only: strip tags, then normalize dashes, then markdown
  const cleaned = stripEmDashes(stripCaseTags(text));

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

/** Cited case rendered inline in the thread, under the message that cited it. */
function InlineCaseCard({ c }: { c: CitedCase }) {
  return (
    <div
      className="mt-3 rounded-lg px-3 py-2.5"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(59,136,245,0.22)',
        borderLeft: '2px solid var(--pi-blue-400)',
      }}
    >
      <p
        className="m-0 text-[10px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--pi-blue-300)' }}
      >
        Referenced case
      </p>
      <p className="m-0 mt-1 text-xs font-semibold text-white leading-snug">
        {c.title}
      </p>
      {c.blurb ? (
        <p
          className="m-0 mt-1 text-xs leading-relaxed"
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
          className="inline-block m-0 mt-1.5 text-xs font-medium no-underline"
          style={{ color: 'var(--pi-blue-400)' }}
        >
          View case →
        </a>
      ) : null}
    </div>
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
  const [conversations, setConversations] = useState<ConversationListItem[]>(
    [],
  );
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [switchingChat, setSwitchingChat] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<ViewableDoc | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [ttsPlayingId, setTtsPlayingId] = useState<string | null>(null);
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [sttBusy, setSttBusy] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSentRef = useRef<string>('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  // True once the user sends anything — a late-arriving history response must
  // not clobber a conversation they already started in this tab
  const hasSentRef = useRef(false);

  function notify(
    message: string,
    type: 'success' | 'error' = 'success',
  ) {
    setNotification({ message, type });
  }

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notification]);

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
          setSttError('No audio captured, try again');
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
          : 'Could not access microphone, check browser permissions',
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

  async function refreshConversations() {
    try {
      const res = await fetch('/api/chat/conversations');
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        conversations?: ConversationListItem[];
      };
      setConversations(data.conversations ?? []);
    } catch {
      // keep prior list
    } finally {
      setConversationsLoading(false);
    }
  }

  function mapHistoryMessages(
    raw: Array<{
      id: string;
      role: string;
      content: string;
      citedIds?: string[];
      citedCases?: CitedCase[];
      attachments?: OnepagerAttachment[];
    }>,
  ): ChatMessage[] {
    return raw
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        text: m.content,
        citedIds: m.citedIds,
        citedCases: m.citedCases,
        attachments: m.attachments,
      }));
  }

  // Load sidebar list only. Login always lands on a client-side empty draft —
  // Conversation rows are created on the first sent message, not on arrival.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const listRes = await fetch('/api/chat/conversations');
        if (listRes.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (listRes.ok) {
          const listData = (await listRes.json()) as {
            conversations?: ConversationListItem[];
          };
          if (!cancelled) setConversations(listData.conversations ?? []);
        }
      } catch {
        // Network hiccup → empty draft is already the default
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
          setConversationsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function selectConversation(id: string) {
    if (id === conversationId || isSending || switchingChat) return;
    setSwitchingChat(true);
    setSttError(null);
    stopTts();
    try {
      const res = await fetch(`/api/chat/conversations/${id}`);
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (res.status === 404) {
        await refreshConversations();
        throw new Error('That chat is no longer available.');
      }
      const data = (await res.json()) as {
        conversation?: { id: string; title: string | null };
        messages?: Array<{
          id: string;
          role: string;
          content: string;
          citedIds?: string[];
          citedCases?: CitedCase[];
          attachments?: OnepagerAttachment[];
        }>;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || 'Failed to load chat');

      hasSentRef.current = false;
      setConversationId(data.conversation?.id ?? id);
      setMessages(mapHistoryMessages(data.messages ?? []));
      setLimitReached(false);
      setInput('');
      textareaRef.current?.focus();
    } catch (err) {
      setSttError(err instanceof Error ? err.message : 'Failed to switch chat');
    } finally {
      setSwitchingChat(false);
    }
  }

  function createNewChat() {
    if (isSending || switchingChat) return;
    // Already on an empty draft — don't stack empties or hit the DB.
    if (!conversationId && messages.length === 0) {
      textareaRef.current?.focus();
      return;
    }
    stopTts();
    hasSentRef.current = false;
    setConversationId(undefined);
    setMessages([]);
    setLimitReached(false);
    setInput('');
    setSttError(null);
    textareaRef.current?.focus();
  }

  async function renameConversation(id: string, title: string) {
    const res = await fetch(`/api/chat/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    const data = (await res.json()) as {
      conversation?: ConversationListItem;
      error?: string;
    };
    if (!res.ok || !data.conversation) {
      throw new Error(data.error || 'Rename failed');
    }
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...data.conversation! } : c)),
    );
  }

  async function deleteConversation(id: string) {
    const res = await fetch(`/api/chat/conversations/${id}`, {
      method: 'DELETE',
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error || 'Delete failed');
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (conversationId === id) {
      // Back to a client-only empty draft (no DB create until first send).
      hasSentRef.current = false;
      setConversationId(undefined);
      setMessages([]);
      setLimitReached(false);
      setInput('');
      textareaRef.current?.focus();
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

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message: text }),
        signal: controller.signal,
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
      // Title + updatedAt change server-side — refresh sidebar.
      void refreshConversations();
    } catch (err) {
      // User pressed Stop — discard the pending bubble cleanly, no error state.
      // The server may still finish and persist the reply; reopening the chat
      // will show it, which is harmless.
      if (controller.signal.aborted) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? {
                  id: `a-stop-${Date.now()}`,
                  role: 'assistant',
                  text: 'Response stopped.',
                  pending: false,
                  stopped: true,
                }
              : m,
          ),
        );
        void refreshConversations();
        return;
      }
      console.error('[chat] send failed', err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? {
                id: `a-err-${Date.now()}`,
                role: 'assistant',
                text: "We couldn't get a response just now. Your message wasn't lost, try sending it again.",
                pending: false,
                error: true,
              }
            : m,
        ),
      );
    } finally {
      abortRef.current = null;
      setIsSending(false);
      // Keep the conversation flowing — cursor back in the input
      textareaRef.current?.focus();
    }
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  /** Readable plain text for the clipboard - no [[case:ID]] tags, no markdown syntax. */
  function toPlainText(text: string): string {
    return stripEmDashes(stripCaseTags(text))
      .replace(/^#{1,6}\s+/gm, '') // headings
      .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
      .replace(/__([^_]+)__/g, '$1')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1$2') // italics (not list markers)
      .replace(/`([^`]+)`/g, '$1') // inline code
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → label
      .trim();
  }

  async function copyMessage(m: ChatMessage) {
    const cleaned = toPlainText(m.text);
    if (!cleaned) return;
    try {
      await navigator.clipboard.writeText(cleaned);
      setCopiedId(m.id);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      notify('Could not copy to clipboard.', 'error');
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

  // Claude-style empty state: the input sits vertically centered until the
  // conversation starts, then the spacer below it collapses and the input
  // animates down to the bottom edge.
  const inputCentered = !historyLoading && messages.length === 0;
  const canDownloadTranscript =
    Boolean(conversationId) &&
    messages.some(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        m.text.trim() &&
        !m.pending &&
        !m.error,
    );

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
    <div
      className="relative isolate h-screen flex flex-col overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse at 20% 50%, rgba(30, 111, 217, 0.18) 0%, transparent 55%), radial-gradient(ellipse at 80% 20%, rgba(27, 58, 107, 0.28) 0%, transparent 50%), linear-gradient(160deg, #060d1a 0%, #0d1f3c 50%, #060d1a 100%)',
      }}
    >
      {notification ? (
        <div
          className="fixed right-4 top-4 z-[70] w-[min(380px,calc(100vw-2rem))] rounded-xl border p-3.5 shadow-2xl"
          role={notification.type === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          style={{
            background:
              notification.type === 'error'
                ? 'linear-gradient(145deg, rgba(55,20,29,0.98), rgba(17,18,32,0.98))'
                : 'linear-gradient(145deg, rgba(10,48,45,0.98), rgba(10,23,38,0.98))',
            borderColor:
              notification.type === 'error'
                ? 'rgba(248,113,113,0.36)'
                : 'rgba(52,211,153,0.32)',
            boxShadow: '0 18px 55px rgba(0,0,0,0.45)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div className="flex items-start gap-3">
            {notification.type === 'error' ? (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
            )}
            <p className="m-0 flex-1 text-sm leading-relaxed text-white">
              {notification.message}
            </p>
            <button
              type="button"
              onClick={() => setNotification(null)}
              className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
      <div className="relative z-10 flex flex-1 min-h-0 w-full">
        <div className="hidden md:flex h-full">
          <ConversationSidebar
            conversations={conversations}
            activeId={conversationId}
            loading={conversationsLoading}
            busy={isSending || switchingChat}
            onSelect={(id) => void selectConversation(id)}
            onNewChat={createNewChat}
            onRename={renameConversation}
            onDelete={deleteConversation}
            onNotify={notify}
            onOpenLibrary={() => setLibraryOpen(true)}
          />
        </div>
        {/* LEFT: chat */}
        <section className="flex-1 min-w-0 flex flex-col h-full relative">
          <div className="px-4 md:px-6 pt-4 pb-2 shrink-0 flex items-end justify-between gap-3">
            <div>
              <p
                className="text-xs font-semibold uppercase tracking-widest m-0 mb-1"
                style={{ color: 'var(--pi-blue-300)' }}
              >
                AI-Assistant
              </p>
              <h1 className="text-xl font-semibold text-white m-0 tracking-tight">
                Paramount Intelligence
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={createNewChat}
                disabled={isSending || switchingChat}
                className="md:hidden inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium disabled:opacity-50"
                style={{
                  color: '#fff',
                  background: 'rgba(59,136,245,0.14)',
                  border: '1px solid rgba(59,136,245,0.32)',
                }}
                aria-label="New chat"
                title="New chat"
              >
                New chat
              </button>
              <button
                type="button"
                onClick={() => setLibraryOpen(true)}
                className="md:hidden inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium"
                style={{
                  color: 'var(--pi-silver-300)',
                  border: '1px solid rgba(143,164,196,0.2)',
                  background: 'transparent',
                }}
                aria-label="Open library"
                title="Library"
              >
                <LibraryBig className="w-3.5 h-3.5" />
              </button>
              {canDownloadTranscript ? (
                <button
                  type="button"
                  onClick={openTranscriptViewer}
                  aria-label="View conversation transcript"
                  title="View transcript"
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-2 text-xs font-medium"
                  style={{
                    color: 'var(--pi-silver-300)',
                    border: '1px solid rgba(143,164,196,0.2)',
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">View transcript</span>
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
            </div>
          </div>

          <div className="flex-1 min-h-0 px-4 md:px-6 pb-4 flex flex-col">
            <div className="glass-dark chat-main-surface relative isolate flex-1 min-h-0 flex flex-col rounded-xl overflow-hidden">
              <ChatVideoBackground />
              {inputCentered || (historyLoading && messages.length === 0) ? (
                <ChatEmptyState loading={historyLoading}>
                        <form
                          onSubmit={onSend}
                          className="w-full flex flex-col gap-1.5"
                        >
                          <div
                            className="chat-inputfield flex items-end gap-1.5 rounded-xl pl-2 pr-2 py-1.5"
                            style={{ background: 'rgba(6,13,26,0.55)' }}
                          >
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
                                    : 'Ask Jackie'
                              }
                              aria-label="Ask Jackie"
                              disabled={isSending || limitReached || isRecording}
                              className="flex-1 resize-none rounded-lg border-0 bg-transparent px-2 py-2 text-sm outline-none max-h-[140px]"
                              style={{
                                color: 'var(--pi-silver-100)',
                                ...(limitReached || isRecording
                                  ? { opacity: 0.5 }
                                  : {}),
                              }}
                            />
                            <button
                              type="button"
                              onClick={toggleMic}
                              disabled={isSending || limitReached || sttBusy}
                              className="shrink-0 h-9 w-9 rounded-lg inline-flex items-center justify-center cursor-pointer disabled:opacity-50 transition-colors"
                              style={{
                                background: isRecording
                                  ? 'rgba(220, 38, 38, 0.25)'
                                  : sttBusy
                                    ? 'rgba(59,136,245,0.2)'
                                    : 'transparent',
                                color: isRecording
                                  ? '#fca5a5'
                                  : 'var(--pi-silver-300)',
                                border: isRecording
                                  ? '1px solid rgba(248,113,113,0.5)'
                                  : '1px solid transparent',
                                boxShadow: isRecording
                                  ? '0 0 0 2px rgba(220,38,38,0.25)'
                                  : undefined,
                              }}
                              aria-label={
                                isRecording
                                  ? 'Stop'
                                  : sttBusy
                                    ? 'Transcribing'
                                    : 'Press to start recording'
                              }
                              title={
                                isRecording
                                  ? 'Stop'
                                  : 'Press to start recording'
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
                            {isSending ? (
                              <button
                                type="button"
                                onClick={stopGeneration}
                                className="shrink-0 h-9 w-9 rounded-lg inline-flex items-center justify-center cursor-pointer"
                                aria-label="Stop generating"
                                title="Stop generating"
                                style={{
                                  color: '#fecaca',
                                  background: 'rgba(127,29,29,0.25)',
                                  border: '1px solid rgba(248,113,113,0.4)',
                                }}
                              >
                                <Square className="w-3.5 h-3.5 fill-current" />
                              </button>
                            ) : (
                              <button
                                type="submit"
                                disabled={
                                  limitReached ||
                                  !input.trim() ||
                                  isRecording ||
                                  sttBusy
                                }
                                className="shrink-0 h-9 w-9 rounded-lg inline-flex items-center justify-center border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-transform enabled:hover:scale-105"
                                aria-label="Send message"
                                title="Send"
                                style={{
                                  color: '#ffffff',
                                  background:
                                    'linear-gradient(135deg, var(--pi-blue-500) 0%, var(--primary-dark) 100%)',
                                }}
                              >
                                <Send className="w-4 h-4" />
                              </button>
                            )}
                            <a
                              href="/voice"
                              className="shrink-0 h-9 w-9 rounded-lg inline-flex items-center justify-center no-underline"
                              aria-label="Use Voice Mode"
                              title="Use Voice Mode"
                              style={{
                                color: 'var(--pi-blue-300)',
                                background: 'rgba(59,136,245,0.14)',
                                border: '1px solid rgba(59,136,245,0.32)',
                              }}
                            >
                              <AudioLines className="w-4 h-4" />
                            </a>
                          </div>
                          {sttError ? (
                            <div
                              className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5"
                              role="alert"
                              style={{
                                color: '#fecaca',
                                background: 'rgba(127,29,29,0.16)',
                                borderColor: 'rgba(248,113,113,0.24)',
                              }}
                            >
                              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <p className="m-0 flex-1 text-[11px] leading-relaxed">
                                {sttError}
                              </p>
                              <button
                                type="button"
                                onClick={() => setSttError(null)}
                                className="rounded p-0.5 text-red-200/70 hover:bg-white/10 hover:text-red-100"
                                aria-label="Dismiss alert"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ) : isRecording ? (
                            <p
                              className="m-0 text-[11px] select-none inline-flex items-center gap-1.5"
                              style={{ color: '#fca5a5' }}
                            >
                              <span
                                className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                                style={{ background: '#ef4444' }}
                              />
                              Recording, tap mic again to stop &amp; transcribe
                            </p>
                          ) : limitReached ? (
                            <p
                              className="m-0 text-[11px] select-none"
                              style={{ color: 'var(--pi-silver-400)' }}
                            >
                              Daily limit reached, resets tomorrow.
                            </p>
                          ) : null}
                        </form>
                </ChatEmptyState>
              ) : (
                <div className="relative z-10 flex flex-1 min-h-0 flex-col">
                  {/* Active thread: messages scroll; input pinned below */}
                  <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-5 py-4 space-y-4">
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
                              <span
                                className="typing-dots"
                                role="status"
                                aria-label="Assistant is thinking"
                              >
                                <span />
                                <span />
                                <span />
                              </span>
                            )
                          ) : m.stopped ? (
                            <p
                              className="m-0 inline-flex items-center gap-2 text-xs italic"
                              style={{ color: 'var(--pi-silver-400)' }}
                            >
                              <Square className="w-3 h-3 shrink-0 fill-current opacity-60" />
                              {m.text}
                            </p>
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
                              {m.citedCases?.map((c) => (
                                <InlineCaseCard key={`${m.id}-${c.id}`} c={c} />
                              ))}
                              {m.attachments?.map((att) => (
                                <OnepagerDownloadCard
                                  key={`${att.url}-${att.filename}`}
                                  att={att}
                                  onView={setViewingDoc}
                                />
                              ))}
                              {m.text.trim() ? (
                                <div className="mt-2.5 flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => void listenToMessage(m)}
                                    disabled={isSending}
                                    className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md border-0 cursor-pointer disabled:opacity-50"
                                    style={{
                                      color:
                                        ttsPlayingId === m.id ||
                                        ttsLoadingId === m.id
                                          ? '#ffffff'
                                          : 'var(--pi-silver-400)',
                                      background:
                                        ttsPlayingId === m.id ||
                                        ttsLoadingId === m.id
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
                                  <button
                                    type="button"
                                    onClick={() => void copyMessage(m)}
                                    className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md cursor-pointer"
                                    style={{
                                      color:
                                        copiedId === m.id
                                          ? '#6ee7b7'
                                          : 'var(--pi-silver-400)',
                                      background: 'rgba(255,255,255,0.04)',
                                      border: '1px solid rgba(255,255,255,0.1)',
                                    }}
                                    aria-label="Copy this answer"
                                    title="Copy to clipboard"
                                  >
                                    {copiedId === m.id ? (
                                      <Check className="w-3.5 h-3.5" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                    {copiedId === m.id ? 'Copied' : 'Copy'}
                                  </button>
                                </div>
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

                  <form
                    onSubmit={onSend}
                    className="shrink-0 border-t px-4 md:px-5 pt-3 pb-3 flex flex-col gap-1.5 w-full mx-auto"
                    style={{
                      maxWidth: 640,
                      borderColor: 'rgba(30,111,217,0.2)',
                    }}
                  >
                    <div
                      className="chat-inputfield flex items-end gap-1.5 rounded-xl pl-2 pr-2 py-1.5"
                      style={{ background: 'rgba(6,13,26,0.55)' }}
                    >
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
                              : 'Ask Jackie'
                        }
                        aria-label="Ask Jackie"
                        disabled={isSending || limitReached || isRecording}
                        className="flex-1 resize-none rounded-lg border-0 bg-transparent px-2 py-2 text-sm outline-none max-h-[140px]"
                        style={{
                          color: 'var(--pi-silver-100)',
                          ...(limitReached || isRecording
                            ? { opacity: 0.5 }
                            : {}),
                        }}
                      />
                      <button
                        type="button"
                        onClick={toggleMic}
                        disabled={isSending || limitReached || sttBusy}
                        className="shrink-0 h-9 w-9 rounded-lg inline-flex items-center justify-center cursor-pointer disabled:opacity-50 transition-colors"
                        style={{
                          background: isRecording
                            ? 'rgba(220, 38, 38, 0.25)'
                            : sttBusy
                              ? 'rgba(59,136,245,0.2)'
                              : 'transparent',
                          color: isRecording
                            ? '#fca5a5'
                            : 'var(--pi-silver-300)',
                          border: isRecording
                            ? '1px solid rgba(248,113,113,0.5)'
                            : '1px solid transparent',
                          boxShadow: isRecording
                            ? '0 0 0 2px rgba(220,38,38,0.25)'
                            : undefined,
                        }}
                        aria-label={
                          isRecording
                            ? 'Stop'
                            : sttBusy
                              ? 'Transcribing'
                              : 'Press to start recording'
                        }
                        title={
                          isRecording
                            ? 'Stop'
                            : 'Press to start recording'
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
                      {isSending ? (
                        <button
                          type="button"
                          onClick={stopGeneration}
                          className="shrink-0 h-9 w-9 rounded-lg inline-flex items-center justify-center cursor-pointer"
                          aria-label="Stop generating"
                          title="Stop generating"
                          style={{
                            color: '#fecaca',
                            background: 'rgba(127,29,29,0.25)',
                            border: '1px solid rgba(248,113,113,0.4)',
                          }}
                        >
                          <Square className="w-3.5 h-3.5 fill-current" />
                        </button>
                      ) : (
                        <button
                          type="submit"
                          disabled={
                            limitReached ||
                            !input.trim() ||
                            isRecording ||
                            sttBusy
                          }
                          className="shrink-0 h-9 w-9 rounded-lg inline-flex items-center justify-center border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-transform enabled:hover:scale-105"
                          aria-label="Send message"
                          title="Send"
                          style={{
                            color: '#ffffff',
                            background:
                              'linear-gradient(135deg, var(--pi-blue-500) 0%, var(--primary-dark) 100%)',
                          }}
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      )}
                      <a
                        href="/voice"
                        className="shrink-0 h-9 w-9 rounded-lg inline-flex items-center justify-center no-underline"
                        aria-label="Use Voice Mode"
                        title="Use Voice Mode"
                        style={{
                          color: 'var(--pi-blue-300)',
                          background: 'rgba(59,136,245,0.14)',
                          border: '1px solid rgba(59,136,245,0.32)',
                        }}
                      >
                        <AudioLines className="w-4 h-4" />
                      </a>
                    </div>
                    {sttError ? (
                      <div
                        className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5"
                        role="alert"
                        style={{
                          color: '#fecaca',
                          background: 'rgba(127,29,29,0.16)',
                          borderColor: 'rgba(248,113,113,0.24)',
                        }}
                      >
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <p className="m-0 flex-1 text-[11px] leading-relaxed">
                          {sttError}
                        </p>
                        <button
                          type="button"
                          onClick={() => setSttError(null)}
                          className="rounded p-0.5 text-red-200/70 hover:bg-white/10 hover:text-red-100"
                          aria-label="Dismiss alert"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : isRecording ? (
                      <p
                        className="m-0 text-[11px] select-none inline-flex items-center gap-1.5"
                        style={{ color: '#fca5a5' }}
                      >
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                          style={{ background: '#ef4444' }}
                        />
                        Recording, tap mic again to stop &amp; transcribe
                      </p>
                    ) : limitReached ? (
                      <p
                        className="m-0 text-[11px] select-none"
                        style={{ color: 'var(--pi-silver-400)' }}
                      >
                        Daily limit reached, resets tomorrow.
                      </p>
                    ) : null}
                  </form>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <LibraryDialog open={libraryOpen} onClose={() => setLibraryOpen(false)} />
      <DocumentViewer
        doc={viewingDoc}
        onClose={() => setViewingDoc(null)}
      />
    </div>
  );
}
