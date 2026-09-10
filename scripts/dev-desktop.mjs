import { randomBytes } from 'node:crypto';
import { createServer } from 'vite';
import { launchDesktop } from './desktop-launch.mjs';

// The nonce permits only Vite's generated development scripts under the same
// restrictive script policy used by the desktop renderer.
process.env.AHQ_DEV_CSP_NONCE = randomBytes(24).toString('base64');
const server = await createServer({ server: { host: '127.0.0.1' } });
await server.listen();
server.printUrls();
try {
  const desktop = await launchDesktop({ ...process.env, AHQ_DEV_URL: 'http://127.0.0.1:5173' });
  const stop = () => void desktop.stop().catch((error) => console.error(error.message));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    const { code, signal } = await desktop.closed;
    process.exitCode = code ?? (signal ? 1 : 0);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
} finally {
  await server.close();
}
