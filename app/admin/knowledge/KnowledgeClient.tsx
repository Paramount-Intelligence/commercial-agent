'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  FileText,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';

type KnowledgeRow = {
  id: string;
  title: string;
  body: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileMime: string | null;
  shareable: boolean;
  shareLabel: string | null;
  chunkCount: number;
  sourceType: string;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
  createdByName: string;
  createdByEmail: string;
};

const CORPUS_WARNING =
  'This is company knowledge the agent can state without citation. Do NOT add client project claims, case metrics, or engagement details here — those belong in case studies so they are citation-validated.';

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function KnowledgeClient() {
  const [entries, setEntries] = useState<KnowledgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [clearFile, setClearFile] = useState(false);
  const [existingFileName, setExistingFileName] = useState<string | null>(null);
  const [shareable, setShareable] = useState(false);
  const [shareLabel, setShareLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/knowledge');
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        entries?: KnowledgeRow[];
        error?: string;
      };
      if (!res.ok || !data.entries) {
        throw new Error(data.error || 'Failed to load knowledge entries');
      }
      setEntries(data.entries);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setTitle('');
    setBody('');
    setFile(null);
    setClearFile(false);
    setExistingFileName(null);
    setShareable(false);
    setShareLabel('');
  }

  function openCreate() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(entry: KnowledgeRow) {
    setShowForm(true);
    setEditingId(entry.id);
    setTitle(entry.title);
    setBody(entry.body ?? '');
    setFile(null);
    setClearFile(false);
    setExistingFileName(entry.fileName);
    setShareable(Boolean(entry.shareable));
    setShareLabel(entry.shareLabel ?? '');
    setNotice(null);
    setError(null);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set('title', title.trim());
      form.set('body', body);
      form.set('shareable', shareable ? 'true' : 'false');
      form.set('shareLabel', shareLabel.trim());
      if (file) form.set('file', file);
      if (editingId && clearFile) form.set('clearFile', 'true');

      const res = await fetch(
        editingId ? `/api/admin/knowledge/${editingId}` : '/api/admin/knowledge',
        {
          method: editingId ? 'PATCH' : 'POST',
          body: form,
        },
      );
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        entry?: KnowledgeRow;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setNotice(data.message || 'Saved.');
      resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(entry: KnowledgeRow) {
    if (
      !window.confirm(
        `Delete “${entry.title}”? This removes its ContentChunks so the agent can no longer retrieve it.`,
      )
    ) {
      return;
    }
    setBusyId(entry.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/knowledge/${entry.id}`, {
        method: 'DELETE',
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setNotice('Entry deleted — chunks removed from the company corpus.');
      if (editingId === entry.id) resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 leading-relaxed">
        <strong className="font-semibold">Corpus boundary.</strong> {CORPUS_WARNING}
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="m-0 text-sm text-slate-600 max-w-2xl">
            Admin-authored company knowledge is embedded into{' '}
            <code className="text-xs bg-slate-200 px-1 rounded">ContentChunk</code>{' '}
            (<code className="text-xs bg-slate-200 px-1 rounded">admin-knowledge</code>
            ) and retrieved via <code className="text-xs bg-slate-200 px-1 rounded">search_company_info</code>{' '}
            — trusted and uncited. Case claims still require citation-validated case studies.
          </p>
        </div>
        {!showForm ? (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white text-sm font-medium px-3.5 py-2 hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            Add knowledge
          </button>
        ) : null}
      </div>

      {notice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {showForm ? (
        <form
          onSubmit={onSave}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-base font-semibold text-slate-900">
              {editingId ? 'Edit knowledge entry' : 'New knowledge entry'}
            </h2>
            <button
              type="button"
              onClick={resetForm}
              className="text-slate-500 hover:text-slate-800"
              aria-label="Close form"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-950">
            {CORPUS_WARNING}
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Title / heading
            </span>
            <input
              required
              value={title}
              onChange={(ev) => setTitle(ev.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="e.g. Delivery process overview"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Body text
            </span>
            <textarea
              value={body}
              onChange={(ev) => setBody(ev.target.value)}
              rows={10}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="Company / product / positioning knowledge the agent may state without citation…"
            />
          </label>

          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Attach file (optional PDF or DOCX)
            </span>
            <p className="m-0 text-xs text-slate-500">
              Text is extracted, chunked, and embedded so the agent can read it. Scanned
              image PDFs are rejected — paste text into the body instead.
            </p>
            {existingFileName && !clearFile && !file ? (
              <div className="flex items-center gap-3 text-sm text-slate-700">
                <FileText className="h-4 w-4 text-slate-500" />
                <span>{existingFileName}</span>
                <button
                  type="button"
                  className="text-xs font-medium text-red-700 hover:underline"
                  onClick={() => setClearFile(true)}
                >
                  Remove file
                </button>
              </div>
            ) : null}
            {clearFile ? (
              <p className="m-0 text-xs text-amber-800">
                Existing file will be removed on save.
                <button
                  type="button"
                  className="ml-2 font-medium underline"
                  onClick={() => setClearFile(false)}
                >
                  Undo
                </button>
              </p>
            ) : null}
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(ev) => {
                setFile(ev.target.files?.[0] ?? null);
                setClearFile(false);
              }}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-800"
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={shareable}
                onChange={(ev) => setShareable(ev.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">
                  Shareable with users
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  When enabled, Jackie may offer this file as a download via{' '}
                  <code className="text-[11px] bg-slate-200 px-1 rounded">
                    share_document
                  </code>
                  . Leave off for internal notes (pricing, process, drafts).
                </span>
              </span>
            </label>
            {shareable ? (
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Share label (required)
                </span>
                <input
                  required={shareable}
                  value={shareLabel}
                  onChange={(ev) => setShareLabel(ev.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder='e.g. Paramount Intelligence Corporate Overview'
                />
                <p className="m-0 text-xs text-slate-500">
                  What Jackie calls the document. A file attachment is required.
                </p>
              </label>
            ) : null}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editingId ? 'Save & re-embed' : 'Save & embed'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="m-0 text-sm font-semibold text-slate-900">
            Admin knowledge entries
          </h2>
          <span className="text-xs text-slate-500">
            {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
          </span>
        </div>

        {loading ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
            Loading…
          </div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            No admin knowledge yet. Add an entry to extend the company corpus.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Title</th>
                  <th className="px-4 py-2.5 font-semibold">Shareable</th>
                  <th className="px-4 py-2.5 font-semibold">Source</th>
                  <th className="px-4 py-2.5 font-semibold">Chunks</th>
                  <th className="px-4 py-2.5 font-semibold">Added by</th>
                  <th className="px-4 py-2.5 font-semibold">Updated</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-t border-slate-100 hover:bg-slate-50/80"
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-slate-900">{entry.title}</div>
                      {entry.fileName ? (
                        <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                          <FileText className="h-3 w-3" />
                          {entry.fileName}
                        </div>
                      ) : null}
                      {entry.body ? (
                        <div className="mt-1 text-xs text-slate-500 line-clamp-2 max-w-sm">
                          {entry.body}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {entry.shareable ? (
                        <div>
                          <span className="inline-block text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                            Shareable
                          </span>
                          {entry.shareLabel ? (
                            <div className="mt-1 text-xs text-slate-600 max-w-[160px]">
                              {entry.shareLabel}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Internal</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <code className="text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                        {entry.sourceType}
                      </code>
                    </td>
                    <td className="px-4 py-3 align-top text-slate-700">
                      {entry.chunkCount}
                    </td>
                    <td className="px-4 py-3 align-top text-slate-700">
                      <div>{entry.createdByName}</div>
                      <div className="text-xs text-slate-500">
                        {formatWhen(entry.createdAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-slate-600 text-xs">
                      {formatWhen(entry.updatedAt)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(entry)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busyId === entry.id}
                          onClick={() => void onDelete(entry)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {busyId === entry.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
