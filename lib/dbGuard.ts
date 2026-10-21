/**
 * Database guard.
 *
 * Outside production, refuse to start Prisma unless DATABASE_URL and
 * DIRECT_URL point at this machine, or at the staging database on purpose.
 * Prisma migrate uses DIRECT_URL, so both are checked. This protects the
 * shared production database from local dev servers and from scripts run
 * with `tsx --env-file=.env.local`.
 *
 * A remote URL is allowed only when DB_TARGET=staging AND the SHA-256 of the
 * URL is listed in STAGING_DB_FINGERPRINT (comma-separated, one per distinct
 * URL; both live in .env.staging, see `npm run db:fingerprint`). A production
 * URL can never match a staging fingerprint.
 *
 * The Vercel runtime (NODE_ENV=production, which includes preview builds) is
 * not affected. Seed and eval scripts pass { strict: true }, which ignores
 * NODE_ENV so they can never write to production by setting it.
 */
import { createHash } from 'crypto';

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class RemoteDatabaseBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteDatabaseBlockedError';
  }
}

type GuardEnv = Record<string, string | undefined>;

export type DatabaseTarget = 'local' | 'staging';

function cleanUrl(raw: string | undefined): string | undefined {
  const v = raw?.trim().replace(/^["']|["']$/g, '');
  return v || undefined;
}

/** Hex SHA-256 of a connection string (trimmed, surrounding quotes removed). */
export function databaseFingerprint(url: string): string {
  return createHash('sha256').update(cleanUrl(url) ?? '').digest('hex');
}

function stagingFingerprints(env: GuardEnv): Set<string> {
  return new Set(
    (env.STAGING_DB_FINGERPRINT ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[0-9a-f]{64}$/.test(s)),
  );
}

/**
 * Throws RemoteDatabaseBlockedError unless every configured URL is local or a
 * fingerprinted staging URL. Returns which kind of database this is.
 */
export function assertLocalDatabase(
  env: GuardEnv = process.env,
  opts: { strict?: boolean } = {},
): DatabaseTarget {
  if (!opts.strict && env.NODE_ENV === 'production') return 'local';

  let target: DatabaseTarget = 'local';
  for (const key of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    const raw = cleanUrl(env[key]);
    if (!raw) continue;
    let host: string;
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      throw new RemoteDatabaseBlockedError(
        `[db-guard] ${key} is not a valid URL. Fix .env / .env.local before starting.`,
      );
    }
    if (LOCAL_DB_HOSTS.has(host)) continue;

    if (env.DB_TARGET?.trim() !== 'staging') {
      throw new RemoteDatabaseBlockedError(
        `[db-guard] ${key} points to "${host}", which is not a local database. ` +
          'Local development and scripts may only use localhost. ' +
          'The staging database needs DB_TARGET=staging and STAGING_DB_FINGERPRINT (.env.staging).',
      );
    }
    if (!stagingFingerprints(env).has(databaseFingerprint(raw))) {
      throw new RemoteDatabaseBlockedError(
        `[db-guard] ${key} points to "${host}" but does not match STAGING_DB_FINGERPRINT. ` +
          'Only the staging database may be used remotely. Run npm run db:fingerprint to check .env.staging.',
      );
    }
    target = 'staging';
  }
  return target;
}
