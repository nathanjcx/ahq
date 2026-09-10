import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DemoTriggerSchema } from './demo';
import type { LaunchSnapshot } from '../shared/launch';
import type { DemoNotification, DemoSnapshot, DemoTrigger } from '../shared/demo';

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new Error('Request exceeds 4 MiB.');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export async function startDemoServer(options: {
  directory: string;
  trigger(input: DemoTrigger): Promise<DemoNotification>;
  snapshot(): Promise<DemoSnapshot>;
  retry?(id: string): Promise<DemoNotification>;
  launchSnapshot?(): Promise<LaunchSnapshot>;
  launchAction?(input: unknown): Promise<LaunchSnapshot>;
}) {
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (request, response) => {
    const reply = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    const received = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected))
      return reply(401, { error: 'Unauthorized' });
    if (request.method !== 'GET' && request.headers.origin)
      return reply(403, { error: 'Browser mutations are not allowed.' });
    try {
      if (request.method === 'GET' && request.url === '/launch' && options.launchSnapshot) return reply(200, await options.launchSnapshot());
      if (request.method === 'POST' && request.url === '/launch' && options.launchAction) return reply(200, await options.launchAction(await body(request)));
      if (request.method === 'GET' && request.url === '/state') return reply(200, await options.snapshot());
      if (request.method === 'POST' && request.url === '/notifications') {
        const input = DemoTriggerSchema.parse(await body(request));
        return reply(200, await options.trigger(input));
      }
      const retry = request.url?.match(/^\/notifications\/([a-zA-Z0-9-]+)\/retry$/);
      if (request.method === 'POST' && retry && options.retry)
        return reply(200, await options.retry(retry[1]));
      reply(404, { error: 'Not found' });
    } catch (error) {
      reply(400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not bind the demo server.');
  const connectionPath = path.join(options.directory, 'demo-connection.json');
  try {
    await mkdir(options.directory, { recursive: true });
    await writeFile(connectionPath, JSON.stringify({ port: address.port, token }), {
      mode: 0o600,
      flag: 'w',
    });
    // Existing files retain their permissions when overwritten.
    const { chmod } = await import('node:fs/promises');
    await chmod(connectionPath, 0o600);
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    address: `http://127.0.0.1:${address.port}`,
    connectionPath,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await unlink(connectionPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    },
  };
}
