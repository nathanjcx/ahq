import { createRuntime } from '../runtime/engine';
import type { Command } from '../src/shared/types';

type Message = { id: number; command: Command };
const parent = (process as NodeJS.Process & {
  parentPort?: { postMessage(value: unknown): void; on(event: string, listener: (event: { data: Message }) => void): void };
}).parentPort;
const send = (value: unknown) => parent ? parent.postMessage(value) : process.send?.(value);
const dataDir = process.env.OFFICE_DATA_DIR;
if (!dataDir) throw new Error('OFFICE_DATA_DIR is required');
const runtime = createRuntime({ dataDir, onSnapshot: (snapshot) => send({ type: 'snapshot', snapshot }) });

async function receive(message: Message) {
  if (!message || typeof message.id !== 'number') return;
  try {
    const engine = await runtime;
    const result = await engine.command(message.command);
    send({ id: message.id, result });
  } catch (error) {
    send({ id: message.id, error: error instanceof Error ? error.message : 'Runtime request failed' });
  }
}
if (parent) parent.on('message', (event) => void receive(event.data));
else process.on('message', (message) => void receive(message as Message));
runtime.then((engine) => send({ type: 'snapshot', snapshot: engine.snapshot() })).catch((error) => {
  send({ type: 'fatal', error: error instanceof Error ? error.message : 'Runtime failed to start' });
  process.exitCode = 1;
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await (await runtime).close();
  process.exit(0);
}
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
process.on('disconnect', () => void close());
