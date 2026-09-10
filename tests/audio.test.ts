import assert from 'node:assert/strict';
import test from 'node:test';
import { monoWav } from '../src/lib/audio';
test('microphone recordings become a valid mono PCM WAV for macOS transcription', () => {
  const audio = monoWav([new Float32Array([-1, 0, 1]), new Float32Array([-1, 1, 1])], 48000);
  const bytes = new DataView(audio);
  assert.equal(new TextDecoder().decode(audio.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(audio.slice(8, 12)), 'WAVE');
  assert.equal(bytes.getUint32(4, true), audio.byteLength - 8);
  assert.equal(bytes.getUint16(22, true), 1);
  assert.equal(bytes.getUint32(24, true), 48000);
  assert.equal(bytes.getUint16(34, true), 16);
  assert.equal(bytes.getUint32(40, true), 6);
  assert.deepEqual(
    [44, 46, 48].map((offset) => bytes.getInt16(offset, true)),
    [-32768, 16384, 32767],
  );
});
