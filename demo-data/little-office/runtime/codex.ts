import type { AgentMessage } from '../src/shared/types';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

type JsonObject = Record<string, unknown>;
type NotificationListener = (method: string, params: JsonObject) => void;

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface TurnWaiter {
  resolve(params: JsonObject): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export interface CodexAccount {
  signedIn: boolean;
  email?: string;
  plan?: string;
  method?: string;
  unsupportedMethod?: string;
}

export interface CodexTurnResult {
  threadId: string;
  turnId: string;
  status: 'completed' | 'interrupted' | 'failed';
  message: string;
  error?: string;
}

export interface RunTurnOptions {
  cwd: string;
  model: string;
  signal?: AbortSignal;
  prompt: string;
  outputSchema?: JsonObject;
  onStarted?(ids: { threadId: string; turnId: string }): void;
  onProgress?(text: string): void;
  onMessage?(message: AgentMessage): void;
}

export class CodexAppServer {
  private child?: ChildProcessWithoutNullStreams;
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<NotificationListener>();
  private readonly completedTurns = new Map<string, JsonObject>();
  private readonly turnMessages = new Map<string, string>();
  private readonly turnWaiters = new Map<string, TurnWaiter>();
  private closed = false;

  async start(): Promise<void> {
    if (this.child) return;
    const executable = process.env.CODEX_BIN || 'codex';
    let child: ChildProcessWithoutNullStreams;
    try {
      const configured = JSON.parse(execFileSync(executable, ['mcp', 'list', '--json'], {
        encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'],
      })) as Array<{ name?: unknown }>;
      if (!Array.isArray(configured)) throw new Error('Codex returned an invalid MCP server list');
      const names = configured.map((entry) => entry.name).filter((name): name is string => typeof name === 'string');
      const override = `mcp_servers={${names.map((name) => `${JSON.stringify(name)}={enabled=false}`).join(',')}}`;
      child = spawn(executable, ['app-server', '--stdio', '--disable', 'apps', '--disable', 'plugins', '-c', override, '-c', 'web_search="disabled"'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (error) {
      throw new Error(`Codex could not start with external tools disabled: ${messageOf(error)}`);
    }
    this.child = child;
    child.once('error', (error) => {
      this.child = undefined;
      this.failAll(new Error(`Codex could not start: ${error.message}`));
    });
    child.once('exit', (code, signal) => {
      this.child = undefined;
      if (!this.closed) this.failAll(new Error(`Codex app-server stopped (${signal || code || 'unknown'})`));
    });
    createInterface({ input: child.stdout }).on('line', (line) => this.receive(line));
    child.stderr.resume();

    await this.request('initialize', {
      clientInfo: { name: 'little-office', title: 'Little Office', version: '0.1.0' },
      capabilities: null,
    });
    this.notify('initialized', {});
  }

  onNotification(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async readAccount(refreshToken = false): Promise<CodexAccount> {
    const result = await this.request('account/read', { refreshToken }) as JsonObject;
    const account = result.account as JsonObject | null;
    if (!account) return { signedIn: false };
    const type = stringValue(account.type);
    if (type !== 'chatgpt') {
      return { signedIn: false, unsupportedMethod: type || 'unknown' };
    }
    return {
      signedIn: true,
      email: optionalString(account.email),
      plan: optionalString(account.planType),
      method: 'ChatGPT subscription',
    };
  }

  async login(): Promise<{ loginId: string; authUrl: string }> {
    const result = await this.request('account/login/start', {
      type: 'chatgpt',
      useHostedLoginSuccessPage: true,
      appBrand: 'codex',
    }) as JsonObject;
    if (result.type !== 'chatgpt' || typeof result.loginId !== 'string' || typeof result.authUrl !== 'string') {
      throw new Error('Codex did not return a ChatGPT browser login');
    }
    return { loginId: result.loginId, authUrl: result.authUrl };
  }

  async cancelLogin(loginId: string): Promise<void> {
    await this.request('account/login/cancel', { loginId });
  }

  async logout(): Promise<void> {
    await this.request('account/logout', {});
  }

  async runTurn(options: RunTurnOptions): Promise<CodexTurnResult> {
    options.signal?.throwIfAborted();
    const threadResult = await this.request('thread/start', {
      cwd: options.cwd,
      ...(options.model.trim() ? { model: options.model.trim() } : {}),
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
      ephemeral: true,
      developerInstructions: 'You are working for Little Office in the provided workspace. Stay inside this workspace. Do not call external apps, services, or MCP tools. Do not read credentials. Complete only the stated task.',
    }) as JsonObject;
    const thread = threadResult.thread as JsonObject;
    const threadId = stringValue(thread?.id);
    if (!threadId) throw new Error('Codex thread/start returned no thread id');

    let turnId = '';
    const messages = new Map<string, AgentMessage>();
    const dirty = new Set<string>();
    let flushTimer: NodeJS.Timeout | undefined;
    const flush = () => {
      clearTimeout(flushTimer); flushTimer = undefined;
      for (const id of dirty) options.onMessage?.({ ...messages.get(id)! });
      dirty.clear();
    };
    const completedMessage = (item: JsonObject) => {
      const text = agentMessageText(item);
      if (!text) return;
      const id = stringValue(item.id) || `message-${messages.size}`;
      messages.set(id, { id, text, complete: true, timestamp: messages.get(id)?.timestamp || Date.now() });
      dirty.add(id); flush();
      options.onProgress?.(text);
    };
    // Subscribe before turn/start: fast turns can emit messages before its response.
    const unsubscribe = this.onNotification((method, params) => {
      if (params.threadId !== threadId || (turnId && params.turnId !== turnId)) return;
      if (method === 'item/agentMessage/delta' && typeof params.itemId === 'string' && typeof params.delta === 'string') {
        const id = params.itemId;
        const message = messages.get(id) || { id, text: '', complete: false, timestamp: Date.now() };
        message.text += params.delta;
        messages.set(id, message); dirty.add(id);
        if (!flushTimer) flushTimer = setTimeout(flush, 200);
      } else if (method === 'item/completed' && params.item) completedMessage(params.item as JsonObject);
    });
    try {
      options.signal?.throwIfAborted();
      const turnResult = await this.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: options.prompt, text_elements: [] }],
        cwd: options.cwd,
        approvalPolicy: 'never',
        ...(options.model.trim() ? { model: options.model.trim() } : {}),
        sandboxPolicy: {
          type: 'workspaceWrite', writableRoots: [options.cwd], networkAccess: false,
          excludeTmpdirEnvVar: true, excludeSlashTmp: true,
        },
        outputSchema: options.outputSchema,
      }) as JsonObject;
      turnId = stringValue((turnResult.turn as JsonObject)?.id);
      if (!turnId) throw new Error('Codex turn/start returned no turn id');
      options.onStarted?.({ threadId, turnId });
      const completed = await this.waitForTurn(turnId, 10 * 60_000);
      const finished = completed.turn as JsonObject;
      if (Array.isArray(finished.items)) {
        for (const item of finished.items as JsonObject[]) {
          if (!messages.get(stringValue(item.id))?.complete) completedMessage(item);
        }
      }
      return {
        threadId, turnId,
        status: stringValue(finished.status) as CodexTurnResult['status'],
        message: this.turnMessages.get(turnId) || lastAgentMessage(finished.items) || '',
        error: turnError(finished.error),
      };
    } finally {
      unsubscribe(); flush();
      this.turnMessages.delete(turnId);
      this.completedTurns.delete(turnId);
    }
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.request('turn/interrupt', { threadId, turnId }, 15_000);
  }

  async steer(threadId: string, turnId: string, text: string): Promise<void> {
    await this.request('turn/steer', {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: 'text', text, text_elements: [] }],
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failAll(new Error('Codex app-server closed'));
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 1_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private waitForTurn(turnId: string, timeout: number): Promise<JsonObject> {
    const completed = this.completedTurns.get(turnId);
    if (completed) return Promise.resolve(completed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.turnWaiters.delete(turnId);
        reject(new Error('Codex turn timed out'));
      }, timeout);
      this.turnWaiters.set(turnId, { resolve, reject, timer });
    });
  }

  private request(method: string, params: JsonObject, timeout = 30_000): Promise<unknown> {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private notify(method: string, params: JsonObject): void {
    this.write({ method, params });
  }

  private write(message: JsonObject): void {
    if (!this.child?.stdin.writable) throw new Error('Codex app-server is unavailable');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    let message: JsonObject;
    try {
      message = JSON.parse(line) as JsonObject;
    } catch {
      return;
    }
    if (typeof message.id === 'number' && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(protocolError(message.error)));
      else pending.resolve(message.result);
      return;
    }
    const method = stringValue(message.method);
    const params = (message.params && typeof message.params === 'object' ? message.params : {}) as JsonObject;
    if (!method) return;
    if (method === 'item/completed') {
      const turnId = stringValue(params.turnId);
      const text = agentMessageText(params.item as JsonObject);
      if (turnId && text) this.turnMessages.set(turnId, text);
    }
    if (method === 'turn/completed') {
      const turn = params.turn as JsonObject;
      const turnId = stringValue(turn?.id);
      if (turnId) {
        this.completedTurns.set(turnId, params);
        const waiter = this.turnWaiters.get(turnId);
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve(params);
        }
        this.turnWaiters.delete(turnId);
      }
    }
    for (const listener of this.listeners) listener(method, params);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.turnWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.turnWaiters.clear();
  }
}

function agentMessageText(item: JsonObject | undefined): string {
  if (!item || item.type !== 'agentMessage') return '';
  return optionalString(item.text) || '';
}

function lastAgentMessage(items: unknown): string {
  if (!Array.isArray(items)) return '';
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const text = agentMessageText(items[index] as JsonObject);
    if (text) return text;
  }
  return '';
}

function protocolError(value: unknown): string {
  if (!value || typeof value !== 'object') return 'Codex request failed';
  const error = value as JsonObject;
  return optionalString(error.message) || 'Codex request failed';
}

function turnError(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return optionalString((value as JsonObject).message) || 'Codex turn failed';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
