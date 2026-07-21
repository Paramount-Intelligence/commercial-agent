'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileDown,
  Loader2,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';

type CaseRow = {
  id: string;
  title: string;
  industry: string;
  clientName: string | null;
  assetCount: number;
};

type AssetRow = {
  id: string;
  kind: string;
  uri: string;
  verified: boolean;
  originalFilename: string | null;
  mimeType: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
};

const KINDS = [
  { kind: 'ONE_PAGER', label: 'One-pager', file: true },
  { kind: 'FULL_NARRATIVE', label: 'Full narrative', file: true },
  { kind: 'DECK_SLIDE', label: 'Deck / slide', file: true },
  { kind: 'DEMO_VIDEO', label: 'Demo video', file: false },
] as const;

const ALLOWED_UPLOAD_EXT = new Set(['.pdf', '.png']);
const ALLOWED_UPLOAD_MIME = new Set(['application/pdf', 'image/png']);

function isAllowedUpload(file: File): boolean {
  const name = file.name || '';
  const ext = name.includes('.')
    ? `.${name.split('.').pop()!.toLowerCase()}`
    : '';
  if (!ALLOWED_UPLOAD_EXT.has(ext)) return false;
  // Browsers sometimes omit type; extension check above still applies
  if (file.type && !ALLOWED_UPLOAD_MIME.has(file.type)) return false;
  return true;
}

