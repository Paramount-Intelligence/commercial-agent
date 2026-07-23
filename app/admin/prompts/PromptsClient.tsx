'use client';

/**
 * Multi-layer prompt editor: Base | Guidelines | Guardrails.
 * Each layer has independent drafts, history, publish, and rollback.
 * Attribution: every version shows "edited by <admin> on <date>".
 *
 * Guardrails: inline safety warning + explicit publish confirm (does not
 * block editing). Citation validator remains code-only (not editable here).
 */

import { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2, PencilLine, Rocket, Save, X } from 'lucide-react';
import {
  EDITABLE_PROMPT_LAYERS,
  PROMPT_LAYER_META,
  type EditablePromptLayer,
} from '@/lib/agent/promptLayers';

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
  badge: string;
  note: string;
  highlight: boolean;
};

type LayerSources = {
  base: string;
  guidelines: string;
  caseIndex: string;
  guardrails: string;
};

const GUARDRAILS_WARNING =
  'This is the safety layer. Changes to anti-fabrication, pricing, and citation rules can cause the agent to invent cases, reveal pricing, or make false claims. All changes are versioned and logged.';

const GUARDRAILS_CONFIRM =
  "I understand this changes the agent's safety rules";

function sourceNote(source: string | undefined, editing: boolean): {
  badge: string;
  note: string;
  highlight: boolean;
} {
  if (source === 'auto-generated') {
    return {
      badge: 'Auto-generated',
      note: 'Built from cases — not a PromptVersion layer',
      highlight: false,
    };
  }
  if (source === 'preview-override') {
    return {
      badge: 'Preview override',
      note: 'Submitted draft text — not published',
      highlight: true,
    };
  }
  if (source === 'live-from-DB') {
    return {
      badge: 'Live from DB',
      note: 'Live PromptVersion',
      highlight: editing,
    };
  }
  if (source === 'empty') {
    return {
      badge: 'Empty',
      note: 'No live guidelines published',
      highlight: editing,
    };
  }
  return {
    badge: 'Code fallback',
    note: 'No live DB version — using git/code constant',
    highlight: editing,
  };
}

/** Split the assembled prompt on layer markers for a labeled preview. */
function splitPromptIntoSections(
  prompt: string,
  layerSources: LayerSources | null,
  previewLayer: EditablePromptLayer | null,
): PreviewSection[] {
  const markers: Array<{
    re: RegExp;
    title: string;
    sourceKey: keyof LayerSources;
    layer: EditablePromptLayer | 'caseIndex';
  }> = [
    {
      re: /===== LAYER 1: BASE \([^)]+\) =====/,
      title: 'Layer 1 — Base',
      sourceKey: 'base',
      layer: 'base',
    },
    {
      re: /===== LAYER 2: GUIDELINES \([^)]+\) =====/,
      title: 'Layer 2 — Guidelines',
      sourceKey: 'guidelines',
      layer: 'guidelines',
    },
    {
      re: /===== LAYER 3: CASE INDEX \([^)]+\) =====/,
      title: 'Layer 3 — Case index',
      sourceKey: 'caseIndex',
      layer: 'caseIndex',
    },
    {
      re: /===== LAYER 4: HARD GUARDRAILS \([^)]+\) =====/,
      title: 'Layer 4 — Hard guardrails',
      sourceKey: 'guardrails',
      layer: 'guardrails',
    },
  ];

  const found: Array<{
    index: number;
    endMarker: number;
    meta: (typeof markers)[number];
  }> = [];
  for (const meta of markers) {
    const m = meta.re.exec(prompt);
    if (m && m.index !== undefined) {
      found.push({ index: m.index, endMarker: m.index + m[0].length, meta });
    }
  }
  found.sort((a, b) => a.index - b.index);

  const sections: PreviewSection[] = [];
  for (let i = 0; i < found.length; i++) {
    const { endMarker, meta } = found[i];
    const end = i + 1 < found.length ? found[i + 1].index : prompt.length;
    const src = layerSources?.[meta.sourceKey];
    const editing = previewLayer === meta.layer;
    const { badge, note, highlight } = sourceNote(src, editing);
    sections.push({
      title: meta.title,
      content: prompt.slice(endMarker, end).trim(),
      badge,
      note,
      highlight,
    });
  }
  return sections.length > 0
    ? sections
    : [
        {
          title: 'Assembled prompt',
          content: prompt,
          badge: '',
          note: '',
          highlight: false,
        },
      ];
}

