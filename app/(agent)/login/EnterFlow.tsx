'use client';

/**
 * Single-surface entry flow: org login + user identify + email verification,
 * one question at a time. Visually one card, but with two server checkpoints:
 * - advancing past org password → POST /api/auth/org-login (sets org_auth cookie);
 *   failure stays on the password step — identify questions never show without it.
 * - advancing past affiliation → POST /api/auth/identify (orgId from cookie).
 * Backend routes are unchanged; this is UI orchestration only.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';

type Step =
  | 'orgEmail'
  | 'orgPassword'
  | 'name'
  | 'email'
  | 'affiliation'
  | 'code'
  | 'done';

const STEP_ORDER: Step[] = ['orgEmail', 'orgPassword', 'name', 'email', 'affiliation', 'code'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputStyle = {
  background: 'rgba(6,13,26,0.55)',
  color: 'var(--pi-silver-100)',
} as const;

export default function EnterFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('orgEmail');

  const [orgEmail, setOrgEmail] = useState('');
  const [orgPassword, setOrgPassword] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [code, setCode] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the active question's input on every step change
  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  // Resend-cooldown countdown (code step)
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Completion: brief confirmation, then into the chat
  useEffect(() => {
    if (step !== 'done') return;
    const t = setTimeout(() => router.push('/chat'), 1100);
    return () => clearTimeout(t);
  }, [step, router]);

  async function post(path: string, body: unknown) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, data };
  }

  /** Org cookie expired mid-flow → back to the org-access questions. */
  function restartAtOrgLogin() {
    setOrgPassword('');
    setCode('');
    setStep('orgEmail');
    setError('Organization login expired — please sign in again.');
  }

  function goTo(next: Step) {
    setError(null);
    setInfo(null);
    setStep(next);
  }

  // Per-step client-side validity — gates the arrow button
  const stepValid: Record<Exclude<Step, 'done'>, boolean> = {
    orgEmail: EMAIL_RE.test(orgEmail.trim()),
    orgPassword: orgPassword.length > 0,
    name: name.trim().length > 0,
    email: EMAIL_RE.test(email.trim()),
    affiliation: affiliation.trim().length > 0,
    code: code.length === 6,
  };

  async function advance(e: FormEvent) {
    e.preventDefault();
    if (submitting || step === 'done' || !stepValid[step]) return;

    // Pure client-side steps: just move on
    if (step === 'orgEmail') return goTo('orgPassword');
    if (step === 'name') return goTo('email');
    if (step === 'email') return goTo('affiliation');

    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      if (step === 'orgPassword') {
        // CHECKPOINT 1: org creds must pass before any identify question shows
        const { res, data } = await post('/api/auth/org-login', {
          email: orgEmail,
          password: orgPassword,
        });
        if (res.ok) {
          goTo('name');
        } else {
          setError(
            res.status === 401
              ? 'Invalid credentials or inactive organization'
              : typeof data.error === 'string'
                ? data.error
                : 'Something went wrong. Please try again.',
          );
        }
        return;
      }

      if (step === 'affiliation') {
        // CHECKPOINT 2: identify (orgId comes from the cookie, never from here)
        const { res, data } = await post('/api/auth/identify', {
          name,
          email,
          affiliation,
        });
        if (res.status === 401) return restartAtOrgLogin();

        if (data.status === 'already_verified') {
          goTo('done');
        } else if (data.status === 'code_sent') {
          goTo('code');
          setInfo(`We sent a 6-digit code to ${email.trim()}.`);
          setCooldown(60);
        } else if (data.status === 'rate_limited') {
          const wait = Number(data.retryAfterSeconds) || 60;
          goTo('code');
          setInfo(`A code was already sent — check your email. You can resend in ${wait}s.`);
          setCooldown(wait);
        } else {
          setError(
            typeof data.error === 'string' ? data.error : 'Something went wrong. Please try again.',
          );
        }
        return;
      }

      if (step === 'code') {
        const { res, data } = await post('/api/auth/verify-code', { email, code });
        if (res.status === 401) return restartAtOrgLogin();

        if (data.verified === true) {
          goTo('done');
          return;
        }
        const reason = data.reason as string | undefined;
        if (reason === 'wrong_code') {
          const left = data.attemptsRemaining as number | undefined;
          setError(
            `That code isn't right.${left !== undefined ? ` ${left} attempt${left === 1 ? '' : 's'} remaining.` : ''}`,
          );
        } else if (reason === 'too_many_attempts') {
          setError('Too many wrong attempts — that code is no longer valid. Resend a new one.');
        } else if (reason === 'no_active_code') {
          setError('No active code (it may have expired). Resend a new one.');
        } else {
          setError(
            typeof data.error === 'string' ? data.error : 'Verification failed. Please try again.',
          );
        }
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (submitting || cooldown > 0) return;
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      const { res, data } = await post('/api/auth/resend-code', { email });
      if (res.status === 401) return restartAtOrgLogin();

      if (data.status === 'already_verified') {
        goTo('done');
      } else if (data.status === 'code_sent') {
        setCode('');
        setInfo(`A new code is on its way to ${email.trim()}.`);
        setCooldown(60);
      } else if (data.status === 'rate_limited') {
        const wait = Number(data.retryAfterSeconds) || 60;
        setInfo(`Please wait ${wait}s before requesting another code.`);
        setCooldown(wait);
      } else {
        setError(
          typeof data.error === 'string' ? data.error : 'Could not resend. Please try again.',
        );
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'done') {
    return (
      <div className="glass-dark rounded-xl px-8 py-10 text-center max-w-md w-full step-enter">
        <CheckCircle2 className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--pi-blue-400)' }} />
        <h1 className="text-xl font-semibold text-white m-0">You&apos;re verified</h1>
        <p className="mt-3 text-sm m-0" style={{ color: 'var(--pi-silver-400)' }}>
          Taking you to the adviser…
        </p>
      </div>
    );
  }

  const stepIndex = STEP_ORDER.indexOf(step);
  const isOrgGroup = step === 'orgEmail' || step === 'orgPassword';
  const isServerStep = step === 'orgPassword' || step === 'affiliation' || step === 'code';

  // Per-step copy
  const prompts: Record<Exclude<Step, 'done'>, { title: string; hint?: string }> = {
    orgEmail: { title: 'Organization email' },
    orgPassword: {
      title: 'Organization password',
      hint: `Signing in as ${orgEmail.trim()}`,
    },
    name: { title: "What's your name?" },
    email: {
      title: "What's your work email?",
      hint: 'Your verification code goes here.',
    },
    affiliation: {
      title: "What's your affiliation?",
      hint: 'e.g. "Partner at Catalant"',
    },
    code: {
      title: 'Enter the 6-digit code',
      hint: `Sent to ${email.trim()}`,
    },
  };

  return (
    <div className="w-full max-w-md">
      {/* Group label + progress: 2 org dots, a gap, 4 about-you dots */}
      <div className="text-center mb-6">
        <p
          className="text-xs font-semibold uppercase tracking-widest m-0 mb-3"
          style={{ color: 'var(--pi-blue-300)' }}
        >
          {isOrgGroup ? 'Organization access' : 'About you'}
        </p>
        <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
          {STEP_ORDER.map((s, i) => (
            <span
              key={s}
              className="rounded-full transition-all duration-300"
              style={{
                width: i === stepIndex ? 18 : 6,
                height: 6,
                background:
                  i <= stepIndex ? 'var(--pi-blue-400)' : 'rgba(143,164,196,0.25)',
                marginLeft: i === 2 ? 10 : 0, // visual gap between the two groups
              }}
            />
          ))}
        </div>
        <p className="sr-only">
          Step {stepIndex + 1} of {STEP_ORDER.length}
        </p>
      </div>

      <form
        key={step}
        onSubmit={advance}
        className="glass-dark rounded-xl px-6 py-7 flex flex-col gap-4 step-enter"
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="entry-input"
            className="text-base font-semibold text-white"
            style={{ letterSpacing: '-0.01em' }}
          >
            {prompts[step].title}
          </label>
          {prompts[step].hint && (
            <p className="m-0 text-xs" style={{ color: 'var(--pi-silver-400)' }}>
              {prompts[step].hint}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {step === 'orgEmail' && (
            <input
              ref={inputRef}
              id="entry-input"
              type="email"
              value={orgEmail}
              onChange={(e) => setOrgEmail(e.target.value)}
              required
              autoComplete="username"
              className="chat-input rounded-lg px-4 py-3 text-sm outline-none flex-1"
              style={inputStyle}
            />
          )}
          {step === 'orgPassword' && (
            <input
              ref={inputRef}
              id="entry-input"
              type="password"
              value={orgPassword}
              onChange={(e) => setOrgPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="chat-input rounded-lg px-4 py-3 text-sm outline-none flex-1"
              style={inputStyle}
            />
          )}
          {step === 'name' && (
            <input
              ref={inputRef}
              id="entry-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              className="chat-input rounded-lg px-4 py-3 text-sm outline-none flex-1"
              style={inputStyle}
            />
          )}
          {step === 'email' && (
            <input
              ref={inputRef}
              id="entry-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="chat-input rounded-lg px-4 py-3 text-sm outline-none flex-1"
              style={inputStyle}
            />
          )}
          {step === 'affiliation' && (
            <input
              ref={inputRef}
              id="entry-input"
              type="text"
              value={affiliation}
              onChange={(e) => setAffiliation(e.target.value)}
              required
              autoComplete="organization"
              className="chat-input rounded-lg px-4 py-3 text-sm outline-none flex-1"
              style={inputStyle}
            />
          )}
          {step === 'code' && (
            <input
              ref={inputRef}
              id="entry-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoComplete="one-time-code"
              className="chat-input rounded-lg px-4 py-3 text-center text-xl tracking-[0.5em] outline-none flex-1"
              style={inputStyle}
            />
          )}

          <button
            type="submit"
            disabled={submitting || !stepValid[step]}
            aria-label="Continue"
            className="btn-primary shrink-0 justify-center"
            style={{ padding: '12px 14px' }}
          >
            {submitting && isServerStep ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
          </button>
        </div>

        {info && (
          <p className="m-0 text-sm" style={{ color: 'var(--pi-silver-400)' }}>
            {info}
          </p>
        )}
        {error && (
          <p
            className="m-0 text-sm rounded-lg px-3 py-2.5"
            role="alert"
            style={{
              color: 'var(--pi-silver-200)',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(143,164,196,0.4)',
            }}
          >
            {error}
          </p>
        )}

        {step === 'code' && (
          <button
            type="button"
            onClick={onResend}
            disabled={submitting || cooldown > 0}
            className="m-0 text-xs font-medium bg-transparent border-0 cursor-pointer disabled:cursor-not-allowed self-center"
            style={{
              color: cooldown > 0 ? 'var(--pi-silver-400)' : 'var(--pi-blue-400)',
            }}
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </button>
        )}
      </form>
    </div>
  );
}