export default function AssetsClient() {
  const [q, setQ] = useState('');
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState('');
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [generating, setGenerating] = useState<'pdf' | 'png' | null>(null);

  const loadCases = useCallback(async (search: string) => {
    setLoadingCases(true);
    try {
      const params = search ? `?q=${encodeURIComponent(search)}` : '';
      const res = await fetch(`/api/admin/cases${params}`);
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { cases?: CaseRow[]; error?: string };
      if (!res.ok || !data.cases) throw new Error(data.error || 'Failed to load cases');
      setCases(data.cases);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cases');
    } finally {
      setLoadingCases(false);
    }
  }, []);

  useEffect(() => {
    void loadCases('');
  }, [loadCases]);

  const loadAssets = useCallback(async (caseId: string) => {
    setLoadingAssets(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/cases/${caseId}/assets`);
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        assets?: AssetRow[];
        caseTitle?: string;
        error?: string;
      };
      if (!res.ok || !data.assets) throw new Error(data.error || 'Failed to load assets');
      setAssets(data.assets);
      if (data.caseTitle) setSelectedTitle(data.caseTitle);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load assets');
    } finally {
      setLoadingAssets(false);
    }
  }, []);

  function selectCase(c: CaseRow) {
    setSelectedId(c.id);
    setSelectedTitle(c.title);
    setVideoUrl('');
    setNotice(null);
    void loadAssets(c.id);
  }

  async function uploadFile(kind: string, file: File) {
    if (!selectedId || busy) return;
    if (!isAllowedUpload(file)) {
      setError('Only PDF and PNG files are allowed');
      setNotice(null);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set('kind', kind);
      form.set('file', file);
      const res = await fetch(`/api/admin/cases/${selectedId}/assets`, {
        method: 'POST',
        body: form,
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setNotice(`Uploaded ${kind}: ${file.name}`);
      await loadAssets(selectedId);
      await loadCases(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function addVideo() {
    if (!selectedId || busy || !videoUrl.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set('kind', 'DEMO_VIDEO');
      form.set('url', videoUrl.trim());
      const res = await fetch(`/api/admin/cases/${selectedId}/assets`, {
        method: 'POST',
        body: form,
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to save video URL');
      setNotice('Demo video URL saved.');
      setVideoUrl('');
      await loadAssets(selectedId);
      await loadCases(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save video URL');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(asset: AssetRow) {
    if (!window.confirm(`Delete this ${asset.kind} asset?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/assets/${asset.id}`, { method: 'DELETE' });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setNotice('Asset deleted.');
      if (selectedId) {
        await loadAssets(selectedId);
        await loadCases(q);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function onToggleVerified(asset: AssetRow) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verified: !asset.verified }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Update failed');
      if (selectedId) await loadAssets(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Generate branded one-pager (PDF/PNG) via Chromium.
   * Later: prefer serving a real uploaded ONE_PAGER CaseAsset when present.
   */
  async function generateOnepager(format: 'pdf' | 'png') {
    if (!selectedId || generating) return;
    setGenerating(format);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/admin/cases/${selectedId}/onepager?format=${format}`,
      );
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Generate failed (${res.status})`);
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(cd);
      const filename = match?.[1] ?? `onepager.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice(`Downloaded ${filename}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      setGenerating(null);
    }
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    void loadCases(q.trim());
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-sm text-slate-500">
        Attach real one-pagers, narratives, or decks as PDF or PNG, or add a demo
        video URL. Without a Blob token, uploads go to{' '}
        <code className="text-xs bg-slate-200 px-1 rounded">public/uploads</code>{' '}
        (dev only).
      </p>

      {(error || notice) && (
        <p
          className={`m-0 text-sm rounded-lg px-4 py-3 border ${
            error
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-slate-50 border-slate-200 text-slate-700'
          }`}
          role={error ? 'alert' : 'status'}
        >
          {error ?? notice}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Case list */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col max-h-[70vh]">
          <form
            onSubmit={onSearch}
            className="p-3 border-b border-slate-200 flex gap-2"
          >
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search cases…"
                className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg px-3 py-2 text-sm font-medium bg-slate-900 text-white hover:bg-slate-700"
            >
              Go
            </button>
          </form>
          <div className="overflow-y-auto flex-1">
            {loadingCases ? (
              <div className="px-4 py-8 flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading…
              </div>
            ) : cases.length === 0 ? (
              <p className="m-0 px-4 py-8 text-sm text-slate-500">No cases found.</p>
            ) : (
              <ul className="m-0 p-0 list-none divide-y divide-slate-100">
                {cases.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => selectCase(c)}
                      className={`w-full text-left px-4 py-3 border-0 cursor-pointer transition-colors ${
                        selectedId === c.id
                          ? 'bg-slate-100'
                          : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-sm font-medium text-slate-900 leading-snug">
                        {c.title}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {c.industry}
                        {c.clientName ? ` · ${c.clientName}` : ''}
                        {c.assetCount > 0 ? ` · ${c.assetCount} asset${c.assetCount === 1 ? '' : 's'}` : ''}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Asset panel */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-5 min-h-[320px]">
          {!selectedId ? (
            <p className="m-0 text-sm text-slate-500 py-12 text-center">
              Select a case to manage its assets.
            </p>
          ) : loadingAssets ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-12 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading assets…
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="m-0 text-base font-semibold text-slate-900">
                    {selectedTitle}
                  </h2>
                  <p className="m-0 mt-0.5 text-xs text-slate-500 font-mono">
                    {selectedId}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Generate one-pager
                  </span>
                  <button
                    type="button"
                    disabled={generating !== null}
                    onClick={() => void generateOnepager('pdf')}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
                  >
                    {generating === 'pdf' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileDown className="w-3.5 h-3.5" />
                    )}
                    PDF
                  </button>
                  <button
                    type="button"
                    disabled={generating !== null}
                    onClick={() => void generateOnepager('png')}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    {generating === 'png' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileDown className="w-3.5 h-3.5" />
                    )}
                    PNG
                  </button>
                </div>
              </div>
              {/* SEAM (D): chat will call the same buildOnepagerHtml + render path */}

              {KINDS.map(({ kind, label, file }) => {
                const kindAssets = assets.filter((a) => a.kind === kind);
                return (
                  <div
                    key={kind}
                    className="rounded-lg border border-slate-200 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div>
                        <h3 className="m-0 text-sm font-semibold text-slate-800">
                          {label}
                        </h3>
                        {file ? (
                          <p className="m-0 mt-0.5 text-[11px] text-slate-400">
                            PDF or PNG
                          </p>
                        ) : (
                          <p className="m-0 mt-0.5 text-[11px] text-slate-400">
                            URL only
                          </p>
                        )}
                      </div>
                      {file ? (
                        <label className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer">
                          <Upload className="w-3 h-3" />
                          Upload
                          <input
                            type="file"
                            className="hidden"
                            accept=".pdf,.png,application/pdf,image/png"
                            disabled={busy}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = '';
                              if (f) void uploadFile(kind, f);
                            }}
                          />
                        </label>
                      ) : null}
                    </div>

                    {!file && (
                      <div className="flex gap-2 mb-2">
                        <input
                          type="url"
                          value={videoUrl}
                          onChange={(e) => setVideoUrl(e.target.value)}
                          placeholder="https://…"
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                        />
                        <button
                          type="button"
                          disabled={busy || !videoUrl.trim()}
                          onClick={() => void addVideo()}
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
                        >
                          Add URL
                        </button>
                      </div>
                    )}

                    {kindAssets.length === 0 ? (
                      <p className="m-0 text-xs text-slate-400">None yet.</p>
                    ) : (
                      <ul className="m-0 p-0 list-none space-y-2">
                        {kindAssets.map((a) => (
                          <li
                            key={a.id}
                            className="flex flex-wrap items-center gap-2 text-xs bg-slate-50 rounded-lg px-3 py-2"
                          >
                            <a
                              href={a.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-700 hover:underline inline-flex items-center gap-1 min-w-0 truncate max-w-[220px]"
                            >
                              <ExternalLink className="w-3 h-3 shrink-0" />
                              <span className="truncate">
                                {a.originalFilename || a.uri}
                              </span>
                            </a>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void onToggleVerified(a)}
                              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 border text-[10px] font-semibold uppercase tracking-wider ${
                                a.verified
                                  ? 'bg-emerald-100 border-emerald-200 text-emerald-700'
                                  : 'bg-white border-slate-300 text-slate-500'
                              }`}
                              title="Toggle verified"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              {a.verified ? 'Verified' : 'Unverified'}
                            </button>
                            <span className="text-slate-400 ml-auto">
                              {a.uploadedByName
                                ? `by ${a.uploadedByName} · `
                                : ''}
                              {new Date(a.uploadedAt).toLocaleDateString()}
                            </span>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void onDelete(a)}
                              className="p-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50 bg-white"
                              aria-label="Delete asset"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
