'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';

/** Buyer sign-out: ends the session on the server, then returns to sign-in. */
export default function SignOutButton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      aria-label="Sign out"
      title="Sign out"
      className={
        className ??
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium disabled:opacity-50'
      }
      style={
        style ?? {
          color: 'var(--pi-silver-300)',
          border: '1px solid rgba(143,164,196,0.2)',
          background: 'transparent',
        }
      }
    >
      <LogOut className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">Sign out</span>
    </button>
  );
}
