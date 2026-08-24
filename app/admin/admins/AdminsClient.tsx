'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, Plus } from 'lucide-react';

type AdminRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: string;
  isSelf?: boolean;
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

export default function AdminsClient() {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [credModal, setCredModal] = useState<CredModal | null>(null);
  const [copied, setCopied] = useState<'email' | 'password' | 'both' | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/admins');
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        admins?: AdminRow[];
        error?: string;
      };
      if (!res.ok || !data.admins) {
        throw new Error(data.error || 'Failed to load admins');
      }
      setAdmins(data.admins);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating || !name.trim() || !email.trim()) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const data = (await res.json()) as {
        admin?: AdminRow;
        password?: string;
        warning?: string;
        error?: string;
      };
      if (!res.ok || !data.admin || !data.password) {
        throw new Error(data.error || 'Create failed');
      }
      setShowCreate(false);
      setName('');
      setEmail('');
      setCredModal({
        title: 'Admin created',
        email: data.admin.email,
        password: data.password,
        warning: data.warning || 'Password shown once.',
      });
      setCopied(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  async function onReset(admin: AdminRow) {
    if (
      !window.confirm(
        `Reset password for ${admin.email}? Their current sessions will be revoked.`,
      )
    ) {
      return;
    }
    setBusyId(admin.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/admins/${admin.id}/reset-password`, {
        method: 'POST',
      });
      const data = (await res.json()) as {
        password?: string;
        warning?: string;
        error?: string;
      };
      if (!res.ok || !data.password) {
        throw new Error(data.error || 'Reset failed');
      }
      setCredModal({
        title: 'Password reset',
        email: admin.email,
        password: data.password,
        warning: data.warning || 'Password shown once.',
      });
      setCopied(null);
      setNotice(
        admin.isSelf
          ? 'Your password was reset — copy it now; you may need to log in again.'
          : null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-slate-600 max-w-xl">
          Adviser portal operators. Passwords are never stored in plain text —
          create or reset returns a one-time password. Role is informational
          today (all admins have full access).
        </p>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold bg-slate-900 text-white hover:bg-slate-700"
        >
          <Plus className="w-4 h-4" />
          Invite admin
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

      {showCreate ? (
        <form
          onSubmit={onCreate}
          className="bg-white rounded-xl border border-slate-200 px-5 py-5 flex flex-col gap-4 max-w-lg"
        >
          <h2 className="m-0 text-base font-semibold text-slate-900">
            New adviser admin
          </h2>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Full name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold bg-slate-900 text-white disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="text-sm text-slate-500 bg-transparent border-0"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="px-5 py-10 flex justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3 font-medium">Admin</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {admins.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">
                      {a.name}
                      {a.isSelf ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-400">
                          you
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs font-mono text-slate-500">
                      {a.email}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{a.role}</td>
                  <td className="px-4 py-3">
                    {a.active ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
                        Active
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-red-100 text-red-700">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                    {new Date(a.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={busyId === a.id}
                      onClick={() => void onReset(a)}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-slate-300 bg-white disabled:opacity-40"
                    >
                      <KeyRound className="w-3 h-3" />
                      Reset password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {credModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="m-0 text-base font-semibold text-slate-900">
                {credModal.title}
              </h3>
              <p className="m-0 mt-1 text-xs text-amber-800">{credModal.warning}</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Email
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <code className="text-sm text-slate-900">{credModal.email}</code>
                  <button
                    type="button"
                    onClick={async () => {
                      if (await copyText(credModal.email)) setCopied('email');
                    }}
                    className="text-xs text-slate-600 inline-flex items-center gap-1 bg-transparent border-0"
                  >
                    {copied === 'email' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    Copy
                  </button>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Password
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <code className="text-sm text-slate-900 break-all">
                    {credModal.password}
                  </code>
                  <button
                    type="button"
                    onClick={async () => {
                      if (await copyText(credModal.password))
                        setCopied('password');
                    }}
                    className="text-xs text-slate-600 inline-flex items-center gap-1 bg-transparent border-0"
                  >
                    {copied === 'password' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    Copy
                  </button>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setCredModal(null)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium bg-slate-900 text-white"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
