/**
 * SMTP mailer (nodemailer). Config from env:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 * Port 465 → implicit TLS (secure:true); anything else → STARTTLS (secure:false).
 */
import nodemailer, { type Transporter } from 'nodemailer';

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
  const toList = Array.isArray(opts.to) ? opts.to : [opts.to];
  try {
    const info = await transporter.sendMail({
      from,
      to: toList.join(', '),
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
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
  conversationId: string;
  /** Null when PDF generation failed — email still sends without attachment. */
  pdf: { filename: string; buffer: Buffer; url: string } | null;
  recipients: string[];
};

/** Founder lead notification with optional conversation PDF attached. */
export async function sendLeadNotification(
  payload: LeadNotifyPayload,
): Promise<void> {
  const company = payload.company?.trim() || '—';
  const subject = `New lead: ${payload.name} from ${company} — ${payload.topic.slice(0, 80)}`;
  const pdfLine = payload.pdf
    ? `Transcript PDF: ${payload.pdf.url}`
    : 'Transcript PDF: (generation failed — see conversation in admin / DB)';
  const text = [
    'New adviser lead — Paramount Intelligence',
    '',
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Company: ${company}`,
    `Topic / what they're after: ${payload.topic}`,
    `Conversation ID: ${payload.conversationId}`,
    pdfLine,
    '',
    payload.pdf
      ? 'The full conversation (including case and one-pager links) is attached as a PDF.'
      : 'PDF attachment unavailable for this handoff — use the conversation ID above.',
    '',
    '— Paramount Intelligence Adviser',
  ].join('\n');

  const html = `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px 24px;color:#1a2438;">
  <p style="margin:0 0 4px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#1e6fd9;font-weight:600;">
    Paramount Intelligence — Lead handoff
  </p>
  <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">New lead from the adviser</h1>
  <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;margin:0 0 20px;">
    <tr><td style="padding:6px 0;color:#6b7a96;width:120px;">Name</td><td style="padding:6px 0;"><strong>${escapeHtml(payload.name)}</strong></td></tr>
    <tr><td style="padding:6px 0;color:#6b7a96;">Email</td><td style="padding:6px 0;"><a href="mailto:${escapeHtml(payload.email)}">${escapeHtml(payload.email)}</a></td></tr>
    <tr><td style="padding:6px 0;color:#6b7a96;">Company</td><td style="padding:6px 0;">${escapeHtml(company)}</td></tr>
    <tr><td style="padding:6px 0;color:#6b7a96;vertical-align:top;">Topic</td><td style="padding:6px 0;">${escapeHtml(payload.topic)}</td></tr>
  </table>
  <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3d4a63;">
    ${
      payload.pdf
        ? 'The full conversation transcript is attached as a PDF (includes referenced case studies and one-pager links).'
        : 'PDF generation failed for this handoff — please look up the conversation by ID below.'
    }
  </p>
  <p style="margin:0;font-size:12px;color:#6b7a96;">
    Conversation ID: <code>${escapeHtml(payload.conversationId)}</code>
    ${
      payload.pdf
        ? `<br/>PDF also at: <a href="${escapeHtml(payload.pdf.url)}">${escapeHtml(payload.pdf.url)}</a>`
        : ''
    }
  </p>
</div>`.trim();

  console.info('[email/lead] attempting send', {
    to: payload.recipients,
    subject,
    hasPdf: Boolean(payload.pdf),
    pdfBytes: payload.pdf?.buffer.byteLength ?? 0,
  });

  await sendEmail({
    to: payload.recipients,
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
    to: payload.recipients,
    hasPdf: Boolean(payload.pdf),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
