import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppState, Employee } from '../shared/types';
import {
  MEMORY_KINDS,
  MEMORY_SCOPES,
  resolveAgentConfig,
  type AgentConfig,
  type MemoryKind,
  type MemoryScope,
} from '../shared/agent-config';
import { allowedPath, containsSecret, MAX_FOLDER_SIZE } from '../shared/workspace';
import type { SnapshotStore } from '../runtime/store';
import type { OfficeEventInput } from '../shared/office-events';

export interface AgentToolContext {
  sessionId: string;
  employeeId: string;
  config: AgentConfig;
  files: unknown[];
  signal?: AbortSignal;
  callId?: string;
  turn: number;
  depth: number;
  approved?: boolean;
  runId?: string;
}
export interface AgentToolRuntime {
  definitions(context: AgentToolContext): Record<string, unknown>[] | Promise<Record<string, unknown>[]>;
  execute(name: string, args: unknown, context: AgentToolContext): Promise<unknown>;
  context(context: AgentToolContext): unknown | Promise<unknown>;
  requiresApproval?(name: string, context: AgentToolContext): boolean;
}
export interface AgentMemory {
  id: string;
  employeeId: string;
  sessionId?: string;
  kind: MemoryKind;
  scope: MemoryScope;
  content: string;
  status: 'proposed' | 'active';
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  approvedAt?: string;
  editedBy?: 'user';
  provenance: { actor: 'employee' | 'user'; sessionId?: string; callId?: string; turn?: number };
}
export interface OfficeMessage {
  id: string;
  fromEmployeeId: string;
  toEmployeeId: string;
  text: string;
  status: 'queued' | 'delivered' | 'acknowledged';
  sessionId: string;
  runId?: string;
  depth: number;
  createdAt: string;
  deliveredAt?: string;
  deliveredSessionId?: string;
  acknowledgedAt?: string;
}
export interface AgentArtifact {
  id: string;
  employeeId: string;
  sessionId: string;
  title: string;
  content: string;
  mediaType: 'text/markdown' | 'text/plain' | 'application/json';
  createdAt: string;
  provenance: { callId: string; turn: number };
}
export interface MemoryInput {
  kind: MemoryKind;
  scope: MemoryScope;
  content: string;
  sessionId?: string;
}
export type MemoryUpdate = Partial<MemoryInput>;
interface ToolData {
  memories: AgentMemory[];
  messages: OfficeMessage[];
  artifacts: AgentArtifact[];
  receipts: Record<string, { fingerprint: string; result: unknown }>;
}
const DATA_KEY = 'agent-tools:v1';
const id = z.string().trim().min(1).max(200);
const content = z.string().trim().min(1).max(30_000);
const memoryInput = z.strictObject({
  kind: z.enum(MEMORY_KINDS),
  scope: z.enum(MEMORY_SCOPES),
  content,
  sessionId: id.optional(),
});
const memoryUpdate = memoryInput.partial();
const mutationNames = new Set([
  'memory_remember',
  'memory_forget',
  'office_send_message',
  'office_read_inbox',
  'office_acknowledge_message',
  'artifact_write',
]);

