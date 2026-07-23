'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, Loader2, Search } from 'lucide-react';

type CaseRow = {
  id: string;
  title: string;
  industry: string;
  clientName: string | null;
  businessFunction: string;
  peBacked: boolean | null;
  tech: string;
  techTags: string[];
  hasAssets: boolean;
  assetCount: number;
  chunkCount: number;
  updatedAt: string;
  updatedByName: string | null;
  updatedByEmail: string | null;
};

type CaseDetail = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  clientName: string | null;
  industry: string;
  businessFunction: string;
  overview: string | null;
  challenges: string;
  challenge: string | null;
  solution: string;
  benefits: string;
  results: string | null;
  summary: string | null;
  uniqueSolution: string | null;
  peBacked: boolean | null;
  tech: unknown;
  techTags: string[];
  assetCount: number;
  chunkCount: number;
  updatedAt: string;
  updatedByName: string | null;
  updatedByEmail: string | null;
};

type SortKey =
  | 'title'
  | 'clientName'
  | 'industry'
  | 'businessFunction'
  | 'peBacked'
  | 'tech'
  | 'hasAssets'
  | 'updatedAt';

type PeFilter = 'all' | 'yes' | 'no' | 'unknown';

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function peLabel(pe: boolean | null) {
  if (pe === true) return 'Yes';
  if (pe === false) return 'No';
  return 'Unknown';
}

