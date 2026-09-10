import type { LaunchStep } from './launch';
import type { CloudSession } from './types';

export interface DemoAttachment {
  name: string;
  content: string;
  mediaType: string;
  encoding?: 'base64';
}
export type LocalTaskKind = 'report' | 'meeting' | 'bug' | 'qa' | 'triage' | 'product';
export interface LocalTaskInput {
  kind: LocalTaskKind;
  title: string;
  files: DemoAttachment[];
  sourceId?: string;
  project?: 'little-office';
  launchStep?: LaunchStep;
  launchId?: string;
  parentWorkspace?: string;
  parentSessionId?: string;
}
export interface LocalArtifact {
  id: string;
  title: string;
  kind: 'report' | 'brief' | 'patch' | 'qa' | 'product';
  filePath: string;
  content: string;
  simulated: boolean;
}
export interface SessionMessage {
  id: string;
  text: string;
  complete: boolean;
  timestamp: number;
}
export interface DemoTrigger {
  kind: 'meeting' | 'email' | 'slack';
  idempotencyKey?: string;
  title?: string;
  content?: string;
  attachments?: DemoAttachment[];
}
export interface DemoNotification {
  id: string;
  kind: DemoTrigger['kind'];
  title: string;
  content: string;
  attachments: DemoAttachment[];
  receivedAt: string;
  status: 'triaging' | 'working' | 'completed' | 'ignored' | 'failed';
  triageSessionId?: string;
  sessionId?: string;
  employeeId?: string;
  error?: string;
  idempotencyKey?: string;
}
export interface DemoSnapshot {
  notifications: DemoNotification[];
  sessions: CloudSession[];
  triggerAddress?: string;
}