function definition(
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
) {
  return {
    type: 'function',
    name,
    description,
    strict: false,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  };
}
const textProperty = { type: 'string' };
const definitions = [
  definition(
    'memory_search',
    'Search your permitted active memory. Proposed, expired, private teammate and other-session memories are excluded.',
    { query: textProperty, kind: { enum: MEMORY_KINDS }, scope: { enum: MEMORY_SCOPES } },
  ),
  definition(
    'memory_remember',
    'Remember one typed fact within your configured scope. In proposal mode it remains inactive until the user approves it.',
    { kind: { enum: MEMORY_KINDS }, scope: { enum: MEMORY_SCOPES }, content: textProperty },
    ['kind', 'scope', 'content'],
  ),
  definition(
    'memory_forget',
    'Forget a memory that you own and can currently access.',
    { id: textProperty },
    ['id'],
  ),
  definition('office_list_employees', 'List the office teammates you are allowed to communicate with.'),
  definition(
    'office_send_message',
    'Queue a message for one permitted teammate. Queued means saved for delivery, not acknowledged. This is internal office communication.',
    { employeeId: textProperty, text: textProperty },
    ['employeeId', 'text'],
  ),
  definition(
    'office_read_inbox',
    'Read messages addressed to you. Reading records delivery; acknowledgment requires its separate tool.',
    { unreadOnly: { type: 'boolean' } },
  ),
  definition(
    'office_acknowledge_message',
    'Explicitly acknowledge a message addressed to you after reading its content.',
    { id: textProperty },
    ['id'],
  ),
  definition(
    'workspace_search',
    'Search only the selected snapshot files attached to this session. No original or arbitrary filesystem paths are accessible.',
    { query: textProperty, maxResults: { type: 'integer', minimum: 1, maximum: 30 } },
    ['query'],
  ),
  definition(
    'workspace_read',
    'Read a selected snapshot file by its exact path and optional folder. Large files can be read in bounded chunks.',
    {
      path: textProperty,
      folder: textProperty,
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 30_000 },
    },
    ['path'],
  ),
  definition(
    'artifact_write',
    'Save a durable document in the app-owned artifact store. Supply document content, not an arbitrary filesystem path.',
    {
      title: textProperty,
      content: textProperty,
      mediaType: { enum: ['text/markdown', 'text/plain', 'application/json'] },
    },
    ['title', 'content'],
  ),
  definition('artifact_list', 'List documents created by you in this office.'),
  definition('artifact_read', 'Read one document you own by its artifact ID.', { id: textProperty }, ['id']),
];

/** Local tools persist separately from renderer workspace snapshots and their rollback history. */
export class EmployeeTools implements AgentToolRuntime {
  private serial: Promise<unknown> = Promise.resolve();
  constructor(
    private store: SnapshotStore,
    private getState: () => Promise<AppState | null>,
    private now: () => number = Date.now,
  ) {}

  definitions(context: AgentToolContext): Record<string, unknown>[] {
    const config = resolveAgentConfig(context.config);
    return definitions.filter((tool) => this.enabled(tool.name, config));
  }

  requiresApproval(name: string, context: AgentToolContext): boolean {
    return (
      (name === 'memory_forget' && context.config.memory.write === 'propose') ||
      (context.config.autonomy.toolApproval === 'ask' &&
        (name === 'office_send_message' ||
          name === 'artifact_write' ||
          name === 'memory_forget' ||
          (name === 'memory_remember' && context.config.memory.write === 'automatic')))
    );
  }

  async context(context: AgentToolContext): Promise<unknown> {
    const current = await this.current(context);
    return this.transaction((data) => ({
      memories: this.memoryResults(data, current),
      inbox: current.config.communication.receiveMessages
        ? data.messages.filter((message) => this.receivable(message, current)).slice(-30)
        : [],
    }));
  }

  async execute(name: string, args: unknown, context: AgentToolContext): Promise<unknown> {
    const current = await this.current(context);
    if (!this.enabled(name, current.config)) throw new Error(`Tool ${name} is disabled for this employee.`);
    if (this.requiresApproval(name, current) && !current.approved)
      throw new Error(`Tool ${name} requires the user's approval.`);
    const key = mutationNames.has(name) ? this.receiptKey(current) : undefined;
    const fingerprint = createHash('sha256').update(JSON.stringify({ name, args })).digest('hex');
    return this.transaction(async (data) => {
      current.signal?.throwIfAborted();
      if (key && data.receipts[key]) {
        if (data.receipts[key].fingerprint !== fingerprint)
          throw new Error('This tool call ID was already used for a different action.');
        return data.receipts[key].result;
      }
      const result = await this.run(name, args, current, data);
      current.signal?.throwIfAborted();
      if (key) data.receipts[key] = { fingerprint, result };
      return result;
    }, 'tool');
  }

