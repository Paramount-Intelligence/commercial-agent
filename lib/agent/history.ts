export const VERBATIM_HISTORY_TURNS = 10;
export const VERBATIM_HISTORY_MESSAGES = VERBATIM_HISTORY_TURNS * 2;

export function newestHistoryFirst<T extends { id: string }>(
  rows: T[],
  currentMessageId: string,
): T[] {
  return rows
    .filter((row) => row.id !== currentMessageId)
    .slice(0, VERBATIM_HISTORY_MESSAGES)
    .reverse();
}
