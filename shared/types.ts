import type { LaunchAction, LaunchSnapshot, LaunchStep } from './launch';
import type {
  DemoTrigger,
  DemoNotification,
  DemoSnapshot,
  LocalArtifact,
  LocalTaskKind,
  SessionMessage,
} from './demo';
export type Page =
  | 'office'
  | 'employees'
  | 'announce'
  | 'commitments'
  | 'roadmap'
  | 'files'
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
  temporary?: boolean;
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
}
export interface Commitment {
  launchStep?: LaunchStep;
  launchId?: string;
  taskKind?: Exclude<LocalTaskKind, 'triage'>;
  sessionId?: string;
  assignment?: string;
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
  question?: string;
  choices?: string[];
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
  source: 'example' | 'local' | 'cloud' | 'chatgpt';
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
export interface LocalFileEntry {
  path: string;
  relativePath: string;
  name: string;
  kind: 'database' | 'document' | 'asset';
  size: number;
  modifiedAt: number;
}
export interface AppState {
  launchRestoreId?: string;
  schemaVersion: 1;
  workspaceName: string;
  goal: string;
  roadmap?: RoadmapRun;
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
export interface RoadmapRun {
  launchId?: string;
  automatic?: boolean;
  id: string;
  goal: string;
  status: 'planning' | 'active' | 'paused' | 'failed' | 'complete';
  message: string;
  createdAt: string;
  generatedAt?: string;
  milestoneIds: string[];
  assignments: {
    commitmentId: string;
    employeeId: string;
    sessionId?: string;
    status: 'starting' | 'assigned' | 'stopped';
  }[];
}
export interface CloudSettings {
  provider?: 'chatgpt' | 'openai' | 'gateway';
  account?: ChatGPTAccount;
  model?: string;
  endpoint: string;
  configured: boolean;
  connected: boolean;
  fallbackConfigured?: boolean;
}
export interface ChatGPTAccount {
  status: 'signed-in' | 'signed-out' | 'signing-in' | 'unavailable';
  email?: string;
  plan?: string;
  error?: string;
}
export interface CloudSession {
  employeeId?: string;
  title?: string;
  workspace?: string;
  taskKind?: LocalTaskKind;
  messages?: SessionMessage[];
  artifacts?: LocalArtifact[];
  reviewed?: boolean;
  id: string;
  status: 'queued' | 'running' | 'waiting_for_approval' | 'completed' | 'failed';
  activity: string;
  location: Employee['location'];
  events: { id: string; text: string; time: string }[];
  output?: {
    title: string;
    content: string;
    sources: string[];
    recipient: string;
    version: number;
    question?: string;
    choices?: string[];
  };
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
  launchSnapshot(): Promise<LaunchSnapshot>;
  launchAction(action: LaunchAction): Promise<LaunchSnapshot>;
  generatePersonality(input: { name: string; jobTitle: string }): Promise<string>;
  createRoadmap(goal: string, options?: { automatic?: boolean }): Promise<AppState>;
  triggerDemo(input: DemoTrigger): Promise<DemoNotification>;
  demoSnapshot(): Promise<DemoSnapshot>;
  retryDemo(id: string): Promise<DemoNotification>;
  openLocalArtifact(input: { sessionId: string; artifactId: string }): Promise<void>;
  controlRoadmap(action: 'pause' | 'resume'): Promise<AppState>;
  chatGPTAccount(): Promise<ChatGPTAccount>;
  loginChatGPT(): Promise<ChatGPTAccount>;
  cancelChatGPTLogin(): Promise<ChatGPTAccount>;
  useChatGPT(): Promise<CloudSettings>;
  configureChatGPTFallback(input: { key: string }): Promise<CloudSettings>;
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
  listFiles(): Promise<LocalFileEntry[]>;
  showFileInFinder(path: string): Promise<void>;
  showStorageInFinder(): Promise<void>;
  chooseDatabaseFolder(): Promise<string | null>;
  integrations(): Promise<Integration[]>;
  saveIntegration(input: { id?: string; name: string; url: string; key: string }): Promise<Integration[]>;
  removeIntegration(id: string): Promise<Integration[]>;
  configureOpenAI(input: { key: string; model: string }): Promise<CloudSettings>;
  microphonePermission(): Promise<boolean>;
  revealApplication(): Promise<void>;
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
