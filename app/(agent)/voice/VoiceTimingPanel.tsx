'use client';

/**
 * Latency debug panel for /voice. Mounted only for an admin session or
 * TIMING_DEBUG=1 (see app/(agent)/voice/page.tsx), and then shown only with
 * ?debug=1 in the URL.
 * Diagnostic only: listens for `voice-timing` events from lib/voice/turnTiming.
 */
import { useEffect, useState } from 'react';
import {
  timingsToCsv,
  VOICE_TIMING_EVENT,
  type VoiceTimingSummary,
} from '@/lib/voice/turnTiming';
import {
  buildVoiceBaselineBundle,
  VOICE_BASELINE_EVENT,
  type VoiceInterruptionTiming,
  type VoiceSessionTiming,
} from '@/lib/voice/baseline';

const STAGE_LABELS: Record<string, string> = {
  endOfSpeechWindow: 'End-of-speech wait',
  wavEncode: 'WAV encode',
  sttRoundTrip: 'Speech to text',
  chatToFirstStage: 'Chat first event',
  chatRoundTrip: 'Chat reply (total)',
  ttsFirstResponse: 'TTS first response',
  playbackStart: 'Playback start',
};

function fmt(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? '-' : `${(ms / 1000).toFixed(2)} s`;
}

export default function VoiceTimingPanel() {
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<VoiceTimingSummary[]>([]);
  const [sessions, setSessions] = useState<VoiceSessionTiming[]>([]);
  const [interruptions, setInterruptions] = useState<VoiceInterruptionTiming[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEnabled(new URLSearchParams(window.location.search).get('debug') === '1');
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setRows([...(window.__voiceTimings ?? [])]);
    const refreshBaseline = () => {
      setSessions([...(window.__voiceSessions ?? [])]);
      setInterruptions([...(window.__voiceInterruptions ?? [])]);
    };
    refreshBaseline();
    const onTiming = (event: Event) => {
      const detail = (event as CustomEvent<VoiceTimingSummary>).detail;
      if (detail) setRows((current) => [...current, detail]);
    };
    window.addEventListener(VOICE_TIMING_EVENT, onTiming);
    window.addEventListener(VOICE_BASELINE_EVENT, refreshBaseline);
    return () => {
      window.removeEventListener(VOICE_TIMING_EVENT, onTiming);
      window.removeEventListener(VOICE_BASELINE_EVENT, refreshBaseline);
    };
  }, [enabled]);

  if (!enabled) return null;
  const last = rows[rows.length - 1];
  const spoken = rows.filter((r) => r.totalMs !== null).map((r) => r.totalMs!);
  const sorted = [...spoken].sort((a, b) => a - b);
  const median = sorted.length
    ? sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : null;
  const worst = sorted.length ? sorted[sorted.length - 1] : null;
  const bundle = buildVoiceBaselineBundle(sessions, rows, interruptions);
  const summary = bundle.summary;

  return (
    <aside
      aria-label="Voice latency debug"
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 70,
        width: 320,
        padding: '10px 12px',
        borderRadius: 10,
        background: 'rgba(6, 13, 26, 0.92)',
        border: '1px solid rgba(30, 111, 217, 0.4)',
        color: '#d4e0f0',
        font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong>Latency</strong>
        <span>
          {spoken.length} turns · median {fmt(median)} · worst {fmt(worst)}
        </span>
      </div>
      {last ? (
        <>
          <div style={{ marginBottom: 4 }}>
            Turn {last.id} ({last.outcome}): <strong>{fmt(last.totalMs)}</strong>
          </div>
          {Object.entries(last.stagesMs).map(([key, ms]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{STAGE_LABELS[key] ?? key}</span>
              <span>{fmt(ms)}</span>
            </div>
          ))}
        </>
      ) : (
        <div>Speak a question to record a turn.</div>
      )}
      <div style={{ borderTop: '1px solid rgba(107, 168, 255, 0.24)', marginTop: 7, paddingTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Cold mic p50 / p95</span>
          <span>{fmt(summary.coldMicReady.p50)} / {fmt(summary.coldMicReady.p95)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Warm mic p50 / p95</span>
          <span>{fmt(summary.warmMicReady.p50)} / {fmt(summary.warmMicReady.p95)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Flux connect p50 / p95</span>
          <span>{fmt(summary.fluxConnect.p50)} / {fmt(summary.fluxConnect.p95)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>First audio p50 / p95</span>
          <span>{fmt(summary.firstAudio.p50)} / {fmt(summary.firstAudio.p95)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Interrupt stop p50 / p95</span>
          <span>{fmt(summary.interruptionStop.p50)} / {fmt(summary.interruptionStop.p95)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Flux / false interruption</span>
          <span>
            {summary.fluxUsagePercent ?? '-'}% / {summary.falseInterruptionPercent ?? '-'}%
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            .writeText(timingsToCsv(rows))
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {});
        }}
        disabled={rows.length === 0}
        style={{
          marginTop: 8,
          width: '100%',
          padding: '4px 0',
          borderRadius: 6,
          border: '1px solid rgba(107, 168, 255, 0.5)',
          background: 'transparent',
          color: '#6ba8ff',
          cursor: rows.length ? 'pointer' : 'default',
        }}
      >
        {copied ? 'Copied' : 'Copy all turns as CSV'}
      </button>
      <button
        type="button"
        onClick={() => {
          const json = JSON.stringify(bundle, null, 2);
          const url = URL.createObjectURL(
            new Blob([json], { type: 'application/json' }),
          );
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `voice-baseline-${Date.now()}.json`;
          anchor.click();
          URL.revokeObjectURL(url);
        }}
        style={{
          marginTop: 6,
          width: '100%',
          padding: '4px 0',
          borderRadius: 6,
          border: '1px solid rgba(107, 168, 255, 0.5)',
          background: 'transparent',
          color: '#6ba8ff',
          cursor: 'pointer',
        }}
      >
        Download baseline JSON
      </button>
    </aside>
  );
}
