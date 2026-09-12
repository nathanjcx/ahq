import type { Capability, ModelId, TaskStatus } from '../lib/contracts';
import type { PrivateConnection } from '../lib/server/mcp';
export interface Job {
  id: string;
  kind: string;
  taskId: string;
  payload: Record<string, unknown>;
  leaseToken: string;
  attempts: number;
}
export interface TaskContext {
  project?: { id: string; name: string; brief: string };
  task: {
    id: string;
    title: string;
    prompt: string;
    status: TaskStatus;
    sessionId?: string;
    model: ModelId;
    createdAt: number;
  };
  employeeVersion: {
    id: string;
    model: ModelId;
    instructions: string;
    skills: { name: string; description?: string; content: string }[];
    capabilities: Capability[];
  };
  connections: PrivateConnection[];
  runToken: string;
  authorization: { workspaceId: string; userId: string };
}
export type SessionContext = Pick<TaskContext, 'task' | 'authorization'> & {
  archivedStorageKeys?: string[];
  inputRevision: string;
  pendingInput: boolean;
};
