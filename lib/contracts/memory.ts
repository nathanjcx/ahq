export type MemoryScope = 'task' | 'agent' | 'floor' | 'project' | 'workspace';
export type MemoryKind = 'fact' | 'decision' | 'preference' | 'procedure' | 'glossary' | 'status';
export type MemoryStatus = 'proposed' | 'active' | 'contested' | 'archived';
export type MemoryAuthor = 'agent' | 'person' | 'janitor';

export interface Memory {
  id: string;
  scope: MemoryScope;
  scopeId: string;
  kind: MemoryKind;
  text: string;
  tags: string[];
  sourceTaskId?: string;
  author: MemoryAuthor;
  authorName: string;
  confidence: number;
  status: MemoryStatus;
  supersedesId?: string;
  contestedWithId?: string;
  contestReason?: string;
  expiresAt?: number;
  lastUsedAt?: number;
  createdAt: number;
  updatedAt: number;
}
export interface MemoryBudgets {
  workspace: number;
  project: number;
  floor: number;
  agent: number;
  summaries: number;
}
export interface MemoryScopeSummary {
  scope: MemoryScope;
  scopeId: string;
  name: string;
  active: number;
  proposed: number;
  contested: number;
  tokens: number;
  budget: number;
}
export interface TaskSummary {
  id: string;
  taskId: string;
  outcome: string;
  decisions: string[];
  openQuestions: string[];
  artifactIds: string[];
  text: string;
  inferred: boolean;
  createdAt: number;
}
/** What the janitor did to a claim during a curation run. */
export type JanitorAction = 'merged' | 'promoted' | 'contested';
/** One line of the janitor's log, read back off the claims its curation runs left behind. */
export interface JanitorLogEntry {
  id: string;
  action: JanitorAction;
  at: number;
  scope: MemoryScope;
  scopeId: string;
  /** The claim the action produced or landed on. */
  text: string;
  /** Why, in the janitor's own terms: the contest reason, or what a merge or promotion replaced. */
  detail: string;
  authorName: string;
}
