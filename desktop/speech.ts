import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
const run = promisify(execFile);

const speechResult = z
  .object({ text: z.string().max(12000).optional(), error: z.string().max(4000).optional() })
  .refine((result) => typeof result.text === 'string' || Boolean(result.error?.trim()));

export function readTranscriptionResult(stdout: string): string {
  let result: z.infer<typeof speechResult>;
  try {
    result = speechResult.parse(JSON.parse(stdout));
  } catch {
    throw new Error('Speech recognition returned an invalid response. Please try recording again.');
  }
  if (result.error?.trim()) throw new Error(result.error.trim());
  return result.text?.trim() ?? '';
}

// execFile rejects before its normal response handler when macOS terminates the
// helper. Never expose its raw command line (including the recording path) in UI.
export function transcriptionFailureMessage(error: unknown): string {
  const failure = error as {
    code?: string | number;
    signal?: string;
    killed?: boolean;
    stdout?: string;
  } | null;
  if (typeof failure?.stdout === 'string') {
    try {
      const result = speechResult.safeParse(JSON.parse(failure.stdout));
      if (result.success && result.data.error?.trim()) return result.data.error.trim();
    } catch {
      // A crashed helper may not have produced complete JSON.
    }
  }
  if (failure?.code === 'ENOENT' || failure?.code === 'EACCES')
    return 'The on-device speech helper is missing or cannot run. Rebuild or reinstall Astra HQ, then try again.';
  if (failure?.killed) return 'Speech recognition timed out. Please try a shorter announcement.';
  if (failure?.signal === 'SIGABRT')
    return 'macOS stopped speech recognition before it could start. Quit and reopen Astra HQ, then try again. You can still type your announcement.';
  return 'On-device speech recognition stopped unexpectedly. Please try again, or type your announcement.';
}

export async function transcribeOnDevice(audio: ArrayBuffer, temporaryRoot: string) {
  if (process.platform !== 'darwin')
    throw new Error('On-device voice announcements require macOS. You can still type an announcement.');
  const directory = await fs.mkdtemp(path.join(temporaryRoot, 'astra-voice-'));
  try {
    const file = path.join(directory, 'announcement.wav');
    await fs.writeFile(file, Buffer.from(audio), { mode: 0o600 });
    const executable = path
      .join(__dirname, 'transcribe')
      .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    let stdout: string;
    try {
      ({ stdout } = await run(executable, [file], { timeout: 90_000, maxBuffer: 100_000 }));
    } catch (error) {
      throw new Error(transcriptionFailureMessage(error));
    }
    return readTranscriptionResult(stdout);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
