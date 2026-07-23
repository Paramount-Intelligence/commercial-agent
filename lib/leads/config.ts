/**
 * Lead handoff config — recipients and Jackie confirmation copy.
 * Override recipients via LEAD_NOTIFY_TO (comma-separated) for testing.
 */
export const LEAD_CONFIG = {
  /**
   * Default founder inboxes. Env LEAD_NOTIFY_TO overrides (e.g. your test address).
   * Example: LEAD_NOTIFY_TO="you@example.com" or "ali@…,marty@…,leads@…"
   */
  DEFAULT_NOTIFY_TO: [
    'ali@paramountintelligence.co',
    'marty@paramountintelligence.co',
  ] as const,

  /** Warm confirmation Jackie speaks/shows after a successful capture. */
  CONFIRMATION:
    "I've shared your details with Ali and Marty along with a summary of what you're looking for. Someone from the team will follow up with you directly.",

  /** Soft decline when the user hasn't consented yet. */
  NEED_CONSENT:
    'I can connect you with the Paramount team — once you confirm you\'d like them to follow up, I\'ll share your details and what you\'re working on.',
} as const;

/** Resolve notify recipients (env override for testing). */
export function leadNotifyRecipients(): string[] {
  const raw = process.env.LEAD_NOTIFY_TO?.trim();
  if (raw) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [...LEAD_CONFIG.DEFAULT_NOTIFY_TO];
}
