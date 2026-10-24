/** Decode raw signed 16-bit little-endian PCM from Fish into Web Audio samples. */
export function pcm16LeToFloat32(bytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const output = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 32_768;
  }
  return output;
}

/** Byte count for a short PCM startup buffer. */
export function pcmBufferBytes(sampleRate: number, milliseconds: number): number {
  return Math.max(2, Math.round(sampleRate * 2 * (milliseconds / 1_000)));
}
