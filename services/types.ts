import type {
  Cadence,
  Capability,
  CorrectionDescriptor,
  EmployeeKind,
  ModelId,
  Persona,
  ProviderId,
  TaskKind,
  TaskStatus,
  ToolMode,
} from '../lib/contracts';
import type { JobKind } from '../lib/jobs';

/** A reviewed tool with its execution policy, as stored in `registryTools`. */
export interface ToolPolicy {
  provider: ProviderId;
  name: string;
  mode: ToolMode;
  resourceArgument?: string;
  correction?: CorrectionDescriptor;
}

/** A connection with its sealed credential, only ever returned to services. */
export interface PrivateConnection {
  id: string;
  provider: ProviderId;
  serverUrl: string;
  status: string;
  ownerSubject: string;
  /** Allowed tools already intersected with the employee version's capability. */
  allowedTools: string[];
  resourceScope: string;
  credentialCiphertext: string;
  credentialKeyVersion?: string;
}

/** Queue kinds the worker runs, named once in `lib/jobs.ts` and shared with the planner. */
export type { JobKind };

export interface Job {
  id: string;
  kind: JobKind;
  taskId: string;
  payload: Record<string, unknown>;
  leaseToken: string;
  attempts: number;
}

/** Everything the worker and gateway need for one task, from `services/sessions:taskContext` and `services/actions:gatewayContext`. */
export interface TaskContext {
  floor?: { id: string; name: string; brief: string };
  task: {
    id: string;
    workspaceId: string;
    title: string;
    prompt: string;
    status: TaskStatus;
    kind: TaskKind;
    cadence?: Cadence;
    projectId?: string;
    sessionId?: string;
    model: ModelId;
    createdBy: string;
    createdAt: number;
    /**
     * Session tokens recorded before this turn. A session's reported usage is cumulative, so a turn
     * that wants its own cost subtracts this from what the session reports afterwards.
     */
    usage?: { input: number; cached: number; output: number };
  };
  employee: { id: string; name: string; kind: EmployeeKind };
  employeeVersion: {
    id: string;
    model: ModelId;
    instructions: string;
    skills: { name: string; description?: string; content: string }[];
    capabilities: Capability[];
    persona?: Persona;
  };
  connections: PrivateConnection[];
  /** Policies for every provider the task's connections cover. */
  policies: ToolPolicy[];
  runToken: string;
}

/** What `services/actions:gatewayContext` returns: live authorization for one run token. */
export interface GatewayContext {
  task: {
    id: string;
    workspaceId: string;
    status: TaskStatus;
    kind: TaskKind;
    createdBy: string;
    floorId?: string;
    projectId?: string;
  };
  /** The instance the run belongs to. Its kind is what the gateway's role check turns on. */
  employee: { id: string; name: string; kind: EmployeeKind };
  employeeVersion: { id: string; capabilities: Capability[] };
  connections: PrivateConnection[];
  policies: ToolPolicy[];
}

export type SessionContext = {
  task: TaskContext['task'];
  archivedStorageKeys: string[];
  inputRevision: string;
  pendingInput: boolean;
};

/** Provider configuration as read by web, worker, and gateway from `services/config:providers`. */
export interface ProviderRuntimeConfig {
  provider: ProviderId;
  enabledUrls: string[];
  oauthClients: {
    serverUrl?: string;
    clientId: string;
    clientSecretCiphertext?: string;
    scopes?: string;
    authorizationUrl?: string;
    tokenUrl?: string;
    tokenAuthMethod?: 'client_secret_basic' | 'client_secret_post' | 'none';
  }[];
  inboxSecretCiphertext?: string;
  reviewedTools: number;
}
