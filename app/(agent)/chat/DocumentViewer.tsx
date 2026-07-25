'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Download, FileText, Loader2, X } from 'lucide-react';

export type ViewableDoc = {
  title: string;
  url: string;
  filename: string;
  format: 'pdf' | 'png' | 'docx';
};

/**
 * Cookies for our own gated routes; omitted for storage URLs. Blob replies with
 * `Access-Control-Allow-Origin: *`, which CORS rejects on credentialed requests.
 */
function fetchDoc(url: string): Promise<Response> {
  const sameOrigin = url.startsWith('/');
  return fetch(url, { credentials: sameOrigin ? 'same-origin' : 'omit' });
}

/**
 * In-app document viewer. Fetches the file, renders PDF/PNG inline, and offers
 * Download from the same view. DOCX can't be previewed in-browser — we show a
 * clear fallback + download.
 */
export default function DocumentViewer({
  doc,
  onClose,
  onBack,
}: {
  doc: ViewableDoc | null;
  onClose: () => void;
  /** When set, shows a "Back to library" control instead of only closing. */
  onBack?: () => void;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!doc) {
      setObjectUrl(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);
    setObjectUrl(null);

    (async () => {
      try {
        const res = await fetchDoc(doc.url);
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (!res.ok) {
          let message = `Could not open document (${res.status})`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data.error) message = data.error;
          } catch {
            // non-JSON body
          }
          throw new Error(message);
        }
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Could not open document',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [doc]);

  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (onBack ?? onClose)();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, onClose, onBack]);

  if (!doc) return null;

  async function onDownload() {
    if (!doc || downloading) return;
    setDownloading(true);
    try {
      // Prefer the already-fetched blob URL so we don't re-hit Chromium for
      // transcripts; fall back to a fresh fetch if preview failed.
      let href = objectUrl;
      if (!href) {
        const res = await fetchDoc(doc.url);
        if (!res.ok) throw new Error('Download failed');
        const blob = await res.blob();
        href = URL.createObjectURL(blob);
        try {
          triggerDownload(href, doc.filename);
        } finally {
          URL.revokeObjectURL(href);
        }
        return;
      }
      triggerDownload(href, doc.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  const canPreview = doc.format === 'pdf' || doc.format === 'png';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) (onBack ?? onClose)();
      }}
      style={{ background: 'rgba(2, 8, 23, 0.78)', backdropFilter: 'blur(10px)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="doc-viewer-title"
        className="w-full max-w-5xl h-[min(92vh,900px)] flex flex-col rounded-2xl border shadow-2xl overflow-hidden"
        style={{
          background:
            'linear-gradient(145deg, rgba(17,35,65,0.99), rgba(6,16,32,0.99))',
          borderColor: 'rgba(107,168,255,0.3)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
        }}
      >
        <div
          className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 shrink-0 border-b"
          style={{ borderColor: 'rgba(143,164,196,0.14)' }}
        >
          <div className="min-w-0 flex items-center gap-2.5">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1.5 shrink-0 rounded-lg px-2.5 py-2 text-xs font-medium"
                style={{
                  color: 'var(--pi-silver-300)',
                  border: '1px solid rgba(143,164,196,0.22)',
                  background: 'transparent',
                }}
                aria-label="Back to library"
                title="Back to library"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            ) : null}
            <FileText
              className="w-4 h-4 shrink-0"
              style={{ color: 'var(--pi-blue-400)' }}
              aria-hidden
            />
            <div className="min-w-0">
              <p
                className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: 'var(--pi-blue-300)' }}
              >
                {doc.format.toUpperCase()}
              </p>
              <h2
                id="doc-viewer-title"
                className="m-0 text-sm sm:text-base font-semibold text-white truncate"
              >
                {doc.title}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void onDownload()}
              disabled={downloading || (!objectUrl && loading)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              style={{
                background:
                  'linear-gradient(135deg, var(--pi-blue-500) 0%, var(--primary-dark) 100%)',
              }}
            >
              {downloading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Download
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label="Close document"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          className="flex-1 min-h-0 relative"
          style={{ background: 'rgba(0,0,0,0.35)' }}
        >
          {loading ? (
            <div
              className="absolute inset-0 flex items-center justify-center gap-2.5 text-sm"
              style={{ color: 'var(--pi-silver-400)' }}
              role="status"
            >
              <Loader2 className="w-5 h-5 animate-spin" />
              Opening document…
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <p
                className="m-0 text-sm"
                style={{ color: 'var(--pi-silver-300)' }}
                role="alert"
              >
                {error}
              </p>
              <button
                type="button"
                onClick={() => void onDownload()}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white"
                style={{
                  background:
                    'linear-gradient(135deg, var(--pi-blue-500) 0%, var(--primary-dark) 100%)',
                }}
              >
                <Download className="w-3.5 h-3.5" />
                Try download instead
              </button>
            </div>
          ) : !canPreview ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <FileText
                className="w-10 h-10"
                style={{ color: 'var(--pi-blue-400)' }}
                aria-hidden
              />
              <p className="m-0 text-sm text-white font-medium">
                Preview isn't available for Word documents
              </p>
              <p
                className="m-0 text-xs max-w-sm"
                style={{ color: 'var(--pi-silver-400)' }}
              >
                Download the file to open it in Word or another compatible app.
              </p>
              <button
                type="button"
                onClick={() => void onDownload()}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white"
                style={{
                  background:
                    'linear-gradient(135deg, var(--pi-blue-500) 0%, var(--primary-dark) 100%)',
                }}
              >
                <Download className="w-3.5 h-3.5" />
                Download {doc.filename}
              </button>
            </div>
          ) : doc.format === 'png' && objectUrl ? (
            <div className="absolute inset-0 overflow-auto flex items-start justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={objectUrl}
                alt={doc.title}
                className="max-w-full h-auto rounded-lg shadow-lg"
              />
            </div>
          ) : objectUrl ? (
            <iframe
              title={doc.title}
              src={objectUrl}
              className="absolute inset-0 w-full h-full border-0 bg-white"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
