'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';

type OrgOption = { id: string; name: string };

type Row = {
  id: string;
  createdAt: string;
  messageCount: number;
  user: { name: string | null; email: string };
  organization: { id: string; name: string } | null;
  preview: string;
};

export default function TranscriptsList() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(25);
  const [organizationId, setOrganizationId] = useState('');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
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
  }, [page, pageSize, organizationId, search]);

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
      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
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

        <form onSubmit={applySearch} className="flex-1 flex items-center gap-2 min-w-[200px]">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search email, name, or message…"
              className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg px-3 py-2 text-sm font-medium bg-slate-900 text-white hover:bg-slate-700 transition-colors"
          >
            Search
          </button>
        </form>
      </div>

      {error && (
        <p
          className="m-0 text-sm rounded-lg px-4 py-3 bg-red-50 border border-red-200 text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="px-5 py-10 flex items-center justify-center gap-2.5 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading transcripts…
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
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Org</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium text-right">Msgs</th>
                  <th className="px-4 py-3 font-medium">First question</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => router.push(`/admin/transcripts/${r.id}`)}
                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {r.organization?.name ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {r.user.name || '—'}
                      </div>
                      <div className="text-xs text-slate-500">{r.user.email}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                      {r.messageCount}
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-xs truncate">
                      {r.preview || (
                        <span className="text-slate-400 italic">No user message</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-sm text-slate-600">
          <span>
            {total === 0
              ? '0 conversations'
              : `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)} of ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>
            <span className="text-xs text-slate-500">
              Page {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              disabled={page + 1 >= pageCount || loading}
              onClick={() => setPage((p) => p + 1)}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
