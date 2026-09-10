import type { AgentConfig } from './agent-config';
export type { AgentConfig, MemoryKind, MemoryScope, ReasoningEffort } from './agent-config';

export type Page =
  | 'office'
  | 'employees'
  | 'announce'
  | 'commitments'
  | 'conversations'
  | 'needs-you'
  | 'settings'
  | 'activity';
export type EmployeeStatus = 'working' | 'review' | 'ready' | 'offline';
export interface Appearance {
  gender: 'neutral' | 'feminine' | 'masculine';
  skin: string;
  hair: string;
  hairstyle: 'short' | 'long' | 'bald';
  hat: 'none' | 'cap' | 'beanie';
  glasses: boolean;
  clothing: string;
}
export interface Employee {
  id: string;
  name: string;
  jobTitle: string;
  personality: string;
  skills: string;
  color: string;
  avatar: number;
  status: EmployeeStatus;
  activity: string;
  location: 'desk' | 'library' | 'meeting' | 'board';
  sessionId?: string;
  appearance?: Appearance;
  agent?: AgentConfig;
}
export interface Commitment {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  recipient: string;
  deadline: string;
  firm: boolean;
  status: 'in-progress' | 'review' | 'done' | 'planned';
  progress: number;
  nextStep: string;
  dependencies: string[];
  source: string;
  definitionOfDone: string;
}
export interface Message {
  id: string;
  authorId: string;
  channel: 'team' | 'announce' | string;
  text: string;
  time: string;
  acknowledgmentIds?: string[];
}
export interface Approval {
  id: string;
  employeeId: string;
  title: string;
  summary: string;
  content: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'changes-requested';
  commitmentId?: string;
  kind: 'document' | 'decision';
  recipient: string;
  sources: string[];
  version: number;
  sessionId?: string;
}
export interface WorkEvent {
  id: string;
  employeeId?: string;
  text: string;
  time: string;
  kind: 'work' | 'review' | 'announcement' | 'system';
  source: 'example' | 'local' | 'cloud';
}
export interface FolderFile {
  path: string;
  size: number;
  excerpt: string;
}
export interface WorkspaceFolder {
  id: string;
  name: string;
  files: FolderFile[];
  createdAt: string;
  excludedCount: number;
}
export interface AppState {
  schemaVersion: 1;
  workspaceName: string;
  goal: string;
  employees: Employee[];
  commitments: Commitment[];
  messages: Message[];
  approvals: Approval[];
  events: WorkEvent[];
  folders: WorkspaceFolder[];
  reducedMotion: boolean;
  sound: boolean;
  demo: boolean;
}
export interface CloudSettings {
  provider?: 'openai' | 'gateway';
  model?: string;
  endpoint: string;
  configured: boolean;
  connected: boolean;
}
export interface CloudSession {
  reviewed?: boolean;
  id: string;
  status: 'queued' | 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'cancelled';
  activity: string;
  location: Employee['location'];
  events: { id: string; text: string; time: string }[];
  output?: { title: string; content: string; sources: string[]; recipient: string; version: number };
  config?: AgentConfig;
  configRevision?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    turns: number;
    toolCalls: number;
  };
  toolCalls?: { id: string; name: string; status: 'completed' | 'failed'; summary: string; time: string }[];
}
export interface OfficeFrame {
  time: number;
  sceneTime: number;
  listening: boolean;
  level: number;
  motion: boolean;
}
export interface HistoryEntry {
  id: number;
  time: number;
  reason: string;
}
export interface Integration {
  id: string;
  name: string;
  url: string;
  configured: boolean;
}
export interface DesktopAPI {
  officeRecordingBounds(): Promise<import('./office-events').OfficeRecordingBounds>;
  officeReplay(at: number): Promise<import('./office-events').OfficeReplayBundle>;
  exportOfficeAudit(): Promise<{
    exported: boolean;
    path?: string;
    verification: import('./office-events').OfficeAuditVerification;
  }>;
  onAgentSession(listener: (update: { employeeId: string; session: CloudSession }) => void): () => void;
  inspectAgent(employeeId: string): Promise<import('./agent-inspection').AgentInspection>;
  sendAgentMessage(input: {
    channel: string;
    text: string;
  }): Promise<{ employeeId: string; session?: CloudSession; error?: string }[]>;
  saveAgentMemory(input: {
    employeeId: string;
    id?: string;
    memory: import('./agent-inspection').MemoryInput;
  }): Promise<import('./agent-inspection').AgentMemory>;
  approveAgentMemory(input: {
    employeeId: string;
    id: string;
  }): Promise<import('./agent-inspection').AgentMemory>;
  forgetAgentMemory(input: { employeeId: string; id: string }): Promise<void>;
  readAgentArtifact(input: {
    employeeId: string;
    id: string;
  }): Promise<import('./agent-inspection').AgentArtifact>;
  recordFrame(frame: OfficeFrame): Promise<void>;
  frameAt(time: number): Promise<OfficeFrame | null>;
  history(): Promise<HistoryEntry[]>;
  historyState(id: number): Promise<AppState>;
  restoreHistory(id: number): Promise<AppState>;
  checkpoint(): Promise<HistoryEntry[]>;
  activity(): Promise<WorkEvent[]>;
  exportActivity(format: 'json' | 'csv'): Promise<boolean>;
  needsStorageSetup(): Promise<boolean>;
  useDefaultStorage(): Promise<void>;
  storageLocation(): Promise<string>;
  chooseDatabaseFolder(): Promise<string | null>;
  integrations(): Promise<Integration[]>;
  saveIntegration(input: { id?: string; name: string; url: string; key: string }): Promise<Integration[]>;
  removeIntegration(id: string): Promise<Integration[]>;
  configureOpenAI(input: { key: string; model: string }): Promise<CloudSettings>;
  microphonePermission(): Promise<boolean>;
  transcribe(input: { audio: ArrayBuffer; mime: string }): Promise<string>;
  broadcast(text: string): Promise<{ employeeId: string; session?: CloudSession; error?: string }[]>;
  cancelSession(id: string): Promise<CloudSession>;
  localCommand(
    command: import('../src/shared/types').Command,
  ): Promise<import('../src/shared/types').Snapshot>;

  loadState(): Promise<AppState | null>;
  saveState(state: AppState): Promise<void>;
  selectFolder(): Promise<WorkspaceFolder | null>;
  exportDocument(input: { title: string; content: string }): Promise<boolean>;
  getCloudSettings(): Promise<CloudSettings>;
  configureCloud(input: { endpoint: string; token: string }): Promise<CloudSettings>;
  disconnectCloud(): Promise<CloudSettings>;
  startSession(input: {
    employee: Employee;
    assignment: string;
    goal: string;
    folderIds: string[];
    allowCloudUpload: boolean;
  }): Promise<CloudSession>;
  getSession(id: string): Promise<CloudSession>;
  decideSession(input: {
    sessionId: string;
    version: number;
    decision: 'approve' | 'request_changes';
    feedback: string;
  }): Promise<CloudSession>;
}
declare global {
  interface Window {
    ahq?: DesktopAPI;
  }
}
