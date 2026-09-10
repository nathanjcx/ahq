import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } from 'electron';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Command, Snapshot } from '../src/shared/types';

let window: BrowserWindow | null = null;
let host: Electron.UtilityProcess | null = null;
let latest: Snapshot | undefined;
let sequence = 0;
const pending = new Map<number, { resolve(value: Snapshot): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
const devUrl = !app.isPackaged && process.env.OFFICE_DEV === '1' ? 'http://127.0.0.1:5173' : undefined;
const dataDir = process.env.OFFICE_DATA_DIR || path.join(app.getPath('userData'), 'office');

function request(command: Command): Promise<Snapshot> {
  if (!host) return Promise.reject(new Error('The local runtime is not running. Restart Little Office.'));
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The local runtime did not respond.')); }, 60_000);
    pending.set(id, { resolve, reject, timer });
    host!.postMessage({ id, command });
  });
}
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('This window cannot access the local runtime.');
  }
}
function externalUrl(raw: string, loginOnly = false) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS links can be opened.');
  if (loginOnly && !['auth.openai.com', 'auth0.openai.com', 'chatgpt.com', 'auth.chatgpt.com'].includes(url.hostname)) {
    throw new Error('Codex returned an unexpected sign-in address.');
  }
  return url.href;
}
function startRuntime() {
  host = utilityProcess.fork(path.join(__dirname, 'runtime-host.cjs'), [], {
    env: { ...process.env, OFFICE_DATA_DIR: dataDir }, serviceName: 'Little Office Runtime', stdio: 'pipe',
  });
  host.stderr?.on('data', (chunk: Buffer) => console.error('[runtime]', chunk.toString()));
  host.on('message', (message) => {
    if (message.type === 'snapshot') {
      latest = message.snapshot;
      window?.webContents.send('office:snapshot', latest);
    } else if (message.type === 'fatal') {
      dialog.showErrorBox('Little Office could not start', String(message.error));
    } else if (pending.has(message.id)) {
      const item = pending.get(message.id)!;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(String(message.error)));
      else { latest = message.result; item.resolve(message.result); }
    }
  });
  host.on('exit', () => {
    host = null;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('The local runtime stopped. Restart Little Office.')); }
    pending.clear();
  });
}
function createWindow() {
  window = new BrowserWindow({
    title: 'Little Office', width: 1480, height: 960, minWidth: 900, minHeight: 650,
    backgroundColor: '#f7f5ec', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('closed', () => { window = null; });
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(path.join(__dirname, '../dist/index.html'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.restore(); window?.focus(); });
  void app.whenReady().then(() => {
    ipcMain.handle('office:command', async (event, command: Command) => {
      trusted(event);
      const snapshot = await request(command);
      if (command.type === 'auth.login' && snapshot.auth.loginUrl) {
        await shell.openExternal(externalUrl(snapshot.auth.loginUrl, true));
      }
      return snapshot;
    });
    ipcMain.handle('office:external', async (event, url: string) => { trusted(event); await shell.openExternal(externalUrl(url)); });
    ipcMain.handle('office:artifact', async (event, id: string) => {
      trusted(event);
      const artifact = latest?.artifacts.find((item) => item.id === id);
      if (!artifact?.filePath) throw new Error('This artifact does not have an exported file.');
      const root = await realpath(dataDir);
      const file = await realpath(artifact.filePath);
      const relative = path.relative(root, file);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !(await stat(file)).isFile()) throw new Error('Artifact is outside the office workspace.');
      const error = await shell.openPath(file);
      if (error) throw new Error(error);
    });
    startRuntime();
    createWindow();
    app.on('activate', () => { if (!window) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { host?.kill(); });
}
