/**
 * Quick unit checks for TTS chunk splitting (no Fish / no DB).
 *   npx tsx scripts/test-tts-chunks.ts
 */
import { VOICE_CONFIG } from '../lib/voice/config';
import { splitTextForTtsChunks } from '../lib/voice/ttsChunks';

function check(label: string, ok: boolean, detail?: string) {
  if (!ok) {
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS  ${label}`);
}

const short = 'Hello Jackie.';
check('short stays one chunk', splitTextForTtsChunks(short).length === 1);

const long = Array.from({ length: 40 }, (_, i) => {
  return `This is sentence number ${i + 1} about Paramount Intelligence case work and delivery.`;
}).join(' ');

const chunks = splitTextForTtsChunks(long);
check('long splits into multiple chunks', chunks.length > 1, `n=${chunks.length}`);
check(
  'every chunk within max',
  chunks.every((c) => c.length <= VOICE_CONFIG.MAX_CHARS_PER_REQUEST),
  chunks.map((c) => c.length).join(','),
);
check(
  'rejoined covers full meaning (no dropped words)',
  chunks.join(' ').replace(/\s+/g, ' ') === long.replace(/\s+/g, ' '),
);

console.log('\n========================================');
console.log(process.exitCode ? 'FAILED' : `ALL PASSED (${3 + 1})`);
