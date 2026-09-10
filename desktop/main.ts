import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, systemPreferences } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EmployeeSchema, FolderSchema, StateSchema } from '../shared/schemas';
import { activityExport } from '../shared/activity';
import { allowedPath, containsSecret } from '../shared/workspace';
import { atomicWrite, createSnapshot } from './workspace';
import { checkGateway, readSession, validateEndpoint } from './gateway';
import { SnapshotStore } from '../runtime/store';
import { createRuntime, type OfficeRuntime } from '../runtime/engine';
import { HostedEmployees, openAIRequest, type HostedConfig } from './hosted';
import { applySession, applyDecision } from '../src/lib/workflow';
import type { Command } from '../src/shared/types';
import { AstraModelSchema, MEMORY_KINDS, MEMORY_SCOPES } from '../shared/agent-config';
import { EmployeeTools } from './agent-tools';
import { AgentOffice } from './agent-office';
import type { AppState, CloudSession, CloudSettings } from '../shared/types';
let win: BrowserWindow | null = null;
let connected = false;
const root = () => app.getPath('userData');
let dataDir = '';
let database: SnapshotStore;
let hosted: HostedEmployees;
let employeeTools: EmployeeTools;
let office: AgentOffice;
let polling = false;
let localRuntime: OfficeRuntime | undefined;
let pollTimer: ReturnType<typeof setInterval>;
let snapshotTimer: ReturnType<typeof setInterval>;
const vaultPath = () => path.join(root(), 'api-keys.json');
const vaultSchema = z.object({
  key: z.string().default(''),
  model: AstraModelSchema.default('gpt-6-astra'),
  integrations: z
    .array(z.object({ id: z.string(), name: z.string(), url: z.string(), key: z.string() }))
    .default([]),
});
async function vault(): Promise<HostedConfig> {
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure key storage is unavailable.');
    return vaultSchema.parse(JSON.parse(safeStorage.decryptString(await fs.readFile(vaultPath()))));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      return { key: '', model: 'gpt-6-astra', integrations: [] };
    throw e;
  }
}
async function saveVault(value: HostedConfig) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure key storage is unavailable.');
  await atomicWrite(vaultPath(), safeStorage.encryptString(JSON.stringify(value)));
}
async function hostedConfig() {
  const v = await vault();
  if (!v.key) throw new Error('Add your Astra / OpenAI API key in Settings first.');
  return v;
}
async function log(text: string) {
  await database.log({
    id: randomUUID(),
    time: new Date().toISOString(),
    text,
    kind: 'system',
    source: 'local',
  });
}
async function setupDatabase() {
  try {
    const config = JSON.parse(await fs.readFile(path.join(root(), 'database-location.json'), 'utf8'));
    dataDir = z.string().min(1).parse(config.path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    dataDir = path.join(root(), 'database');
  }
  database = await SnapshotStore.open(dataDir);
  initializeEmployees();
  if (!database.get<AppState>('workspace')) {
    try {
      const old = StateSchema.parse(JSON.parse(await fs.readFile(statePath(), 'utf8')));
      await database.saveHQ(old, 'Imported AHQ Birth workspace');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  await recoverEmployeeSessions();
  pollTimer = setInterval(() => void pollEmployees(), 3000);
  snapshotTimer = setInterval(
    () =>
      void queued(async () => {
        const current = await loadState();
        if (current) await database.saveHQ(current, '5-minute checkpoint', true);
      }).catch(() => win?.webContents.send('workspace:error', 'Could not save checkpoint')),
    300_000,
  );
}

const statePath = () => path.join(root(), 'workspace.json');
const settingsPath = () => path.join(root(), 'cloud.json');
const snapshotsRoot = () => path.join(root(), 'snapshots');

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
  const v = await vault();
  if (v.key)
    return {
      provider: 'openai',
      model: v.model,
      endpoint: 'https://api.openai.com/v1',
      configured: true,
      connected: true,
    };
  const value = await savedSettings();
  return {
    provider: 'gateway',
    endpoint: value?.endpoint ?? '',
    configured: !!value,
    connected: !!value && connected,
  };
}
async function loadState(): Promise<AppState | null> {
  const value = database.get<AppState>('workspace');
  return value ? StateSchema.parse(value) : null;
}

function initializeEmployees() {
  employeeTools = new EmployeeTools(database, loadState);
  hosted = new HostedEmployees(database, hostedConfig, employeeTools);
  office = new AgentOffice(loadState, mutateWorkspace, persistSession, hosted, employeeTools);
}
async function mutateWorkspace(change: (state: AppState) => AppState, reason?: string) {
  await queued(async () => {
    const latest = await loadState();
    if (!latest) throw new Error('Open your workspace first.');
    await database.saveHQ(change(latest), reason);
  });
}
async function persistSession(employeeId: string, result: CloudSession) {
  if (!hosted.owns(result.id) || hosted.ownerOf(result.id) !== employeeId)
    throw new Error('Session ownership does not match this employee.');
  await mutateWorkspace((latest) => applySession(latest, employeeId, result));
  if (win && !win.isDestroyed()) win.webContents.send('agent:session', { employeeId, session: result });
}
async function recoverEmployeeSessions() {
  const state = await loadState();
  if (!state) return;
  for (const employee of state.employees.filter((item) => !item.sessionId)) {
    const saved = hosted.sessionFor(employee.id);
    if (saved) await persistSession(employee.id, saved);
  }
}
async function pollEmployees() {
  if (polling) return;
  polling = true;
  try {
    await recoverEmployeeSessions();
    const state = await loadState();
    if (!state) return;
    await Promise.allSettled(
      state.employees
        .filter((employee) => employee.sessionId && employee.status !== 'ready')
        .map(async (employee) => {
          if (!hosted.owns(employee.sessionId!) || hosted.ownerOf(employee.sessionId!) !== employee.id)
            return;
          await persistSession(employee.id, await hosted.get(employee.sessionId!));
        }),
    );
    await office.deliverPending();
  } catch {
    /* Session errors remain visible in each employee workspace. */
  } finally {
    polling = false;
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
// Serialize only local workspace writes. Each hosted session owns its own execution lock.
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
  const employee = state?.employees.find((e) => e.sessionId === id);
  if (!employee || (hosted.owns(id) && hosted.ownerOf(id) !== employee.id))
    throw new Error('That session is not owned by this employee.');
}
function registerHandlers() {
  handle('office:recording-bounds', async () => database.officeRecordingBounds());
  handle('office:replay', async (input) =>
    database.officeReplay(z.number().finite().nonnegative().parse(input)),
  );
  handle('office:audit-export', async () => {
    const packet = database.exportOfficeAudit();
    const destination = await dialog.showSaveDialog(win!, {
      title: 'Export the office audit record',
      defaultPath: 'Astra-HQ-audit.json',
      filters: [{ name: 'Office audit JSON', extensions: ['json'] }],
    });
    if (destination.canceled || !destination.filePath)
      return { exported: false, verification: packet.verification };
    await atomicWrite(destination.filePath, JSON.stringify(packet, null, 2));
    return { exported: true, path: destination.filePath, verification: packet.verification };
  });
  handle('office:frame', async (input) => {
    await database.recordFrame(
      z
        .object({
          time: z.number().int().positive(),
          sceneTime: z.number().positive(),
          listening: z.boolean(),
          level: z.number().min(0).max(1),
          motion: z.boolean(),
        })
        .parse(input),
    );
  });
  handle('office:frame-at', async (input) => database.frameAt(z.number().positive().parse(input)));
  handle('history:list', async () => database.history());
  handle('history:state', async (input) => database.historyState(z.number().int().positive().parse(input)));
  handle('history:checkpoint', async () =>
    queued(async () => {
      const state = await loadState();
      if (state) await database.saveHQ(state, 'Manual checkpoint', true);
      return database.history();
    }),
  );
  handle('history:restore', async (input) =>
    queued(async () => {
      const id = z.number().int().positive().parse(input),
        current = await loadState();
      if (!current) throw new Error('Open your workspace first.');
      if (current.employees.some((e) => e.sessionId && ['working', 'review', 'offline'].includes(e.status)))
        throw new Error('Stop active cloud sessions before restoring a checkpoint.');
      await database.saveHQ(current, 'Before rollback', true);
      const previous = StateSchema.parse(database.historyState(id));
      const restored = {
        ...previous,
        employees: previous.employees.map((e) => ({
          ...e,
          sessionId: undefined,
          status: 'ready' as const,
          activity: 'Restored checkpoint · ready for your direction',
        })),
        approvals: previous.approvals.map((a) => ({ ...a, sessionId: undefined })),
        events: [
          ...current.events,
          {
            id: randomUUID(),
            time: new Date().toISOString(),
            text: `Restored checkpoint ${id}. Cloud actions and exported files are unchanged.`,
            kind: 'system' as const,
            source: 'local' as const,
          },
        ],
      };
      await database.saveHQ(restored, 'Restored checkpoint', true);
      return restored;
    }),
  );
  handle('activity:list', async () => database.activity());
  handle('activity:export', async (input) => {
    const format = z.enum(['json', 'csv']).parse(input);
    const events = database.activity();
    const content = activityExport(events, format);
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export all office activity',
      defaultPath: `Astra-HQ-activity.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return false;
    await fs.writeFile(result.filePath, content, { mode: 0o600 });
    await log('Exported office activity.');
    return true;
  });
  handle('storage:needs-setup', async () => {
    try {
      await fs.access(path.join(root(), 'database-location.json'));
      return false;
    } catch {
      return true;
    }
  });
  handle('storage:use-default', async () => {
    await atomicWrite(path.join(root(), 'database-location.json'), JSON.stringify({ path: dataDir }));
    await log('Chose the application folder for local storage.');
  });
  handle('storage:location', async () => database.filePath);
  handle('storage:choose', async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Allow Astra HQ to store its database in a folder',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return queued(async () => {
      const current = await loadState();
      if (hosted.busy) throw new Error('Wait for current employee operations before moving storage.');
      if (
        current?.employees.some(
          (employee) => employee.sessionId && ['working', 'review'].includes(employee.status),
        )
      )
        throw new Error('Stop active employee sessions before moving the database.');
      const destination = path.join(await fs.realpath(result.filePaths[0]), 'Astra HQ');
      if (destination === dataDir) return database.filePath;
      await fs.mkdir(destination, { recursive: true, mode: 0o700 });
      const file = path.join(destination, 'office.sqlite');
      await hosted.close();
      let next: SnapshotStore;
      try {
        await database.drain();
        await fs.copyFile(database.filePath, file, 1); // Never overwrite another workspace.
        next = await SnapshotStore.open(destination);
      } catch (error) {
        initializeEmployees();
        throw error;
      }
      await atomicWrite(path.join(root(), 'database-location.json'), JSON.stringify({ path: destination }));
      database.close();
      database = next;
      dataDir = destination;
      initializeEmployees();
      await log('Selected a local database folder.');
      return database.filePath;
    });
  });
  handle('openai:configure', async (input) =>
    queued(async () => {
      const fields = z
        .object({
          key: z.string().min(1).max(8000),
          model: AstraModelSchema,
        })
        .parse(input);
      const old = await vault();
      await openAIRequest({ ...old, ...fields }, `/models/${encodeURIComponent(fields.model)}`);
      await saveVault({ ...old, ...fields });
      await log('Updated the Astra / OpenAI connection.');
      return cloudSettings();
    }),
  );
  const integrationList = async () =>
    (await vault()).integrations.map(({ key, ...i }) => ({ ...i, configured: !!key }));
  handle('integrations:list', integrationList);
  handle('integrations:save', async (input) =>
    queued(async () => {
      const fields = z
        .object({
          id: z.string().uuid().optional(),
          name: z.string().trim().min(1).max(60),
          url: z.string().url(),
          key: z.string().max(8000),
        })
        .parse(input);
      const url = new URL(fields.url);
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('Use a secure HTTPS integration endpoint without embedded credentials.');
      const old = await vault();
      if (old.integrations.length >= 20 && !fields.id)
        throw new Error('Up to 20 integrations are supported.');
      const previous = old.integrations.find((i) => i.id === fields.id);
      if (
        old.integrations.some((i) => i.id !== fields.id && i.name.toLowerCase() === fields.name.toLowerCase())
      )
        throw new Error('An integration with that name already exists.');
      const value = { ...fields, id: fields.id ?? randomUUID(), key: fields.key || previous?.key || '' };
      await saveVault({
        ...old,
        integrations: [...old.integrations.filter((i) => i.id !== value.id), value],
      });
      await log(`Configured integration: ${fields.name}.`);
      return integrationList();
    }),
  );
  handle('integrations:remove', async (input) =>
    queued(async () => {
      const id = z.string().uuid().parse(input);
      const old = await vault();
      await saveVault({ ...old, integrations: old.integrations.filter((i) => i.id !== id) });
      await log('Removed an integration.');
      return integrationList();
    }),
  );
  handle('microphone:permission', async () =>
    process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : true,
  );
  handle('voice:transcribe', async () => {
    throw new Error('Voice transcription is unavailable in Astra-only mode. Use a typed announcement.');
  });
  handle('cloud:cancel', async (input) => {
    const id = z.string().max(200).parse(input);
    await knownSession(id);
    if (!hosted.owns(id)) throw new Error('This legacy session is managed by its gateway.');
    const result = await hosted.cancel(id);
    const employee = (await loadState())?.employees.find((e) => e.sessionId === id);
    if (employee) await persistSession(employee.id, result);
    return result;
  });
  handle('cloud:broadcast', async (input) => {
    await hostedConfig();
    return office.message('announce', z.string().trim().min(1).max(12000).parse(input));
  });
  handle('agent:message', async (input) => {
    const fields = z
      .object({ channel: z.string().min(1).max(200), text: z.string().trim().min(1).max(12000) })
      .parse(input);
    await hostedConfig();
    return office.message(fields.channel, fields.text);
  });
  handle('agent:inspect', async (input) => {
    const employeeId = z.string().min(1).max(200).parse(input);
    const employee = (await loadState())?.employees.find((e) => e.id === employeeId);
    if (!employee) throw new Error('This employee is not in the workspace.');
    const [memories, messages, artifacts] = await Promise.all([
      employeeTools.listMemory(employeeId),
      employeeTools.listMessages(employeeId),
      employeeTools.listArtifacts(employeeId),
    ]);
    return {
      session:
        employee.sessionId &&
        hosted.owns(employee.sessionId) &&
        hosted.ownerOf(employee.sessionId) === employee.id
          ? hosted.peek(employee.sessionId)
          : null,
      memories,
      messages,
      artifacts,
    };
  });
  const memoryFields = z.object({
    kind: z.enum(MEMORY_KINDS),
    scope: z.enum(MEMORY_SCOPES),
    content: z.string().trim().min(1).max(30000),
    sessionId: z.string().min(1).max(200).optional(),
  });
  handle('agent:memory-save', async (input) => {
    const fields = z
      .object({
        employeeId: z.string().min(1).max(200),
        id: z.string().min(1).max(200).optional(),
        memory: memoryFields,
      })
      .parse(input);
    return fields.id
      ? employeeTools.updateMemory(fields.employeeId, fields.id, fields.memory)
      : employeeTools.addMemory(fields.employeeId, fields.memory);
  });
  for (const action of ['forget', 'approve'] as const)
    handle(`agent:memory-${action}`, async (input) => {
      const fields = z
        .object({ employeeId: z.string().min(1).max(200), id: z.string().min(1).max(200) })
        .parse(input);
      return action === 'forget'
        ? employeeTools.forgetMemory(fields.employeeId, fields.id)
        : employeeTools.approveMemory(fields.employeeId, fields.id);
    });
  handle('agent:artifact', async (input) => {
    const fields = z
      .object({ employeeId: z.string().min(1).max(200), id: z.string().min(1).max(200) })
      .parse(input);
    return employeeTools.readArtifact(fields.employeeId, fields.id);
  });
  handle('local:command', async (input) => {
    // Keep the original main runtime and its validated command dispatcher available.
    if (!localRuntime)
      localRuntime = await createRuntime({
        dataDir: path.join(dataDir, 'local-runtime'),
        onSnapshot(snapshot) {
          for (const event of snapshot.activity)
            void database
              .log({
                id: `local-runtime:${event.id}`,
                time: new Date(event.timestamp).toISOString(),
                employeeId: event.agentId,
                text: event.text,
                kind: event.kind === 'error' ? 'system' : 'work',
                source: snapshot.settings.mode === 'demo' ? 'example' : 'local',
              })
              .catch(() => undefined);
        },
      });
    return localRuntime.command(input as Command);
  });

  handle('workspace:load', async () => loadState());
  handle('workspace:save', async (input) => {
    const state = StateSchema.parse(input);
    if (JSON.stringify(state).length > 16_000_000) throw new Error('Workspace size limit reached.');
    await queued(async () => {
      const previous = await loadState();
      let merged: AppState = {
        ...state,
        employees: state.employees.map((e) => {
          const saved = previous?.employees.find((p) => p.id === e.id);
          return {
            ...e,
            sessionId: saved?.sessionId,
            ...(saved?.sessionId
              ? { status: saved.status, activity: saved.activity, location: saved.location }
              : {}),
          };
        }),
      };
      // Cloud results are owned by the backend. A delayed renderer save cannot erase them.
      if (previous) {
        const combine = <T extends { id: string }>(older: T[], newer: T[]) => [
          ...new Map([...older, ...newer].map((item) => [item.id, item])).values(),
        ];
        merged.messages = combine(previous.messages, merged.messages);
        merged.events = combine(previous.events, merged.events);
        merged.approvals = [
          ...new Map(
            [...previous.approvals, ...merged.approvals].map((a) => [
              a.sessionId ? `${a.sessionId}:${a.version}` : a.id,
              a,
            ]),
          ).values(),
        ];
      }
      for (const employee of merged.employees)
        if (
          employee.sessionId &&
          hosted.owns(employee.sessionId) &&
          hosted.ownerOf(employee.sessionId) === employee.id
        )
          merged = applySession(merged, employee.id, hosted.peek(employee.sessionId));
      await database.saveHQ(merged);
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
    if ((await vault()).key) return cloudSettings();
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
    if ((await vault()).key) throw new Error('Disconnect OpenAI before switching to a separate gateway.');
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
    const current = await loadState();
    if (current?.employees.some((e) => e.sessionId && ['working', 'review', 'offline'].includes(e.status)))
      throw new Error('Stop employee sessions in Activity before disconnecting.');
    const v = await vault();
    await saveVault({ ...v, key: '' });
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
    await hostedConfig();
    const state = await loadState();
    const employee = state?.employees.find((e) => e.id === fields.employee.id);
    if (!state || !employee) throw new Error('Save the employee before starting a session.');
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
    try {
      const result = await hosted.start(employee, fields.assignment, state, files);
      await persistSession(employee.id, result);
      return result;
    } catch (error) {
      const saved = hosted.sessionFor(employee.id);
      if (saved) await persistSession(employee.id, saved);
      throw error;
    }
  });
  handle('cloud:session', async (input) => {
    const id = z.string().min(1).max(200).parse(input);
    await knownSession(id);
    if (hosted.owns(id)) {
      const result = await hosted.get(id);
      const employee = (await loadState())?.employees.find((e) => e.sessionId === id);
      if (employee) await persistSession(employee.id, result);
      return result;
    }
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
    if (!hosted.owns(decision.sessionId))
      throw new Error(
        'Legacy gateways do not implement the configured Astra session contract. Connect Astra in Settings.',
      );
    const result = await hosted.decide(
      decision.sessionId,
      decision.version,
      decision.decision,
      decision.feedback,
    );
    await mutateWorkspace((current) => {
      const employee = current.employees.find((e) => e.sessionId === decision.sessionId);
      if (!employee) return current;
      const approval = current.approvals.find(
        (a) => a.sessionId === decision.sessionId && a.version === decision.version && a.status === 'pending',
      );
      const reviewed = approval
        ? applyDecision(
            current,
            approval.id,
            decision.version,
            decision.decision === 'approve' ? 'approved' : 'changes-requested',
            decision.feedback,
          )
        : current;
      return applySession(reviewed, employee.id, result);
    });
    return result;
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
  void app
    .whenReady()
    .then(async () => {
      await setupDatabase();
      session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
        callback(
          contents === win?.webContents &&
            permission === 'media' &&
            'mediaTypes' in details &&
            details.mediaTypes?.length === 1 &&
            details.mediaTypes[0] === 'audio',
        ),
      );
      session.defaultSession.setPermissionCheckHandler(
        (contents, permission, _origin, details) =>
          contents === win?.webContents &&
          permission === 'media' &&
          details.mediaType === 'audio' &&
          details.isMainFrame,
      );
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
    })
    .catch((error) => {
      dialog.showErrorBox(
        'Astra HQ could not open its database',
        String(error instanceof Error ? error.message : error),
      );
      app.quit();
    });
  let closing = false;
  app.on('before-quit', (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    clearInterval(snapshotTimer);
    clearInterval(pollTimer);
    void (async () => {
      await hosted?.close();
      await diskQueue;
      await localRuntime?.close();
      await database?.drain();
      database?.close();
      app.quit();
    })().catch(() => app.quit());
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
