/**
 * Merge browser-exported Phase 4A voice baseline bundles into one report.
 *
 * npm run eval:voice-baseline -- path/to/run-1.json path/to/run-2.json
 */
import { readFileSync } from 'node:fs';
import {
  buildVoiceBaselineBundle,
  type VoiceBaselineBundle,
} from '../lib/voice/baseline';
import { writeReport } from '../evals/lib/common';

const paths = process.argv.slice(2).filter((value) => !value.startsWith('--'));
if (!paths.length) {
  console.error('Pass one or more voice-baseline-*.json files.');
  process.exit(1);
}

const bundles = paths.map((path) =>
  JSON.parse(readFileSync(path, 'utf8')) as VoiceBaselineBundle,
);
const merged = buildVoiceBaselineBundle(
  bundles.flatMap((bundle) => bundle.sessions ?? []),
  bundles.flatMap((bundle) => bundle.turns ?? []),
  bundles.flatMap((bundle) => bundle.interruptions ?? []),
);

const { summary, targets } = merged;
const mark = (value: boolean | null) =>
  value === null ? 'NEEDS DATA' : value ? 'PASS' : 'FAIL';
const ms = (value: number | null) => (value === null ? '-' : Math.round(value));
const rows = [
  ['Cold mic ready p95', summary.coldMicReady.count, ms(summary.coldMicReady.p50), ms(summary.coldMicReady.p95), targets.coldMicReadyP95Ms, mark(summary.pass.coldMicReady)],
  ['Warm mic ready p95', summary.warmMicReady.count, ms(summary.warmMicReady.p50), ms(summary.warmMicReady.p95), targets.warmMicReadyP95Ms, mark(summary.pass.warmMicReady)],
  ['First meaningful audio p50', summary.firstAudio.count, ms(summary.firstAudio.p50), ms(summary.firstAudio.p95), targets.firstAudioP50Ms, mark(summary.pass.firstAudioP50)],
  ['First meaningful audio p95', summary.firstAudio.count, ms(summary.firstAudio.p50), ms(summary.firstAudio.p95), targets.firstAudioP95Ms, mark(summary.pass.firstAudioP95)],
  ['Interruption stop p95', summary.interruptionStop.count, ms(summary.interruptionStop.p50), ms(summary.interruptionStop.p95), targets.interruptionStopP95Ms, mark(summary.pass.interruptionStop)],
];

const markdown = [
  '# Phase 4A voice baseline',
  '',
  `Generated: ${merged.exportedAt}. Input files: ${paths.length}. Sessions: ${merged.sessions.length}. Turns: ${merged.turns.length}. Interruptions: ${merged.interruptions.length}.`,
  '',
  '| Metric | n | p50 ms | p95 ms | target ms | result |',
  '|---|---:|---:|---:|---:|---|',
  ...rows.map((row) => `| ${row.join(' | ')} |`),
  '',
  `- Flux turn usage: ${summary.fluxUsagePercent ?? '-'}% (target ≥${targets.fluxUsagePercent}%): ${mark(summary.pass.fluxUsage)}.`,
  `- False interruption rate: ${summary.falseInterruptionPercent ?? '-'}% (target ≤${targets.falseInterruptionPercent}%): ${mark(summary.pass.falseInterruptions)}.`,
  `- Flux connection: p50 ${ms(summary.fluxConnect.p50)} ms; p95 ${ms(summary.fluxConnect.p95)} ms; n=${summary.fluxConnect.count}.`,
  '',
  '## Device runs',
  '',
  '| Started | device | run | warm | viewport | network | provider | fallback |',
  '|---|---|---|---|---|---|---|---|',
  ...merged.sessions.map((session) =>
    `| ${session.startedAt} | ${session.deviceLabel} | ${session.runLabel} | ${session.warm} | ${session.viewport} | ${session.network} | ${session.meta.sttProvider ?? '-'} | ${session.meta.sttFallbackUsed ?? false} |`,
  ),
  '',
  'A release decision requires data from every device in the Phase 4A checklist. “NEEDS DATA” is not a pass.',
].join('\n');

const report = writeReport('phase4a-voice-baseline', markdown);
console.log(markdown);
console.log(`\nReport: ${report}`);
