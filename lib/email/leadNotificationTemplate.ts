/**
 * Lead notification email body (HTML template + plain-text fallback).
 *
 * Template: jackie-lead-email.html — Mustache-lite tokens + IF blocks:
 *   {{token}}
 *   <!-- IF field -->…<!-- ENDIF field -->
 *   <!-- IF noPdf -->…<!-- ENDIF noPdf -->   (true when no PDF was generated)
 *   <!-- IF pdfAttachedOnly -->…            (PDF attached, but no public https URL)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  LOCATION_UNAVAILABLE,
  approxLocationDisplay,
} from '../leads/geo';

export const DEFAULT_LEAD_LOGO_URL =
  'https://www.paramountintelligence.co/images/logo.png';

export type LeadEmailTokens = {
  leadName: string;
  company: string;
  role?: string | null;
  email: string;
  phone?: string | null;
  context: string;
  summary?: string | null;
  /** Any stored PDF URL (may be relative /uploads/... from local fallback). */
  pdfUrl?: string | null;
  /** True when a PDF buffer was generated and attached, even if pdfUrl isn't public. */
  pdfAttached?: boolean;
  /** @deprecated kept for callers; no longer rendered in the email. */
  leadRef?: string;
  capturedAt: string;
  approxLocation?: string | null;
  logoUrl?: string | null;
};

let cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  const path = join(process.cwd(), 'lib/email/jackie-lead-email.html');
  cachedTemplate = readFileSync(path, 'utf8');
  return cachedTemplate;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function present(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

/**
 * Only absolute https URLs that aren't localhost belong in an email button.
 * Relative `/uploads/...` paths become `http://uploads/...` in mail clients.
 */
export function emailSafePublicUrl(url: string | null | undefined): string | null {
  const raw = url?.trim();
  if (!raw) return null;
  if (!/^https:\/\//i.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (/^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Expand <!-- IF name -->…<!-- ENDIF name --> based on truthiness of values[name]. */
export function applyIfBlocks(
  template: string,
  values: Record<string, string | null | undefined | boolean>,
): string {
  return template.replace(
    /<!--\s*IF\s+(\w+)\s*-->([\s\S]*?)<!--\s*ENDIF\s+\1\s*-->/gi,
    (_full, name: string, inner: string) => {
      const raw = values[name];
      const show =
        typeof raw === 'boolean' ? raw : present(typeof raw === 'string' ? raw : null);
      return show ? inner : '';
    },
  );
}

export function fillTokens(
  template: string,
  tokens: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    return tokens[key] ?? '';
  });
}

export function formatLeadCapturedAt(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function renderLeadNotificationHtml(input: LeadEmailTokens): string {
  const approx = approxLocationDisplay(input.approxLocation);
  const company = input.company?.trim() || '—';
  const role = input.role?.trim() || '';
  const phone = input.phone?.trim() || '';
  const summary = input.summary?.trim() || '';
  const publicPdfUrl = emailSafePublicUrl(input.pdfUrl);
  const pdfAttached = input.pdfAttached === true || Boolean(input.pdfUrl?.trim());
  const logoUrl = input.logoUrl?.trim() || DEFAULT_LEAD_LOGO_URL;

  const withBlocks = applyIfBlocks(loadTemplate(), {
    role,
    phone,
    summary,
    pdfUrl: publicPdfUrl,
    pdfAttachedOnly: pdfAttached && !publicPdfUrl,
    noPdf: !pdfAttached,
  });

  return fillTokens(withBlocks, {
    leadName: escapeHtml(input.leadName),
    company: escapeHtml(company),
    role: escapeHtml(role),
    email: escapeHtml(input.email),
    phone: escapeHtml(phone),
    context: escapeHtml(input.context),
    summary: escapeHtml(summary),
    pdfUrl: escapeHtml(publicPdfUrl ?? ''),
    capturedAt: escapeHtml(input.capturedAt),
    approxLocation: escapeHtml(approx),
    logoUrl: escapeHtml(logoUrl),
  });
}

export function renderLeadNotificationText(input: LeadEmailTokens): string {
  const approx = approxLocationDisplay(input.approxLocation);
  const company = input.company?.trim() || '—';
  const publicPdfUrl = emailSafePublicUrl(input.pdfUrl);
  const pdfAttached = input.pdfAttached === true || Boolean(input.pdfUrl?.trim());
  const lines = [
    'New adviser lead — Paramount Intelligence',
    '',
    `Name: ${input.leadName}`,
    `Email: ${input.email}`,
    `Company: ${company}`,
  ];
  if (present(input.role)) lines.push(`Role: ${input.role!.trim()}`);
  if (present(input.phone)) lines.push(`Phone: ${input.phone!.trim()}`);
  lines.push(`Location: ${approx} (approx · via IP)`);
  lines.push(`Context: ${input.context}`);
  if (present(input.summary)) lines.push(`Summary: ${input.summary!.trim()}`);
  lines.push(`Captured: ${input.capturedAt}`);
  if (publicPdfUrl) {
    lines.push(`Transcript PDF: ${publicPdfUrl}`);
    lines.push(
      'The full conversation (including case and one-pager links) is attached as a PDF.',
    );
  } else if (pdfAttached) {
    lines.push(
      'Transcript PDF: attached to this email (no public link — local/dev storage).',
    );
  } else {
    lines.push(
      'Transcript PDF: (generation failed — conversation is still saved in the agent)',
    );
  }
  lines.push('');
  lines.push(
    'Approximate location is inferred from the request IP and may be wrong behind a VPN or proxy. Internal handoff context only — not verified.',
  );
  lines.push('');
  lines.push('— Paramount Intelligence Adviser');
  return lines.join('\n');
}

export { LOCATION_UNAVAILABLE };
