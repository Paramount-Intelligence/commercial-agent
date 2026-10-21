/**
 * Runs every unit test script that needs no database, network or API key.
 * Used locally before each commit and in CI.
 *
 *   npm run test:unit
 */
import { spawnSync } from 'child_process';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const TSX = join(ROOT, 'node_modules/tsx/dist/cli.mjs');

const SCRIPTS = [
  'scripts/test-validator.ts',
  'scripts/test-pricing.ts',
  'scripts/test-contacts.ts',
  'scripts/test-src-grounding.ts',
  'scripts/test-normalize-output.ts',
  'scripts/test-fish-tts.ts',
  'scripts/test-tts-chunks.ts',
  'scripts/test-lead-email.ts',
  'scripts/test-failure-alert.ts',
  'scripts/test-model-timeout.ts',
  'scripts/test-db-guard.ts',
  'scripts/test-sign-in.ts',
  'scripts/test-timing-debug.ts',
  'scripts/test-buyer-output.ts',
  'scripts/test-company-exclusions.ts',
  'scripts/test-transcript-html.ts',
  'scripts/test-file-access.ts',
  'scripts/test-storage-mode.ts',
  'scripts/test-file-migration.ts',
  'scripts/test-file-move-log.ts',
  'scripts/test-serve-stored-file.ts',
  'scripts/test-approved-knowledge.ts',
  'evals/test-reply-checks.ts',
];

// No secrets, no database: unit tests must pass with a bare environment.
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PATH: process.env.PATH,
  SYSTEMROOT: process.env.SYSTEMROOT,
  HOME: process.env.HOME,
};
const verbose = process.argv.includes('--verbose');
const failures: string[] = [];

for (const script of SCRIPTS) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [TSX, script], { cwd: ROOT, env, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const ok = r.status === 0;
  const summary = out.trim().split('\n').filter(Boolean).at(-1) ?? '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${script}  (${Date.now() - t0} ms)  ${summary.slice(0, 80)}`);
  if (!ok || verbose) console.log(out);
  if (!ok) failures.push(script);
}

console.log(`\n${SCRIPTS.length - failures.length} of ${SCRIPTS.length} test scripts passed`);
if (failures.length > 0) process.exit(1);
