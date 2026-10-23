import { strict as assert } from 'node:assert';
import {
  buildVoiceBaselineBundle,
  percentile,
  summarizeVoiceBaseline,
  type VoiceInterruptionTiming,
  type VoiceSessionTiming,
} from '../lib/voice/baseline';
import type { VoiceTimingSummary } from '../lib/voice/turnTiming';

const session = (
  id: string,
  warm: boolean,
  micMs: number,
  fluxMs: number,
): VoiceSessionTiming => ({
  id,
  startedAt: '2026-10-23T00:00:00.000Z',
  warm,
  deviceLabel: 'test',
  runLabel: id,
  userAgent: 'test',
  viewport: '100x100@1',
  network: 'test',
  marks: {
    mounted: 0,
    micRequested: 10,
    micReady: 10 + micMs,
    fluxRequested: 20,
    fluxConnected: 20 + fluxMs,
  },
  meta: { sttProvider: 'deepgram-flux' },
});

const turn = (id: number, totalMs: number, provider: string): VoiceTimingSummary => ({
  id,
  outcome: 'spoke',
  totalMs,
  stagesMs: {},
  sinceSpeechEndMs: {},
  server: {},
  meta: { sttProvider: provider },
});

const interruption = (
  id: string,
  stopMs: number,
  confirmed: boolean,
): VoiceInterruptionTiming => ({
  id,
  source: 'flux-start',
  detectedAt: 0,
  stoppedAt: stopMs,
  confirmedAt: stopMs + 1,
  confirmed,
  stopMs,
});

assert.equal(percentile([], 95), null);
assert.equal(percentile([100, 200, 300], 50), 200);
assert.equal(percentile([100, 200, 300], 95), 290);

const sessions = [session('cold', false, 1_000, 300), session('warm', true, 300, 200)];
const turns = [turn(1, 900, 'deepgram-flux'), turn(2, 1_100, 'deepgram-flux')];
const interruptions = [interruption('ok', 120, true)];
const summary = summarizeVoiceBaseline(sessions, turns, interruptions);
assert.equal(summary.coldMicReady.p95, 1_000);
assert.equal(summary.warmMicReady.p95, 300);
assert.equal(summary.firstAudio.p50, 1_000);
assert.equal(summary.interruptionStop.p95, 120);
assert.equal(summary.fluxUsagePercent, 100);
assert.equal(summary.falseInterruptionPercent, 0);
assert(Object.values(summary.pass).every((value) => value === true));

const withFallback = summarizeVoiceBaseline(
  sessions,
  [...turns, turn(3, 900, 'fish-fallback')],
  [...interruptions, interruption('false', 100, false)],
);
assert.equal(withFallback.fluxUsagePercent, 66.7);
assert.equal(withFallback.falseInterruptionPercent, 50);
assert.equal(withFallback.pass.fluxUsage, false);
assert.equal(withFallback.pass.falseInterruptions, false);

const empty = summarizeVoiceBaseline([], [], []);
assert.equal(empty.firstAudio.p95, null);
assert.equal(empty.pass.firstAudioP95, null);

const bundle = buildVoiceBaselineBundle(sessions, turns, interruptions);
assert.equal(bundle.sessions.length, 2);
assert.equal(bundle.targets.interruptionStopP95Ms, 300);

console.log('ALL PASSED (voice baseline)');
