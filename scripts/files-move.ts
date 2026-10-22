/**
 * Drive the gated file-move routes (/api/admin/maintenance/files/...) on a
 * deployment, signed in as an adviser admin. The deployment moves its own
 * files; this script never connects to a database or a store.
 *
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run files:move -- --url=https://<deployment> --export
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run files:move -- --url=https://<deployment>                  (dry run)
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run files:move -- --url=https://<deployment> --apply          (until remaining is 0)
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run files:move -- --url=https://<deployment> --restore=<export file> [--apply]
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run files:move -- --url=https://<deployment> --delete-old [--apply]
 *
 * Lead PDF repair:
 *   npm run files:move -- --url=https://<deployment> --lead-pdfs [--apply]
 *
 * The routes answer 404 unless that deployment has FILE_MIGRATION_ENABLED=true.
 * Prints HTTP status and counts only: never URLs, file names or personal data.
 * Exports are saved outside the repo (FILE_EXPORT_DIR, default Jackie Notes\release1).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import { REPO_ROOT } from './lib/paths';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const flag = (name: string) => process.argv.includes(`--${name}`);
const EXPORT_DIR = process.env.FILE_EXPORT_DIR || 'D:/Paramount Intelligence/Jackie Notes/release1';
const TABLES = ['CaseAsset', 'KnowledgeEntry', 'Lead', 'Conversation'] as const;

type Json = Record<string, unknown>;

class Stop extends Error {}

async function main() {
  const url = arg('url')?.replace(/\/$/, '');
  const apply = flag('apply');
  const restoreFile = arg('restore');
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!url) throw new Error('--url is required');
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD');
  const modes = [flag('export'), restoreFile !== undefined, flag('delete-old'), flag('lead-pdfs')].filter(Boolean).length;
  if (modes > 1) throw new Error('Use one of --export, --restore=<file>, --delete-old, --lead-pdfs');
  if (flag('export') && apply) throw new Error('--export is read-only; drop --apply');

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

  const call = async (path: string, method: 'GET' | 'POST', body?: unknown) => {
    const res = await fetch(`${url}/api/admin/maintenance/files${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: Json = {};
    try {
      json = JSON.parse(text) as Json;
    } catch {
      // non-JSON error page: status only
    }
    if (!res.ok) {
      // Error bodies from these routes are fixed messages (no URLs); 404 means the flag is off.
      console.log(res.status, typeof json.error === 'string' && res.status !== 500 ? json.error : '');
      throw new Stop();
    }
    return { status: res.status, json };
  };

  try {
    if (flag('export')) {
      const { status, json } = await call('/export', 'GET');
      const counts = Object.fromEntries(TABLES.map((t) => [t, Array.isArray(json[t]) ? (json[t] as unknown[]).length : 0]));
      const out = resolve(EXPORT_DIR, `file-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      const rel = relative(REPO_ROOT, out);
      if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('The export must be saved outside the repo.');
      mkdirSync(EXPORT_DIR, { recursive: true });
      writeFileSync(out, JSON.stringify(json, null, 1));
      console.log(status, JSON.stringify(counts));
      console.log('saved export (outside the repo):', out);
    } else if (restoreFile !== undefined) {
      const data = JSON.parse(readFileSync(restoreFile, 'utf8')) as Json;
      const { status, json } = await call('/restore', 'POST', { apply, data });
      const { apply: applied, counts, rejectedHost, rejectedId, malformed } = json;
      console.log(status, JSON.stringify({ apply: applied, counts, rejectedHost, rejectedId, malformed }));
    } else if (flag('delete-old')) {
      for (let batch = 1; ; batch++) {
        const { status, json } = await call('/delete-old', 'POST', { apply });
        const { apply: applied, deleted, keptInUse, failed, pending } = json;
        console.log(status, apply ? `batch ${batch}` : 'dry run', JSON.stringify({ apply: applied, deleted, keptInUse, failed, pending }));
        if (!apply || pending === 0) break;
        if (failed !== 0 || deleted === 0) throw new Error('delete-old stopped: a batch failed or made no progress');
      }
    } else if (flag('lead-pdfs')) {
      let last = Infinity;
      for (let batch = 1; ; batch++) {
        const { status, json } = await call('', 'POST', { apply, leadPdfs: true });
        const { apply: applied, access, mode, counts, remaining } = json as Json & {
          counts: { regenerated?: number; cleared?: number; failed?: number };
          remaining: number;
        };
        console.log(status, apply ? `batch ${batch}` : 'dry run', JSON.stringify({ apply: applied, access, mode, counts, remaining }));
        if (!apply || remaining === 0) break;
        if ((counts?.failed ?? 0) > 0) throw new Error('lead-pdfs stopped: a repair failed');
        if (!(remaining < last)) throw new Error('lead-pdfs stopped: remaining did not go down');
        last = remaining;
      }
    } else {
      let last = Infinity;
      for (let batch = 1; ; batch++) {
        const { status, json } = await call('', 'POST', { apply });
        const { apply: applied, access, mode, counts, remaining } = json as Json & { counts: Record<string, number>; remaining: number };
        console.log(status, apply ? `batch ${batch}` : 'dry run', JSON.stringify({ apply: applied, access, mode, counts, remaining }));
        if (!apply || remaining === 0) break;
        // A missing old file stays legacy and would come back in every batch.
        const missing = Object.entries(counts ?? {}).filter(([k]) => k.endsWith(':skip-missing'));
        if (missing.length) throw new Error(`move stopped: missing old files ${JSON.stringify(Object.fromEntries(missing))}`);
        if (!(remaining < last)) throw new Error('move stopped: remaining did not go down');
        last = remaining;
      }
    }
  } finally {
    await fetch(`${url}/api/admin/auth/logout`, { method: 'POST', headers: { Cookie: cookie } }).catch(() => {});
  }
}

main().catch((e) => {
  if (!(e instanceof Stop)) console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
