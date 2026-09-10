// PCM WAV is understood by macOS Speech and the optional API transcription service.
export function monoWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  if (
    !channels.length ||
    !Number.isInteger(sampleRate) ||
    sampleRate <= 0 ||
    channels.some((c) => c.length !== channels[0].length)
  )
    throw new Error('Invalid recording format.');
  const frames = channels[0].length;
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const word = (offset: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  word(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  word(8, 'WAVE');
  word(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    const sample = Math.max(-1, Math.min(1, channels.reduce((sum, c) => sum + c[i], 0) / channels.length));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}
