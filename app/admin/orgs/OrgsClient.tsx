'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, Plus, Power, SlidersHorizontal } from 'lucide-react';

type OrgRow = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  dailyMsgLimit: number;
  dailyLlmTokenLimit: number;
  dailyTtsCharLimit: number;
  dailySttSecondLimit: number;
  createdAt: string;
  userCount: number;
  messagesUsedToday: number;
  llmTokensUsedToday: number;
  ttsCharsUsedToday: number;
  sttSecondsUsedToday: number;
};

type CredModal = {
  title: string;
  email: string;
  password: string;
  warning: string;
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function OrgsClient() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createLimit, setCreateLimit] = useState('1000');
  const [createLlmLimit, setCreateLlmLimit] = useState('1000000');
  const [createTtsLimit, setCreateTtsLimit] = useState('150000');
  const [createSttLimit, setCreateSttLimit] = useState('3600');
  const [creating, setCreating] = useState(false);

  // Credential modal (create / reveal / reset)
  const [credModal, setCredModal] = useState<CredModal | null>(null);
  const [copied, setCopied] = useState<'email' | 'password' | 'both' | null>(null);

  // Busy flags per action
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/orgs');
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        organizations?: OrgRow[];
        error?: string;
      };
      if (!res.ok || !data.organizations) {
        throw new Error(data.error || 'Failed to load organizations');
      }
      setOrgs(data.organizations);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openCreds(modal: CredModal) {
    setCopied(null);
    setCredModal(modal);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating || !createName.trim()) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const limit = Number(createLimit);
      const llmLimit = Number(createLlmLimit);
      const ttsLimit = Number(createTtsLimit);
      const sttLimit = Number(createSttLimit);
      const res = await fetch('/api/admin/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          ...(Number.isInteger(limit) && limit >= 1 ? { dailyMsgLimit: limit } : {}),
          ...(Number.isInteger(llmLimit) && llmLimit >= 1
            ? { dailyLlmTokenLimit: llmLimit }
            : {}),
          ...(Number.isInteger(ttsLimit) && ttsLimit >= 1
            ? { dailyTtsCharLimit: ttsLimit }
            : {}),
          ...(Number.isInteger(sttLimit) && sttLimit >= 1
            ? { dailySttSecondLimit: sttLimit }
            : {}),
        }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        organization?: OrgRow;
        password?: string;
        error?: string;
      };
      if (!res.ok || !data.organization || !data.password) {
        throw new Error(data.error || 'Create failed');
      }
      setShowCreate(false);
      setCreateName('');
      setCreateLimit('1000');
      setCreateTtsLimit('150000');
      setCreateSttLimit('3600');
      openCreds({
        title: 'Organization created',
        email: data.organization.email,
        password: data.password,
        warning: 'Save this now — the password is shown once on create (you can Reveal later).',
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  async function onReveal(org: OrgRow) {
    if (
      !window.confirm(
        `Reveal live credentials for "${org.name}"?\n\nThis exposes the organization password.`,
      )
    ) {
      return;
    }
    setBusyId(org.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orgs/${org.id}/reveal`, { method: 'POST' });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        email?: string;
        password?: string;
        error?: string;
      };
      if (!res.ok || !data.email || !data.password) {
        throw new Error(data.error || 'Reveal failed');
      }
      openCreds({
        title: `Credentials — ${org.name}`,
        email: data.email,
        password: data.password,
        warning: 'This is the live organization password. Share only with trusted partners.',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reveal failed');
    } finally {
      setBusyId(null);
    }
  }

  async function onReset(org: OrgRow) {
    if (
      !window.confirm(
        `Reset password for "${org.name}"?\n\nA new password will be generated. The old one stops working immediately.`,
      )
    ) {
      return;
    }
    setBusyId(org.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orgs/${org.id}/reset-password`, {
        method: 'POST',
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        email?: string;
        password?: string;
        error?: string;
      };
      if (!res.ok || !data.email || !data.password) {
        throw new Error(data.error || 'Reset failed');
      }
      openCreds({
        title: `New password — ${org.name}`,
        email: data.email,
        password: data.password,
        warning: 'Save this now — shown once. Existing user chat sessions stay valid.',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusyId(null);
    }
  }

  async function onToggleActive(org: OrgRow) {
    const next = !org.active;
    if (
      !next &&
      !window.confirm(
        `Deactivate "${org.name}"?\n\nThis logs out all users of this organization immediately on their next request.`,
      )
    ) {
      return;
    }
    setBusyId(org.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/orgs/${org.id}/set-active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: next }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Update failed');
      setNotice(
        next
          ? `"${org.name}" reactivated.`
          : `"${org.name}" deactivated — users will be logged out on next request.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  }

  async function onEditLimit(org: OrgRow) {
    const raw = window.prompt(
      `Daily message limit for "${org.name}"`,
      String(org.dailyMsgLimit),
    );
    if (raw === null) return;
    const limit = Number(raw.trim());
    if (!Number.isInteger(limit) || limit < 1) {
      setError('Daily limit must be a positive integer.');
      return;
    }
    setBusyId(org.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/orgs/${org.id}/set-limit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyMsgLimit: limit }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Update failed');
      setNotice(`"${org.name}" daily limit set to ${limit}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  }

  async function onEditCostLimits(org: OrgRow) {
    const llmRaw = window.prompt(
      `Daily Claude token limit for "${org.name}"`,
      String(org.dailyLlmTokenLimit),
    );
    if (llmRaw === null) return;
    const ttsRaw = window.prompt(
      `Daily TTS character limit for "${org.name}"`,
      String(org.dailyTtsCharLimit),
    );
    if (ttsRaw === null) return;
    const sttRaw = window.prompt(
      `Daily STT seconds limit for "${org.name}"`,
      String(org.dailySttSecondLimit),
    );
    if (sttRaw === null) return;
    const llmLimit = Number(llmRaw.trim());
    const ttsLimit = Number(ttsRaw.trim());
    const sttLimit = Number(sttRaw.trim());
    if (
      !Number.isInteger(llmLimit) ||
      llmLimit < 1 ||
      !Number.isInteger(ttsLimit) ||
      ttsLimit < 1 ||
      !Number.isInteger(sttLimit) ||
      sttLimit < 1
    ) {
      setError('Cost limits must be positive integers.');
      return;
    }
    setBusyId(org.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/orgs/${org.id}/set-limit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dailyLlmTokenLimit: llmLimit,
          dailyTtsCharLimit: ttsLimit,
          dailySttSecondLimit: sttLimit,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Update failed');
      setNotice(`"${org.name}" cost limits updated.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-slate-500">
          Create orgs, re-share credentials, adjust caps, kill-switch access.
        </p>
        <button
          type="button"
          onClick={() => {
            setShowCreate((v) => !v);
            setError(null);
          }}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold bg-slate-900 text-white hover:bg-slate-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create organization
        </button>
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

      {showCreate && (
        <form
          onSubmit={onCreate}
          className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-5 flex flex-col gap-4"
        >
          <h2 className="m-0 text-base font-semibold text-slate-900">
            New organization
          </h2>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Name
            </span>
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              required
              autoFocus
              placeholder="e.g. Catalant"
              className="rounded-lg px-3.5 py-2.5 text-sm outline-none border border-slate-300 bg-white text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Daily message limit
            </span>
            <input
              type="number"
              min={1}
              step={1}
              value={createLimit}
              onChange={(e) => setCreateLimit(e.target.value)}
              className="rounded-lg px-3.5 py-2.5 text-sm outline-none border border-slate-300 bg-white text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 w-40"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Daily Claude tokens
            </span>
            <input
              type="number"
              min={1}
              step={1}
              value={createLlmLimit}
              onChange={(e) => setCreateLlmLimit(e.target.value)}
              className="rounded-lg px-3.5 py-2.5 text-sm outline-none border border-slate-300 bg-white text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 w-48"
            />
          </label>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Daily TTS characters
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={createTtsLimit}
                onChange={(e) => setCreateTtsLimit(e.target.value)}
                className="rounded-lg px-3.5 py-2.5 text-sm outline-none border border-slate-300 bg-white text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Daily STT seconds
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={createSttLimit}
                onChange={(e) => setCreateSttLimit(e.target.value)}
                className="rounded-lg px-3.5 py-2.5 text-sm outline-none border border-slate-300 bg-white text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={creating || !createName.trim()}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="text-sm font-medium text-slate-500 hover:text-slate-700 bg-transparent border-0 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="px-5 py-10 flex items-center justify-center gap-2.5 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading organizations…
          </div>
        ) : orgs.length === 0 ? (
          <p className="m-0 px-5 py-10 text-sm text-slate-500 text-center">
            No organizations yet — create the first one above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3 font-medium">Organization</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Today</th>
                  <th className="px-4 py-3 font-medium text-right">Users</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orgs.map((org) => {
                  const busy = busyId === org.id;
                  return (
                    <tr key={org.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{org.name}</div>
                        <div className="text-xs text-slate-500 font-mono">
                          {org.email}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {org.active ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
                            Active
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-red-100 text-red-700">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        <div>{org.messagesUsedToday} / {org.dailyMsgLimit} msg</div>
                        <div className="text-[10px] text-slate-400">
                          {org.llmTokensUsedToday.toLocaleString()} /{' '}
                          {org.dailyLlmTokenLimit.toLocaleString()} Claude tokens
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {org.ttsCharsUsedToday.toLocaleString()} /{' '}
                          {org.dailyTtsCharLimit.toLocaleString()} TTS
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {org.sttSecondsUsedToday.toLocaleString()} /{' '}
                          {org.dailySttSecondLimit.toLocaleString()}s STT
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {org.userCount}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {new Date(org.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void onReveal(org)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                          >
                            <KeyRound className="w-3 h-3" />
                            Reveal
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void onReset(org)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                          >
                            Reset pw
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void onEditLimit(org)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                          >
                            <SlidersHorizontal className="w-3 h-3" />
                            Limit
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void onEditCostLimits(org)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 transition-colors"
                          >
                            <SlidersHorizontal className="w-3 h-3" />
                            Cost limits
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void onToggleActive(org)}
                            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border disabled:opacity-40 transition-colors ${
                              org.active
                                ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            {busy ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Power className="w-3 h-3" />
                            )}
                            {org.active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Credential modal */}
      {credModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.55)' }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="m-0 text-base font-semibold text-slate-900">
                {credModal.title}
              </h3>
              <p className="m-0 mt-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {credModal.warning}
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Email
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 break-all">
                    {credModal.email}
                  </code>
                  <button
                    type="button"
                    onClick={async () => {
                      if (await copyText(credModal.email)) setCopied('email');
                    }}
                    className="shrink-0 p-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
                    aria-label="Copy email"
                  >
                    {copied === 'email' ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-600" />
                    )}
                  </button>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Password
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 break-all font-mono">
                    {credModal.password}
                  </code>
                  <button
                    type="button"
                    onClick={async () => {
                      if (await copyText(credModal.password)) setCopied('password');
                    }}
                    className="shrink-0 p-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
                    aria-label="Copy password"
                  >
                    {copied === 'password' ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-600" />
                    )}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const both = `${credModal.email}\n${credModal.password}`;
                  if (await copyText(both)) setCopied('both');
                }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              >
                {copied === 'both' ? (
                  <Check className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                Copy email + password
              </button>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setCredModal(null)}
                className="rounded-lg px-4 py-2 text-sm font-semibold bg-slate-900 text-white hover:bg-slate-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