function techToFormValue(tech: unknown, techTags: string[]): string {
  if (techTags.length > 0) return techTags.join(', ');
  if (Array.isArray(tech)) {
    return tech
      .map((t) => {
        if (t && typeof t === 'object' && 'title' in t) {
          return String((t as { title: unknown }).title ?? '');
        }
        return typeof t === 'string' ? t : '';
      })
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

export default function CasesClient() {
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [peFilter, setPeFilter] = useState<PeFilter>('all');
  const [industryFilter, setIndustryFilter] = useState('');
  const [techFilter, setTechFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [industry, setIndustry] = useState('');
  const [businessFunction, setBusinessFunction] = useState('');
  const [overview, setOverview] = useState('');
  const [challenges, setChallenges] = useState('');
  const [challenge, setChallenge] = useState('');
  const [solution, setSolution] = useState('');
  const [benefits, setBenefits] = useState('');
  const [results, setResults] = useState('');
  const [summary, setSummary] = useState('');
  const [uniqueSolution, setUniqueSolution] = useState('');
  const [peBacked, setPeBacked] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [tech, setTech] = useState('');

  const [indexText, setIndexText] = useState('');
  const [indexLoading, setIndexLoading] = useState(true);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/cases');
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { cases?: CaseRow[]; error?: string };
      if (!res.ok || !data.cases) {
        throw new Error(data.error || 'Failed to load cases');
      }
      setRows(data.cases);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshIndex = useCallback(async () => {
    setIndexLoading(true);
    try {
      const res = await fetch('/api/admin/cases/index');
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { index?: string; error?: string };
      if (!res.ok || data.index == null) {
        throw new Error(data.error || 'Failed to load case index');
      }
      setIndexText(data.index);
    } catch (e) {
      setIndexText(
        e instanceof Error ? `Error loading index: ${e.message}` : 'Error',
      );
    } finally {
      setIndexLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
    void refreshIndex();
  }, [refreshList, refreshIndex]);

  const industries = useMemo(() => {
    const set = new Set(rows.map((r) => r.industry).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const tf = techFilter.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (peFilter === 'yes' && r.peBacked !== true) return false;
      if (peFilter === 'no' && r.peBacked !== false) return false;
      if (peFilter === 'unknown' && r.peBacked !== null) return false;
      if (industryFilter && r.industry !== industryFilter) return false;
      if (tf && !(r.tech || '').toLowerCase().includes(tf)) return false;
      if (qq) {
        const hay = [
          r.title,
          r.clientName ?? '',
          r.industry,
          r.businessFunction,
          r.tech,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (sortKey === 'peBacked') {
        const an = a.peBacked === true ? 2 : a.peBacked === false ? 1 : 0;
        const bn = b.peBacked === true ? 2 : b.peBacked === false ? 1 : 0;
        return (an - bn) * dir;
      }
      if (sortKey === 'hasAssets') {
        return (Number(a.hasAssets) - Number(b.hasAssets)) * dir;
      }
      if (sortKey === 'updatedAt') {
        return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * dir;
      }
      const as = String(av ?? '').toLowerCase();
      const bs = String(bv ?? '').toLowerCase();
      return as.localeCompare(bs) * dir;
    });
    return list;
  }, [rows, q, peFilter, industryFilter, techFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'updatedAt' ? 'desc' : 'asc');
    }
  }

  function sortMark(key: SortKey) {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  async function openEdit(id: string) {
    setEditingId(id);
    setDetailLoading(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/cases/${id}`);
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { case?: CaseDetail; error?: string };
      if (!res.ok || !data.case) {
        throw new Error(data.error || 'Failed to load case');
      }
      const c = data.case;
      setDetail(c);
      setTitle(c.title);
      setSubtitle(c.subtitle);
      setClientName(c.clientName ?? '');
      setIndustry(c.industry);
      setBusinessFunction(c.businessFunction);
      setOverview(c.overview ?? '');
      setChallenges(c.challenges);
      setChallenge(c.challenge ?? '');
      setSolution(c.solution);
      setBenefits(c.benefits);
      setResults(c.results ?? '');
      setSummary(c.summary ?? '');
      setUniqueSolution(c.uniqueSolution ?? '');
      setPeBacked(
        c.peBacked === true ? 'yes' : c.peBacked === false ? 'no' : 'unknown',
      );
      setTech(techToFormValue(c.tech, c.techTags));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load case');
      setEditingId(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeEdit() {
    setEditingId(null);
    setDetail(null);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/cases/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          subtitle,
          clientName,
          industry,
          businessFunction,
          overview,
          challenges,
          challenge,
          solution,
          benefits,
          results,
          summary,
          uniqueSolution,
          peBacked,
          tech,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        case?: CaseDetail;
        message?: string;
        error?: string;
        reembedded?: { chunkCount: number };
      };
      if (!res.ok || !data.case) {
        throw new Error(data.error || 'Save failed');
      }
      setDetail(data.case);
      setNotice(
        data.message ||
          `Saved. Re-embedded ${data.reembedded?.chunkCount ?? 0} chunk(s).`,
      );
      await Promise.all([refreshList(), refreshIndex()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (editingId) {
    return (
      <div className="space-y-5">
        <button
          type="button"
          onClick={closeEdit}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 bg-transparent border-0 cursor-pointer p-0"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to table
        </button>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </div>
        )}

        {detailLoading || !detail ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading case…
          </div>
        ) : (
          <form
            onSubmit={onSave}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-semibold text-slate-900">
                  Edit case
                </h2>
                <p className="m-0 mt-1 text-xs text-slate-500">
                  Slug: {detail.slug} · {detail.chunkCount} embedding chunk
                  {detail.chunkCount === 1 ? '' : 's'} · {detail.assetCount}{' '}
                  asset{detail.assetCount === 1 ? '' : 's'}
                </p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>Last updated {formatWhen(detail.updatedAt)}</div>
                <div>
                  {detail.updatedByName
                    ? `by ${detail.updatedByName}`
                    : 'Editor not recorded (pre-admin edit)'}
                </div>
              </div>
            </div>

            <p className="m-0 text-sm text-slate-600 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
              Saving updates the case row, regenerates Layer 3 index from all
              cases, re-embeds this case&apos;s chunks, and invalidates cached
              one-pagers via <code className="text-xs">updatedAt</code>.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Title</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">
                  Subtitle
                </span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  required
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">
                  Client name
                </span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">
                  PE-backed
                </span>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={peBacked}
                  onChange={(e) =>
                    setPeBacked(e.target.value as 'yes' | 'no' | 'unknown')
                  }
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">
                  Industry
                </span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  required
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">
                  Business function
                </span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={businessFunction}
                  onChange={(e) => setBusinessFunction(e.target.value)}
                  required
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">
                  Tech (comma-separated — drives Layer 3 index)
                </span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={tech}
                  onChange={(e) => setTech(e.target.value)}
                  placeholder="e.g. RAG, Computer Vision, Azure"
                />
              </label>
            </div>

            {(
              [
                ['overview', overview, setOverview, false],
                ['challenges', challenges, setChallenges, true],
                [
                  'challenge (deep dive — retrieval embeddings)',
                  challenge,
                  setChallenge,
                  false,
                ],
                ['solution', solution, setSolution, true],
                ['benefits', benefits, setBenefits, true],
                ['results', results, setResults, false],
                ['summary', summary, setSummary, false],
                ['uniqueSolution', uniqueSolution, setUniqueSolution, false],
              ] as const
            ).map(([label, value, setter, required]) => (
              <label key={label} className="block">
                <span className="text-xs font-medium text-slate-600">
                  {label}
                </span>
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-[88px] font-mono"
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                  required={required}
                />
              </label>
            ))}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 disabled:opacity-60"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Saving & re-embedding…' : 'Save case'}
              </button>
              <button
                type="button"
                onClick={closeEdit}
                className="text-sm text-slate-600 hover:text-slate-900 bg-transparent border-0 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        Edit <strong>case data</strong> below. The Layer 3 case index is
        auto-generated from titles + tech (no case IDs). Do not invent cases in
        the index — change the underlying rows so the agent cannot cite phantom
        cases.
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-3 items-end">
          <label className="flex-1 min-w-[180px]">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Search
            </span>
            <div className="mt-1 relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-2 text-sm"
                placeholder="Title, industry, tech, client…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </label>
          <label>
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              PE
            </span>
            <select
              className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={peFilter}
              onChange={(e) => setPeFilter(e.target.value as PeFilter)}
            >
              <option value="all">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label>
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Industry
            </span>
            <select
              className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm max-w-[200px]"
              value={industryFilter}
              onChange={(e) => setIndustryFilter(e.target.value)}
            >
              <option value="">All</option>
              {industries.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[140px]">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Tech contains
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={techFilter}
              onChange={(e) => setTechFilter(e.target.value)}
              placeholder="e.g. RAG"
            />
          </label>
          <p className="m-0 text-xs text-slate-500 pb-2">
            {loading ? 'Loading…' : `${filtered.length} of ${rows.length} cases`}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                {(
                  [
                    ['title', 'Title'],
                    ['clientName', 'Client'],
                    ['industry', 'Industry'],
                    ['businessFunction', 'Function'],
                    ['peBacked', 'PE'],
                    ['tech', 'Tech'],
                    ['hasAssets', 'Assets'],
                    ['updatedAt', 'Updated'],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <th key={key} className="px-3 py-2.5 font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort(key)}
                      className="bg-transparent border-0 p-0 cursor-pointer text-slate-600 hover:text-slate-900 font-semibold uppercase tracking-wide text-xs"
                    >
                      {label}
                      {sortMark(key)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    Loading cases…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                    No cases match these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => void openEdit(r.id)}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="px-3 py-2.5 font-medium text-slate-900 max-w-[220px]">
                      <span className="line-clamp-2">{r.title}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {r.clientName || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {r.industry}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {r.businessFunction}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {peLabel(r.peBacked)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[180px]">
                      <span className="line-clamp-2" title={r.tech}>
                        {r.tech || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {r.hasAssets ? `Yes (${r.assetCount})` : 'No'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap text-xs">
                      {formatWhen(r.updatedAt)}
                      {r.updatedByName ? (
                        <div className="text-slate-400">{r.updatedByName}</div>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
        <div>
          <h2 className="m-0 text-base font-semibold text-slate-900">
            Generated case index (Layer 3) — read only
          </h2>
          <p className="m-0 mt-1 text-sm text-slate-600">
            This index is generated from the case data above. Edit the cases to
            change it.
          </p>
        </div>
        {indexLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Building index…
          </div>
        ) : (
          <pre className="m-0 max-h-[420px] overflow-auto rounded-lg bg-slate-900 text-slate-100 text-xs leading-relaxed p-4 whitespace-pre-wrap">
            {indexText}
          </pre>
        )}
      </section>
    </div>
  );
}
