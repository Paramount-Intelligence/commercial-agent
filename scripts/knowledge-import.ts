/**
 * Post a knowledge bundle (npm run knowledge:bundle) to a deployment's gated
 * import route, signed in as an adviser admin. The deployment loads it into
 * its own database; this script never connects to a database.
 *
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run knowledge:import -- --url=https://<deployment> --bundle=<file>          (dry run)
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run knowledge:import -- --url=https://<deployment> --bundle=<file> --apply
 *
 * The route answers 404 unless that deployment has KNOWLEDGE_IMPORT_ENABLED=true.
 * Prints counts only.
 */
import { readFileSync } from 'fs';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

async function main() {
  const url = arg('url')?.replace(/\/$/, '');
  const bundlePath = arg('bundle');
  const apply = process.argv.includes('--apply');
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!url || !bundlePath) throw new Error('--url and --bundle are required');
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD');
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));

  const login = await fetch(`${url}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('adviser_admin_session='));
  if (login.status !== 200 || !cookie) throw new Error(`admin sign-in failed (${login.status})`);

  const res = await fetch(`${url}/api/admin/knowledge/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ apply, bundle }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  console.log(res.status, JSON.stringify(body));
  await fetch(`${url}/api/admin/auth/logout`, { method: 'POST', headers: { Cookie: cookie } }).catch(() => {});
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
