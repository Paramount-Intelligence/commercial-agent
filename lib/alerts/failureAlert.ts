/**
 * Minimal production failure alerts — notify when Jackie breaks for a prospect.
 *
 * Channels (first configured wins):
 *   1. FAILURE_ALERT_SLACK_WEBHOOK_URL — Slack incoming webhook (preferred)
 *   2. FAILURE_ALERT_TO + SMTP_* — email (comma-separated recipients)
 *
 * If neither is set, alerts are no-ops (still logged once at DEBUG).
 * Fire-and-forget: never await from the user-facing path; never throw to callers.
 */
import { sendEmail } from '../email/mailer';

export type FailureKind =
  | 'used_fallback'
  | 'validation_failed_twice'
  | 'model_overloaded'
  | 'chat_5xx'
  | 'tts_timeout'
  | 'tts_5xx'
  | 'stt_5xx'
  | 'quota_chat'
  | 'quota_tts'
  | 'quota_stt';

export type FailureAlertInput = {
  kind: FailureKind;
  /** Short human reason (shown in the alert body). */
  reason: string;
  conversationId?: string | null;
  orgId?: string | null;
  orgName?: string | null;
  route?: string;
};

type ThrottleBucket = {
  windowStart: number;
  sent: number;
  suppressed: number;
};

/** In-process throttle (per serverless instance). Better than spam; not global. */
const THROTTLE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const THROTTLE_MAX_SENDS = 1; // one alert per key per window
const buckets = new Map<string, ThrottleBucket>();

let loggedDisabled = false;

/** Exposed for unit tests. */
export function resetFailureAlertThrottleForTests(): void {
  buckets.clear();
  loggedDisabled = false;
}

/** Exposed for unit tests — decide whether to send, mutating the bucket. */
export function consumeFailureAlertThrottle(
  key: string,
  now = Date.now(),
): { send: boolean; suppressedSinceLastSend: number } {
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart >= THROTTLE_WINDOW_MS) {
    const suppressed = existing?.suppressed ?? 0;
    buckets.set(key, { windowStart: now, sent: 1, suppressed: 0 });
    return { send: true, suppressedSinceLastSend: suppressed };
  }
  if (existing.sent < THROTTLE_MAX_SENDS) {
    existing.sent += 1;
    return { send: true, suppressedSinceLastSend: existing.suppressed };
  }
  existing.suppressed += 1;
  return { send: false, suppressedSinceLastSend: existing.suppressed };
}

function throttleKey(input: FailureAlertInput): string {
  return `${input.kind}:${input.orgId || 'global'}`;
}

function slackWebhookUrl(): string | null {
  return process.env.FAILURE_ALERT_SLACK_WEBHOOK_URL?.trim() || null;
}

function emailRecipients(): string[] {
  const raw = process.env.FAILURE_ALERT_TO?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function alertsConfigured(): boolean {
  return Boolean(slackWebhookUrl() || emailRecipients().length > 0);
}

function formatAlertText(
  input: FailureAlertInput,
  suppressedSinceLastSend: number,
): string {
  const lines = [
    `Jackie failure: ${input.kind}`,
    `Reason: ${input.reason}`,
    `Org: ${input.orgName || '(unknown)'}${input.orgId ? ` (${input.orgId})` : ''}`,
    `Conversation: ${input.conversationId || '(none)'}`,
  ];
  if (input.route) lines.push(`Route: ${input.route}`);
  if (suppressedSinceLastSend > 0) {
    lines.push(
      `Note: ${suppressedSinceLastSend} similar alert(s) suppressed in the prior throttle window.`,
    );
  }
  lines.push(`Time: ${new Date().toISOString()}`);
  return lines.join('\n');
}

async function postSlack(webhook: string, text: string): Promise<void> {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Slack webhook HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function dispatchFailureAlert(input: FailureAlertInput): Promise<void> {
  if (!alertsConfigured()) {
    if (!loggedDisabled) {
      loggedDisabled = true;
      console.info(
        '[alerts] FAILURE_ALERT_SLACK_WEBHOOK_URL / FAILURE_ALERT_TO unset — failure alerts disabled',
      );
    }
    return;
  }

  const { send, suppressedSinceLastSend } = consumeFailureAlertThrottle(
    throttleKey(input),
  );
  if (!send) {
    console.info('[alerts] throttled', {
      kind: input.kind,
      orgId: input.orgId ?? null,
      suppressedInWindow: suppressedSinceLastSend,
    });
    return;
  }

  const text = formatAlertText(input, suppressedSinceLastSend);
  const webhook = slackWebhookUrl();
  if (webhook) {
    await postSlack(webhook, text);
    console.info('[alerts] slack sent', {
      kind: input.kind,
      orgId: input.orgId ?? null,
      conversationId: input.conversationId ?? null,
    });
    return;
  }

  const to = emailRecipients();
  await sendEmail({
    to,
    subject: `[Jackie] ${input.kind} — ${input.orgName || 'unknown org'}`,
    text,
  });
  console.info('[alerts] email sent', {
    kind: input.kind,
    to,
    orgId: input.orgId ?? null,
    conversationId: input.conversationId ?? null,
  });
}

/**
 * Fire-and-forget failure alert. Safe to call from any request path —
 * never throws, never awaited by callers.
 */
export function notifyJackieFailure(input: FailureAlertInput): void {
  void dispatchFailureAlert(input).catch((err) => {
    console.error('[alerts] dispatch failed', {
      kind: input.kind,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
