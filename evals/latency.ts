/**
 * Chat latency against a running dev server (EVAL_BASE_URL, default
 * http://localhost:3000), the same HTTP path the browser uses.
 *
 *   npm run eval:latency                               3 chat turns
 *   npm run eval:latency -- --turns=5 --ids=q26,q13
 *   npm run eval:latency -- --voice --audio-dir=<dir>  STT -> chat (voiceMode) -> first TTS chunk
 *   ... --server-log=<dev server log>                  count model calls from the server log
 *
 * Chat questions come from EVAL_DIR/golden-questions.yaml (--ids, default
 * q26,q13,q10). Voice uses q01.wav, q02.wav ... from --audio-dir. Each turn is
 * a new conversation. Authenticates as the seeded buyer (npm run seed:local).
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { logApiCall } from '../scripts/lib/apiLedger';
import { cleanVoiceText } from '../lib/citationText';
import { splitTextForTtsChunks } from '../lib/voice/ttsChunks';
import {
  arg,
  BASE_URL,
  chatTurn,
  connect,
  csvCell,
  flag,
  loadGolden,
  median,
  percentile,
  seedBuyerSession,
  serverLogCounter,
  writeReport,
} from './lib/common';

const VOICE = flag('voice');
const TURNS = Number(arg('turns', '3'));
const IDS = arg('ids', 'q26,q13,q10')!.split(',');
const AUDIO_DIR = arg('audio-dir', 'D:/Paramount Intelligence/Jackie Notes/audit/data/voice')!;

async function tts(cookie: string, text: string) {
  const t0 = performance.now();
  const res = await fetch(`${BASE_URL}/api/voice/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ text }),
  });
  const reader = res.body!.getReader();
  let first = -1;
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
    if (first < 0) first = performance.now() - t0;
  }
  return { status: res.status, firstByteMs: Math.round(first), fullMs: Math.round(performance.now() - t0) };
}

async function stt(cookie: string, wavPath: string) {
  const wav = readFileSync(wavPath);
  const seconds = (wav.length - 44) / (wav.readUInt32LE(24) * 2);
  const form = new FormData();
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
  form.append('durationSeconds', String(Math.round(seconds * 10) / 10));
  const t0 = performance.now();
  const res = await fetch(`${BASE_URL}/api/voice/stt`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  const json = (await res.json().catch(() => ({}))) as { text?: string };
  return { status: res.status, ms: Math.round(performance.now() - t0), text: json.text ?? '', seconds };
}

async function main() {
  const { prisma, target } = await connect();
  const { cookie, sessionId } = await seedBuyerSession(prisma);
  const countCalls = serverLogCounter(arg('server-log'));
  const golden = new Map(loadGolden().map((g) => [g.id, g]));

  const rows: string[] = [];
  const totals: number[] = [];
  const firstAudio: number[] = [];
  try {
    if (!VOICE) {
      rows.push('n,id,status,ms_total,server_total,phases,reply_chars,cited_cases,error');
      for (let i = 0; i < TURNS; i++) {
        const g = golden.get(IDS[i % IDS.length]);
        if (!g) throw new Error(`Unknown golden id ${IDS[i % IDS.length]}`);
        const c = await chatTurn(cookie, g.q);
        logApiCall('agent-turn', 1, `eval:latency chat ${g.id}`);
        totals.push(c.ms);
        rows.push([i + 1, g.id, c.status, c.ms, c.timingMs.total ?? '', csvCell(JSON.stringify(c.timingMs)), c.reply.length, c.citedCases.length, csvCell(c.error)].join(','));
        console.log(`${i + 1}. ${g.id} ${c.status} ${c.ms} ms, ${c.citedCases.length} case card(s)${c.error ? ` ERROR ${c.error}` : ''}`);
      }
    } else {
      rows.push('n,audio,stt_status,stt_ms,audio_s,chat_status,chat_ms,tts_first_byte_ms,tts_full_ms,est_first_audio_ms,error');
      for (let i = 0; i < TURNS; i++) {
        const wavPath = join(AUDIO_DIR, `q${String(i + 1).padStart(2, '0')}.wav`);
        if (!existsSync(wavPath)) throw new Error(`Missing ${wavPath}`);
        const s = await stt(cookie, wavPath);
        logApiCall('fish-stt', 1, `eval:latency voice ${i + 1}`);
        const c = s.text ? await chatTurn(cookie, s.text, true) : null;
        if (c) logApiCall('agent-turn', 1, `eval:latency voice ${i + 1}`);
        const chunk = c ? splitTextForTtsChunks(cleanVoiceText(c.reply))[0] : undefined;
        const t = chunk ? await tts(cookie, chunk) : null;
        if (t) logApiCall('fish-tts', 1, `eval:latency voice ${i + 1}`);
        const est = t && c ? s.ms + c.ms + t.firstByteMs : NaN;
        if (Number.isFinite(est)) firstAudio.push(est);
        if (c) totals.push(c.ms);
        rows.push([i + 1, `q${i + 1}`, s.status, s.ms, s.seconds.toFixed(1), c?.status ?? '', c?.ms ?? '', t?.firstByteMs ?? '', t?.fullMs ?? '', Number.isFinite(est) ? est : '', csvCell(c?.error ?? (s.text ? '' : 'empty transcript'))].join(','));
        console.log(`${i + 1}. stt ${s.ms} ms, chat ${c?.ms ?? '-'} ms, tts first byte ${t?.firstByteMs ?? '-'} ms, first audio ~${Number.isFinite(est) ? est : '-'} ms`);
      }
    }
  } finally {
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
    await prisma.$disconnect();
  }

  const calls = countCalls();
  const md = [
    `# ${VOICE ? 'Voice' : 'Chat'} latency (${new Date().toISOString().slice(0, 16)}Z)`,
    '',
    `Server: ${BASE_URL}. Database: ${target}. Turns: ${TURNS}, each a new conversation.`,
    `Model calls (from server log): ${calls ?? 'not counted (pass --server-log)'}.`,
    '',
    `Chat round trip: median ${Math.round(median(totals))} ms, p95 ${Math.round(percentile(totals, 95))} ms, max ${Math.max(...totals)} ms.`,
    VOICE ? `Estimated time to first audio (STT + chat + first TTS byte): median ${Math.round(median(firstAudio))} ms.` : '',
    '',
    'Per-turn rows are in the CSV next to this report.',
  ].join('\n');
  console.log(`\n${md}\nReport: ${writeReport(VOICE ? 'latency-voice' : 'latency-chat', md, rows.join('\n'))}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