  async listMemory(employeeId: string, sessionId?: string): Promise<AgentMemory[]> {
    await this.employee(employeeId);
    return this.transaction((data) =>
      data.memories.filter(
        (memory) =>
          memory.employeeId === employeeId &&
          (!sessionId || memory.scope !== 'session' || memory.sessionId === sessionId),
      ),
    );
  }
  async addMemory(employeeId: string, input: MemoryInput): Promise<AgentMemory> {
    const employee = await this.employee(employeeId),
      config = resolveAgentConfig(employee.agent);
    const fields = memoryInput.parse(input);
    return this.transaction(
      (data) => this.remember(data, employeeId, config, fields, { actor: 'user' }, 'active'),
      'user',
    );
  }
  async updateMemory(employeeId: string, memoryId: string, input: MemoryUpdate): Promise<AgentMemory> {
    const employee = await this.employee(employeeId),
      config = resolveAgentConfig(employee.agent);
    const fields = memoryUpdate.parse(input);
    return this.transaction((data) => {
      const memory = this.ownedMemory(data, employeeId, memoryId);
      const next = memoryInput.parse({
        kind: memory.kind,
        scope: memory.scope,
        content: memory.content,
        sessionId: memory.sessionId,
        ...fields,
      });
      this.validateMemory(config, next);
      this.validateSessionOwner(employeeId, next.sessionId);
      Object.assign(memory, next, {
        updatedAt: this.time(),
        expiresAt: this.expiry(config),
        editedBy: 'user',
      });
      if (next.scope !== 'session') delete memory.sessionId;
      return memory;
    }, 'user');
  }
  async forgetMemory(employeeId: string, memoryId: string): Promise<void> {
    await this.employee(employeeId);
    await this.transaction((data) => {
      this.ownedMemory(data, employeeId, memoryId);
      data.memories = data.memories.filter((memory) => memory.id !== memoryId);
    }, 'user');
  }
  async approveMemory(employeeId: string, memoryId: string): Promise<AgentMemory> {
    const employee = await this.employee(employeeId),
      config = resolveAgentConfig(employee.agent);
    return this.transaction((data) => {
      const memory = this.ownedMemory(data, employeeId, memoryId);
      this.validateMemory(config, memory);
      if (memory.status !== 'proposed') throw new Error('This memory is not awaiting approval.');
      memory.status = 'active';
      memory.approvedAt = memory.updatedAt = this.time();
      return memory;
    }, 'user');
  }
  async listMessages(employeeId: string): Promise<OfficeMessage[]> {
    await this.employee(employeeId);
    return this.transaction((data) =>
      data.messages.filter(
        (message) => message.fromEmployeeId === employeeId || message.toEmployeeId === employeeId,
      ),
    );
  }
  async pendingMessages(employeeId?: string): Promise<OfficeMessage[]> {
    if (employeeId) await this.employee(employeeId);
    return this.transaction((data) =>
      data.messages.filter(
        (message) => message.status === 'queued' && (!employeeId || message.toEmployeeId === employeeId),
      ),
    );
  }
  async deliverMessage(messageId: string, employeeId: string, sessionId: string): Promise<OfficeMessage> {
    const employee = await this.employee(employeeId),
      config = resolveAgentConfig(employee.agent);
    id.parse(sessionId);
    this.validateSessionOwner(employeeId, sessionId);
    return this.transaction((data) => {
      const message = this.incoming(data, messageId, employeeId);
      if (!config.communication.receiveMessages || !this.teammateAllowed(config, message.fromEmployeeId))
        throw new Error('This employee is not accepting messages from that teammate.');
      return this.markDelivered(message, sessionId);
    });
  }
  async listArtifacts(employeeId: string): Promise<AgentArtifact[]> {
    await this.employee(employeeId);
    return this.transaction((data) =>
      data.artifacts.filter((artifact) => artifact.employeeId === employeeId),
    );
  }
  async readArtifact(employeeId: string, artifactId: string): Promise<AgentArtifact> {
    await this.employee(employeeId);
    return this.transaction((data) => this.ownedArtifact(data, employeeId, artifactId));
  }

