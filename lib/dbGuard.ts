/**
 * Local database guard.
 *
 * Outside production, refuse to start Prisma unless DATABASE_URL and
 * DIRECT_URL point at this machine. Prisma migrate uses DIRECT_URL, so both
 * are checked. This protects the shared production database from local dev
 * servers and from scripts run with `tsx --env-file=.env.local`.
 *
 * Production (NODE_ENV=production, which includes Vercel preview builds) is
 * not affected. To connect to a remote database on purpose, set
 * ALLOW_REMOTE_DB=1 for that one command.
 */
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class RemoteDatabaseBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteDatabaseBlockedError';
  }
}

type GuardEnv = Record<string, string | undefined>;

export function assertLocalDatabase(env: GuardEnv = process.env): void {
  if (env.NODE_ENV === 'production') return;
  if (env.ALLOW_REMOTE_DB?.trim() === '1') return;

  for (const key of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    const raw = env[key]?.trim().replace(/^["']|["']$/g, '');
    if (!raw) continue;
    let host: string;
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      throw new RemoteDatabaseBlockedError(
        `[db-guard] ${key} is not a valid URL. Fix .env / .env.local before starting.`,
      );
    }
    if (!LOCAL_DB_HOSTS.has(host)) {
      throw new RemoteDatabaseBlockedError(
        `[db-guard] ${key} points to "${host}", which is not a local database. ` +
          'Local development and scripts may only use localhost. ' +
          'Set ALLOW_REMOTE_DB=1 for one command only if you really mean to connect remotely.',
      );
    }
  }
}
