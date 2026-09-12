import type {
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

/** Queue kinds the worker runs. The first four predate the schedule; the rest arrive from it. */
export type JobKind =
  | 'start_task'
  | 'send_message'
  | 'cancel_task'
  | 'execute_action'
  | 'start_shift'
  | 'review_shift'
  | 'meeting_prep'
  | 'meeting_answer'
  | 'meeting_wrapup'
  | 'curation_run'
  | 'audit_run'
  | 'triage_run'
  | 'email_classify'
  | 'plan_project';

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
    projectId?: string;
    sessionId?: string;
    model: ModelId;
    createdBy: string;
    createdAt: number;
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
