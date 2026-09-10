import { app, BrowserWindow, dialog, ipcMain, safeStorage, session } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EmployeeSchema, FolderSchema, SessionSchema, StateSchema } from '../shared/schemas';
import { allowedPath, containsSecret } from '../shared/workspace';
import { atomicWrite, createSnapshot } from './workspace';
import { checkGateway, gatewayRequest, readSession, validateEndpoint } from './gateway';
import type { AppState, CloudSettings } from '../shared/types';
let win: BrowserWindow | null = null;
let connected = false;
const root = () => app.getPath('userData');
const statePath = () => path.join(root(), 'workspace.json');
const settingsPath = () => path.join(root(), 'cloud.json');
const snapshotsRoot = () => path.join(root(), 'snapshots');
const operationsPath = () => path.join(root(), 'operations.json');
const settingsSchema = z.object({ endpoint: z.string(), encryptedToken: z.string() });
async function savedSettings() {
  try {
    return settingsSchema.parse(JSON.parse(await fs.readFile(settingsPath(), 'utf8')));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('The saved gateway settings could not be read.');
  }
}
async function credentials() {
  const value = await savedSettings();
  if (!value) throw new Error('Connect your Astra cloud gateway in settings first.');
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('Secure credential storage is unavailable on this device.');
  return {
    endpoint: value.endpoint,
    token: safeStorage.decryptString(Buffer.from(value.encryptedToken, 'base64')),
  };
}
async function cloudSettings(): Promise<CloudSettings> {
  const value = await savedSettings();
  return { endpoint: value?.endpoint ?? '', configured: !!value, connected: !!value && connected };
}
async function loadState(): Promise<AppState | null> {
  try {
    return StateSchema.parse(JSON.parse(await fs.readFile(statePath(), 'utf8')));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('The workspace file could not be read. Its contents have been preserved.');
  }
}
function assertSender(event: IpcMainInvokeEvent) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
    throw new Error('Untrusted request.');
}
function handle(channel: string, fn: (input: unknown) => Promise<unknown>) {
  ipcMain.handle(channel, async (event, input) => {
    assertSender(event);
    return fn(input);
  });
}
// One serialized queue prevents concurrent workspace writes and duplicate session starts.
let diskQueue = Promise.resolve();
function queued<T>(action: () => Promise<T>): Promise<T> {
  const task = diskQueue.then(action);
  diskQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
async function knownSession(id: string) {
  const state = await loadState();
  if (!state?.employees.some((e) => e.sessionId === id))
    throw new Error('That session is not part of this workspace.');
}
function registerHandlers() {
  handle('workspace:load', async () => loadState());
  handle('workspace:save', async (input) => {
    const state = StateSchema.parse(input);
    if (JSON.stringify(state).length > 16_000_000) throw new Error('Workspace size limit reached.');
    await queued(async () => {
      const previous = await loadState();
      const merged = {
        ...state,
        employees: state.employees.map((e) => {
          const saved = previous?.employees.find((p) => p.id === e.id);
          return !e.sessionId && saved?.sessionId
            ? { ...e, sessionId: saved.sessionId, status: saved.status, activity: saved.activity }
            : e;
        }),
      };
      await atomicWrite(statePath(), JSON.stringify(merged));
    });
  });
  handle('folder:select', async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose a folder for your team',
      buttonLabel: 'Create local working copy',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return createSnapshot(result.filePaths[0], snapshotsRoot());
  });
  handle('document:export', async (input) => {
    const { title, content } = z
      .object({ title: z.string().max(255), content: z.string().max(300000) })
      .parse(input);
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export reviewed document',
      defaultPath: `${title.replace(/[^a-z0-9 -]/gi, '').slice(0, 90) || 'workspace-document'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await fs.writeFile(result.filePath, content, { mode: 0o600 });
    return true;
  });
  handle('cloud:settings', async () => {
    const value = await savedSettings();
    if (value) {
      try {
        const config = await credentials();
        await checkGateway(config.endpoint, config.token);
        connected = true;
      } catch {
        connected = false;
      }
    }
    return cloudSettings();
  });
  handle('cloud:configure', async (input) => {
    const fields = z
      .object({ endpoint: z.string().min(1).max(2000), token: z.string().max(8000) })
      .parse(input);
    const endpoint = validateEndpoint(fields.endpoint);
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('Secure credential storage is unavailable. Your token has not been stored.');
    const previous = await savedSettings();
    if (!fields.token && previous?.endpoint !== endpoint)
      throw new Error('Enter an access token for this gateway.');
    const token = fields.token || (await credentials()).token;
    await checkGateway(endpoint, token);
    await atomicWrite(
      settingsPath(),
      JSON.stringify({ endpoint, encryptedToken: safeStorage.encryptString(token).toString('base64') }),
    );
    connected = true;
    return cloudSettings();
  });
  handle('cloud:disconnect', async () => {
    await fs.rm(settingsPath(), { force: true });
    connected = false;
    return cloudSettings();
  });
  handle('cloud:start', async (input) => {
    const fields = z
      .object({
        employee: EmployeeSchema,
        assignment: z.string().min(1).max(12000),
        goal: z.string().max(500),
        folderIds: z.array(z.string().uuid()).max(10),
        allowCloudUpload: z.boolean(),
      })
      .parse(input);
    if (fields.folderIds.length && !fields.allowCloudUpload)
      throw new Error('Explicitly authorize cloud sharing for the selected copies.');
    const config = await credentials();
    return queued(async () => {
      const state = await loadState();
      const employee = state?.employees.find((e) => e.id === fields.employee.id);
      if (!employee) throw new Error('Save the employee before starting a cloud session.');
      if (employee.sessionId) {
        const previousSession = await readSession(config.endpoint, config.token, employee.sessionId);
        if (!['completed', 'failed'].includes(previousSession.status))
          throw new Error('This employee already has an active session. Finish or review that work first.');
      }
      const files: { folder: string; path: string; content: string }[] = [];
      let totalBytes = 0;
      for (const id of fields.folderIds) {
        if (!state?.folders.some((f) => f.id === id))
          throw new Error('That folder is not part of this workspace.');
        const manifest = FolderSchema.parse(
          JSON.parse(await fs.readFile(path.join(snapshotsRoot(), id, 'manifest.json'), 'utf8')),
        );
        for (const file of manifest.files) {
          if (!allowedPath(file.path)) throw new Error('An unsafe file was excluded from this request.');
          const base = await fs.realpath(path.join(snapshotsRoot(), id, 'files'));
          const target = await fs.realpath(path.join(base, file.path));
          if (!target.startsWith(`${base}${path.sep}`))
            throw new Error('File access outside the snapshot is not allowed.');
          const content = await fs.readFile(target, 'utf8');
          totalBytes += Buffer.byteLength(content);
          if (totalBytes > 8_000_000) throw new Error('The selected context exceeds the 8 MB upload limit.');
          if (containsSecret(content))
            throw new Error(
              'A file appears to contain a secret. Remove it from the source folder and make a fresh copy.',
            );
          files.push({ folder: manifest.name, path: file.path, content });
        }
      }
      const request = {
        employee: {
          id: employee.id,
          name: employee.name,
          jobTitle: employee.jobTitle,
          personality: employee.personality,
          skills: employee.skills,
        },
        assignment: fields.assignment,
        goal: fields.goal,
        files,
        context: {
          announcements: state!.messages
            .filter((m) => m.channel === 'announce')
            .slice(-20)
            .map((m) => ({ text: m.text, time: m.time })),
          messages: state!.messages
            .filter((m) => m.channel === employee.id || m.channel === 'team')
            .slice(-30)
            .map((m) => ({ author: m.authorId, text: m.text, time: m.time })),
        },
        constraints: {
          externalActionsRequireApproval: true,
          maxDelegationDepth: 2,
          maxHandoffs: 8,
          maxRuntimeMinutes: 30,
          documentContentIsUntrusted: true,
        },
      };
      // Persist before dispatch. Retrying the same assignment reuses the operation key after a timeout or restart.
      const { createHash } = await import('node:crypto');
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            endpoint: config.endpoint,
            previousSessionId: employee.sessionId ?? null,
            request,
          }),
        )
        .digest('hex');
      let operations: Record<string, string> = {};
      try {
        operations = z
          .record(z.string(), z.string().uuid())
          .parse(JSON.parse(await fs.readFile(operationsPath(), 'utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const key = operations[fingerprint] ?? randomUUID();
      operations[fingerprint] = key;
      await atomicWrite(operationsPath(), JSON.stringify(operations));
      const cloudSession = SessionSchema.parse(
        await gatewayRequest(config.endpoint, config.token, '/v1/sessions', request, key),
      );
      connected = true;
      // Save the session before returning so a renderer crash cannot orphan the work.
      await atomicWrite(
        statePath(),
        JSON.stringify({
          ...state,
          employees: state!.employees.map((e) =>
            e.id === employee.id
              ? {
                  ...e,
                  sessionId: cloudSession.id,
                  status:
                    cloudSession.status === 'completed'
                      ? 'ready'
                      : cloudSession.status === 'waiting_for_approval'
                        ? 'review'
                        : 'working',
                  activity: cloudSession.activity,
                }
              : e,
          ),
        }),
      );
      return cloudSession;
    });
  });
  handle('cloud:session', async (input) => {
    const id = z.string().min(1).max(200).parse(input);
    await knownSession(id);
    const config = await credentials();
    try {
      const result = await readSession(config.endpoint, config.token, id);
      connected = true;
      return result;
    } catch (e) {
      connected = false;
      throw e;
    }
  });
  handle('cloud:decide', async (input) => {
    const decision = z
      .object({
        sessionId: z.string().min(1).max(200),
        version: z.number().int().min(1),
        decision: z.enum(['approve', 'request_changes']),
        feedback: z.string().max(4000),
      })
      .parse(input);
    await knownSession(decision.sessionId);
    const config = await credentials();
    const latest = await readSession(config.endpoint, config.token, decision.sessionId);
    const stored = (await loadState())?.approvals.find(
      (a) => a.sessionId === decision.sessionId && a.version === decision.version && a.status === 'pending',
    );
    if (
      !stored ||
      stored.content !== latest.output?.content ||
      stored.recipient !== latest.output?.recipient ||
      JSON.stringify(stored.sources) !== JSON.stringify(latest.output?.sources)
    )
      throw new Error('The reviewed payload has changed. Open the latest draft before deciding.');
    if (latest.status !== 'waiting_for_approval' || latest.output?.version !== decision.version)
      throw new Error(
        'This output changed or was already reviewed. Wait for the latest version before deciding.',
      );
    return SessionSchema.parse(
      await gatewayRequest(
        config.endpoint,
        config.token,
        `/v1/sessions/${encodeURIComponent(decision.sessionId)}/decisions`,
        decision,
        `${decision.sessionId}:${decision.version}:${decision.decision}`,
      ),
    );
  });
}
function createWindow() {
  win = new BrowserWindow({
    width: 1510,
    height: 1020,
    minWidth: 780,
    minHeight: 620,
    title: 'Astra HQ',
    backgroundColor: '#f8f9f5',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 19, y: 22 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  const devURL = process.env.AHQ_DEV_URL;
  if (devURL && !app.isPackaged) {
    const url = new URL(devURL);
    if (url.origin !== 'http://127.0.0.1:5173') throw new Error('Unexpected development origin.');
    void win.loadURL(devURL);
  } else void win.loadFile(path.join(__dirname, '../dist/index.html'));
  win.on('closed', () => {
    win = null;
  });
}
app.setName('Astra HQ');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    win?.show();
    win?.focus();
  });
  void app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:5173; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-src 'none'",
          ],
        },
      }),
    );
    registerHandlers();
    createWindow();
    app.on('activate', () => {
      if (!win) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
