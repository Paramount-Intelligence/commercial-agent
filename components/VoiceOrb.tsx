'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { AgentState } from '@/components/voice/ElevenLabsOrb';

const DynamicElevenLabsOrb = dynamic(
  () => import('@/components/voice/ElevenLabsOrb').then((module) => module.ElevenLabsOrb),
  { ssr: false },
);

export type VoiceOrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

type Props = {
  state: VoiceOrbState;
  microphoneLevel?: number;
  outputLevel?: number;
  size?: number;
  className?: string;
};

function webGlAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function mapAgentState(state: VoiceOrbState): AgentState {
  if (state === 'listening') return 'listening';
  if (state === 'thinking') return 'thinking';
  if (state === 'speaking') return 'talking';
  return null;
}

export default function VoiceOrb({
  state,
  microphoneLevel = 0,
  outputLevel = 0,
  size = 260,
  className,
}: Props) {
  const inputRef = useRef(microphoneLevel);
  const outputRef = useRef(outputLevel);
  const [useFallback, setUseFallback] = useState(true);
  const [orbReady, setOrbReady] = useState(false);
  inputRef.current = microphoneLevel;
  outputRef.current = outputLevel;
  const getInputVolume = useCallback(() => inputRef.current, []);
  const getOutputVolume = useCallback(() => outputRef.current, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      const fallback = media.matches || !webGlAvailable();
      setUseFallback(fallback);
      if (fallback) setOrbReady(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return (
    <div
      className={cn('voice-gradient-orb voice-orb-enter', (!orbReady || useFallback) && 'is-fallback', orbReady && 'is-ready', className)}
      style={{ '--orb-size': `${size}px` } as CSSProperties}
      role="img"
      aria-label="Voice conversation"
      data-agent-state={mapAgentState(state) ?? 'idle'}
    >
      {!useFallback ? (
        <DynamicElevenLabsOrb
          className="voice-elevenlabs-orb"
          colors={['#CFE3FF', '#1E6FD9']}
          seed={23}
          agentState={mapAgentState(state)}
          volumeMode="manual"
          getInputVolume={getInputVolume}
          getOutputVolume={getOutputVolume}
          onReady={() => setOrbReady(true)}
        />
      ) : null}
      <span className="voice-gradient-orb-fallback" aria-hidden="true" />
    </div>
  );
}
