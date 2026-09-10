import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
const run = promisify(execFile);
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
    const { stdout } = await run(executable, [file], { timeout: 90_000, maxBuffer: 100_000 });
    const result = z
      .object({ text: z.string().max(12000).optional(), error: z.string().optional() })
      .parse(JSON.parse(stdout));
    if (result.error) throw new Error(result.error);
    return result.text?.trim() ?? '';
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
