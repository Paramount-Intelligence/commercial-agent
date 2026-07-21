'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Lock } from 'lucide-react';

export default function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        router.push('/admin');
        router.refresh();
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        res.status === 401
          ? 'Invalid credentials'
          : data.error || 'Something went wrong. Please try again.',
      );
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-6 flex flex-col gap-4"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
          Email
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          autoComplete="username"
          className="rounded-lg px-3.5 py-2.5 text-sm outline-none border border-slate-300 bg-white text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
          Password
        </span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="rounded-lg px-3.5 py-2.5 text-sm outline-none border border-slate-300 bg-white text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        />
      </label>

      {error && (
        <p
          className="m-0 text-sm rounded-lg px-3 py-2.5 bg-red-50 border border-red-200 text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !email.trim() || !password}
        className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Lock className="w-4 h-4" />
        )}
        Sign in
      </button>
    </form>
  );
}
