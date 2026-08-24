/**
 * Browser helpers to prepare MediaRecorder blobs for Fish Audio ASR.
 *
 * Chrome records `audio/webm;codecs=opus`. Fish ASR accepts wav/mp3/opus but
 * often rejects WebM containers ("format not recognised"). Decode via
 * Web Audio and re-encode as PCM WAV before upload.
 */

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

/** Encode an AudioBuffer as 16-bit mono/stereo PCM WAV. */
export function encodeWav(audioBuffer: AudioBuffer): Blob {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i] ?? 0));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function needsWavConversion(mimeType: string): boolean {
  const m = mimeType.toLowerCase();
  if (!m || m === 'application/octet-stream') return true;
  if (m.includes('wav') || m.includes('mpeg') || m.includes('mp3')) return false;
  // WebM (Chrome) and unknown containers — Fish ASR rejects these.
  return true;
}

/**
 * Return a Fish-ASR-friendly blob + filename.
 * Leaves wav/mp3 alone; converts webm/ogg/mp4 (and unknowns) to WAV.
 */
export async function prepareAudioForFishAsr(
  blob: Blob,
): Promise<{ blob: Blob; filename: string; mimeType: string }> {
  const sourceType = blob.type || 'application/octet-stream';
  if (!needsWavConversion(sourceType)) {
    const ext = sourceType.includes('mp3') || sourceType.includes('mpeg')
      ? 'mp3'
      : 'wav';
    return {
      blob,
      filename: `recording.${ext}`,
      mimeType: blob.type || (ext === 'mp3' ? 'audio/mpeg' : 'audio/wav'),
    };
  }

  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) {
    // Last resort: send original (will likely fail on Fish for webm).
    return {
      blob,
      filename: 'recording.webm',
      mimeType: sourceType,
    };
  }

  const ctx = new AudioContextCtor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    // decodeAudioData may detach the buffer; pass a copy.
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const wav = encodeWav(audioBuffer);
    return { blob: wav, filename: 'recording.wav', mimeType: 'audio/wav' };
  } finally {
    await ctx.close().catch(() => {});
  }
}