function formatAttribution(name: string, iso: string): string {
  return `edited by ${name} on ${new Date(iso).toLocaleString()}`;
}

export default function PromptsClient() {
  const [layer, setLayer] = useState<EditablePromptLayer>('guidelines');
  const [versions, setVersions] = useState<Version[]>([]);
  const [codeFallback, setCodeFallback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [body, setBody] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const [previewSections, setPreviewSections] = useState<PreviewSection[] | null>(
    null,
  );
  const [previewSource, setPreviewSource] = useState<'submitted' | 'live'>(
    'submitted',
  );
  const [previewing, setPreviewing] = useState(false);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [guardrailsAck, setGuardrailsAck] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const meta = PROMPT_LAYER_META[layer];

  const refresh = useCallback(async (activeLayer: EditablePromptLayer) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/prompts?layer=${encodeURIComponent(activeLayer)}`,
      );
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        versions?: Version[];
        codeFallback?: string | null;
        error?: string;
      };
      if (!res.ok || !data.versions) throw new Error(data.error || 'Failed to load');
      setVersions(data.versions);
      setCodeFallback(data.codeFallback ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load versions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setError(null);
    setNotice(null);
    setBody('');
    setLabel('');
    setConfirmingId(null);
    setGuardrailsAck(false);
    void refresh(layer);
  }, [layer, refresh]);

  const live = versions.find((v) => v.isLive) ?? null;

  function switchLayer(next: EditablePromptLayer) {
    if (next === layer) return;
    setLayer(next);
  }

  async function saveDraft() {
    if (saving || !body.trim()) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const res = await fetch('/api/admin/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layer,
          body,
          label: label.trim() || undefined,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        version?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed');
      setNotice(
        `Saved ${meta.title} draft v${data.version}. Publish it when ready.`,
      );
      setBody('');
      setLabel('');
      await refresh(layer);
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
        body: JSON.stringify({ layer, body: text }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        prompt?: string;
        source?: 'submitted' | 'live';
        layerSources?: LayerSources;
        error?: string;
      };
      if (!res.ok || typeof data.prompt !== 'string') {
        throw new Error(data.error || 'Preview failed');
      }
      setPreviewSource(data.source ?? 'submitted');
      setPreviewSections(
        splitPromptIntoSections(data.prompt, data.layerSources ?? null, layer),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }

  async function publish(id: string) {
    if (publishingId) return;
    if (layer === 'guardrails' && !guardrailsAck) {
      setError(`Check the box: "${GUARDRAILS_CONFIRM}" before publishing.`);
      return;
    }
    setError(null);
    setNotice(null);
    setPublishingId(id);
    try {
      const res = await fetch(`/api/admin/prompts/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          layer === 'guardrails' ? { confirmSafetyChange: true } : {},
        ),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        version?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Publish failed');
      setNotice(
        `${meta.title} v${data.version} is now LIVE — the agent's next reply uses it.`,
      );
      await refresh(layer);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setPublishingId(null);
      setConfirmingId(null);
      setGuardrailsAck(false);
    }
  }

  function editAsNew(v: Version) {
    setBody(v.body);
    setLabel(v.label ? `${v.label} (from v${v.version})` : `from v${v.version}`);
    setNotice(
      `Loaded v${v.version} into the editor — saving creates a NEW draft version.`,
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function loadCodeFallback() {
    if (!codeFallback) return;
    setBody(codeFallback);
    setLabel('from code fallback');
    setNotice(
      `Loaded code-fallback ${meta.title} into the editor — saving creates a NEW draft.`,
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Layer tabs */}
      <div
        className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
        role="tablist"
        aria-label="Prompt layer"
      >
        {EDITABLE_PROMPT_LAYERS.map((key) => {
          const active = key === layer;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => switchLayer(key)}
              className={`flex-1 min-w-[7rem] rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors border-0 cursor-pointer ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'bg-transparent text-slate-600 hover:bg-slate-50'
              }`}
            >
              {PROMPT_LAYER_META[key].title}
            </button>
          );
        })}
      </div>

      <p className="m-0 text-sm text-slate-600">{meta.description}</p>

      {layer === 'guardrails' && (
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4"
          role="note"
        >
          <p className="m-0 text-sm font-semibold text-amber-950">Safety layer</p>
          <p className="m-0 mt-1.5 text-sm text-amber-900 leading-relaxed">
            {GUARDRAILS_WARNING}
          </p>
          <p className="m-0 mt-2 text-xs text-amber-800">
            Editing is fully allowed. The [[case:ID]] citation validator stays in
            code and cannot be turned off by changing this prompt.
          </p>
        </div>
      )}

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
            <span className="font-semibold">
              LIVE {meta.title}: v{live.version}
            </span>
            {live.label ? ` — ${live.label}` : ''}
            <span className="text-emerald-700">
              {' '}
              · {formatAttribution(live.createdByName, live.createdAt)}
            </span>
          </p>
        ) : (
          <p className="m-0 text-sm text-amber-900">
            <span className="font-semibold">No live {meta.title} version</span>
            {codeFallback
              ? ' — agent uses the code/git fallback until you publish one.'
              : ' — this layer is empty in the assembled prompt.'}
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
        <h2 className="m-0 text-base font-semibold text-slate-900">
          New {meta.title} draft
        </h2>
        <p className="m-0 mt-1 text-sm text-slate-500">
          Saving creates a draft for the{' '}
          <span className="font-medium">{meta.title}</span> layer only. Nothing
          goes live until you publish. History is kept per layer.
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
            {meta.title} body
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            spellCheck={false}
            placeholder={`Edit the ${meta.title.toLowerCase()} layer…`}
            className="mt-1.5 w-full rounded-lg px-3.5 py-3 text-[13px] leading-relaxed font-mono outline-none border border-slate-300 bg-slate-50 text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 resize-y"
          />
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void saveDraft()}
            disabled={saving || !body.trim()}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save as draft
          </button>
          <button
            type="button"
            onClick={() => void preview(body)}
            disabled={previewing}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {previewing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
            Preview assembled prompt
          </button>
          {codeFallback && !live && (
            <button
              type="button"
              onClick={loadCodeFallback}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Load code fallback
            </button>
          )}
        </div>
      </section>

      {/* Version list */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="m-0 text-base font-semibold text-slate-900">
            {meta.title} versions
          </h2>
          <p className="m-0 mt-0.5 text-sm text-slate-500">
            History is never deleted. Rollback = publish an older version for this
            layer.
          </p>
        </div>

        {loading ? (
          <div className="px-5 py-8 flex items-center gap-2.5 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading versions…
          </div>
        ) : versions.length === 0 ? (
          <p className="m-0 px-5 py-8 text-sm text-slate-500">
            No versions yet for {meta.title}.
            {codeFallback
              ? ' Load the code fallback above, edit, save, then publish.'
              : ' Write the first draft above.'}
            {layer === 'guidelines' && (
              <>
                {' '}
                Or run{' '}
                <code className="text-[12px] bg-slate-100 px-1 py-0.5 rounded">
                  npm run prompts:seed
                </code>
                .
              </>
            )}
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
                    {formatAttribution(v.createdByName, v.createdAt)}
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
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {layer === 'guardrails' ? (
                          <label className="inline-flex items-start gap-2 text-xs text-amber-900 max-w-md">
                            <input
                              type="checkbox"
                              checked={guardrailsAck}
                              onChange={(e) => setGuardrailsAck(e.target.checked)}
                              className="mt-0.5"
                            />
                            <span>{GUARDRAILS_CONFIRM}</span>
                          </label>
                        ) : (
                          <span className="text-xs text-slate-600">
                            This becomes the agent&apos;s live behavior
                            immediately.
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void publish(v.id)}
                          disabled={
                            publishingId !== null ||
                            (layer === 'guardrails' && !guardrailsAck)
                          }
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
                          onClick={() => {
                            setConfirmingId(null);
                            setGuardrailsAck(false);
                          }}
                          className="text-xs font-medium text-slate-500 hover:text-slate-700 bg-transparent border-0 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingId(v.id);
                          setGuardrailsAck(false);
                        }}
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
                  All four layers shown. Labels: live-from-DB, code fallback, or
                  auto-generated.
                  {previewSource === 'live'
                    ? ' Editor was empty — previewing live/fallback for this layer.'
                    : ` ${meta.title} shows your submitted text.`}
                  {' '}
                  Read-only — nothing is published.
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
                    s.highlight
                      ? 'border-blue-200 bg-blue-50'
                      : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-slate-200/70">
                    <span className="text-sm font-semibold text-slate-800">
                      {s.title}
                    </span>
                    {s.badge && (
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${
                          s.highlight
                            ? 'bg-blue-200 text-blue-800'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {s.badge}
                      </span>
                    )}
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
