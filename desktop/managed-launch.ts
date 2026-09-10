import { promises as fs, watch } from 'node:fs';
import path from 'node:path';
import type { App } from 'electron';

// Call only after acquiring the single-instance lock. The launcher owns and
// removes this private directory; each instance receives a different token.
export async function registerManagedLaunch(app: App): Promise<boolean> {
  if (app.isPackaged) return true;
  const directory = process.env.AHQ_LAUNCH_DIRECTORY;
  const token = process.env.AHQ_LAUNCH_TOKEN;
  let quitting = false;
  const quit = () => {
    if (quitting) return;
    quitting = true;
    app.quit();
  };
  process.on('SIGTERM', quit);
  process.on('SIGINT', quit);
  app.once('will-quit', () => {
    process.off('SIGTERM', quit);
    process.off('SIGINT', quit);
  });
  if (!directory || !token) return true;

  const checkCommand = async (): Promise<boolean> => {
    let command: { token?: string; command?: string };
    try {
      command = JSON.parse(await fs.readFile(path.join(directory, 'command.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    if (command.token !== token || command.command !== 'quit') return false;
    quit();
    return true;
  };
  const watcher = watch(directory, (_event, filename) => {
    if (!filename || filename.toString() === 'command.json')
      void checkCommand().catch((error) => console.error('Could not read launcher command:', error));
  });
  watcher.on('error', (error) => console.error('Could not watch launcher commands:', error));
  app.once('will-quit', () => watcher.close());
  await fs.writeFile(path.join(directory, 'process.json'), JSON.stringify({ token, pid: process.pid }), {
    mode: 0o600,
    flag: 'wx',
  });
  // Stop can arrive while Launch Services is still starting Electron.
  await checkCommand();
  return !quitting;
}
