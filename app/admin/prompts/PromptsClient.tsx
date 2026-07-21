'use client';

/**
 * Guidelines editor: list versions, save new drafts, preview the fully
 * assembled prompt, publish (= rollback when applied to an older version).
 * Edits ONLY the guidelines layer — base prompt and hard guardrails are
 * git-controlled and shown locked in the preview.
 */

import { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2, PencilLine, Rocket, Save, X } from 'lucide-react';

type Version = {
  id: string;
  version: number;
  label: string | null;
  isLive: boolean;
  createdByName: string;
  createdAt: string;
  bodyPreview: string;
  body: string;
};

type PreviewSection = {
  title: string;
  content: string;
  locked: boolean;
  note: string;
};

/** Split the assembled prompt on its layer markers for a labeled preview. */
function splitPromptIntoSections(prompt: string): PreviewSection[] {
  const markers: Array<{ marker: string; title: string; locked: boolean; note: string }> = [
    {
      marker: '===== LAYER 1: BASE (git) =====',
      title: 'Layer 1 — Base',
      locked: true,
      note: 'Locked (git) — not editable here',
    },
    {
      marker: '===== LAYER 2: GUIDELINES (admin, editable) =====',
      title: 'Layer 2 — Guidelines',
      locked: false,
      note: 'Editable — this is what you are editing',
    },
    {
      marker: '===== LAYER 3: CASE INDEX (auto-generated; not citable) =====',
      title: 'Layer 3 — Case index',
      locked: true,
      note: 'Auto-generated — not editable here',
    },
    {
      marker: '===== LAYER 4: HARD GUARDRAILS (git, ALWAYS LAST) =====',
      title: 'Layer 4 — Hard guardrails',
      locked: true,
      note: 'Locked (git), always last — cannot be overridden by guidelines',
    },
  ];

  const sections: PreviewSection[] = [];
  for (let i = 0; i < markers.length; i++) {
    const start = prompt.indexOf(markers[i].marker);
    if (start === -1) continue;
    const contentStart = start + markers[i].marker.length;
    const end =
      i + 1 < markers.length ? prompt.indexOf(markers[i + 1].marker) : prompt.length;
    sections.push({
      title: markers[i].title,
      content: prompt.slice(contentStart, end === -1 ? prompt.length : end).trim(),
      locked: markers[i].locked,
      note: markers[i].note,
    });
  }
  return sections.length > 0
    ? sections
    : [{ title: 'Assembled prompt', content: prompt, locked: true, note: '' }];
}

