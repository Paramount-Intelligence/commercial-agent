/**
 * Isolated SMTP delivery check — run BEFORE wiring email into the auth flow.
 *
 *   npm run smtp:test -- you@example.com
 *   npx tsx --env-file=.env.local scripts/test-smtp.ts you@example.com
 *
 * Sends a real verification email with a dummy code. No DB involved.
 */
import {
  sendVerificationEmail,
  verifySmtpConnection,
} from '../lib/email/mailer';

async function main() {
  const to = process.argv[2]?.trim();
  if (!to || !to.includes('@')) {
    console.error('Usage: npm run smtp:test -- <recipient email>');
    process.exitCode = 1;
    return;
  }

  const dummyCode = '123456';
  console.log('Verifying SMTP configuration and connection...');
  await verifySmtpConnection();
  console.log('✓ SMTP connection verified.');
  console.log(`Sending test verification email to ${to} (code ${dummyCode})...`);
  await sendVerificationEmail(to, dummyCode);
  console.log('✓ Sent. Check the inbox (and spam folder).');
}

main().catch((err) => {
  console.error('SMTP test FAILED:');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
