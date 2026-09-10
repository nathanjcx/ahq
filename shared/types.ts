export type Page =
  'office' | 'employees' | 'announce' | 'commitments' | 'conversations' | 'needs-you' | 'settings';
export type EmployeeStatus = 'working' | 'review' | 'ready' | 'offline';
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
  endpoint: string;
  configured: boolean;
  connected: boolean;
}
export interface CloudSession {
  id: string;
  status: 'queued' | 'running' | 'waiting_for_approval' | 'completed' | 'failed';
  activity: string;
  location: Employee['location'];
  events: { id: string; text: string; time: string }[];
  output?: { title: string; content: string; sources: string[]; recipient: string; version: number };
}
export interface DesktopAPI {
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
