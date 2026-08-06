/**
 * SMTP mailer (nodemailer). Config from env:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 * Port 465 → implicit TLS (secure:true); anything else → STARTTLS (secure:false).
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { sanitizeHeader } from './sanitize';
import {
  formatLeadCapturedAt,
  renderLeadNotificationHtml,
  renderLeadNotificationText,
} from './leadNotificationTemplate';

export { sanitizeHeader, isEmailFormat, EMAIL_FORMAT_RE } from './sanitize';

let cached: Transporter | null = null;

type LoadedTransport = {
  transporter: Transporter;
  from: string;
  host: string;
  port: number;
  secure: boolean;
};

type SmtpError = Error & {
  code?: string;
  command?: string;
  response?: string;
  responseCode?: number;
};

function loadTransport(): LoadedTransport {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

  const missing = (
    [
      ['SMTP_HOST', SMTP_HOST],
      ['SMTP_PORT', SMTP_PORT],
      ['SMTP_USER', SMTP_USER],
      ['SMTP_PASS', SMTP_PASS],
      ['SMTP_FROM', SMTP_FROM],
    ] as const
  )
    .filter(([, v]) => !v?.trim())
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(
      `SMTP is not configured — missing env var(s): ${missing.join(', ')}. ` +
        'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM.',
    );
  }

  const port = Number(SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`SMTP_PORT must be an integer from 1 to 65535, got "${SMTP_PORT}"`);
  }
  if (/^https?:\/\//i.test(SMTP_HOST!)) {
    throw new Error('SMTP_HOST must be a hostname, without http:// or https://');
  }

  const from = SMTP_FROM!.trim();
  const fromAddress = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
    throw new Error(
      `SMTP_FROM must contain a valid sender email address, got "${from}"`,
    );
  }

  const secure = port === 465;
  if (!cached) {
    cached = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure, // 465 = implicit TLS; 587/25 = STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }

  return { transporter: cached, from, host: SMTP_HOST!, port, secure };
}

function smtpErrorDetails(err: unknown) {
  const smtpError = err as SmtpError;
  return {
    message: err instanceof Error ? err.message : String(err),
    code: smtpError?.code,
    command: smtpError?.command,
    responseCode: smtpError?.responseCode,
    response: smtpError?.response,
  };
}

/** Validate credentials/connectivity without sending mail (used by smtp:test). */
export async function verifySmtpConnection(): Promise<void> {
  const { transporter, host, port, secure } = loadTransport();
  try {
    await transporter.verify();
  } catch (err) {
    console.error('[email/smtp] connection verification failed', {
      host,
      port,
      secure,
      ...smtpErrorDetails(err),
    });
    throw new Error(`SMTP connection verification failed for ${host}:${port}`, {
      cause: err,
    });
  }
}

const CODE_TTL_MINUTES = 10;

export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  const subject = 'Your Paramount Intelligence Adviser verification code';
  const text = [
    'Paramount Intelligence Adviser',
    '',
    `Your verification code is: ${code}`,
    '',
    `This code expires in ${CODE_TTL_MINUTES} minutes. If you did not request it, you can ignore this email.`,
    '',
    '— Paramount Intelligence',
  ].join('\n');

  const html = `
<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1a2438;">
  <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #1e6fd9; font-weight: 600;">
    Paramount Intelligence — Adviser
  </p>
  <h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 600;">Verification code</h1>
  <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #3d4a63;">
    Use this code to verify your email address:
  </p>
  <p style="margin: 0 0 20px; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #0d1f3c;">
    ${code}
  </p>
  <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #6b7a96;">
    This code expires in ${CODE_TTL_MINUTES} minutes. If you did not request it, you can safely ignore this email.
  </p>
</div>`.trim();

  await sendEmail({ to, subject, text, html });
}

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type SendEmailOpts = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
};

/** Generic SMTP send (Resend SMTP). Supports PDF attachments for lead handoff. */
export async function sendEmail(opts: SendEmailOpts): Promise<void> {
  const { transporter, from, host, port, secure } = loadTransport();
  const toList = (Array.isArray(opts.to) ? opts.to : [opts.to])
    .map((addr) => sanitizeHeader(addr))
    .filter(Boolean);
  if (toList.length === 0) {
    throw new Error('Email send refused: no valid recipients after sanitization');
  }
  const subject = sanitizeHeader(opts.subject);
  try {
    const info = await transporter.sendMail({
      from,
      to: toList.join(', '),
      subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments?.map((a) => ({
        filename: sanitizeHeader(a.filename) || 'attachment',
        content: a.content,
        contentType: a.contentType ?? 'application/octet-stream',
      })),
    });
    console.info('[email/smtp] delivery accepted', {
      host,
      port,
      secure,
      from,
      to: toList,
      messageId: info.messageId,
      response: info.response,
      attachmentCount: opts.attachments?.length ?? 0,
    });
  } catch (err) {
    console.error('[email/smtp] delivery failed', {
      host,
      port,
      secure,
      from,
      to: toList,
      ...smtpErrorDetails(err),
    });
    throw new Error(
      `Failed to send email to ${toList.join(', ')}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

export type LeadNotifyPayload = {
  name: string;
  email: string;
  company?: string | null;
  topic: string;
  /** Longer notes (optional) — maps to {{summary}} IF block. */
  summary?: string | null;
  conversationId: string;
  leadId: string;
  createdAt: Date;
  approxLocation?: string | null;
  role?: string | null;
  phone?: string | null;
  /** Null when PDF generation failed — email still sends without attachment. */
  pdf: { filename: string; buffer: Buffer; url: string } | null;
  recipients: string[];
};

/** Founder lead notification with optional conversation PDF attached. */
export async function sendLeadNotification(
  payload: LeadNotifyPayload,
): Promise<void> {
  // Header-bound fields scrubbed before Subject / To construction.
  const name = sanitizeHeader(payload.name) || 'Unknown';
  const company = sanitizeHeader(payload.company?.trim() || '') || '—';
  const topic = sanitizeHeader(payload.topic).slice(0, 80) || '(no topic)';
  const recipients = payload.recipients
    .map((r) => sanitizeHeader(r))
    .filter(Boolean);
  const subject = sanitizeHeader(
    `New lead: ${name} from ${company} — ${topic}`,
  );

  const tokens = {
    leadName: payload.name,
    company: payload.company?.trim() || '—',
    role: payload.role,
    email: payload.email,
    phone: payload.phone,
    context: payload.topic,
    summary: payload.summary,
    pdfUrl: payload.pdf?.url ?? null,
    pdfAttached: Boolean(payload.pdf),
    capturedAt: formatLeadCapturedAt(payload.createdAt),
    approxLocation: payload.approxLocation,
  };
  const text = renderLeadNotificationText(tokens);
  const html = renderLeadNotificationHtml(tokens);

  console.info('[email/lead] attempting send', {
    to: recipients,
    subject,
    hasPdf: Boolean(payload.pdf),
    pdfBytes: payload.pdf?.buffer.byteLength ?? 0,
    approxLocation: payload.approxLocation ?? null,
  });

  await sendEmail({
    to: recipients,
    subject,
    text,
    html,
    attachments: payload.pdf
      ? [
          {
            filename: payload.pdf.filename,
            content: payload.pdf.buffer,
            contentType: 'application/pdf',
          },
        ]
      : undefined,
  });

  console.info('[email/lead] send completed', {
    to: recipients,
    hasPdf: Boolean(payload.pdf),
  });
}
