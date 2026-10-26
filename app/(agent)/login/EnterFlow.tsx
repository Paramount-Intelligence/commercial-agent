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
import ParamountLogo from '@/components/ParamountLogo';

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

export default function EnterFlow({ assistantName }: { assistantName: string }) {
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

  // Completion: brief confirmation, then into text chat (default landing).
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
    // Name must not be an email (password-manager autofill often dumps email here)
    name: name.trim().length > 0 && !EMAIL_RE.test(name.trim()),
    email: EMAIL_RE.test(email.trim()),
    affiliation: affiliation.trim().length > 0,
    code: code.length === 6,
  };

  async function advance(e: FormEvent) {
    e.preventDefault();
    if (submitting || step === 'done' || !stepValid[step]) return;

    // Pure client-side steps: just move on
    if (step === 'orgEmail') return goTo('orgPassword');
    if (step === 'name') {
      if (EMAIL_RE.test(name.trim())) {
        setError('Please enter your name, not an email address.');
        return;
      }
      return goTo('email');
    }
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

        if (data.status === 'code_sent') {
          goTo('code');
          setInfo(`We sent a 6-digit code to ${email.trim()}.`);
          setCooldown(60);
        } else if (data.status === 'rate_limited') {
          const wait = Number(data.retryAfterSeconds) || 60;
          if (typeof data.error === 'string' && data.error.length > 0) {
            setError(data.error);
            setCooldown(wait);
          } else {
            goTo('code');
            setInfo(`A code was already sent — check your email. You can resend in ${wait}s.`);
            setCooldown(wait);
          }
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

      if (data.status === 'code_sent') {
        setCode('');
        setInfo(`A new code is on its way to ${email.trim()}.`);
        setCooldown(60);
      } else if (data.status === 'rate_limited') {
        const wait = Number(data.retryAfterSeconds) || 60;
        setInfo(
          typeof data.error === 'string' && data.error.length > 0
            ? data.error
            : `Please wait ${wait}s before requesting another code.`,
        );
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
      <div className="phase5-auth-card max-w-md w-full px-8 py-12 text-center step-enter">
        <CheckCircle2 className="w-10 h-10 mx-auto mb-5 text-[#1E6FD9]" />
        <h1 className="m-0 text-2xl font-semibold text-[#0B1220]">You&apos;re verified</h1>
        <p className="mt-3 mb-0 text-sm text-[#5B6577]">
          Taking you to {assistantName}…
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
    name: {
      title: "What's your name?",
      hint: 'Enter your Full Name',
    },
    email: {
      title: "What's your work email?",
      hint: 'You will receive a code to verify your email.',
    },
    affiliation: {
      title: "What's your affiliation?",
      hint: 'e.g. "Buyer-side CTO" or "Independent advisor"',
    },
    code: {
      title: 'Enter the 6-digit code',
      hint: `Sent to ${email.trim()}`,
    },
  };

  return (
    <div className="w-full max-w-[550px]">
      <form
        key={step}
        onSubmit={advance}
        className="phase5-auth-card step-enter px-6 py-7 sm:px-10 sm:py-9"
      >
        <div className="phase5-auth-progress" aria-hidden="true">
          {[0, 1, 2].map((group) => (
            <span
              key={group}
              className={group <= Math.min(2, Math.floor(stepIndex / 2)) ? 'is-active' : ''}
            />
          ))}
        </div>
        <div className="phase5-auth-brand" aria-label="Paramount Intelligence">
          <ParamountLogo size={34} priority />
          <span>Paramount Intelligence</span>
        </div>
        <div className="mb-7 text-center">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5B6577]">
            {isOrgGroup ? 'Secure organization access' : 'Complete your profile'}
          </p>
          <h1 className="m-0 text-[26px] font-semibold tracking-[-0.025em] text-[#0B1220]">
            {isOrgGroup ? 'Sign in' : step === 'code' ? 'Verify your email' : 'Tell us about you'}
          </h1>
        </div>
        <div className="flex flex-col gap-2">
          <label
            htmlFor="entry-input"
            className="text-sm font-medium text-[#0B1220]"
          >
            {prompts[step].title}
          </label>
          {prompts[step].hint && (
            <p className="m-0 text-xs leading-5 text-[#5B6577]">
              {prompts[step].hint}
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-3">
          {step === 'orgEmail' && (
            <input
              ref={inputRef}
              id="entry-input"
              type="email"
              value={orgEmail}
              onChange={(e) => setOrgEmail(e.target.value)}
              required
              autoComplete="username"
              placeholder="name@company.com"
              className="phase5-input"
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
              placeholder="Enter your password"
              className="phase5-input"
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
              placeholder="Full name"
              className="phase5-input"
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
              placeholder="name@company.com"
              className="phase5-input"
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
              placeholder="Company or role"
              className="phase5-input"
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
              placeholder="000000"
              className="phase5-input text-center text-xl tracking-[0.5em]"
            />
          )}

          <button
            type="submit"
            disabled={submitting || !stepValid[step]}
            aria-label="Continue"
            className="phase5-primary-button mt-1 h-12 w-full justify-center"
          >
            {submitting && isServerStep ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Continue
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>

        {info && (
          <p className="mt-4 mb-0 text-sm text-[#5B6577]">
            {info}
          </p>
        )}
        {error && (
          <p
            className="mt-4 mb-0 rounded-lg border border-[#F2C6C2] bg-[#FFF6F5] px-3 py-2.5 text-sm text-[#8F2920]"
            role="alert"
          >
            {error}
          </p>
        )}

        {step === 'code' && (
          <button
            type="button"
            onClick={onResend}
            disabled={submitting || cooldown > 0}
            className="mt-4 self-center border-0 bg-transparent text-xs font-medium text-[#1E6FD9] disabled:cursor-not-allowed disabled:text-[#8D96A6]"
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </button>
        )}
        <p className="sr-only">Step {stepIndex + 1} of {STEP_ORDER.length}</p>
      </form>
    </div>
  );
}
