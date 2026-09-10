import { launchDesktop } from './desktop-launch.mjs';
const desktop = await launchDesktop();
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
