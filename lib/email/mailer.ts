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
  const { transporter, from, host, port, secure } = loadTransport();

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

  try {
    await transporter.sendMail({ from, to, subject, text, html });
  } catch (err) {
    console.error('[email/smtp] delivery failed', {
      host,
      port,
      secure,
      from,
      to,
      ...smtpErrorDetails(err),
    });
    throw new Error(
      `Failed to send verification email to ${to}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}
