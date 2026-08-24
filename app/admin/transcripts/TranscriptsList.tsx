'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';

type OrgOption = { id: string; name: string };

type Row = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  title?: string | null;
  deletedAt?: string | null;
  messageCount: number;
  user: { name: string | null; email: string };
  organization: { id: string; name: string } | null;
  preview: string;
  toolsUsed?: string[];
  usedFallback?: boolean;
  voiceLikely?: boolean;
};

export default function TranscriptsList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFailures = searchParams.get('failures') === '1';

  const [rows, setRows] = useState<Row[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(25);
  const [organizationId, setOrganizationId] = useState('');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [failuresOnly, setFailuresOnly] = useState(initialFailures);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (organizationId) params.set('organizationId', organizationId);
      if (search) params.set('search', search);
      if (failuresOnly) params.set('failures', '1');

      const res = await fetch(`/api/admin/transcripts?${params}`);
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        conversations?: Row[];
        total?: number;
        organizations?: OrgOption[];
        error?: string;
      };
      if (!res.ok || !data.conversations) {
        throw new Error(data.error || 'Failed to load transcripts');
      }
      setRows(data.conversations);
      setTotal(data.total ?? 0);
      if (data.organizations) setOrgs(data.organizations);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, organizationId, search, failuresOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    setSearch(searchDraft.trim());
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Org
          </span>
          <select
            value={organizationId}
            onChange={(e) => {
              setPage(0);
              setOrganizationId(e.target.value);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          >
            <option value="">All organizations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={failuresOnly}
            onChange={(e) => {
              setPage(0);
              setFailuresOnly(e.target.checked);
              const url = new URL(window.location.href);
              if (e.target.checked) url.searchParams.set('failures', '1');
              else url.searchParams.delete('failures');
              window.history.replaceState({}, '', url.pathname + url.search);
            }}
            className="rounded border-slate-300"
          />
          Failures only
          <span className="text-xs text-slate-400">(grounding handoff)</span>
        </label>

        <form onSubmit={applySearch} className="flex items-center gap-2 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search name, email, or message…"
              className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg px-3 py-2 text-sm font-medium bg-slate-900 text-white hover:bg-slate-700"
          >
            Search
          </button>
        </form>
      </div>

      {error ? (
        <p className="m-0 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </p>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="px-5 py-10 flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="m-0 px-5 py-10 text-sm text-slate-500 text-center">
            No conversations match these filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Org</th>
                  <th className="px-4 py-3 font-medium">Flags</th>
                  <th className="px-4 py-3 font-medium">Preview</th>
                  <th className="px-4 py-3 font-medium text-right">Msgs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => router.push(`/admin/transcripts/${row.id}`)}
                  >
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {row.user.name || '—'}
                      </div>
                      <div className="text-xs text-slate-500">{row.user.email}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.organization?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.usedFallback ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                            Fallback
                          </span>
                        ) : null}
                        {row.voiceLikely ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">
                            Voice
                          </span>
                        ) : null}
                        {(row.toolsUsed?.length ?? 0) > 0 ? (
                          <span
                            className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-700"
                            title={row.toolsUsed?.join(', ')}
                          >
                            Tools {row.toolsUsed!.length}
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-50 text-slate-400">
                            No tools
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-xs truncate">
                      {row.preview || '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {row.messageCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            {total.toLocaleString()} conversation{total === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-slate-300 bg-white disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>
            <span className="text-xs text-slate-600 tabular-nums">
              {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              disabled={page + 1 >= pageCount || loading}
              onClick={() => setPage((p) => p + 1)}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-slate-300 bg-white disabled:opacity-40"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
