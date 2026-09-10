import assert from 'node:assert/strict';
import test from 'node:test';
import { readTranscriptionResult, transcriptionFailureMessage } from '../desktop/speech';

test('on-device speech results preserve text and actionable native errors', () => {
  assert.equal(readTranscriptionResult('{"text":"  Hello office. \\n"}'), 'Hello office.');
  assert.equal(readTranscriptionResult('{"text":""}'), '');
  assert.throws(
    () => readTranscriptionResult('{"error":"Allow Speech Recognition in System Settings."}'),
    /Allow Speech Recognition in System Settings\./,
  );
});

test('incomplete or malformed native responses cannot appear as a successful empty transcript', () => {
  for (const output of ['', '{', '{}', '{"text":42}', '{"error":"  "}']) {
    assert.throws(() => readTranscriptionResult(output), /invalid response/);
  }
});

test('a failed speech subprocess retains structured native errors without leaking recording paths', () => {
  const message = transcriptionFailureMessage({
    code: 1,
    message: 'Command failed: /private/helper /private/recording.wav',
    stdout: '{"error":"This build is missing its macOS Speech Recognition permission description."}',
  });
  assert.equal(message, 'This build is missing its macOS Speech Recognition permission description.');
  assert.doesNotMatch(message, /private|Command failed/);
});

test('speech helper crashes, launch failures and timeouts have recovery guidance', () => {
  assert.match(transcriptionFailureMessage({ signal: 'SIGABRT' }), /Quit and reopen Astra HQ/);
  assert.match(transcriptionFailureMessage({ killed: true, signal: 'SIGTERM' }), /timed out/);
  assert.match(transcriptionFailureMessage({ code: 'ENOENT' }), /Rebuild or reinstall/);
  assert.match(transcriptionFailureMessage({ code: 'EACCES' }), /Rebuild or reinstall/);
  assert.match(transcriptionFailureMessage({ code: 1, stdout: '{' }), /stopped unexpectedly/);
  assert.match(transcriptionFailureMessage(null), /stopped unexpectedly/);
});
