'use client';

import { DeepgramClient } from '@deepgram/sdk';
import { DEEPGRAM_FLUX_CONFIG } from './deepgramConfig';

type ListenV2TurnInfo = {
  type: 'TurnInfo';
  event: string;
  transcript: string;
  turn_index: number;
  audio_window_start: number;
  audio_window_end: number;
  end_of_turn_confidence: number;
};

export type FluxTurnEvent = {
  event: string;
  transcript: string;
  turnIndex: number;
  audioStart: number;
  audioEnd: number;
  confidence: number;
};

export type FluxCallbacks = {
  onTurn: (event: FluxTurnEvent) => void;
  onError: (error: Error) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

export type FluxBrowserSession = {
  close: () => void;
  ready: Promise<void>;
};

function floatToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

async function fetchToken(signal: AbortSignal): Promise<string> {
  const response = await fetch('/api/voice/deepgram-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
  });
  const body = (await response.json().catch(() => ({}))) as {
    accessToken?: string;
    error?: string;
  };
  if (!response.ok || !body.accessToken) {
    throw new Error(body.error || 'Could not start live listening.');
  }
  return body.accessToken;
}

/**
 * Open Flux directly from the browser. The API key remains server-side; only
 * a short-lived grant is used for the WebSocket handshake.
 */
export function openFluxBrowserSession(
  stream: MediaStream,
  callbacks: FluxCallbacks,
  opts: { eager?: boolean } = {},
): FluxBrowserSession {
  const abort = new AbortController();
  let context: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let worklet: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let silent: GainNode | null = null;
  let connection: Awaited<
    ReturnType<DeepgramClient['listen']['v2']['connect']>
  > | null = null;
  let connectionOpen = false;
  let closed = false;
  let pending: number[] = [];

  const close = () => {
    if (closed) return;
    closed = true;
    abort.abort();
    if (processor) processor.onaudioprocess = null;
    if (worklet) worklet.port.onmessage = null;
    try { processor?.disconnect(); } catch { /* no-op */ }
    try { worklet?.disconnect(); } catch { /* no-op */ }
    try { source?.disconnect(); } catch { /* no-op */ }
    try { silent?.disconnect(); } catch { /* no-op */ }
    connection?.close();
    void context?.close().catch(() => {});
    processor = null;
    worklet = null;
    source = null;
    silent = null;
    connection = null;
    connectionOpen = false;
    context = null;
    pending = [];
  };

  const ready = (async () => {
    try {
      // Token minting is independent of browser audio setup. Start it now and
      // establish capture while the network request is in flight; we still do
      // not await/connect Flux until buffered capture is active.
      const accessTokenPromise = fetchToken(abort.signal);
      context = new AudioContext({ sampleRate: 16_000 });
      await context.resume();
      const sampleRate = context.sampleRate;
      const frameSamples = Math.max(
        1,
        Math.round((sampleRate * DEEPGRAM_FLUX_CONFIG.frameMs) / 1_000),
      );
      const maxPendingSamples = sampleRate * 10;

      const drainFrames = () => {
        if (closed || !connection || !connectionOpen) return;
        while (pending.length >= frameSamples) {
          const frame = pending.splice(0, frameSamples);
          try {
            connection.sendMedia(floatToPcm16(Float32Array.from(frame)));
          } catch (error) {
            callbacks.onError(
              error instanceof Error ? error : new Error(String(error)),
            );
            return;
          }
        }
      };

      const forwardSamples = (samples: Float32Array) => {
        if (closed) return;
        pending.push(...samples);
        if (pending.length > maxPendingSamples) {
          pending.splice(0, pending.length - maxPendingSamples);
        }
        drainFrames();
      };

      source = context.createMediaStreamSource(stream);
      silent = context.createGain();
      silent.gain.value = 0;
      // AudioWorklet keeps capture off the main thread. Retain the deprecated
      // ScriptProcessor only as a compatibility path for older browsers.
      if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        try {
          await context.audioWorklet.addModule('/voice/pcm-capture-worklet.js');
          if (closed || !context) return;
          worklet = new AudioWorkletNode(context, 'pcm-capture-processor');
          worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
            if (event.data instanceof Float32Array) forwardSamples(event.data);
          };
          source.connect(worklet);
          worklet.connect(silent);
        } catch (error) {
          console.warn('[voice/flux] AudioWorklet unavailable; using compatibility capture', {
            name: error instanceof Error ? error.name : 'unknown',
          });
        }
      }
      if (!worklet) {
        processor = context.createScriptProcessor(1024, 1, 1);
        processor.onaudioprocess = (event) => {
          forwardSamples(event.inputBuffer.getChannelData(0));
        };
        source.connect(processor);
        processor.connect(silent);
      }
      silent.connect(context.destination);

      const accessToken = await accessTokenPromise;
      if (closed) return;
      const client = new DeepgramClient({ accessToken });
      connection = await client.listen.v2.connect({
        model: DEEPGRAM_FLUX_CONFIG.model,
        encoding: 'linear16',
        sample_rate: sampleRate as 8000 | 16000 | 24000 | 44100 | 48000,
        eot_threshold: DEEPGRAM_FLUX_CONFIG.eotThreshold,
        eot_timeout_ms: DEEPGRAM_FLUX_CONFIG.eotTimeoutMs,
        ...(opts.eager
          ? { eager_eot_threshold: DEEPGRAM_FLUX_CONFIG.eagerEotThreshold }
          : {}),
        keyterm: ['Paramount Intelligence', 'Ali Azzam', 'Bykea'],
        reconnectAttempts: 0,
        abortSignal: abort.signal,
      });
      connection.on('message', (message) => {
        if (message.type !== 'TurnInfo') return;
        const turn = message as ListenV2TurnInfo;
        callbacks.onTurn({
          event: turn.event,
          transcript: turn.transcript?.trim() ?? '',
          turnIndex: turn.turn_index,
          audioStart: turn.audio_window_start,
          audioEnd: turn.audio_window_end,
          confidence: turn.end_of_turn_confidence,
        });
      });
      connection.on('error', callbacks.onError);
      connection.on('close', () => {
        connectionOpen = false;
        if (!closed) callbacks.onClose?.();
      });
      connection.on('open', () => {
        connectionOpen = true;
        drainFrames();
        callbacks.onOpen?.();
      });
      connection.connect();
      await connection.waitForOpen();
      if (closed || !context || !connection) return;
      drainFrames();
    } catch (error) {
      if (closed || abort.signal.aborted) return;
      close();
      callbacks.onError(
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  })();

  return { close, ready };
}
