/**
 * Gate for the file-move maintenance route. Off everywhere unless the
 * deployment sets FILE_MIGRATION_ENABLED=true (exactly), and only for the
 * migration window. Applying needs an explicit apply=true (JSON body boolean
 * or ?apply=true); anything else is a dry run.
 */
export function fileMigrationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.FILE_MIGRATION_ENABLED?.trim() === 'true';
}

export function parseMigrationRequest(
  body: unknown,
  searchParams: URLSearchParams,
): { apply: boolean; limit: number | undefined } {
  const b = (body && typeof body === 'object' ? body : {}) as { apply?: unknown; limit?: unknown };
  const apply = b.apply === true || searchParams.get('apply') === 'true';
  const rawLimit = typeof b.limit === 'number' ? b.limit : Number(searchParams.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
  return { apply, limit };
}
