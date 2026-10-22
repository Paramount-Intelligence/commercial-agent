'use client';

import { useEffect, useState } from 'react';
import {
  Building2,
  Eye,
  FileText,
  Loader2,
  MessagesSquare,
  Search,
  X,
} from 'lucide-react';
import DocumentViewer, { type ViewableDoc } from './DocumentViewer';

export type LibraryItem = {
  key: string;
  kind: 'company' | 'one-pager' | 'transcript';
  title: string;
  filename: string;
  url: string;
  format: 'pdf' | 'png' | 'docx';
  conversationId?: string;
  conversationTitle?: string | null;
  createdAt: string;
};

const SECTIONS: Array<{
  kind: LibraryItem['kind'];
  label: string;
  empty: string;
}> = [
  {
    kind: 'company',
    label: 'Company documents',
    empty: 'No shareable company documents right now.',
  },
  {
    kind: 'one-pager',
    label: 'One-pagers & shared docs',
    empty: 'Documents generated for you will appear here.',
  },
  {
    kind: 'transcript',
    label: 'Conversation transcripts',
    empty: 'Transcript downloads you request will appear here.',
  },
];

function KindIcon({ kind }: { kind: LibraryItem['kind'] }) {
  const cls = 'w-4 h-4 shrink-0';
  const style = { color: 'var(--pi-blue-400)' };
  if (kind === 'company') return <Building2 className={cls} style={style} aria-hidden />;
  if (kind === 'transcript')
    return <MessagesSquare className={cls} style={style} aria-hidden />;
  return <FileText className={cls} style={style} aria-hidden />;
}

export default function LibraryDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ViewableDoc | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) {
      setViewing(null);
      setQuery('');
      return;
    }
    let cancelled = false;
    setItems(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch('/api/chat/library');
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        const data = (await res.json()) as {
          items?: LibraryItem[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || 'Could not load library');
        if (!cancelled) setItems(data.items ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Could not load library',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || viewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, viewing]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !viewing) onClose();
        }}
        style={{ background: 'rgba(11, 18, 32, 0.28)', backdropFilter: 'blur(5px)' }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="library-title"
          className="phase5-library w-full max-w-3xl max-h-[88vh] flex flex-col rounded-xl border overflow-hidden"
        >
          <div
            className="flex items-start justify-between gap-4 px-5 py-4 shrink-0 border-b"
            style={{ borderColor: 'rgba(143,164,196,0.14)' }}
          >
            <div>
              <p
                className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em]"
                style={{ color: '#5B6577' }}
              >
                Your documents
              </p>
              <h2
                id="library-title"
                className="m-0 mt-1 text-2xl font-semibold text-[#0B1220]"
              >
                Documents
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-[#5B6577] hover:bg-[#F7F8FA] hover:text-[#0B1220]"
              aria-label="Close library"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="phase5-library-search-wrap">
            <Search className="h-4 w-4" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="phase5-library-search"
              placeholder="Search documents"
              aria-label="Search documents"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-6">
            {items === null && !error ? (
              <div
                className="flex items-center justify-center gap-2 py-10 text-sm"
                style={{ color: 'var(--pi-silver-400)' }}
                role="status"
              >
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading your library…
              </div>
            ) : error ? (
              <p
                className="m-0 py-10 text-center text-sm"
                style={{ color: 'var(--pi-silver-400)' }}
                role="alert"
              >
                {error}
              </p>
            ) : (
              SECTIONS.map((section) => {
                const normalizedQuery = query.trim().toLocaleLowerCase();
                const rows = (items ?? []).filter(
                  (item) =>
                    item.kind === section.kind &&
                    (!normalizedQuery ||
                      [item.title, item.filename, item.format, item.conversationTitle]
                        .filter(Boolean)
                        .some((value) =>
                          String(value).toLocaleLowerCase().includes(normalizedQuery),
                        )),
                );
                return (
                  <section key={section.kind}>
                    <h3
                      className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-widest"
                      style={{ color: '#5B6577' }}
                    >
                      {section.label}
                    </h3>
                    {rows.length === 0 ? (
                      <p
                        className="m-0 text-xs"
                        style={{ color: 'var(--pi-silver-400)' }}
                      >
                        {section.empty}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {rows.map((item) => (
                          <div
                            key={item.key}
                            className="phase5-document-row flex flex-wrap items-center gap-3 rounded-xl px-4 py-4"
                          >
                            <KindIcon kind={item.kind} />
                            <div className="min-w-0 flex-1">
                              <p className="m-0 text-sm font-semibold text-[#0B1220] truncate">
                                {item.title}
                              </p>
                              <p
                                className="m-0 mt-0.5 text-[10px] truncate"
                                style={{ color: 'var(--pi-silver-400)' }}
                              >
                                {item.format.toUpperCase()}
                                {item.conversationId
                                  ? ` · from “${
                                      item.conversationTitle?.trim() || 'a chat'
                                    }”`
                                  : ' · Paramount Intelligence'}
                                {' · '}
                                {new Date(item.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setViewing({
                                  title: item.title,
                                  url: item.url,
                                  filename: item.filename,
                                  format: item.format,
                                })
                              }
                              className="phase5-document-action inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md shrink-0 border-0 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              View
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })
            )}
          </div>
        </div>
      </div>

      <DocumentViewer
        doc={viewing}
        onClose={() => setViewing(null)}
        onBack={() => setViewing(null)}
      />
    </>
  );
}