  private async current(context: AgentToolContext): Promise<AgentToolContext> {
    context.signal?.throwIfAborted();
    id.parse(context.sessionId);
    z.number().int().nonnegative().parse(context.depth);
    z.number().int().nonnegative().parse(context.turn);
    const employee = await this.employee(context.employeeId);
    const session = this.store.get<{ employeeId?: string }>(`session:${context.sessionId}`);
    if (session?.employeeId && session.employeeId !== employee.id)
      throw new Error('This session belongs to another employee.');
    return { ...context, config: resolveAgentConfig(employee.agent ?? context.config) };
  }
  private async employee(employeeId: string): Promise<Employee> {
    id.parse(employeeId);
    const employee = (await this.getState())?.employees.find((entry) => entry.id === employeeId);
    if (!employee) throw new Error('Employee not found in this workspace.');
    return employee;
  }
  private enabled(name: string, config: AgentConfig): boolean {
    if (name === 'memory_search') return config.memory.enabled;
    if (name === 'memory_remember' || name === 'memory_forget')
      return config.memory.enabled && config.memory.write !== 'off';
    if (name === 'office_list_employees')
      return config.communication.sendMessages || config.communication.receiveMessages;
    if (name === 'office_send_message') return config.communication.sendMessages;
    if (name === 'office_read_inbox' || name === 'office_acknowledge_message')
      return config.communication.receiveMessages;
    if (name === 'workspace_read' || name === 'workspace_search') return config.tools.workspaceRead;
    if (name === 'artifact_write' || name === 'artifact_list' || name === 'artifact_read')
      return config.tools.artifactWrite;
    return false;
  }
  private receiptKey(context: AgentToolContext): string {
    if (!context.callId) throw new Error('A stable tool call ID is required for a mutating action.');
    id.max(500).parse(context.callId);
    return JSON.stringify([context.employeeId, context.sessionId, context.callId]);
  }
  private async transaction<T>(
    operation: (data: ToolData) => T | Promise<T>,
    source: OfficeEventInput['source'] = 'system',
  ): Promise<T> {
    const run = this.serial.then(async () => {
      const data = this.store.get<ToolData>(DATA_KEY) ?? {
        memories: [],
        messages: [],
        artifacts: [],
        receipts: {},
      };
      const before = JSON.stringify(data);
      data.memories = data.memories.filter((memory) => Date.parse(memory.expiresAt) > this.now());
      const state = await this.getState();
      for (const employee of state?.employees ?? []) {
        const config = resolveAgentConfig(employee.agent);
        const owned = data.memories
          .filter(
            (memory) =>
              memory.employeeId === employee.id &&
              Date.parse(memory.updatedAt) + config.memory.retentionDays * 86_400_000 > this.now(),
          )
          .sort(
            (a, b) =>
              b.updatedAt.localeCompare(a.updatedAt) || data.memories.indexOf(b) - data.memories.indexOf(a),
          );
        const retained = new Set(owned.slice(0, config.memory.maxEntries).map((memory) => memory.id));
        data.memories = data.memories.filter(
          (memory) => memory.employeeId !== employee.id || retained.has(memory.id),
        );
      }
      this.redactRetiredMemory(data);
      const result = await operation(data);
      this.redactRetiredMemory(data);
      if (JSON.stringify(data) !== before)
        await this.store.putAudited(
          DATA_KEY,
          data,
          this.auditChanges(JSON.parse(before) as ToolData, data, source),
        );
      return structuredClone(result);
    });
    this.serial = run.catch(() => undefined);
    return run;
  }
  private auditChanges(
    before: ToolData,
    after: ToolData,
    source: OfficeEventInput['source'],
  ): OfficeEventInput[] {
    const events: OfficeEventInput[] = [];
    for (const memory of after.memories) {
      const previous = before.memories.find((item) => item.id === memory.id);
      if (JSON.stringify(previous) === JSON.stringify(memory)) continue;
      const kind =
        memory.status === 'proposed'
          ? 'memory.proposed'
          : previous?.status === 'active'
            ? 'memory.updated'
            : 'memory.saved';
      events.push({
        id: `memory:${memory.id}:${createHash('sha256').update(JSON.stringify(memory)).digest('hex')}`,
        kind,
        source,
        employeeId: memory.employeeId,
        memoryId: memory.id,
        memoryKind: memory.kind,
        memoryScope: memory.scope,
        contentHash: createHash('sha256').update(memory.content).digest('hex'),
        ...((memory.sessionId ?? memory.provenance.sessionId)
          ? { sessionId: memory.sessionId ?? memory.provenance.sessionId }
          : {}),
        summary: `${memory.status === 'proposed' ? 'Placed a memory card in the review tray' : 'Filed a memory card'}: ${memory.kind}, ${memory.scope} scope.`,
        occurredAt: memory.updatedAt,
      });
    }
    for (const memory of before.memories.filter(
      (item) => !after.memories.some((next) => next.id === item.id),
    ))
      events.push({
        id: `memory:${memory.id}:forgotten`,
        kind: 'memory.forgotten',
        source,
        employeeId: memory.employeeId,
        memoryId: memory.id,
        memoryKind: memory.kind,
        memoryScope: memory.scope,
        summary: `Removed a ${memory.kind} memory card from ${memory.scope} storage.`,
      });
    for (const message of after.messages) {
      const previous = before.messages.find((item) => item.id === message.id);
      if (previous?.status === message.status) continue;
      const base = {
        source,
        messageId: message.id,
        sessionId: message.sessionId,
        employeeId: message.fromEmployeeId,
        targetEmployeeId: message.toEmployeeId,
        ...(message.deliveredSessionId ? { targetSessionId: message.deliveredSessionId } : {}),
      };
      if (!previous)
        events.push({
          ...base,
          id: `message:${message.id}:queued`,
          kind: 'message.queued',
          summary: 'Placed an addressed envelope in the outgoing tray.',
          occurredAt: message.createdAt,
        });
      if (message.deliveredAt && !previous?.deliveredAt)
        events.push({
          ...base,
          id: `message:${message.id}:delivered`,
          kind: 'message.delivered',
          summary: 'Delivered the message to the recipient session.',
          occurredAt: message.deliveredAt,
        });
      if (message.acknowledgedAt && !previous?.acknowledgedAt)
        events.push({
          ...base,
          id: `message:${message.id}:acknowledged`,
          kind: 'message.acknowledged',
          summary: 'The recipient explicitly stamped the message received.',
          occurredAt: message.acknowledgedAt,
        });
    }
    for (const artifact of after.artifacts.filter(
      (item) => !before.artifacts.some((previous) => previous.id === item.id),
    ))
      events.push({
        id: `artifact:${artifact.id}:created`,
        kind: 'artifact.created',
        source,
        employeeId: artifact.employeeId,
        sessionId: artifact.sessionId,
        artifactId: artifact.id,
        contentHash: createHash('sha256').update(artifact.content).digest('hex'),
        summary: `Saved a document to the deliverable shelf: ${artifact.title}`,
        occurredAt: artifact.createdAt,
      });
    return events;
  }
  private time(): string {
    return new Date(this.now()).toISOString();
  }
  private redactRetiredMemory(data: ToolData): void {
    const memories = new Map(data.memories.map((memory) => [memory.id, memory]));
    for (const receipt of Object.values(data.receipts)) {
      const memory = receipt.result as Partial<AgentMemory> | undefined;
      if (memory && memory.kind && memory.scope && memory.employeeId && memory.id)
        receipt.result = memories.get(memory.id) ?? { id: memory.id, forgotten: true };
    }
  }
  private expiry(config: AgentConfig): string {
    return new Date(this.now() + config.memory.retentionDays * 86_400_000).toISOString();
  }
  private validateMemory(config: AgentConfig, memory: MemoryInput): void {
    if (!config.memory.enabled) throw new Error('Memory is disabled for this employee.');
    if (!config.memory.kinds.includes(memory.kind))
      throw new Error('This memory type is disabled for this employee.');
    if (!config.memory.scopes.includes(memory.scope))
      throw new Error('This memory scope is disabled for this employee.');
    if (memory.scope === 'session' && !memory.sessionId)
      throw new Error('Session memory requires a session ID.');
    if (containsSecret(memory.content))
      throw new Error('Memory must not contain credentials or private keys.');
  }
  private remember(
    data: ToolData,
    employeeId: string,
    config: AgentConfig,
    fields: MemoryInput,
    provenance: AgentMemory['provenance'],
    status: AgentMemory['status'],
  ): AgentMemory {
    this.validateMemory(config, fields);
    if (fields.scope === 'session') this.validateSessionOwner(employeeId, fields.sessionId);
    const memory: AgentMemory = {
      id: randomUUID(),
      employeeId,
      kind: fields.kind,
      scope: fields.scope,
      content: fields.content,
      ...(fields.scope === 'session' ? { sessionId: fields.sessionId } : {}),
      status,
      createdAt: this.time(),
      updatedAt: this.time(),
      expiresAt: this.expiry(config),
      provenance,
      ...(provenance.actor === 'user' ? { approvedAt: this.time() } : {}),
    };
    data.memories.push(memory);
    const owned = data.memories
      .filter((entry) => entry.employeeId === employeeId)
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || data.memories.indexOf(b) - data.memories.indexOf(a),
      );
    const retained = new Set(owned.slice(0, config.memory.maxEntries).map((entry) => entry.id));
    data.memories = data.memories.filter(
      (entry) => entry.employeeId !== employeeId || retained.has(entry.id),
    );
    return memory;
  }
  private validateSessionOwner(employeeId: string, sessionId?: string): void {
    if (!sessionId) return;
    const session = this.store.get<{ employeeId?: string }>(`session:${sessionId}`);
    if (session?.employeeId && session.employeeId !== employeeId)
      throw new Error('This session belongs to another employee.');
  }
  private readable(memory: AgentMemory, context: AgentToolContext): boolean {
    return (
      context.config.memory.enabled &&
      memory.status === 'active' &&
      Date.parse(memory.expiresAt) > this.now() &&
      context.config.memory.kinds.includes(memory.kind) &&
      context.config.memory.scopes.includes(memory.scope) &&
      (memory.scope === 'workspace' ||
        (memory.employeeId === context.employeeId &&
          (memory.scope !== 'session' || memory.sessionId === context.sessionId)))
    );
  }
  private memoryResults(
    data: ToolData,
    context: AgentToolContext,
    query = '',
    kind?: MemoryKind,
    scope?: MemoryScope,
  ): AgentMemory[] {
    let remaining = context.config.memory.maxContextChars - 2;
    return data.memories
      .filter(
        (memory) =>
          this.readable(memory, context) &&
          (!kind || kind === memory.kind) &&
          (!scope || scope === memory.scope) &&
          (!query || memory.content.toLowerCase().includes(query.toLowerCase())),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, context.config.memory.maxEntries)
      .flatMap((memory) => {
        const overhead = JSON.stringify({ ...memory, content: '' }).length + 1;
        if (remaining <= overhead) return [];
        const result = { ...memory, content: memory.content.slice(0, remaining - overhead) };
        while (JSON.stringify(result).length + 1 > remaining)
          result.content = result.content.slice(
            0,
            Math.max(0, result.content.length - (JSON.stringify(result).length + 1 - remaining)),
          );
        remaining -= JSON.stringify(result).length + 1;
        return [result];
      });
  }
  private ownedMemory(data: ToolData, employeeId: string, memoryId: string): AgentMemory {
    const memory = data.memories.find((entry) => entry.id === memoryId && entry.employeeId === employeeId);
    if (!memory) throw new Error('Memory not found or owned by another employee.');
    return memory;
  }
  private teammateAllowed(config: AgentConfig, employeeId: string): boolean {
    return !config.communication.teammateIds.length || config.communication.teammateIds.includes(employeeId);
  }
  private receivable(message: OfficeMessage, context: AgentToolContext): boolean {
    return (
      message.toEmployeeId === context.employeeId &&
      this.teammateAllowed(context.config, message.fromEmployeeId)
    );
  }
  private incoming(data: ToolData, messageId: string, employeeId: string): OfficeMessage {
    const message = data.messages.find(
      (entry) => entry.id === messageId && entry.toEmployeeId === employeeId,
    );
    if (!message) throw new Error('Message not found in this employee inbox.');
    return message;
  }
  private markDelivered(message: OfficeMessage, sessionId: string): OfficeMessage {
    if (message.status === 'queued') {
      message.status = 'delivered';
      message.deliveredAt = this.time();
      message.deliveredSessionId = sessionId;
    }
    return message;
  }
  private ownedArtifact(data: ToolData, employeeId: string, artifactId: string): AgentArtifact {
    const artifact = data.artifacts.find(
      (entry) => entry.id === artifactId && entry.employeeId === employeeId,
    );
    if (!artifact) throw new Error('Artifact not found or owned by another employee.');
    return artifact;
  }
  private selectedFiles(context: AgentToolContext): { folder: string; path: string; content: string }[] {
    const files = z
      .array(
        z.object({
          folder: z.string().max(255),
          path: z.string().max(2000),
          content: z.string().max(512_000),
        }),
      )
      .max(1000)
      .parse(context.files);
    if (files.reduce((size, file) => size + Buffer.byteLength(file.content), 0) > MAX_FOLDER_SIZE)
      throw new Error('Selected snapshot context exceeds its size limit.');
    return files.filter((file) => allowedPath(file.path) && !containsSecret(file.content));
  }

  private async run(
    name: string,
    args: unknown,
    context: AgentToolContext,
    data: ToolData,
  ): Promise<unknown> {
    if (name === 'memory_search') {
      const fields = z
        .strictObject({
          query: z.string().max(1000).optional(),
          kind: z.enum(MEMORY_KINDS).optional(),
          scope: z.enum(MEMORY_SCOPES).optional(),
        })
        .parse(args);
      return { memories: this.memoryResults(data, context, fields.query, fields.kind, fields.scope) };
    }
    if (name === 'memory_remember') {
      const fields = memoryInput.omit({ sessionId: true }).parse(args);
      return this.remember(
        data,
        context.employeeId,
        context.config,
        { ...fields, ...(fields.scope === 'session' ? { sessionId: context.sessionId } : {}) },
        { actor: 'employee', sessionId: context.sessionId, callId: context.callId, turn: context.turn },
        context.config.memory.write === 'propose' ? 'proposed' : 'active',
      );
    }
    if (name === 'memory_forget') {
      const fields = z.strictObject({ id }).parse(args),
        memory = this.ownedMemory(data, context.employeeId, fields.id);
      if (
        !this.readable(memory, context) &&
        !(
          memory.status === 'proposed' &&
          context.config.memory.kinds.includes(memory.kind) &&
          context.config.memory.scopes.includes(memory.scope) &&
          (memory.scope !== 'session' || memory.sessionId === context.sessionId)
        )
      )
        throw new Error('This memory is outside the current permitted scope.');
      data.memories = data.memories.filter((entry) => entry.id !== memory.id);
      return { id: memory.id, forgotten: true };
    }
    if (name === 'office_list_employees') {
      z.strictObject({}).parse(args);
      return {
        employees: (await this.getState())!.employees
          .filter(
            (employee) =>
              employee.id !== context.employeeId && this.teammateAllowed(context.config, employee.id),
          )
          .map(({ id: employeeId, name: employeeName, jobTitle, status }) => ({
            id: employeeId,
            name: employeeName,
            jobTitle,
            status,
          })),
      };
    }
    if (name === 'office_send_message') {
      const fields = z
        .strictObject({ employeeId: id, text: z.string().trim().min(1).max(12_000) })
        .parse(args);
      if (fields.employeeId === context.employeeId)
        throw new Error('Choose a different employee for the message.');
      if (!this.teammateAllowed(context.config, fields.employeeId))
        throw new Error('Messaging this teammate is disabled.');
      if (context.depth >= context.config.communication.maxHandoffs)
        throw new Error('The maximum employee handoff depth has been reached.');
      if (
        data.messages.filter(
          (message) =>
            message.fromEmployeeId === context.employeeId &&
            (message.runId ?? message.sessionId) === (context.runId ?? context.sessionId),
        ).length >= context.config.communication.maxHandoffs
      )
        throw new Error('The maximum number of employee handoffs for this run has been reached.');
      const recipient = await this.employee(fields.employeeId),
        receiverConfig = resolveAgentConfig(recipient.agent);
      if (
        !receiverConfig.communication.receiveMessages ||
        !this.teammateAllowed(receiverConfig, context.employeeId)
      )
        throw new Error('This employee is not accepting messages from that teammate.');
      if (containsSecret(fields.text))
        throw new Error('Messages must not contain credentials or private keys.');
      const message: OfficeMessage = {
        id: randomUUID(),
        fromEmployeeId: context.employeeId,
        toEmployeeId: fields.employeeId,
        text: fields.text,
        status: 'queued',
        sessionId: context.sessionId,
        ...(context.runId ? { runId: context.runId } : {}),
        depth: context.depth + 1,
        createdAt: this.time(),
      };
      data.messages.push(message);
      return message;
    }
    if (name === 'office_read_inbox') {
      const fields = z.strictObject({ unreadOnly: z.boolean().optional() }).parse(args);
      const messages = data.messages
        .filter(
          (message) =>
            this.receivable(message, context) && (!fields.unreadOnly || message.status !== 'acknowledged'),
        )
        .slice(-50);
      for (const message of messages) this.markDelivered(message, context.sessionId);
      return { messages };
    }
    if (name === 'office_acknowledge_message') {
      const fields = z.strictObject({ id }).parse(args),
        message = this.incoming(data, fields.id, context.employeeId);
      if (!this.receivable(message, context))
        throw new Error('This message is outside your permitted teammates.');
      if (message.status === 'queued')
        throw new Error('Read the message in your inbox before acknowledging it.');
      message.status = 'acknowledged';
      message.acknowledgedAt ??= this.time();
      return message;
    }
    if (name === 'workspace_search') {
      const fields = z
        .strictObject({
          query: z.string().trim().min(1).max(1000),
          maxResults: z.number().int().min(1).max(30).optional(),
        })
        .parse(args);
      return {
        matches: this.selectedFiles(context)
          .flatMap((file) => {
            const index = file.content.toLowerCase().indexOf(fields.query.toLowerCase());
            if (index < 0 && !file.path.toLowerCase().includes(fields.query.toLowerCase())) return [];
            const start = Math.max(0, index - 150);
            return [
              {
                folder: file.folder,
                path: file.path,
                excerpt: file.content.slice(start, start + 1200),
                offset: start,
              },
            ];
          })
          .slice(0, fields.maxResults ?? 10),
      };
    }
    if (name === 'workspace_read') {
      const fields = z
        .strictObject({
          path: z.string().min(1).max(2000),
          folder: z.string().max(255).optional(),
          offset: z.number().int().nonnegative().optional(),
          limit: z.number().int().min(1).max(30_000).optional(),
        })
        .parse(args);
      if (!allowedPath(fields.path)) throw new Error('Only selected snapshot paths are readable.');
      const matches = this.selectedFiles(context).filter(
        (file) => file.path === fields.path && (fields.folder === undefined || fields.folder === file.folder),
      );
      if (matches.length !== 1)
        throw new Error(
          matches.length
            ? 'Specify the folder for this ambiguous file path.'
            : 'This file was not selected for the session.',
        );
      const file = matches[0],
        offset = fields.offset ?? 0,
        limit = fields.limit ?? 12_000;
      return {
        folder: file.folder,
        path: file.path,
        content: file.content.slice(offset, offset + limit),
        offset,
        totalChars: file.content.length,
        truncated: offset + limit < file.content.length,
      };
    }
    if (name === 'artifact_write') {
      const fields = z
        .strictObject({
          title: z.string().trim().min(1).max(255),
          content: z.string().trim().min(1).max(200_000),
          mediaType: z.enum(['text/markdown', 'text/plain', 'application/json']).optional(),
        })
        .parse(args);
      if (containsSecret(fields.content))
        throw new Error('Artifacts must not contain credentials or private keys.');
      if (fields.mediaType === 'application/json') JSON.parse(fields.content);
      const artifact: AgentArtifact = {
        id: randomUUID(),
        employeeId: context.employeeId,
        sessionId: context.sessionId,
        title: fields.title,
        content: fields.content,
        mediaType: fields.mediaType ?? 'text/markdown',
        createdAt: this.time(),
        provenance: { callId: context.callId!, turn: context.turn },
      };
      data.artifacts.push(artifact);
      return artifact;
    }
    if (name === 'artifact_list') {
      z.strictObject({}).parse(args);
      return {
        artifacts: data.artifacts
          .filter((artifact) => artifact.employeeId === context.employeeId)
          .map(({ content: body, ...artifact }) => ({ ...artifact, chars: body.length })),
      };
    }
    if (name === 'artifact_read') {
      const fields = z.strictObject({ id }).parse(args);
      return this.ownedArtifact(data, context.employeeId, fields.id);
    }
    throw new Error(`Unknown employee tool: ${name}`);
  }
}
