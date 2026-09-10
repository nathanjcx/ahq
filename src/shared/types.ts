import type { NewsCollection } from './news';
export type Source = 'gmail' | 'calendar' | 'imessage' | 'slack' | 'discord' | 'linear' | 'asana';
export type ActivityKind = 'idle' | 'walking' | 'reading' | 'researching' | 'drafting' | 'coding' | 'scheduling' | 'collaborating' | 'waiting' | 'celebrating';
export type WorkStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting';
export type Scenario = 'report' | 'bug' | 'meeting' | 'dinner' | 'qa';
export interface SourceAttachment { id: string; name: string; mediaType: string; content: string }
export interface SourceItem {
  id: string; source: Source; externalId: string; threadId: string; author: string;
  title: string; content: string; timestamp: number; channel?: string;
  scenario?: Scenario; disposition?: 'pending' | 'triaging' | 'ignored' | 'attached' | 'work' | 'waiting' | 'error'; reason?: string;
  attachments?: SourceAttachment[];
}
export interface TriageRecord {
  id: string; sourceId: string; status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: number; completedAt?: number; action?: 'ignore' | 'create' | 'attach' | 'wait';
  reason?: string; workId?: string; error?: string; threadId?: string; turnId?: string;
}
export interface ReplayEntry { id: string; label: string; source: Source; delivered: boolean; item?: SourceItem }
export interface Agent {
  id: string; name: string; role: string; color: string; hair: string; skin: string;
  accessory: 'glasses' | 'cap' | 'headphones' | 'none'; persistent: boolean;
  activity: ActivityKind; statusText: string; workId?: string; home: number;
  temporary?: boolean; spawnedAt?: number; retiredAt?: number;
}
export interface WorkItem {
  id: string; title: string; goal: string; sourceIds: string[]; agentId: string;
  status: WorkStatus; scenario: Scenario; createdAt: number; completedAt?: number;
  mode: 'demo' | 'live'; error?: string; routineId?: string;
  triggerSourceId?: string; parentWorkId?: string; dependsOnWorkIds?: string[];
  inputArtifactIds?: string[]; blockedReason?: string; needsInformation?: boolean; followUpOf?: string;
  calendarDraft?: CalendarEvent;
}
export interface Run {
  id: string; workId: string; status: WorkStatus; startedAt: number; completedAt?: number;
  threadId?: string; turnId?: string; workspace?: string;
}
export interface ActivityEvent {
  id: string; sequence: number; timestamp: number; workId?: string; agentId?: string;
  kind: 'status' | 'tool' | 'artifact' | 'board' | 'error' | 'system'; text: string;
}
export interface Artifact {
  id: string; workId: string; title: string; kind: 'report' | 'brief' | 'patch' | 'calendar' | 'qa';
  content: string; createdAt: number; filePath?: string; simulated: boolean;
  supersedesArtifactId?: string;
  news?: NewsCollection;
}
export interface BoardPost {
  id: string; agentId: string; workId?: string; artifactId?: string;
  kind: 'finding' | 'request' | 'handoff' | 'complete' | 'chatter'; text: string; timestamp: number;
  simulated?: boolean; replyTo?: string;
}
export interface Routine {
  kind?: 'ai-news';
  id: string; agentId: string; name: string; instructions: string; enabled: boolean;
  schedule: 'interval' | 'daily'; intervalMinutes: number; dailyTime: string;
  nextRunAt: number; lastRunAt?: number; notes: string;
}
export interface CalendarEvent {
  id: string; title: string; start: string; end: string; attendees: string[];
  location: string; description: string; sourceIds: string[]; simulated: boolean;
}
export interface AuthState {
  status: 'checking' | 'unavailable' | 'signed-out' | 'signing-in' | 'signed-in' | 'error';
  email?: string; plan?: string; method?: string; error?: string; loginUrl?: string;
}
export interface Snapshot {
  revision: number; sources: SourceItem[]; agents: Agent[]; work: WorkItem[]; runs: Run[];
  activity: ActivityEvent[]; artifacts: Artifact[]; board: BoardPost[]; routines: Routine[];
  calendar: CalendarEvent[]; auth: AuthState; triage: TriageRecord[];
  settings: { mode: 'demo' | 'live'; reducedMotion: boolean; sound: boolean; model: string };
  demo: { playing: boolean; nextIndex: number; speed: number; startedAt?: number; events?: ReplayEntry[] };
}
export type Command =
  | { type: 'snapshot' }
  | { type: 'auth.refresh' | 'auth.login' | 'auth.cancel' | 'auth.logout' }
  | { type: 'demo.play' | 'demo.pause' | 'demo.next' | 'demo.reset' }
  | { type: 'demo.speed'; speed: number }
  | { type: 'demo.deliver'; id: string; changes?: Pick<SourceItem, 'source' | 'author' | 'title' | 'content' | 'threadId'> }
  | { type: 'source.ingest'; item: Omit<SourceItem, 'scenario' | 'disposition' | 'reason'> }
  | { type: 'calendar.create'; event: Omit<CalendarEvent, 'id' | 'sourceIds' | 'simulated'> }
  | { type: 'scenario.run'; scenario: Scenario }
  | { type: 'source.evaluate'; id: string }
  | { type: 'work.cancel' | 'work.retry'; id: string }
  | { type: 'work.steer'; id: string; text: string }
  | { type: 'routine.save'; routine: Omit<Routine, 'id' | 'nextRunAt'> & { id?: string } }
  | { type: 'routine.toggle' | 'routine.run' | 'routine.delete'; id: string }
  | { type: 'board.post'; text: string; workId?: string }
  | { type: 'settings.update'; settings: Partial<Snapshot['settings']> };
export interface OfficeBridge {
  command(command: Command): Promise<Snapshot>;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
  openArtifact(id: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  platform: string;
}
declare global { interface Window { office?: OfficeBridge } }
