/**
 * Append-only CSV of paid API calls made by seed and eval scripts
 * (EVAL_OUT/api-calls.csv). One row per upstream request.
 */
import { appendFileSync, existsSync } from 'fs';
import { join } from 'path';
import { evalOut } from './paths';

export type ApiKind = 'openai-embedding' | 'agent-turn' | 'fish-stt' | 'fish-tts';

export function logApiCall(kind: ApiKind, items: number, note: string): void {
  const file = join(evalOut(), 'api-calls.csv');
  if (!existsSync(file)) appendFileSync(file, 'time,kind,items,note\n');
  appendFileSync(file, `${new Date().toISOString()},${kind},${items},"${note.replace(/"/g, "'")}"\n`);
}
