'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  LibraryBig,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type ConversationListItem = {
  id: string;
  title: string | null;
  updatedAt: string;
  createdAt?: string;
  messageCount: number;
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

type Props = {
  conversations: ConversationListItem[];
  activeId: string | undefined;
  loading?: boolean;
  busy?: boolean;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  onOpenLibrary: () => void;
};

export default function ConversationSidebar({
  conversations,
  activeId,
  loading,
  busy,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  onNotify,
  onOpenLibrary,
}: Props) {
  const [renameTarget, setRenameTarget] =
    useState<ConversationListItem | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<ConversationListItem | null>(null);
  const [draft, setDraft] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renameTarget) inputRef.current?.focus();
  }, [renameTarget]);

  function startRename(c: ConversationListItem) {
    setRenameTarget(c);
    setDraft(c.title?.trim() || '');
  }

  async function commitRename() {
    if (!renameTarget) return;
    const title = draft.replace(/\s+/g, ' ').trim();
    if (!title) return;
    setSavingId(renameTarget.id);
    try {
      await onRename(renameTarget.id, title);
      setRenameTarget(null);
      onNotify('Chat renamed.');
    } catch (error) {
      onNotify(
        error instanceof Error ? error.message : 'Could not rename chat.',
        'error',
      );
    } finally {
      setSavingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setSavingId(deleteTarget.id);
    try {
      await onDelete(deleteTarget.id);
      setDeleteTarget(null);
      onNotify('Chat removed from your list.');
    } catch (error) {
      onNotify(
        error instanceof Error ? error.message : 'Could not delete chat.',
        'error',
      );
    } finally {
      setSavingId(null);
    }
  }

  return (
    <aside
      className="w-[240px] shrink-0 flex flex-col border-r h-full"
      style={{
        borderColor: 'rgba(143,164,196,0.16)',
        background: 'rgba(6,13,26,0.55)',
      }}
    >
      <div
        className="p-3 border-b space-y-2"
        style={{ borderColor: 'rgba(143,164,196,0.12)' }}
      >
        <button
          type="button"
          onClick={onNewChat}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          style={{
            background: 'rgba(59,136,245,0.18)',
            border: '1px solid rgba(59,136,245,0.35)',
          }}
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
          New chat
        </button>
        <button
          type="button"
          onClick={onOpenLibrary}
          className="w-full inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-left transition-colors hover:bg-white/5"
          style={{
            color: 'var(--pi-silver-300)',
            border: '1px solid rgba(143,164,196,0.18)',
            background: 'transparent',
          }}
        >
          <LibraryBig
            className="w-3.5 h-3.5"
            style={{ color: 'var(--pi-blue-400)' }}
          />
          Library
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1">
        {loading ? (
          <div
            className="flex items-center justify-center gap-2 py-8 text-xs"
            style={{ color: 'var(--pi-silver-400)' }}
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading…
          </div>
        ) : conversations.length === 0 ? (
          <p
            className="m-0 px-2 py-6 text-xs text-center"
            style={{ color: 'var(--pi-silver-400)' }}
          >
            No chats yet. Send a message or start a new chat.
          </p>
        ) : (
          conversations.map((c) => {
            const active = c.id === activeId;
            const rowBusy = savingId === c.id;
            return (
              <div
                key={c.id}
                className={cn(
                  'group rounded-lg px-2 py-2 transition-colors',
                  active ? '' : 'hover:bg-white/5',
                )}
                style={
                  active
                    ? {
                        background: 'rgba(59,136,245,0.14)',
                        boxShadow: 'inset 0 0 0 1px rgba(59,136,245,0.4)',
                      }
                    : undefined
                }
              >
                <div className="flex items-start gap-1">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onSelect(c.id)}
                      disabled={busy}
                    >
                      <div className="text-xs font-medium text-white truncate">
                        {c.title?.trim() || 'New chat'}
                      </div>
                      <div
                        className="text-[10px] mt-0.5"
                        style={{ color: 'var(--pi-silver-400)' }}
                      >
                        {relativeTime(c.updatedAt)}
                        {c.messageCount > 0
                          ? ` · ${c.messageCount} msg${c.messageCount === 1 ? '' : 's'}`
                          : ''}
                      </div>
                    </button>
                    <div className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button
                        type="button"
                        className="p-1 rounded text-slate-300 hover:bg-white/10"
                        onClick={() => startRename(c)}
                        disabled={busy || rowBusy}
                        aria-label="Rename chat"
                        title="Rename"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded text-red-300 hover:bg-white/10"
                        onClick={() => setDeleteTarget(c)}
                        disabled={busy || rowBusy}
                        aria-label="Delete chat"
                        title="Delete"
                      >
                        {rowBusy ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>
              </div>
            );
          })
        )}
      </div>

      {renameTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingId) {
              setRenameTarget(null);
            }
          }}
          style={{ background: 'rgba(2, 8, 23, 0.72)', backdropFilter: 'blur(8px)' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-chat-title"
            className="w-full max-w-md rounded-2xl border p-5 shadow-2xl"
            style={{
              background:
                'linear-gradient(145deg, rgba(17,35,65,0.98), rgba(6,16,32,0.98))',
              borderColor: 'rgba(107,168,255,0.3)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p
                  className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em]"
                  style={{ color: 'var(--pi-blue-300)' }}
                >
                  Conversation
                </p>
                <h2 id="rename-chat-title" className="m-0 mt-1 text-lg font-semibold text-white">
                  Rename chat
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                disabled={Boolean(savingId)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-50"
                aria-label="Close rename dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-5 block">
              <span className="mb-2 block text-xs font-medium text-slate-300">
                Chat name
              </span>
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void commitRename();
                  }
                  if (event.key === 'Escape' && !savingId) {
                    setRenameTarget(null);
                  }
                }}
                maxLength={120}
                disabled={Boolean(savingId)}
                className="w-full rounded-xl border bg-black/20 px-3.5 py-3 text-sm text-white outline-none transition focus:ring-2 disabled:opacity-60"
                style={{
                  borderColor: 'rgba(143,164,196,0.3)',
                  // Tailwind arbitrary focus color is unavailable as an inline token.
                  caretColor: 'var(--pi-blue-300)',
                }}
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                disabled={Boolean(savingId)}
                className="rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void commitRename()}
                disabled={Boolean(savingId) || !draft.trim()}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, #3b88f5, #1559b4)',
                }}
              >
                {savingId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save name
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingId) {
              setDeleteTarget(null);
            }
          }}
          style={{ background: 'rgba(2, 8, 23, 0.72)', backdropFilter: 'blur(8px)' }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-chat-title"
            aria-describedby="delete-chat-description"
            className="w-full max-w-md rounded-2xl border p-5 shadow-2xl"
            style={{
              background:
                'linear-gradient(145deg, rgba(31,27,45,0.99), rgba(10,16,31,0.99))',
              borderColor: 'rgba(248,113,113,0.28)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.58)',
            }}
          >
            <div className="flex gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-300 ring-1 ring-red-400/20">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 id="delete-chat-title" className="m-0 text-lg font-semibold text-white">
                  Delete chat
                </h2>
                <p
                  id="delete-chat-description"
                  className="m-0 mt-2 text-sm leading-relaxed text-slate-300"
                >
                  Delete this chat? It will be removed from your list.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={Boolean(savingId)}
                autoFocus
                className="rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={Boolean(savingId)}
                className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-red-950/30 hover:bg-red-400 disabled:opacity-50"
              >
                {savingId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete chat
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