export default function PromptsClient() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Editor
  const [body, setBody] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // Preview
  const [previewSections, setPreviewSections] = useState<PreviewSection[] | null>(null);
  const [previewSource, setPreviewSource] = useState<'submitted' | 'live'>('submitted');
  const [previewing, setPreviewing] = useState(false);

  // Publish
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/prompts');
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { versions?: Version[]; error?: string };
      if (!res.ok || !data.versions) throw new Error(data.error || 'Failed to load');
      setVersions(data.versions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load versions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const live = versions.find((v) => v.isLive) ?? null;

  async function saveDraft() {
    if (saving || !body.trim()) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const res = await fetch('/api/admin/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, label: label.trim() || undefined }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { ok?: boolean; version?: number; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed');
      setNotice(`Saved as draft v${data.version}. Publish it when ready.`);
      setBody('');
      setLabel('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function preview(text: string) {
    if (previewing) return;
    setError(null);
    setPreviewing(true);
    try {
      const res = await fetch('/api/admin/prompts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        prompt?: string;
        source?: 'submitted' | 'live';
        error?: string;
      };
      if (!res.ok || typeof data.prompt !== 'string') {
        throw new Error(data.error || 'Preview failed');
      }
      setPreviewSource(data.source ?? 'submitted');
      setPreviewSections(splitPromptIntoSections(data.prompt));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }

  async function publish(id: string) {
    if (publishingId) return;
    setError(null);
    setNotice(null);
    setPublishingId(id);
    try {
      const res = await fetch(`/api/admin/prompts/${id}/publish`, { method: 'POST' });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { ok?: boolean; version?: number; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Publish failed');
      setNotice(`v${data.version} is now LIVE — the agent's next reply uses it.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setPublishingId(null);
      setConfirmingId(null);
    }
  }

  function editAsNew(v: Version) {
    setBody(v.body);
    setLabel(v.label ? `${v.label} (from v${v.version})` : `from v${v.version}`);
    setNotice(`Loaded v${v.version} into the editor — saving creates a NEW draft version.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Live status */}
      <div
        className={`rounded-xl border px-5 py-4 ${
          live
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-amber-50 border-amber-200'
        }`}
      >
        {live ? (
          <p className="m-0 text-sm text-emerald-900">
            <span className="font-semibold">LIVE: v{live.version}</span>
            {live.label ? ` — ${live.label}` : ''}
            <span className="text-emerald-700">
              {' '}
              · by {live.createdByName} ·{' '}
              {new Date(live.createdAt).toLocaleString()}
            </span>
          </p>
        ) : (
          <p className="m-0 text-sm text-amber-900">
            <span className="font-semibold">No live version</span> — the agent
            currently runs with an empty guidelines layer.
          </p>
        )}
      </div>

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

      {/* Editor */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-5">
        <h2 className="m-0 text-base font-semibold text-slate-900">New draft</h2>
        <p className="m-0 mt-1 text-sm text-slate-500">
          Edits only the <span className="font-medium">guidelines</span> layer. Base
          prompt and hard guardrails are git-controlled and cannot be changed here.
          Saving creates a draft — nothing goes live until you publish.
        </p>

        <label className="block mt-4">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Label (optional)
          </span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='e.g. "added PE emphasis"'
            className="mt-1.5 w-full rounded-lg px-3.5 py-2.5 text-sm outline-none border border-slate-300 bg-white text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
        </label>

        <label className="block mt-4">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Guidelines body
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            spellCheck={false}
            placeholder="Tone, Paramount-specific phrasing, phrases to use or avoid, per-case commercial guidance…"
            className="mt-1.5 w-full rounded-lg px-3.5 py-3 text-[13px] leading-relaxed font-mono outline-none border border-slate-300 bg-slate-50 text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 resize-y"
          />
        </label>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void saveDraft()}
            disabled={saving || !body.trim()}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save as draft
          </button>
          <button
            type="button"
            onClick={() => void preview(body)}
            disabled={previewing}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            Preview assembled prompt
          </button>
        </div>
      </section>

      {/* Version list */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="m-0 text-base font-semibold text-slate-900">Versions</h2>
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            History is never deleted. Rollback = publish an older version.
          </p>
        </div>

        {loading ? (
          <div className="px-5 py-8 flex items-center gap-2.5 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading versions…
          </div>
        ) : versions.length === 0 ? (
          <p className="m-0 px-5 py-8 text-sm text-slate-500">
            No versions yet — write the first draft above (or run{' '}
            <code className="text-[12px] bg-slate-100 px-1 py-0.5 rounded">
              npm run prompts:seed
            </code>{' '}
            to start from the suggested v1).
          </p>
        ) : (
          <ul className="m-0 p-0 list-none divide-y divide-slate-100">
            {versions.map((v) => (
              <li key={v.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold text-slate-900">
                    v{v.version}
                  </span>
                  {v.isLive && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
                      Live
                    </span>
                  )}
                  {v.label && (
                    <span className="text-sm text-slate-600">{v.label}</span>
                  )}
                  <span className="text-xs text-slate-400">
                    {v.createdByName} · {new Date(v.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="m-0 mt-1.5 text-[13px] text-slate-500 font-mono whitespace-pre-wrap break-words">
                  {v.bodyPreview}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void preview(v.body)}
                    disabled={previewing}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => editAsNew(v)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <PencilLine className="w-3.5 h-3.5" />
                    Edit as new version
                  </button>
                  {!v.isLive &&
                    (confirmingId === v.id ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-slate-600">
                          This becomes the agent&apos;s live behavior immediately.
                        </span>
                        <button
                          type="button"
                          onClick={() => void publish(v.id)}
                          disabled={publishingId !== null}
                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                        >
                          {publishingId === v.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Rocket className="w-3.5 h-3.5" />
                          )}
                          Confirm publish
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          className="text-xs font-medium text-slate-500 hover:text-slate-700 bg-transparent border-0 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingId(v.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-700 transition-colors"
                      >
                        <Rocket className="w-3.5 h-3.5" />
                        Publish
                      </button>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Preview overlay */}
      {previewSections && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
          style={{ background: 'rgba(15,23,42,0.55)' }}
          role="dialog"
          aria-modal="true"
          aria-label="Assembled system prompt preview"
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-full flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div>
                <h3 className="m-0 text-base font-semibold text-slate-900">
                  Assembled system prompt
                </h3>
                <p className="m-0 mt-0.5 text-xs text-slate-500">
                  {previewSource === 'live'
                    ? 'Showing the LIVE guidelines (nothing was typed in the editor) — this is what the agent runs right now.'
                    : 'Layer 2 shows the text you submitted. Read-only — nothing is published.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewSections(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 border-0 bg-transparent cursor-pointer"
                aria-label="Close preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {previewSections.map((s) => (
                <div
                  key={s.title}
                  className={`rounded-lg border ${
                    s.locked
                      ? 'border-slate-200 bg-slate-50'
                      : 'border-blue-200 bg-blue-50'
                  }`}
                >
                  <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-slate-200/70">
                    <span className="text-sm font-semibold text-slate-800">
                      {s.title}
                    </span>
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${
                        s.locked
                          ? 'bg-slate-200 text-slate-600'
                          : 'bg-blue-200 text-blue-800'
                      }`}
                    >
                      {s.locked ? 'Locked' : 'Editable'}
                    </span>
                    <span className="text-[11px] text-slate-500">{s.note}</span>
                  </div>
                  <pre className="m-0 px-4 py-3 text-[12px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
                    {s.content}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
