export const DEFAULT_ASSISTANT_NAME = 'Paramount Assistant';

export function assistantName(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.ASSISTANT_NAME?.trim() || DEFAULT_ASSISTANT_NAME;
}
